// Run with: node --test test/
// Exercises Google/Apple sign-in end to end against the in-memory user store,
// using locally generated keys in place of Google's and Apple's.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GOOGLE_WEB_CLIENT_ID = 'web-123.apps.googleusercontent.com';
process.env.GOOGLE_IOS_CLIENT_ID = 'ios-456.apps.googleusercontent.com';
process.env.APPLE_SIGNIN_ENABLED = 'true';
process.env.APPLE_BUNDLE_ID = 'com.yashasmahale.loopshot';
for (const k of ['MONGODB_URI', 'MONGODB_URL', 'STORAGE_URL', 'DATABASE_URL', 'MONGO_URL', 'MONGODB_CONNECTION_STRING']) delete process.env[k];

// The sandbox has no DNS; registration checks that the email domain has mail servers
require('dns').promises.resolveMx = async () => [{ exchange: 'mx.example.com', priority: 1 }];

const social = require('../api/social-auth');
const app = require('../api/index');

let server, base, keys;

test.before(async () => {
  const jose = await import('jose');
  const google = await jose.generateKeyPair('RS256');
  const apple = await jose.generateKeyPair('RS256');
  const other = await jose.generateKeyPair('RS256');
  const jwk = async (k, kid) => ({ ...(await jose.exportJWK(k.publicKey)), kid, alg: 'RS256' });
  const sets = {
    google: jose.createLocalJWKSet({ keys: [await jwk(google, 'g1')] }),
    apple: jose.createLocalJWKSet({ keys: [await jwk(apple, 'a1')] })
  };
  social._setJwksForTests(p => sets[p]);
  const sign = (pair, kid) => (claims, opts = {}) => new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime(opts.exp || '10m')
    .sign(pair.privateKey);
  keys = { google: sign(google, 'g1'), apple: sign(apple, 'a1'), forged: sign(other, 'g1') };
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = async (path, body, token) => {
  const r = await fetch(base + path, {
    method: path === '/api/auth/account' ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};
const googleToken = (sub, email, extra = {}) => keys.google({
  iss: 'https://accounts.google.com', aud: process.env.GOOGLE_WEB_CLIENT_ID, sub, email, email_verified: true, ...extra
});

test('providers endpoint reports what is configured', async () => {
  const r = await (await fetch(base + '/api/auth/providers')).json();
  assert.equal(r.google.webClientId, process.env.GOOGLE_WEB_CLIENT_ID);
  assert.equal(r.google.iosClientId, process.env.GOOGLE_IOS_CLIENT_ID);
  assert.deepEqual(r.apple, { enabled: true, bundleId: 'com.yashasmahale.loopshot' });
});

test('new Google player picks a username, then signs straight in next time', async () => {
  const first = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-100', 'ria.k99@gmail.com') });
  assert.equal(first.status, 200);
  assert.equal(first.body.needsUsername, true);
  assert.equal(first.body.suggestion, 'ria.k99');

  const taken = await post('/api/auth/social/complete', { signupToken: first.body.signupToken, username: 'x' });
  assert.equal(taken.status, 400);

  const done = await post('/api/auth/social/complete', { signupToken: first.body.signupToken, username: 'Ria_K' });
  assert.equal(done.status, 200);
  assert.equal(done.body.username, 'ria_k');
  assert.ok(done.body.token);

  const again = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-100', 'ria.k99@gmail.com') });
  assert.equal(again.body.username, 'ria_k');
  assert.ok(again.body.token);
  assert.equal(again.body.needsUsername, undefined);

  // Password sign-in on a Google-only account explains what to do
  const pw = await post('/api/auth/login', { username: 'ria_k', password: 'Whatever1!' });
  assert.equal(pw.status, 400);
  assert.match(pw.body.error, /Google/);
});

test('iOS client ID is accepted as an audience', async () => {
  const t = await googleToken('g-ios', 'ios.player@gmail.com', { aud: process.env.GOOGLE_IOS_CLIENT_ID });
  const r = await post('/api/auth/social', { provider: 'google', idToken: t });
  assert.equal(r.status, 200);
  assert.equal(r.body.needsUsername, true);
});

test('Google sign-in links to an existing password account with the same verified email', async () => {
  const reg = await post('/api/auth/register', { email: 'linkme@gmail.com', username: 'linker', password: 'Secret12!' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const r = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-200', 'linkme@gmail.com') });
  assert.equal(r.body.username, 'linker');
  assert.equal(r.body.linked, true);
  // Password still works too
  const pw = await post('/api/auth/login', { username: 'linker', password: 'Secret12!' });
  assert.equal(pw.status, 200);
});

test('unverified email is never used to link accounts', async () => {
  const reg = await post('/api/auth/register', { email: 'victim@gmail.com', username: 'victim', password: 'Secret12!' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const r = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-evil', 'victim@gmail.com', { email_verified: false }) });
  assert.equal(r.body.needsUsername, true);
  assert.equal(r.body.username, undefined);
});

test('rejects forged, wrong-audience, wrong-issuer and expired tokens', async () => {
  const forged = await keys.forged({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_WEB_CLIENT_ID, sub: 'x', email: 'a@b.co', email_verified: true });
  const wrongAud = await googleToken('x', 'a@b.co', { aud: 'someone-else.apps.googleusercontent.com' });
  const wrongIss = await googleToken('x', 'a@b.co', { iss: 'https://evil.example.com' });
  const expired = await keys.google({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_WEB_CLIENT_ID, sub: 'x' }, { exp: Math.floor(Date.now() / 1000) - 60 });
  for (const idToken of [forged, wrongAud, wrongIss, expired, 'not-a-jwt']) {
    const r = await post('/api/auth/social', { provider: 'google', idToken });
    assert.ok(r.status === 401 || r.status === 400, `expected rejection, got ${r.status}`);
    assert.equal(r.body.token, undefined);
  }
  const unknown = await post('/api/auth/social', { provider: 'myspace', idToken: await googleToken('x', 'a@b.co') });
  assert.equal(unknown.status, 400);
});

test('a signup token cannot be reused as a login token or forged', async () => {
  const first = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-300', 'n@gmail.com') });
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${first.body.signupToken}` } });
  assert.equal(me.status, 401);
  const score = await post('/api/scores', { mode: 'easy', score: 5 }, first.body.signupToken);
  assert.notEqual(score.status, 200, 'signup token must not save scores');
  const bad = await post('/api/auth/social/complete', { signupToken: 'abc.def.ghi', username: 'hacker' });
  assert.equal(bad.status, 401);
});

test('Apple sign-in works, including the string "true" for email_verified and no email', async () => {
  const t = await keys.apple({ iss: 'https://appleid.apple.com', aud: 'com.yashasmahale.loopshot', sub: 'apple-1', email: 'abc@privaterelay.appleid.com', email_verified: 'true' });
  const r = await post('/api/auth/social', { provider: 'apple', idToken: t });
  assert.equal(r.body.needsUsername, true);
  const done = await post('/api/auth/social/complete', { signupToken: r.body.signupToken, username: 'applefan' });
  assert.equal(done.status, 200);
  // Later Apple sign-ins often carry no email at all
  const t2 = await keys.apple({ iss: 'https://appleid.apple.com', aud: 'com.yashasmahale.loopshot', sub: 'apple-1' });
  const again = await post('/api/auth/social', { provider: 'apple', idToken: t2 });
  assert.equal(again.body.username, 'applefan');
  // A Google key can't sign an Apple token
  const cross = await googleToken('apple-1', null, { iss: 'https://appleid.apple.com', aud: 'com.yashasmahale.loopshot' });
  assert.equal((await post('/api/auth/social', { provider: 'apple', idToken: cross })).status, 401);
});

test('accounts without a password are deleted by typing the username', async () => {
  const first = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-del', 'del@gmail.com') });
  const done = await post('/api/auth/social/complete', { signupToken: first.body.signupToken, username: 'deleteme' });
  const token = done.body.token;
  const meRes = await (await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(meRes.hasPassword, false);
  assert.equal(meRes.google, true);

  const wrong = await post('/api/auth/account', { confirm: 'someone' }, token);
  assert.equal(wrong.status, 400);
  const ok = await post('/api/auth/account', { confirm: 'DeleteMe' }, token);
  assert.equal(ok.status, 200);
  const after = await post('/api/auth/social', { provider: 'google', idToken: await googleToken('g-del', 'del@gmail.com') });
  assert.equal(after.body.needsUsername, true);
});

test('password accounts still need their password to delete', async () => {
  const reg = await post('/api/auth/register', { email: 'pw@gmail.com', username: 'pwuser', password: 'Secret12!' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const token = reg.body.token;
  assert.equal((await post('/api/auth/account', { confirm: 'pwuser' }, token)).status, 400);
  assert.equal((await post('/api/auth/account', { password: 'Wrong123!' }, token)).status, 400);
  assert.equal((await post('/api/auth/account', { password: 'Secret12!' }, token)).status, 200);
});
