// database.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./mixer_data.sqlite');

// Initialize all tables
db.serialize(() => {
  // Create tracks table
  db.run(`
    CREATE TABLE IF NOT EXISTS tracks (
      track_id INTEGER PRIMARY KEY,
      name TEXT,
      volume INTEGER,
      pan INTEGER,
      mute BOOLEAN,
      solo BOOLEAN,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create mixer_events table
  db.run(`
    CREATE TABLE IF NOT EXISTS mixer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER,
      parameter TEXT,
      value TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Insert a new mixer event
function logMixerEvent(track, param, value) {
  db.run(
    `INSERT INTO mixer_events (track_id, parameter, value) VALUES (?, ?, ?)`,
    [track, param, value.toString()]
  );
}

module.exports = { logMixerEvent, db };
