const express = require('express');
const path = require('path');
const app = express();

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

// Check if MongoDB environment variable is present
let mongoClient = null;
let mongoDb = null;
const { MongoClient } = require('mongodb');

async function connectToDatabase() {
  if (mongoClient && mongoDb) {
    return { client: mongoClient, db: mongoDb };
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is missing');
  }
  // Connect and reuse the connection
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('loopshot');
  mongoClient = client;
  mongoDb = db;
  return { client, db };
}

// Helper to fetch global high scores
async function getGlobalScores() {
  if (process.env.MONGODB_URI) {
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

    if (process.env.MONGODB_URI) {
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
    const { mode, score, username } = req.body;
    if (typeof score !== 'number') {
      return res.status(400).json({ error: 'Score must be a number' });
    }
    const result = await updateGlobalScore(mode, score, username);
    res.json(result);
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
