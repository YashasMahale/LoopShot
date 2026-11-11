// Sign in with Google / Apple.
//
// The app (or website) gets an ID token from Google or Apple and sends it here.
// We check the token's signature against the provider's public keys, then:
//   - sign in the account already linked to that Google/Apple user, or
//   - link it to an existing LoopShot account with the same verified email, or
//   - ask the player to pick a username (first sign-in), then create the account.
//
// Configuration (Vercel environment variables). A provider stays switched off
// until its variables are set, so nothing changes for players before then.
//   GOOGLE_WEB_CLIENT_ID   OAuth client ID of type "Web application" (required for Google)
//   GOOGLE_IOS_CLIENT_ID   OAuth client ID of type "iOS" (needed for the iPhone app)
//   APPLE_SIGNIN_ENABLED   "true" once Sign in with Apple is turned on for the iOS app
//   APPLE_BUNDLE_ID        defaults to com.yashasmahale.loopshot

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const SIGNUP_TOKEN_TTL = '20m';

function config() {
  const env = process.env;
  const googleWeb = (env.GOOGLE_WEB_CLIENT_ID || '').trim();
  const googleIos = (env.GOOGLE_IOS_CLIENT_ID || '').trim();
  return {
    google: googleWeb ? { webClientId: googleWeb, iosClientId: googleIos || null } : null,
    apple: /^(1|true|yes)$/i.test((env.APPLE_SIGNIN_ENABLED || '').trim())
      ? { bundleId: (env.APPLE_BUNDLE_ID || 'com.yashasmahale.loopshot').trim() }
      : null
  };
}

// jose is ESM-only, so load it lazily from this CommonJS file
let josePromise = null;
const jose = () => (josePromise = josePromise || import('jose'));

const jwksCache = {};
let jwksOverride = null; // tests only
async function jwksFor(provider) {
  if (jwksOverride) return jwksOverride(provider);
  if (!jwksCache[provider]) {
    const { createRemoteJWKSet } = await jose();
    jwksCache[provider] = createRemoteJWKSet(new URL(provider === 'google' ? GOOGLE_JWKS_URL : APPLE_JWKS_URL));
  }
  return jwksCache[provider];
}

class AuthError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Returns { sub, email, emailVerified } or throws AuthError
async function verifyIdToken(provider, idToken, cfg = config()) {
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3 || idToken.length > 8192) {
    throw new AuthError('Sign-in failed: the token is missing or malformed.');
  }
  const { jwtVerify } = await jose();
  let payload;
  try {
    if (provider === 'google') {
      if (!cfg.google) throw new AuthError('Google sign-in is not set up on the server yet.', 503);
      const audience = [cfg.google.webClientId, cfg.google.iosClientId].filter(Boolean);
      ({ payload } = await jwtVerify(idToken, await jwksFor('google'), { issuer: GOOGLE_ISSUERS, audience }));
    } else if (provider === 'apple') {
      if (!cfg.apple) throw new AuthError('Sign in with Apple is not set up on the server yet.', 503);
      ({ payload } = await jwtVerify(idToken, await jwksFor('apple'), { issuer: APPLE_ISSUER, audience: cfg.apple.bundleId }));
    } else {
      throw new AuthError('Unknown sign-in provider.');
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('Sign-in failed: the token could not be verified. Please try again.', 401);
  }
  if (!payload.sub) throw new AuthError('Sign-in failed: the token has no account ID.', 401);
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  return { sub: String(payload.sub), email, emailVerified };
}

// Suggest a username from the email's local part, e.g. "ria.k99@gmail.com" -> "ria.k99"
function suggestUsername(email) {
  if (!email) return '';
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 15);
  return base.length >= 3 ? base : '';
}

