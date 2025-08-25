// midiAssistant.js
require('dotenv').config();
const midi = require('midi');
const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3000;

// Use enhanced MCU decoder
const { 
  sessionState, 
  enhancedMCUDecode, 
  enhancedSysExDecode,
  getCompleteSessionState,
  getAPICompatibleState,
  resetSessionState
} = require('./mcu/enhanced-mcu-decoder.js');

// Serve static files from /public
app.use(express.static('public'));

// Route to serve the mixer UI page
app.get('/mixer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mixer.html'));
});

// API routes
app.use('/api', require('./api/state')); // Legacy API
//app.use('/api', require('./api/enhanced-state')); // New enhanced API

// === Gemini Setup ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// === View Engine ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// === MIDI INPUT + OUTPUT SETUP ===
const input = new midi.Input();
const output = new midi.Output();

function connectIACBus2Only() {
  let inputPort = -1;
  let outputPort = -1;

  // Find IAC Driver Bus 2 for input
  for (let i = 0; i < input.getPortCount(); i++) {
    if (input.getPortName(i).includes("IAC Driver Bus 2")) {
      inputPort = i;
      input.openPort(i);
      input.ignoreTypes(false, false, false); // Enable SysEx, timing, and active sensing
      break;
    }
  }

  // Find IAC Driver Bus 2 for output
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
  
  return { inputPort, outputPort };
}

const { inputPort, outputPort } = connectIACBus2Only();

// Enhanced MIDI input handling with SysEx support
let sysexBuffer = [];
let inSysex = false;

