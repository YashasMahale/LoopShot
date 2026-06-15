const express = require('express');
const path = require('path');
const app = express();

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, '../public')));

// Route for the Main Menu
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Route for the Game Arena
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/game.html'));
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
