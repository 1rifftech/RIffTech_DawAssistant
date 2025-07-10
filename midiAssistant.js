require('dotenv').config();
const midi = require('midi');
const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3000;

// expose mixerState from decoder and enhanced functionality
const { mixerState } = require('./mcu/mcu-decoder');
const { processEnhancedMCUMessage, getEnhancedMixerState, MCU } = require('./mcu-decoder');

// serve static files from /public
app.use(express.static('public'));

// route to serve the mixer UI page
app.get('/mixer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mixer.html'));
});

require('./mcu/mcu-listener.js'); // Runs MCU listener
require('./mcu/mcu-decoder.js');  // Runs MCU decoder

// API to provide state as JSON
app.use('/api', require('./api/state'));
app.use('/api', require('./server'));

// Enhanced MCU API routes
app.get('/api/enhanced-mixer-state', (req, res) => {
  const state = getEnhancedMixerState();
  res.json(state);
});

app.get('/api/mcu-constants', (req, res) => {
  res.json(MCU);
});

// === Gemini Setup ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// === View Engine ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// === MIDI INPUT + OUTPUT SETUP (IAC Driver Bus 2 Only) ===
const input = new midi.Input();
const output = new midi.Output();

function connectIACBus2Only() {
  let inputPort = -1;
  let outputPort = -1;

  for (let i = 0; i < input.getPortCount(); i++) {
    if (input.getPortName(i).includes("IAC Driver Bus 2")) {
      inputPort = i;
      input.openPort(i);
      input.ignoreTypes(false, false, false);
      break;
    }
  }

  for (let i = 0; i < output.getPortCount(); i++) {
    if (output.getPortName(i).includes("IAC Driver Bus 2")) {
      outputPort = i;
      output.openPort(i);
      break;
    }
  }

  console.log(`MIDI INPUT:  ${inputPort !== -1 ? input.getPortName(inputPort) : 'Not Found'}`);
  console.log(`MIDI OUTPUT: ${outputPort !== -1 ? output.getPortName(outputPort) : 'Not Found'}`);

  if (inputPort === -1 || outputPort === -1) {
    console.error("Could not connect to IAC Driver Bus 2. Please check your MIDI setup.");
    process.exit(1);
  }
}

connectIACBus2Only();

// Enhanced MIDI input handling
input.on('message', (deltaTime, message) => {
  // Process with enhanced decoder
  const decoded = processEnhancedMCUMessage(message);
  
  if (decoded) {
    console.log(`[Enhanced MCU] ${decoded.type}:`, decoded);
    // Handle specific events if needed
    handleEnhancedMCUEvent(decoded);
  }
});

function handleEnhancedMCUEvent(event) {
  switch (event.type) {
    case 'fader':
      console.log(`Fader ${event.channel}: ${event.value}`);
      break;
    case 'note_on':
      if (event.action === 'mute') {
        console.log(`Mute ${event.channel}: ${event.value}`);
      } else if (event.action === 'transport') {
        console.log(`Transport ${event.control}: ${event.velocity > 0}`);
      }
      break;
    case 'encoder':
      console.log(`Encoder ${event.channel}: ${event.direction > 0 ? 'CW' : 'CCW'} speed ${event.speed}`);
      break;
    case 'track_name':
      console.log(`Track ${event.channel} name: "${event.name}"`);
      break;
  }
}

// === MIDI Actions ===
const setVolume = (channel, volume) => {
  const status = 0xB0 + (channel - 1);
  output.sendMessage([status, 7, volume]);
  console.log(`🎚️ Volume → Channel ${channel}, Volume ${volume}`);
};

const setMute = (channel, on) => {
  const status = 0xB0 + (channel - 1);
  const value = on ? 127 : 0;
  output.sendMessage([status, 78, value]);
  console.log(`🔇 Mute → Channel ${channel}, ${on ? 'ON' : 'OFF'}`);
};

const playNote = (note = 60, velocity = 100, duration = 1000) => {
  output.sendMessage([0x90, note, velocity]);
  setTimeout(() => {
    output.sendMessage([0x80, note, 0]);
    console.log(`🎵 Note ${note} played and released`);
  }, duration);
};

