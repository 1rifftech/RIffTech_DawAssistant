// mcu/mcu-listener.js

const midi = require('midi');
const { decodeMessage } = require('./mcu-decoder');

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

if (iacPort === -1) throw new Error('IAC Driver Bus 2 not found for input');

input.ignoreTypes(false, false, false);
input.openPort(iacPort);
console.log(`Listening on: ${input.getPortName(iacPort)}`);

// === Forward all MIDI messages to the decoder ===
input.on('message', (deltaTime, message) => {
  console.log('MIDI IN:', message);
  decodeMessage(...message);
});
