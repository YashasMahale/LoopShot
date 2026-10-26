const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

// Automatically load local .env / .env.local if present (for local testing)
['.env.local', '.env'].forEach(file => {
  const envPath = path.join(__dirname, '..', file);
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      });
    } catch (e) {
      // Ignore env read issues locally
    }
  }
});

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'loopshot-default-super-secret-key-123456';

// Support multiple Stripe key environment variable names
function getStripeKey() {
  return (
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_API_KEY ||
    process.env.STRIPE_SECRET ||
    process.env.STRIPE_KEY ||
    process.env.STRIPE_PRIVATE_KEY ||
    ''
  ).trim();
}

function getStripeWebhookSecret() {
  return (
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.STRIPE_SIGNING_SECRET ||
    process.env.STRIPE_ENDPOINT_SECRET ||
    ''
  ).trim();
}

function getStripeClient() {
  const key = getStripeKey();
  if (!key || key === 'sk_test_placeholder') return null;
  return new Stripe(key);
}

// Lemon Squeezy configuration helpers
function getLemonSqueezyApiKey() {
  return (
    process.env.LEMONSQUEEZY_API_KEY ||
    process.env.LEMON_SQUEEZY_API_KEY ||
    process.env.LEMONSQUEEZY_KEY ||
    process.env.LEMON_API_KEY ||
    ''
  ).trim();
}

function getLemonSqueezyStoreId() {
  return (
    process.env.LEMONSQUEEZY_STORE_ID ||
    process.env.LEMON_SQUEEZY_STORE_ID ||
    process.env.LEMON_STORE_ID ||
    ''
  ).trim();
}

function getLemonSqueezyVariantId() {
  return (
    process.env.LEMONSQUEEZY_VARIANT_ID ||
    process.env.LEMON_SQUEEZY_VARIANT_ID ||
    process.env.LEMON_VARIANT_ID ||
    ''
  ).trim();
}

function getLemonSqueezyWebhookSecret() {
  return (
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET ||
    process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ||
    process.env.LEMON_WEBHOOK_SECRET ||
    ''
  ).trim();
}

function isLemonSqueezyConfigured() {
  return Boolean(getLemonSqueezyApiKey() && getLemonSqueezyStoreId() && getLemonSqueezyVariantId());
}

