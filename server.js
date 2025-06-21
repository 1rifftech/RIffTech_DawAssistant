// server.js

const express = require('express');
const { mixerState } = require('./mixer-state/mixer-state');
const { setVolume, setMute } = require('./mixer-state/sendCommand');

const app = express();
const port = 3000;

app.use(express.json());

/**
 * GET /mixer-state
 * Returns the current in-memory mixer state
 */
app.get('/mixer-state', (req, res) => {
  res.json(mixerState);
});

/**
 * POST /api/command
 * Accepts a JSON payload like:
 * {
 *   "action": "volume", // or "mute"
 *   "track": 1,
 *   "value": 500       // for volume; true/false for mute
 * }
 */
app.post('/api/command', (req, res) => {
  const { action, track, value } = req.body;

  if (!track || value === undefined || !action) {
    return res.status(400).json({ error: 'Missing track, value, or action' });
  }

  if (action === 'volume') {
    setVolume(track, value);
  } else if (action === 'mute') {
    setMute(track, value);
  } else {
    return res.status(400).json({ error: `Unsupported action: ${action}` });
  }

  res.json({ status: 'executed', action, track, value });
});

app.get('/', (req, res) => {
  res.send('<h2>Logic Control API is Running</h2><p>Try <a href="/mixer-state">/mixer-state</a></p>');
});

app.listen(port, () => {
  console.log(`API Server running at http://localhost:${port}`);
});
