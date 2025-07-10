const express = require('express');
const app = express();
const stateRouter = require('./api/state');

app.use(express.json());

// Mount your /api routes
app.use('/api', stateRouter);

// Command endpoint
app.post('/api/command', (req, res) => {
  const { action, track, value } = req.body;

  if (track === undefined || value === undefined || !action) {
    return res.status(400).json({ error: 'Missing track, value, or action' });
  }

  if (action === 'volume') {
    // your function to set volume
    setVolume(track, value);
  } else if (action === 'mute') {
    // your function to set mute
    setMute(track, value);
  } else {
    return res.status(400).json({ error: `Unsupported action: ${action}` });
  }

  res.json({ status: 'executed', action, track, value });
});

// Catch-all to show wrong requests
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

module.exports = app;