function getOptionalUser(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function getBaseUrl(req) {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  if (req && req.headers && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers.host}`;
  }
  return 'http://localhost:3000';
}

// Middleware: Use raw body for Stripe & Lemon Squeezy Webhooks, JSON for other routes
app.use((req, res, next) => {
  const url = req.originalUrl || req.url;
  if (
    url === '/api/webhook' ||
    url === '/api/lemonsqueezy/webhook' ||
    url.startsWith('/api/webhook') ||
    url.startsWith('/api/lemonsqueezy/webhook')
  ) {
    express.raw({ type: '*/*' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, '../public')));

// Global High Score in-memory storage fallback
let globalScores = {
  easy: { score: 0, username: 'Guest' },
  hard: { score: 0, username: 'Guest' },
  nightmare: { score: 0, username: 'Guest' }
};

// Support multiple environment variable names injected by Vercel integrations / marketplaces
function getMongoUri() {
  return (
    process.env.MONGODB_URI ||
    process.env.MONGODB_URL ||
    process.env.STORAGE_URL ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URL ||
    process.env.MONGODB_CONNECTION_STRING ||
    ''
  ).trim();
}

function isDatabaseConfigured() {
  return Boolean(getMongoUri());
}

// Check database name configuration
function resolveDatabaseName(client) {
  if (process.env.MONGODB_DATABASE) {
    return process.env.MONGODB_DATABASE.trim();
  }
  try {
    const defaultDb = client.db();
    if (defaultDb.databaseName && defaultDb.databaseName !== 'test') {
      return defaultDb.databaseName;
    }
  } catch (e) {
    // fallback
  }
  return 'loopshot';
}

// Serverless-optimized MongoDB connection caching
let cachedClient = null;
let cachedDb = null;
let clientPromise = null;

async function connectToDatabase() {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MongoDB connection string is missing');
  }

  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });

    clientPromise = client.connect().then(connectedClient => {
      const dbName = resolveDatabaseName(connectedClient);
      const db = connectedClient.db(dbName);
      cachedClient = connectedClient;
      cachedDb = db;
      return { client: connectedClient, db };
    }).catch(err => {
      clientPromise = null; // Clear so subsequent requests can retry
      cachedClient = null;
      cachedDb = null;
      throw err;
    });
  }

  return clientPromise;
}

// Helper to fetch global high scores
async function getGlobalScores() {
  if (isDatabaseConfigured()) {
    try {
      const { db } = await connectToDatabase();
      const collection = db.collection('scores');
      const docs = await collection.find({}).toArray();
      const scores = {
        easy: { score: 0, username: 'Guest' },
        hard: { score: 0, username: 'Guest' },
        nightmare: { score: 0, username: 'Guest' }
      };
      docs.forEach(doc => {
        if (doc._id && scores[doc._id]) {
          scores[doc._id] = { score: doc.score, username: doc.username };
        }
      });
      return scores;
    } catch (e) {
      console.error('Failed to get scores from MongoDB, using local fallback:', e.message);
    }
  }
  return globalScores;
}

// Helper to save a global high score
async function updateGlobalScore(mode, score, username) {
  const cleanUsername = (username || 'Guest').substring(0, 15).trim() || 'Guest';
  const cleanMode = ['easy', 'hard', 'nightmare'].includes(mode) ? mode : 'easy';
  const cleanScore = parseInt(score, 10) || 0;

  const current = await getGlobalScores();
  
  if (!current[cleanMode] || cleanScore > current[cleanMode].score) {
    const updatedRecord = {
      score: cleanScore,
      username: cleanUsername,
      timestamp: Date.now()
    };

    // Keep in-memory cache updated
    globalScores[cleanMode] = updatedRecord;

    if (isDatabaseConfigured()) {
      try {
        const { db } = await connectToDatabase();
        const collection = db.collection('scores');
        await collection.updateOne(
          { _id: cleanMode },
          { $set: updatedRecord },
          { upsert: true }
        );
      } catch (e) {
        console.error('Failed to save score to MongoDB:', e.message);
      }
    }
    return { updated: true, globalBest: updatedRecord };
  }

  return { updated: false, globalBest: current[cleanMode] };
}

// Route for the Main Menu
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Route for the Game Arena
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/game.html'));
});

// GET high scores
app.get('/api/scores', async (req, res) => {
  try {
    const scores = await getGlobalScores();
    res.json(scores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/leaderboard - Top 10 players for each of the 3 modes separately
app.get('/api/leaderboard', async (req, res) => {
  try {
    const modes = ['easy', 'hard', 'nightmare'];
    const leaderboard = {
      easy: [],
      hard: [],
      nightmare: []
    };

    if (isDatabaseConfigured()) {
      try {
        const { db } = await connectToDatabase();
        const usersCol = db.collection('users');

        for (const mode of modes) {
          const query = {};
          query[`bestScores.${mode}`] = { $gt: 0 };

          const sortObj = {};
          sortObj[`bestScores.${mode}`] = -1;

          const topUsers = await usersCol
            .find(query, { projection: { _id: 1, bestScores: 1, isSupporter: 1 } })
            .sort(sortObj)
            .limit(10)
            .toArray();

          leaderboard[mode] = topUsers.map((u, idx) => ({
            rank: idx + 1,
            username: u._id,
            score: (u.bestScores && u.bestScores[mode]) || 0,
            isSupporter: Boolean(u.isSupporter)
          }));
        }

        return res.json(leaderboard);
      } catch (dbErr) {
        console.error('Failed to query leaderboard from MongoDB:', dbErr.message);
      }
    }

    // In-memory fallback
    if (global.localUsers) {
      for (const mode of modes) {
        const userList = Object.keys(global.localUsers)
          .map(uname => ({
            username: uname,
            score: (global.localUsers[uname].bestScores && global.localUsers[uname].bestScores[mode]) || 0,
            isSupporter: Boolean(global.localUsers[uname].isSupporter)
          }))
          .filter(u => u.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map((u, idx) => ({ rank: idx + 1, ...u }));

        leaderboard[mode] = userList;
      }
    }

    res.json(leaderboard);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset all high scores in database like the game is new
app.post('/api/admin/reset-scores', async (req, res) => {
  try {
    let dbReset = false;
    let usersResetCount = 0;

    if (isDatabaseConfigured()) {
      const { db } = await connectToDatabase();

      // Reset scores collection
      await db.collection('scores').deleteMany({});
      const defaultRecords = [
        { _id: 'easy', score: 0, username: 'None', timestamp: Date.now() },
        { _id: 'hard', score: 0, username: 'None', timestamp: Date.now() },
        { _id: 'nightmare', score: 0, username: 'None', timestamp: Date.now() }
      ];
      await db.collection('scores').insertMany(defaultRecords);

      // Reset all users' personal best scores
      const result = await db.collection('users').updateMany(
        {},
        { $set: { bestScores: { easy: 0, hard: 0, nightmare: 0 } } }
      );
      usersResetCount = result.modifiedCount;
      dbReset = true;
    }

    // Reset local in-memory fallback scores
    globalScores = {
      easy: { score: 0, username: 'Guest' },
      hard: { score: 0, username: 'Guest' },
      nightmare: { score: 0, username: 'Guest' }
    };
    if (global.localUsers) {
      Object.keys(global.localUsers).forEach(uname => {
        global.localUsers[uname].bestScores = { easy: 0, hard: 0, nightmare: 0 };
      });
    }

    res.json({
      success: true,
      message: 'All scores have been reset to 0 like a brand new game.',
      dbReset,
      usersResetCount,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Reset scores error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST high score - REQUIRES AUTHENTICATION (Scores are only saved when logged in)
app.post('/api/scores', async (req, res) => {
  try {
    const { mode, score } = req.body;

    if (typeof score !== 'number') {
      return res.status(400).json({ error: 'Score must be a number' });
    }

    // Only logged in players can save high scores
    const authUser = getOptionalUser(req);
    if (!authUser) {
      return res.status(401).json({ 
        error: 'High scores can only be saved when logged in. Please log in or register to record your score.',
        requiresLogin: true
      });
    }

    const username = authUser.username;
    const cleanMode = ['easy', 'hard', 'nightmare'].includes(mode) ? mode : 'easy';

    // Update user's personal best in users collection
    if (isDatabaseConfigured()) {
      try {
        const { db } = await connectToDatabase();
        const usersCol = db.collection('users');
        const user = await usersCol.findOne({ _id: username });
        if (user) {
          const userBests = user.bestScores || { easy: 0, hard: 0, nightmare: 0 };
          if (score > (userBests[cleanMode] || 0)) {
            userBests[cleanMode] = score;
            await usersCol.updateOne(
              { _id: username },
              { $set: { bestScores: userBests } }
            );
          }
        }
      } catch (dbErr) {
        console.error('Failed to update personal best in MongoDB:', dbErr.message);
      }
    } else {
      if (!global.localUsers) global.localUsers = {};
      if (global.localUsers[username]) {
        const userBests = global.localUsers[username].bestScores || { easy: 0, hard: 0, nightmare: 0 };
        if (score > (userBests[cleanMode] || 0)) {
          userBests[cleanMode] = score;
        }
      }
    }

    const result = await updateGlobalScore(cleanMode, score, username);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Custom Authentication Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3 || cleanUsername.length > 15) {
      return res.status(400).json({ error: 'Username must be between 3 and 15 characters' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    if (isDatabaseConfigured()) {
      const { db } = await connectToDatabase();
      const collection = db.collection('users');
      
      const existingUser = await collection.findOne({ _id: cleanUsername });
      if (existingUser) {
        return res.status(400).json({ error: 'Username is already taken' });
      }

      const newUser = {
        _id: cleanUsername,
        passwordHash,
        bestScores: { easy: 0, hard: 0, nightmare: 0 },
        isSupporter: false,
        createdAt: new Date()
      };
      await collection.insertOne(newUser);
      
      const token = jwt.sign({ username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, username: cleanUsername, bestScores: newUser.bestScores });
    } else {
      if (!global.localUsers) global.localUsers = {};
      if (global.localUsers[cleanUsername]) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
      global.localUsers[cleanUsername] = {
        passwordHash,
        bestScores: { easy: 0, hard: 0, nightmare: 0 },
        isSupporter: false
      };
      const token = jwt.sign({ username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, username: cleanUsername, bestScores: { easy: 0, hard: 0, nightmare: 0 } });
    }
  } catch (e) {
    console.error('Registration error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const cleanUsername = username.trim().toLowerCase();

    if (isDatabaseConfigured()) {
      const { db } = await connectToDatabase();
      const collection = db.collection('users');
      const user = await collection.findOne({ _id: cleanUsername });
      if (!user) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      const token = jwt.sign({ username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, username: cleanUsername, bestScores: user.bestScores || { easy: 0, hard: 0, nightmare: 0 }, isSupporter: user.isSupporter || false });
    } else {
      if (!global.localUsers || !global.localUsers[cleanUsername]) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const user = global.localUsers[cleanUsername];
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }
      const token = jwt.sign({ username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, username: cleanUsername, bestScores: user.bestScores || { easy: 0, hard: 0, nightmare: 0 }, isSupporter: user.isSupporter || false });
    }
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) return res.status(401).json({ error: 'Invalid or expired token' });
      
      const cleanUsername = decoded.username;
      if (isDatabaseConfigured()) {
        try {
          const { db } = await connectToDatabase();
          const collection = db.collection('users');
          const user = await collection.findOne({ _id: cleanUsername });
          if (!user) return res.status(404).json({ error: 'User not found' });
          
          return res.json({ username: cleanUsername, bestScores: user.bestScores || { easy: 0, hard: 0, nightmare: 0 }, isSupporter: user.isSupporter || false });
        } catch (dbErr) {
          return res.status(500).json({ error: dbErr.message });
        }
      } else {
        if (!global.localUsers || !global.localUsers[cleanUsername]) {
          return res.status(404).json({ error: 'User not found' });
        }
        const user = global.localUsers[cleanUsername];
        return res.json({ username: cleanUsername, bestScores: user.bestScores || { easy: 0, hard: 0, nightmare: 0 }, isSupporter: user.isSupporter || false });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Supporter Badge Test Helper (allows logged in players to toggle test supporter status)
app.post('/api/auth/dev-supporter', async (req, res) => {
  try {
    const authUser = getOptionalUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'You must be logged in to test supporter status' });
    }
    const username = authUser.username;
    if (isDatabaseConfigured()) {
      const { db } = await connectToDatabase();
      const collection = db.collection('users');
      const user = await collection.findOne({ _id: username });
      const newStatus = !(user && user.isSupporter);
      await collection.updateOne(
        { _id: username },
        { $set: { isSupporter: newStatus } },
        { upsert: true }
      );
      return res.json({ success: true, isSupporter: newStatus, username });
    } else {
      if (!global.localUsers) global.localUsers = {};
      if (!global.localUsers[username]) global.localUsers[username] = { bestScores: {} };
      global.localUsers[username].isSupporter = !global.localUsers[username].isSupporter;
      return res.json({ success: true, isSupporter: global.localUsers[username].isSupporter, username });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Creator Support Checkout Session (Lemon Squeezy as primary with Stripe fallback)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const authUser = getOptionalUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'You must be logged in to support the creator' });
    }

    // Determine amount in cents (default $2.99 = 299 cents)
    let amountInCents = 299;
    if (req.body && req.body.amount !== undefined) {
      const parsed = parseFloat(req.body.amount);
      if (isNaN(parsed) || parsed < 1.0) {
        return res.status(400).json({ error: 'Minimum support amount is $1.00 USD' });
      }
      if (parsed > 1000.0) {
        return res.status(400).json({ error: 'Maximum support amount is $1,000.00 USD' });
      }
      amountInCents = Math.round(parsed * 100);
    } else if (req.body && req.body.amountInCents !== undefined) {
      const parsed = parseInt(req.body.amountInCents, 10);
      if (isNaN(parsed) || parsed < 100) {
        return res.status(400).json({ error: 'Minimum support amount is $1.00 USD' });
      }
      if (parsed > 100000) {
        return res.status(400).json({ error: 'Maximum support amount is $1,000.00 USD' });
      }
      amountInCents = parsed;
    }

    const formattedAmount = (amountInCents / 100).toFixed(2);
    const baseUrl = getBaseUrl(req);

    // 1. Check Lemon Squeezy first (preferred provider)
    if (isLemonSqueezyConfigured()) {
      const apiKey = getLemonSqueezyApiKey();
      const storeId = getLemonSqueezyStoreId();
      const variantId = getLemonSqueezyVariantId();

      const lsPayload = {
        data: {
          type: 'checkouts',
          attributes: {
            custom_price: amountInCents,
            product_options: {
              name: 'Support LoopShot Creator',
              description: `A donation of $${formattedAmount} USD to support LoopShot game development.`,
              redirect_url: `${baseUrl}/?payment=success&amt=${formattedAmount}`
            },
            checkout_data: {
              custom: {
                user_id: authUser.username
              }
            }
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: storeId.toString()
              }
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId.toString()
              }
            }
          }
        }
      };

      const lsResponse = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(lsPayload)
      });

      const lsData = await lsResponse.json();

      if (!lsResponse.ok) {
        console.error('Lemon Squeezy API Error:', lsData);
        const errMsg = (lsData.errors && lsData.errors[0] && lsData.errors[0].detail) ||
                       lsData.message ||
                       'Failed to generate Lemon Squeezy checkout';
        return res.status(lsResponse.status).json({ error: errMsg });
      }

      const checkoutUrl = lsData.data && lsData.data.attributes && lsData.data.attributes.url;
      if (!checkoutUrl) {
        return res.status(500).json({ error: 'No checkout URL returned from Lemon Squeezy' });
      }

      return res.json({ url: checkoutUrl, amount: formattedAmount, provider: 'lemonsqueezy' });
    }

    // 2. Stripe Fallback if configured
    const stripeClient = getStripeClient();
    if (stripeClient) {
      const session = await stripeClient.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Support LoopShot Creator',
                description: `A donation of $${formattedAmount} USD to support the development of LoopShot.`,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/?payment=success&amt=${formattedAmount}`,
        cancel_url: `${baseUrl}/?payment=cancelled`,
        metadata: {
          userId: authUser.username,
          amountInCents: amountInCents.toString(),
        },
      });

      return res.json({ url: session.url, amount: formattedAmount, provider: 'stripe' });
    }

    // 3. Neither configured
    return res.status(503).json({
      error: 'Lemon Squeezy payments are not configured yet. Please configure LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, and LEMONSQUEEZY_VARIANT_ID in Vercel settings.',
      provider: 'none'
    });
  } catch (e) {
    console.error('Checkout Session Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Unified Webhook Handler (supports both Lemon Squeezy and Stripe)
const handleUnifiedWebhook = async (req, res) => {
  const lemonSignature = req.headers['x-signature'];
  const stripeSignature = req.headers['stripe-signature'];

  // Helper to mark supporter in DB
  const grantSupporter = async (userId) => {
    if (!userId) return;
    if (isDatabaseConfigured()) {
      try {
        const { db } = await connectToDatabase();
        await db.collection('users').updateOne(
          { _id: userId },
          { $set: { isSupporter: true } }
        );
      } catch (dbErr) {
        console.error('Failed to update supporter in MongoDB:', dbErr.message);
      }
    } else {
      if (global.localUsers && global.localUsers[userId]) {
        global.localUsers[userId].isSupporter = true;
      }
    }
  };

  // Case 1: Lemon Squeezy Webhook
  if (lemonSignature) {
    const rawBodyBuffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');

    const lemonSecret = getLemonSqueezyWebhookSecret();
    if (lemonSecret) {
      try {
        const hmac = crypto.createHmac('sha256', lemonSecret);
        const digest = Buffer.from(hmac.update(rawBodyBuffer).digest('hex'), 'utf8');
        const sigBuffer = Buffer.from(lemonSignature, 'utf8');

        if (digest.length !== sigBuffer.length || !crypto.timingSafeEqual(digest, sigBuffer)) {
          console.warn('Lemon Squeezy signature mismatch');
          return res.status(401).send('Invalid signature');
        }
      } catch (err) {
        console.error('Lemon Squeezy signature verification error:', err);
        return res.status(400).send('Webhook signature verification error');
      }
    }

    try {
      const payload = JSON.parse(rawBodyBuffer.toString('utf8'));
      const eventName = payload.meta && payload.meta.event_name;
      
      if (eventName === 'order_created') {
        const userId =
          (payload.meta && payload.meta.custom_data && payload.meta.custom_data.user_id) ||
          (payload.data && payload.data.attributes && payload.data.attributes.checkout_data &&
           payload.data.attributes.checkout_data.custom && payload.data.attributes.checkout_data.custom.user_id);
        
        if (userId) {
          await grantSupporter(userId);
        }
      }
      return res.json({ received: true, provider: 'lemonsqueezy' });
    } catch (parseErr) {
      console.error('Lemon Squeezy webhook parse error:', parseErr);
      return res.status(400).send('Malformed JSON');
    }
  }

  // Case 2: Stripe Webhook
  if (stripeSignature) {
    const webhookSecret = getStripeWebhookSecret();
    const stripeClient = getStripeClient();
    let event;

    try {
      if (webhookSecret && stripeSignature && stripeClient) {
        event = stripeClient.webhooks.constructEvent(req.body, stripeSignature, webhookSecret);
      } else {
        event = Buffer.isBuffer(req.body)
          ? JSON.parse(req.body.toString('utf8'))
          : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
      }
    } catch (err) {
      console.error(`Stripe webhook error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event && event.type === 'checkout.session.completed') {
      const session = event.data && event.data.object;
      const userId = session && session.metadata && session.metadata.userId;
      if (userId) {
        await grantSupporter(userId);
      }
    }

    return res.json({ received: true, provider: 'stripe' });
  }

  // Case 3: Raw JSON event fallback in development or tests
  try {
    const parsed = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    
    if (parsed && parsed.meta && parsed.meta.event_name === 'order_created') {
      const userId =
        (parsed.meta.custom_data && parsed.meta.custom_data.user_id) ||
        (parsed.data && parsed.data.attributes && parsed.data.attributes.checkout_data &&
         parsed.data.attributes.checkout_data.custom && parsed.data.attributes.checkout_data.custom.user_id);
      if (userId) await grantSupporter(userId);
      return res.json({ received: true, provider: 'lemonsqueezy_unsigned' });
    }
  } catch (e) {
    // ignore
  }

  res.json({ received: true });
};

app.post('/api/webhook', handleUnifiedWebhook);
app.post('/api/lemonsqueezy/webhook', handleUnifiedWebhook);

// Comprehensive Status and Health Check API
const handleHealthCheck = async (req, res) => {
  const uri = getMongoUri();
  const configured = Boolean(uri);

  let dbStatus = {
    configured,
    connected: false,
    mode: configured ? 'mongodb' : 'in-memory-fallback',
    databaseName: null,
    latencyMs: null,
    error: null
  };

  if (configured) {
    const start = Date.now();
    try {
      const { db } = await connectToDatabase();
      const ping = await db.command({ ping: 1 });
      const latencyMs = Date.now() - start;
      dbStatus.connected = Boolean(ping && (ping.ok === 1 || ping.ok === true));
      dbStatus.databaseName = db.databaseName;
      dbStatus.latencyMs = latencyMs;
    } catch (err) {
      dbStatus.connected = false;
      dbStatus.error = err.message;
    }
  }

  // Safe environment audit (booleans only - no secret exposure)
  const envStatus = {
    hasMongoUri: Boolean(process.env.MONGODB_URI),
    hasMongoUrl: Boolean(process.env.MONGODB_URL),
    hasStorageUrl: Boolean(process.env.STORAGE_URL),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasCustomMongoDb: Boolean(process.env.MONGODB_DATABASE),
    hasStripeKey: Boolean(getStripeKey()),
    hasStripeWebhookSecret: Boolean(getStripeWebhookSecret()),
    hasLemonApiKey: Boolean(getLemonSqueezyApiKey()),
    hasLemonStoreId: Boolean(getLemonSqueezyStoreId()),
    hasLemonVariantId: Boolean(getLemonSqueezyVariantId()),
    hasLemonWebhookSecret: Boolean(getLemonSqueezyWebhookSecret()),
    isLemonConfigured: isLemonSqueezyConfigured(),
    hasJwtSecret: Boolean(process.env.JWT_SECRET)
  };

  res.json({
    status: (dbStatus.connected || !configured) ? 'ok' : 'database_error',
    game: 'LoopShot',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    environment: envStatus
  });
};

app.get('/api/status', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// Export the app for Vercel serverless function execution
module.exports = app;

// Listen locally if run directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`LoopShot local server listening on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
  });
}
