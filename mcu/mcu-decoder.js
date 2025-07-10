// Example of how to integrate the enhanced decoder into your existing midiAssistant.js

require('dotenv').config();
const midi = require('midi');
const express = require('express');
const { processEnhancedMCUMessage, getEnhancedMixerState, MCU } = require('./mcu-decoder');

// Replace your existing MCU decoder with the enhanced version
const input = new midi.Input();

// Your existing MIDI input handling, but with enhanced processing
input.on('message', (deltaTime, message) => {
  // Use the enhanced decoder instead of your current one
  const decoded = processEnhancedMCUMessage(message);
  
  if (decoded) {
    // Your existing logic for handling decoded messages
    handleMCUEvent(decoded);
  }
});

function handleMCUEvent(event) {
  switch (event.type) {
    case 'fader':
      console.log(`Fader ${event.channel}: ${event.value}`);
      // Your existing fader handling
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

// Enhanced API routes with the new state
app.get('/api/mixer-state', (req, res) => {
  const state = getEnhancedMixerState();
  res.json(state);
});

// New endpoint to get MCU constants for your frontend
app.get('/api/mcu-constants', (req, res) => {
  res.json(MCU);
});

// Example of using the constants to send commands back to Logic
function sendMCUCommand(command, value = 127) {
  if (MCU[command] !== undefined) {
    const noteNumber = MCU[command];
    output.sendMessage([0x90, noteNumber, value]); // Note On
  }
}

// Your existing input selection logic remains the same
console.log('Available MIDI inputs:');
for (let i = 0; i < input.getPortCount(); i++) {
  console.log(`${i}: ${input.getPortName(i)}`);
}

// Connect to your existing Logic Pro setup
const logicPortIndex = 0; // or whatever port you're using
input.openPort(logicPortIndex);
input.setCallback((deltaTime, message) => {
  processEnhancedMCUMessage(message);
});

console.log('Enhanced MCU decoder connected to Logic Pro');