// Enhanced MCU command sending
const sendMCUCommand = (command, value = 127) => {
  if (MCU[command] !== undefined) {
    const noteNumber = MCU[command];
    output.sendMessage([0x90, noteNumber, value]); // Note On
    console.log(`🎛️ MCU Command: ${command} (${noteNumber})`);
  }
};

// === Prompt Builder ===
const buildGeminiPrompt = (userPrompt) => `
You are a MIDI assistant. Convert user input into structured JSON using one of the following actions:

- {"action": "setVolume", "channel": 1, "value": 100}
- {"action": "mute", "channel": 2, "on": true}
- {"action": "playNote", "note": 60, "velocity": 120, "duration": 500}
- {"action": "mcuCommand", "command": "PLAY", "value": 127}

Respond only with the JSON. Ignore small talk.
Prompt: ${userPrompt}
`;

// === API Routes ===
app.post('/ask', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).send('Missing prompt');

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: buildGeminiPrompt(prompt) }] }]
    });

    const outputText = result.response.text();
    console.log('🤖 Gemini Response:\n', outputText);

    try {
      const command = JSON.parse(outputText);

      if (command.action === 'setVolume') {
        setVolume(command.channel, command.value);
        return res.send(`Volume set to ${command.value} on channel ${command.channel}`);
      }

      if (command.action === 'mute') {
        setMute(command.channel, command.on);
        return res.send(`Mute ${command.on ? 'ON' : 'OFF'} on channel ${command.channel}`);
      }

      if (command.action === 'playNote') {
        playNote(command.note, command.velocity, command.duration);
        return res.send(`Played note ${command.note}`);
      }

      if (command.action === 'mcuCommand') {
        sendMCUCommand(command.command, command.value);
        return res.send(`MCU command ${command.command} sent`);
      }

      return res.status(400).send('Unknown command');
    } catch (err) {
      return res.status(500).send(`Failed to parse Gemini response: ${err.message}`);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Gemini API Error');
  }
});

// === Web UI Routes ===
app.get('/', (req, res) => {
  res.render('index', { result: null });
});

app.post('/submit', async (req, res) => {
  const prompt = req.body.prompt;
  if (!prompt) return res.render('index', { result: 'Missing prompt' });

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: buildGeminiPrompt(prompt) }] }]
    });

    const outputText = result.response.text();
    console.log('Gemini Web Response:\n', outputText);

    let resultMsg = '';

    try {
      const command = JSON.parse(outputText);

      if (command.action === 'setVolume') {
        setVolume(command.channel, command.value);
        resultMsg = `Volume set to ${command.value} on channel ${command.channel}`;
      } else if (command.action === 'mute') {
        setMute(command.channel, command.on);
        resultMsg = `Mute ${command.on ? 'ON' : 'OFF'} on channel ${command.channel}`;
      } else if (command.action === 'playNote') {
        playNote(command.note, command.velocity, command.duration);
        resultMsg = `Played note ${command.note}`;
      } else if (command.action === 'mcuCommand') {
        sendMCUCommand(command.command, command.value);
        resultMsg = `MCU command ${command.command} sent`;
      } else {
        resultMsg = 'Unknown command';
      }
    } catch (err) {
      resultMsg = `Failed to parse response: ${err.message}`;
    }

    res.render('index', { result: resultMsg });

  } catch (err) {
    console.error(err);
    res.render('index', { result: 'Gemini API Error' });
  }
});

// === Gemini Test Endpoint ===
app.get('/test-gemini', async (req, res) => {
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: "Say hi" }] }]
    });
    res.send(result.response.text());
  } catch (err) {
    console.error(err);
    res.status(500).send("Gemini test failed: " + err);
  }
});

// === Launch Server ===
app.listen(port, () => {
  console.log(`API Server running at http://localhost:${port}`);
  console.log(`MIDI Assistant is live`);
  console.log(`Enhanced MCU decoder active`);
});