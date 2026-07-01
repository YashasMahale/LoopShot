const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'loopshot-default-super-secret-key-123456';

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

// Parse JSON request bodies
app.use(express.json());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, '../public')));

// Global High Score in-memory storage fallback
let globalScores = {
  easy: { score: 0, username: 'Guest' },
  hard: { score: 0, username: 'Guest' },
  nightmare: { score: 0, username: 'Guest' }
};

// Support multiple environment variable names injected by Vercel integrations
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.STORAGE_URL;

// Check if MongoDB environment variable is present
let mongoClient = null;
let mongoDb = null;
const { MongoClient } = require('mongodb');

async function connectToDatabase() {
  if (mongoClient && mongoDb) {
    return { client: mongoClient, db: mongoDb };
  }
  if (!MONGODB_URI) {
    throw new Error('MongoDB environment variable is missing');
  }
  // Connect and reuse the connection
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('loopshot');
  mongoClient = client;
  mongoDb = db;
  return { client, db };
}

// Helper to fetch global high scores
async function getGlobalScores() {
  if (MONGODB_URI) {
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
      console.error('Failed to get scores from MongoDB:', e);
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

    if (MONGODB_URI) {
      try {
        const { db } = await connectToDatabase();
        const collection = db.collection('scores');
        await collection.updateOne(
          { _id: cleanMode },
          { $set: updatedRecord },
          { upsert: true }
        );
      } catch (e) {
        console.error('Failed to save score to MongoDB:', e);
      }
    } else {
      globalScores[cleanMode] = updatedRecord;
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

// POST high score
app.post('/api/scores', async (req, res) => {
  try {
    const { mode, score } = req.body;
    let username = req.body.username || 'Guest';

    if (typeof score !== 'number') {
      return res.status(400).json({ error: 'Score must be a number' });
    }

    // Optional authentication check
    const authUser = getOptionalUser(req);
    if (authUser) {
      username = authUser.username;
      
      // Update user's personal best in users collection
      if (MONGODB_URI) {
        const { db } = await connectToDatabase();
        const usersCol = db.collection('users');
        const user = await usersCol.findOne({ _id: username });
        if (user) {
          const userBests = user.bestScores || { easy: 0, hard: 0, nightmare: 0 };
          if (score > (userBests[mode] || 0)) {
            userBests[mode] = score;
            await usersCol.updateOne(
              { _id: username },
              { $set: { bestScores: userBests } }
            );
          }
        }
      } else {
        if (!global.localUsers) global.localUsers = {};
        if (global.localUsers[username]) {
          const userBests = global.localUsers[username].bestScores || { easy: 0, hard: 0, nightmare: 0 };
          if (score > (userBests[mode] || 0)) {
            userBests[mode] = score;
          }
        }
      }
    }

    const result = await updateGlobalScore(mode, score, username);
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

    if (MONGODB_URI) {
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
        bestScores: { easy: 0, hard: 0, nightmare: 0 }
      };
      const token = jwt.sign({ username: cleanUsername }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, username: cleanUsername, bestScores: { easy: 0, hard: 0, nightmare: 0 } });
    }
  } catch (e) {
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

    if (MONGODB_URI) {
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
      return res.json({ token, username: cleanUsername, bestScores: user.bestScores || { easy: 0, hard: 0, nightmare: 0 } });
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
      return res.json({ token, username: cleanUsername, bestScores: user.bestScores });
    }
  } catch (e) {
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
      if (MONGODB_URI) {
        const { db } = await connectToDatabase();
        const collection = db.collection('users');
        const user = await collection.findOne({ _id: cleanUsername });
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        return res.json({ username: cleanUsername, bestScores: user.bestScores || { easy: 0, hard: 0, nightmare: 0 } });
      } else {
        if (!global.localUsers || !global.localUsers[cleanUsername]) {
          return res.status(404).json({ error: 'User not found' });
        }
        const user = global.localUsers[cleanUsername];
        return res.json({ username: cleanUsername, bestScores: user.bestScores });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Status check API
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', game: 'LoopShot', timestamp: new Date() });
});

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
