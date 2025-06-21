// mixer-state/mcu-decoder.js

const mixerState = {}; // State per channel
const trackNameBuffers = {}; // Buffer for track name assembly
const { logMixerEvent, db } = require('../mixer-state/database');

function update(channel, key, value) {
  if (!mixerState[channel]) mixerState[channel] = {};
  mixerState[channel][key] = value;
  logMixerEvent(channel, key, value);
  console.log(`CH ${channel} | ${key}: ${value}`);
}

function decodeSysEx(data) {
  if (
    data.length !== 10 ||
    data[0] !== 0xF0 || data[1] !== 0x00 || data[2] !== 0x00 ||
    data[3] !== 0x66 || data[4] !== 0x14 || data[5] !== 0x12
  ) return;

  const offset = data[7];
  const charCode = data[8];
  const channel = Math.floor(offset / 7) + 1;
  const charIndex = offset % 7;

  if (!trackNameBuffers[channel]) trackNameBuffers[channel] = [];
  trackNameBuffers[channel][charIndex] = String.fromCharCode(charCode);

  const buffer = trackNameBuffers[channel];
  if (buffer.filter(Boolean).length === 7) {
    const name = buffer.join('').trim();
    mixerState[channel] = mixerState[channel] || {};
    mixerState[channel].name = name;

    logMixerEvent(channel, 'name', name);
    if (db) {
      db.run(
        `INSERT OR REPLACE INTO tracks (track_id, name, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [channel, name],
        (err) => {
          if (err) console.error(`DB error updating track name: ${err.message}`);
        }
      );
    }

    console.log(`CH ${channel} | name: ${name}`);
  }
}

function decodeMessage(...args) {
  if (Array.isArray(args[0]) && args[0][0] === 0xF0) {
    decodeSysEx(args[0]);
    return;
  }

  const [status, data1, data2] = args;
  const command = status & 0xF0;
  const channel = (status & 0x0F) + 1;

  if (command === 0xB0) {
    switch (data1) {
      case 0x0A: update(channel, 'pan', data2 - 64); break;
      case 0x3C: update(channel, 'mute', data2 > 0); break;
      case 0x3D: update(channel, 'solo', data2 > 0); break;
      case 0x3E: update(channel, 'recordArm', data2 > 0); break;
      default:
        console.log(`Unhandled CC | CH ${channel} | CC ${data1}: ${data2}`);
    }
  } else if (command === 0xE0) {
    const value = ((data2 << 7) | data1) - 8192;
    update(channel, 'volume', value);
  } else if (command === 0x90 || command === 0x80) {
    const note = data1;
    const isOn = (command === 0x90 && data2 > 0);

    // MCU heartbeat is note 0 only
    if (note === 0) {
      update(channel, 'recordArmHeartbeat', isOn);
    } else {
      // Comment out next line to suppress these completely
      console.log(`Skipping non-heartbeat note ${note} (0x${command.toString(16)})`);
    }
  } else if (status === 0xF0) {
    decodeSysEx([status, data1, data2]);
  } else {
    console.warn(`Unhandled MIDI message (0x${status.toString(16)}): [${data1}, ${data2}]`);
  }
}

module.exports = { decodeMessage, mixerState };
