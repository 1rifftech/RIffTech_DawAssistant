// midiAssistant.js - Complete working version
require('dotenv').config();
const midi = require('midi');
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { mixerState, decodeMCUMessage, decodeSysEx } = require('./mcu/mcu-decoder');
const { db, logMixerEvent } = require('./mixer-state/database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MIDI Setup
const input = new midi.Input();
const output = new midi.Output();
let inputPort = -1, outputPort = -1;

// Find MIDI ports
for (let i = 0; i < input.getPortCount(); i++) {
  if (input.getPortName(i).includes('IAC Driver Bus 2')) {
    inputPort = i;
    break;
  }
}

for (let i = 0; i < output.getPortCount(); i++) {
  if (output.getPortName(i).includes('IAC Driver Bus 2')) {
    outputPort = i;
    break;
  }
}

if (inputPort >= 0) {
  input.ignoreTypes(false, false, false);
  input.openPort(inputPort);
  console.log(`MIDI INPUT: ${input.getPortName(inputPort)}`);
}

if (outputPort >= 0) {
  output.openPort(outputPort);
  console.log(`MIDI OUTPUT: ${output.getPortName(outputPort)}`);
}

// MIDI Message Processing
let sysexBuffer = [];
let inSysex = false;

input.on('message', (deltaTime, message) => {
  console.log('MIDI IN:', message);
  
  if (message[0] === 0xF0) {
    inSysex = true;
    sysexBuffer = [...message];
  } else if (inSysex) {
    sysexBuffer.push(...message);
    if (message.includes(0xF7)) {
      inSysex = false;
      decodeSysEx(sysexBuffer);
      sysexBuffer = [];
    }
  } else {
    decodeMCUMessage(message);
  }
  
  // Emit to WebSocket clients
  io.emit('mixerUpdate', getMixerState());
});

// Get current mixer state
function getMixerState() {
  return {
    timestamp: Date.now(),
    tracks: mixerState.tracks.map((track, i) => ({
      id: i + 1,
      name: track.trackName || `Track ${i + 1}`,
      volume: track.volume,
      pan: track.pan,
      mute: track.mute,
      solo: track.solo,
      armed: track.record,
      meter: mixerState.meters[i] || 0
    })),
    transport: mixerState.transport
  };
}

// API Routes
app.get('/api/mixer/state', (req, res) => {
  res.json(getMixerState());
});

app.get('/api/mixer/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  db.all(`
    SELECT * FROM mixer_events 
    ORDER BY timestamp DESC 
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/mixer/control', (req, res) => {
  const { channel, control, value } = req.body;
  
  try {
    // Send MIDI command based on control type
    if (control === 'volume' && channel >= 0 && channel < 8) {
      const lsb = value & 0x7F;
      const msb = (value >> 7) & 0x7F;
      output.sendMessage([0xE0 | channel, lsb, msb]);
    }
    else if (control === 'mute' && channel >= 0 && channel < 8) {
      output.sendMessage([0x90, 0x10 + channel, value ? 0x7F : 0x00]);
    }
    else if (control === 'play') {
      output.sendMessage([0x90, 0x5E, 0x7F]);
    }
    else if (control === 'stop') {
      output.sendMessage([0x90, 0x5D, 0x7F]);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Analysis endpoint
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const state = getMixerState();
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `As a professional mixing engineer, analyze this DAW mixer state and provide specific suggestions:
    
    ${JSON.stringify(state, null, 2)}
    
    Provide:
    1. Current mix balance assessment
    2. Potential issues
    3. Specific improvement suggestions`;
    
    const result = await model.generateContent(prompt);
    res.json({ 
      analysis: result.response.text(),
      state 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('mixerUpdate', getMixerState());
    
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`API Server running at http://localhost:${PORT}`);
  console.log('MIDI Assistant is live');
  console.log('Enhanced MCU decoder active');
});

// Cleanup
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  input.closePort();
  output.closePort();
  db.close();
  process.exit(0);
});