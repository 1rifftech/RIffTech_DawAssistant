// mixer-state/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'mixer.db'));

// Initialize tables
db.serialize(() => {
  // Main events table
  db.run(`
    CREATE TABLE IF NOT EXISTS mixer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      event_type TEXT,
      channel INTEGER,
      control TEXT,
      value REAL,
      details TEXT
    )
  `);
  
  // State snapshots table
  db.run(`
    CREATE TABLE IF NOT EXISTS mixer_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      state_json TEXT
    )
  `);
  
  // Current state table
  db.run(`
    CREATE TABLE IF NOT EXISTS mixer_state (
      channel INTEGER PRIMARY KEY,
      track_name TEXT,
      volume INTEGER DEFAULT 0,
      pan INTEGER DEFAULT 64,
      mute INTEGER DEFAULT 0,
      solo INTEGER DEFAULT 0,
      record INTEGER DEFAULT 0
    )
  `);
  
  // Initialize 8 channels
  for (let i = 0; i < 8; i++) {
    db.run(`
      INSERT OR IGNORE INTO mixer_state (channel) VALUES (?)
    `, [i]);
  }
});

function logMixerEvent(channel, control, value, eventType = 'control') {
  const timestamp = Date.now();
  db.run(`
    INSERT INTO mixer_events (timestamp, event_type, channel, control, value)
    VALUES (?, ?, ?, ?, ?)
  `, [timestamp, eventType, channel, control, value]);
  
  // Update current state
  if (channel >= 0 && channel < 8) {
    const column = control.toLowerCase();
    if (['volume', 'pan', 'mute', 'solo', 'record'].includes(column)) {
      db.run(`
        UPDATE mixer_state SET ${column} = ? WHERE channel = ?
      `, [value, channel]);
    } else if (column === 'trackname') {
      db.run(`
        UPDATE mixer_state SET track_name = ? WHERE channel = ?
      `, [value, channel]);
    }
  }
}

module.exports = { db, logMixerEvent };