input.on('message', (deltaTime, message) => {
  console.log(`[MIDI IN] Raw: [${message.map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
  
  // Handle SysEx messages (they can be split across multiple MIDI messages)
  if (message[0] === 0xF0) {
    // Start of SysEx
    inSysex = true;
    sysexBuffer = [...message];
    
    // Check if complete SysEx in single message
    if (message.includes(0xF7)) {
      inSysex = false;
      const result = enhancedSysExDecode(sysexBuffer);
      if (result) {
        console.log('[MIDI] SysEx decoded:', result);
      }
      sysexBuffer = [];
    }
  } else if (inSysex) {
    // Continuation of SysEx
    sysexBuffer.push(...message);
    
    // Check for end of SysEx
    if (message.includes(0xF7)) {
      inSysex = false;
      const result = enhancedSysExDecode(sysexBuffer);
      if (result) {
        console.log('[MIDI] SysEx decoded:', result);
      }
      sysexBuffer = [];
    }
  } else {
    // Regular MIDI messages (Note On/Off, CC, Pitch Bend)
    const result = enhancedMCUDecode(message);
    if (result) {
      console.log('[MIDI] Message decoded:', result);
      
      // Emit events for real-time updates if needed
      // You could add WebSocket support here for live updates
    }
  }
});

// === MIDI Output Functions ===
const setVolume = (channel, volume) => {
  // Convert 0-100 percentage to pitch bend value (-8192 to 8191)
  const pitchBendValue = Math.round(((volume / 100) * 16384) - 8192);
  const bend = Math.max(Math.min(pitchBendValue + 8192, 16383), 0);
  const lsb = bend & 0x7F;
  const msb = (bend >> 7) & 0x7F;
  
  const midiChannel = channel - 1; // Convert to 0-based
  output.sendMessage([0xE0 | midiChannel, lsb, msb]);
  console.log(`🎚️ Volume → Channel ${channel}, Volume ${volume}% (${pitchBendValue})`);
};

const setMute = (channel, on) => {
  const noteNumber = 0x10 + (channel - 1); // Mute buttons start at 0x10
  const velocity = on ? 127 : 0;
  output.sendMessage([0x90, noteNumber, velocity]);
  console.log(`🔇 Mute → Channel ${channel}, ${on ? 'ON' : 'OFF'}`);
};

const setSolo = (channel, on) => {
  const noteNumber = 0x08 + (channel - 1); // Solo buttons start at 0x08
  const velocity = on ? 127 : 0;
  output.sendMessage([0x90, noteNumber, velocity]);
  console.log(`🟡 Solo → Channel ${channel}, ${on ? 'ON' : 'OFF'}`);
};

const setRecordArm = (channel, on) => {
  const noteNumber = 0x00 + (channel - 1); // Record buttons start at 0x00
  const velocity = on ? 127 : 0;
  output.sendMessage([0x90, noteNumber, velocity]);
  console.log(`🔴 Record → Channel ${channel}, ${on ? 'ARM' : 'DISARM'}`);
};

const transportPlay = () => {
  output.sendMessage([0x90, 0x5E, 127]); // Play button
  console.log(`⏯️ Transport → PLAY`);
};

const transportStop = () => {
  output.sendMessage([0x90, 0x5D, 127]); // Stop button
  console.log(`⏹️ Transport → STOP`);
};

const transportRecord = () => {
  output.sendMessage([0x90, 0x5F, 127]); // Record button
  console.log(`⏺️ Transport → RECORD`);
};

// === Enhanced Gemini Prompt Builder ===
const buildEnhancedGeminiPrompt = (userPrompt) => {
  const currentState = getCompleteSessionState();
  
  return `
You are an intelligent DAW assistant with access to the complete Logic Pro session state. 

CURRENT SESSION STATE:
${JSON.stringify(currentState.summary, null, 2)}

AVAILABLE ACTIONS:
1. Volume control: {"action": "setVolume", "channel": 1-8, "value": 0-100}
2. Mute control: {"action": "mute", "channel": 1-8, "on": true/false}
3. Solo control: {"action": "solo", "channel": 1-8, "on": true/false}
4. Record arm: {"action": "recordArm", "channel": 1-8, "on": true/false}
5. Transport: {"action": "transport", "command": "play"/"stop"/"record"}
6. Session info: {"action": "getInfo", "type": "tracks"/"transport"/"summary"}

TRACK NAMES:
${Object.entries(currentState.display.trackNames).map(([id, name]) => `Track ${id}: "${name}"`).join('\n')}

CURRENT TRACK STATES:
${Object.entries(currentState.tracks).map(([id, track]) => 
  `Track ${id}: Vol=${track.volumePercent}%, Pan=${track.pan}, Mute=${track.mute}, Solo=${track.solo}, Record=${track.recordArm}`
).join('\n')}

TRANSPORT STATE:
Playing: ${currentState.transport.playing}, Recording: ${currentState.transport.recording}, Time: ${currentState.transport.position.smpte}

USER REQUEST: "${userPrompt}"

Respond with ONLY valid JSON. Use track names when mentioned. Be intelligent about the request context.
`;
};

// === Enhanced API Routes ===
app.post('/ask', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).send('Missing prompt');

  try {
    const enhancedPrompt = buildEnhancedGeminiPrompt(prompt);
    console.log('🤖 Sending enhanced prompt to Gemini');
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: enhancedPrompt }] }]
    });

    const outputText = result.response.text();
    console.log('🤖 Gemini Response:\n', outputText);

    try {
      const command = JSON.parse(outputText);
      let responseMessage = '';

      switch (command.action) {
        case 'setVolume':
          setVolume(command.channel, command.value);
          responseMessage = `Volume set to ${command.value}% on channel ${command.channel}`;
          break;
          
        case 'mute':
          setMute(command.channel, command.on);
          responseMessage = `Mute ${command.on ? 'ON' : 'OFF'} on channel ${command.channel}`;
          break;
          
        case 'solo':
          setSolo(command.channel, command.on);
          responseMessage = `Solo ${command.on ? 'ON' : 'OFF'} on channel ${command.channel}`;
          break;
          
        case 'recordArm':
          setRecordArm(command.channel, command.on);
          responseMessage = `Record ${command.on ? 'ARMED' : 'DISARMED'} on channel ${command.channel}`;
          break;
          
        case 'transport':
          switch (command.command) {
            case 'play': transportPlay(); responseMessage = 'Transport: PLAY'; break;
            case 'stop': transportStop(); responseMessage = 'Transport: STOP'; break;
            case 'record': transportRecord(); responseMessage = 'Transport: RECORD'; break;
            default: responseMessage = 'Unknown transport command';
          }
          break;
          
        case 'getInfo':
          const state = getCompleteSessionState();
          switch (command.type) {
            case 'tracks':
              responseMessage = `Track info: ${Object.keys(state.tracks).length} tracks, ${state.summary.activeTracks} active`;
              break;
            case 'transport':
              responseMessage = `Transport: ${state.transport.playing ? 'Playing' : 'Stopped'}, Time: ${state.transport.position.smpte}`;
              break;
            case 'summary':
              responseMessage = `Session: ${state.summary.totalTracks} tracks, ${state.summary.activeTracks} active, ${state.summary.mutedTracks} muted`;
              break;
            default:
              responseMessage = JSON.stringify(state.summary, null, 2);
          }
          break;
          
        default:
          responseMessage = 'Unknown command action';
      }

      return res.json({ 
        success: true, 
        message: responseMessage,
        command: command,
        timestamp: Date.now()
      });
      
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse AI response',
        rawResponse: outputText 
      });
    }
    
  } catch (err) {
    console.error('Gemini API Error:', err);
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

// === Web UI Routes ===
app.get('/', (req, res) => {
  const state = getCompleteSessionState();
  res.render('index', { 
    result: null,
    sessionInfo: state.summary
  });
});

app.post('/submit', async (req, res) => {
  const prompt = req.body.prompt;
  if (!prompt) {
    const state = getCompleteSessionState();
    return res.render('index', { 
      result: 'Missing prompt',
      sessionInfo: state.summary
    });
  }

  try {
    const enhancedPrompt = buildEnhancedGeminiPrompt(prompt);
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: enhancedPrompt }] }]
    });

    const outputText = result.response.text();
    console.log('🤖 Gemini Web Response:\n', outputText);

    let resultMsg = '';

    try {
      const command = JSON.parse(outputText);
      
      // Execute the same logic as the API endpoint
      switch (command.action) {
        case 'setVolume':
          setVolume(command.channel, command.value);
          resultMsg = `✅ Volume set to ${command.value}% on channel ${command.channel}`;
          break;
        case 'mute':
          setMute(command.channel, command.on);
          resultMsg = `✅ Mute ${command.on ? 'ON' : 'OFF'} on channel ${command.channel}`;
          break;
        case 'solo':
          setSolo(command.channel, command.on);
          resultMsg = `✅ Solo ${command.on ? 'ON' : 'OFF'} on channel ${command.channel}`;
          break;
        case 'recordArm':
          setRecordArm(command.channel, command.on);
          resultMsg = `✅ Record ${command.on ? 'ARMED' : 'DISARMED'} on channel ${command.channel}`;
          break;
        case 'transport':
          switch (command.command) {
            case 'play': transportPlay(); resultMsg = '▶️ Transport: PLAY started'; break;
            case 'stop': transportStop(); resultMsg = '⏹️ Transport: STOPPED'; break;
            case 'record': transportRecord(); resultMsg = '⏺️ Transport: RECORDING'; break;
            default: resultMsg = '❌ Unknown transport command';
          }
          break;
        case 'getInfo':
          const state = getCompleteSessionState();
          resultMsg = `📊 Session Info:\n${JSON.stringify(state.summary, null, 2)}`;
          break;
        default:
          resultMsg = '❌ Unknown command action';
      }
    } catch (parseError) {
      resultMsg = `❌ Failed to understand command: ${parseError.message}`;
    }

    const state = getCompleteSessionState();
    res.render('index', { 
      result: resultMsg,
      sessionInfo: state.summary
    });

  } catch (err) {
    console.error('Error processing web request:', err);
    const state = getCompleteSessionState();
    res.render('index', { 
      result: '❌ AI service error',
      sessionInfo: state.summary
    });
  }
});

// === Debug/Test Endpoints ===
app.get('/test-gemini', async (req, res) => {
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: "Say hi and confirm you can see this message" }] }]
    });
    res.json({ 
      success: true, 
      response: result.response.text(),
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Gemini test failed:', err);
    res.status(500).json({ 
      error: "Gemini test failed", 
      details: err.message 
    });
  }
});

// Session debug endpoint
app.get('/debug', (req, res) => {
  const state = getCompleteSessionState();
  res.json({
    sessionState: state,
    midiPorts: {
      input: inputPort !== -1 ? input.getPortName(inputPort) : 'Not connected',
      output: outputPort !== -1 ? output.getPortName(outputPort) : 'Not connected'
    },
    uptime: Date.now() - state.session.lastUpdate,
    timestamp: Date.now()
  });
});

// Reset session endpoint
app.post('/reset-session', (req, res) => {
  resetSessionState();
  res.json({ 
    message: 'Session reset successfully',
    timestamp: Date.now()
  });
});

// === Graceful Shutdown ===
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down MIDI Assistant...');
  input.closePort();
  output.closePort();
  console.log('✅ MIDI ports closed');
  process.exit(0);
});

// === Launch Server ===
app.listen(port, () => {
  console.log('🚀 =================================');
  console.log(`🎹 MIDI DAW Assistant Server Started`);
  console.log(`🌐 Web Interface: http://localhost:${port}`);
  console.log(`🎛️ Mixer View: http://localhost:${port}/mixer`);
  console.log(`📊 Debug Info: http://localhost:${port}/debug`);
  console.log(`🔴 Live Stream: http://localhost:${port}/api/live`);
  console.log(`📡 Session API: http://localhost:${port}/api/session`);
  console.log('🚀 =================================');
  console.log(`🎚️ Enhanced MCU decoder active`);
  console.log(`🤖 Gemini AI assistant ready`);
  
  // Log current session state
  setTimeout(() => {
    const state = getCompleteSessionState();
    console.log(`📈 Session initialized: ${state.summary.totalTracks} tracks ready`);
  }, 1000);
});