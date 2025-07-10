// mcu/mcu-listener.js

const midi = require('midi');
const { decodeMCUMessage, decodeSysEx } = require('./mcu-decoder');

// === Create the input instance ===
const input = new midi.Input();

// === Print all available ports ===
console.log('Available MIDI Input Ports:');
for (let i = 0; i < input.getPortCount(); i++) {
  console.log(`${i}: ${input.getPortName(i)}`);
}

// === Select "IAC Driver Bus 2" ===
let iacPort = -1;
for (let i = 0; i < input.getPortCount(); i++) {
  const name = input.getPortName(i);
  if (name.includes('IAC Driver Bus 2')) {
    iacPort = i;
    break;
  }
}

if (iacPort === -1) {
  console.error('IAC Driver Bus 2 not found for input');
  process.exit(1);
}

// Enable SysEx, timing, and active sensing
input.ignoreTypes(false, false, false);
input.openPort(iacPort);
console.log(`Listening on: ${input.getPortName(iacPort)}`);

// SysEx buffer for multi-part messages
let sysexBuffer = [];
let inSysex = false;

// === Forward all MIDI messages to the decoder ===
input.on('message', (deltaTime, message) => {
  console.log('MIDI IN:', message);
  
  // Handle SysEx messages
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
    // Regular MIDI messages
    decodeMCUMessage(message);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nClosing MIDI connection...');
  input.closePort();
  process.exit(0);
});

module.exports = input;