function registerSocialAuth(app, deps) {
  const { jwt, JWT_SECRET, isDatabaseConfigured, connectToDatabase, ensureUserIndexes, validateUsername } = deps;
  const subField = p => (p === 'google' ? 'googleSub' : 'appleSub');
  const emptyScores = () => ({ easy: 0, hard: 0, nightmare: 0 });

  const loginResponse = (username, user) => ({
    token: jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' }),
    username,
    bestScores: user.bestScores || emptyScores(),
    isSupporter: user.isSupporter || false
  });

  // In-memory store when no database is configured (local development)
  const local = () => (global.localUsers = global.localUsers || {});

  async function findUser(query) {
    if (isDatabaseConfigured()) {
      const { db } = await connectToDatabase();
      const user = await db.collection('users').findOne(query);
      return user ? { username: user._id, user } : null;
    }
    const [k, v] = Object.entries(query)[0];
    const entry = Object.entries(local()).find(([name, u]) => (k === '_id' ? name === v : u[k] === v));
    return entry ? { username: entry[0], user: entry[1] } : null;
  }

  async function linkProvider(username, provider, sub) {
    const field = subField(provider);
    if (isDatabaseConfigured()) {
      const { db } = await connectToDatabase();
      await db.collection('users').updateOne({ _id: username }, { $set: { [field]: sub } });
    } else {
      local()[username][field] = sub;
    }
  }

  // Which providers the client should offer
  app.get('/api/auth/providers', (req, res) => {
    const cfg = config();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      google: cfg.google ? { webClientId: cfg.google.webClientId, iosClientId: cfg.google.iosClientId } : null,
      apple: cfg.apple ? { enabled: true, bundleId: cfg.apple.bundleId } : null
    });
  });

  // Step 1: verify the provider token and sign in (or ask for a username)
  app.post('/api/auth/social', async (req, res) => {
    try {
      const { provider, idToken } = req.body || {};
      const id = await verifyIdToken(provider, idToken);

      // Already linked
      let found = await findUser({ [subField(provider)]: id.sub });
      if (found) return res.json(loginResponse(found.username, found.user));

      // Same verified email as an existing account: link and sign in
      if (id.email && id.emailVerified) {
        found = await findUser({ email: id.email });
        if (found) {
          await linkProvider(found.username, provider, id.sub);
          return res.json({ ...loginResponse(found.username, found.user), linked: true });
        }
      }

      // New player: they pick a username next
      const signupToken = jwt.sign(
        { typ: 'social-signup', provider, sub: id.sub, email: id.emailVerified ? id.email : null },
        JWT_SECRET,
        { expiresIn: SIGNUP_TOKEN_TTL }
      );
      return res.json({ needsUsername: true, signupToken, suggestion: suggestUsername(id.emailVerified ? id.email : null) });
    } catch (e) {
      if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
      console.error('Social sign-in error:', e);
      return res.status(500).json({ error: 'Sign-in failed. Please try again.' });
    }
  });

  // Step 2: create the account with the chosen username
  app.post('/api/auth/social/complete', async (req, res) => {
    try {
      const body = req.body || {};
      let claims;
      try {
        claims = jwt.verify(String(body.signupToken || ''), JWT_SECRET);
      } catch (e) {
        return res.status(401).json({ error: 'This sign-in has expired. Please sign in again.' });
      }
      if (claims.typ !== 'social-signup' || !['google', 'apple'].includes(claims.provider)) {
        return res.status(400).json({ error: 'Invalid sign-up request.' });
      }
      const u = validateUsername(body.username);
      if (u.error) return res.status(400).json({ error: u.error, field: 'username' });
      const username = u.value;
      const field = subField(claims.provider);

      // The same Google/Apple account may have finished sign-up in another tab
      const existing = await findUser({ [field]: claims.sub });
      if (existing) return res.json(loginResponse(existing.username, existing.user));

      const user = { bestScores: emptyScores(), isSupporter: false, createdAt: new Date(), [field]: claims.sub };
      if (claims.email) user.email = claims.email;

      if (isDatabaseConfigured()) {
        const { db } = await connectToDatabase();
        await ensureUserIndexes(db);
        const users = db.collection('users');
        if (await users.findOne({ _id: username }, { projection: { _id: 1 } })) {
          return res.status(400).json({ error: 'That username is taken. Try another one.', field: 'username' });
        }
        try {
          await users.insertOne({ _id: username, ...user });
        } catch (err) {
          if (err && err.code === 11000) {
            const emailClash = err.keyPattern && err.keyPattern.email;
            return res.status(400).json(emailClash
              ? { error: 'An account with this email already exists. Sign in with your password instead.', field: 'email' }
              : { error: 'That username is taken. Try another one.', field: 'username' });
          }
          throw err;
        }
      } else {
        if (local()[username]) return res.status(400).json({ error: 'That username is taken. Try another one.', field: 'username' });
        local()[username] = user;
      }
      return res.json(loginResponse(username, user));
    } catch (e) {
      console.error('Social sign-up error:', e);
      return res.status(500).json({ error: 'Could not create your account. Please try again.' });
    }
  });
}

module.exports = {
  registerSocialAuth,
  verifyIdToken,
  suggestUsername,
  AuthError,
  _setJwksForTests: fn => { jwksOverride = fn; }
};
