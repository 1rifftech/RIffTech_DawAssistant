
// mixer-state/mcu-listener.js
// Listens for incoming Mackie Control Universal (MCU) protocol MIDI messages and decodes them.

const midi = require('midi');
const { updateMixerState } = require('../mixer-state/mixer-state.js');
const { logMixerEvent } = require('../mixer-state/database.js');

const { decodeMessage } = require('./mcu-decoder');

// === MIDI Input Setup ===
const input = new midi.Input();  
input.ignoreTypes(false, false, false);

let iacPort = -1;
for (let i = 0; i < input.getPortCount(); i++) {
  const name = input.getPortName(i);
  if (name.includes('IAC Driver Bus 2')) {
    iacPort = i;
    break;
  }
}

if (iacPort === -1) {
  throw new Error('âŒ IAC Driver Bus 2 not found for input');
}

input.openPort(iacPort);
console.log(`ðŸŽ›ï¸ MCU Listener active on: ${input.getPortName(iacPort)}`);

// === SysEx MCU Decoder Helpers ===

function decodeSysExMessage(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0xF0 || bytes[bytes.length - 1] !== 0xF7) return;

  const mfg = bytes.slice(1, 4); // 00 00 66
  const deviceID = bytes[4];     // 14
  const modelID = bytes[5];      // 0E
  const param = bytes[6];        // eg. 00 - fader bank/channel
  const value = bytes[7];        // data byte

  console.log(`ðŸŽšï¸ MCU SysEx â†’ Param: ${param}, Value: ${value}`);

  updateMixerState(deviceID, `param_${param}`, value);
  logMixerEvent(deviceID, `param_${param}`, value);
}

// === Main Message Handler ===
input.on('message', (deltaTime, message) => {
  const [status, data1, data2] = message;
  if (status === 0xF0) {
    console.log('ðŸ“¡ MCU SysEx received:', message);
    decodeSysExMessage(message);
  } else {
    console.log('ðŸŽ¹ MIDI Message:', message);
  }
});

module.exports = { input };