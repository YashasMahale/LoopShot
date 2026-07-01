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

// Check if Vercel KV environment variables are present
let useKV = false;
let kv = null;
if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  try {
    kv = require('@vercel/kv').kv;
    useKV = true;
    console.log('Vercel KV integration enabled for global high scores.');
  } catch (e) {
    console.warn('Failed to load @vercel/kv package:', e.message);
  }
}

// Helper to fetch global high scores
async function getGlobalScores() {
  if (useKV && kv) {
    try {
      const scores = await kv.get('loopshot_global_scores');
      if (scores) return scores;
    } catch (e) {
      console.error('Failed to get scores from Vercel KV:', e);
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
    current[cleanMode] = {
      score: cleanScore,
      username: cleanUsername,
      timestamp: Date.now()
    };

    if (useKV && kv) {
      try {
        await kv.set('loopshot_global_scores', current);
      } catch (e) {
        console.error('Failed to save scores to Vercel KV:', e);
      }
    } else {
      globalScores = current;
    }
    return { updated: true, globalBest: current[cleanMode] };
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
