// mixer-state/sendCommand.js

const midi = require('midi');
const output = new midi.Output();

// === DEBUG: Print all available output ports ===
console.log('🔍 Available MIDI Output Ports:');
for (let i = 0; i < output.getPortCount(); i++) {
  console.log(`${i}: ${output.getPortName(i)}`);
}

// === Select only "IAC Driver Bus 2" ===
let iacPort = -1;
for (let i = 0; i < output.getPortCount(); i++) {
  const name = output.getPortName(i);
  if (name.includes('IAC Driver Bus 2')) {
    iacPort = i;
    break;
  }
}

if (iacPort === -1) {
  throw new Error('"IAC Driver Bus 2" not found for MIDI output');
}

output.openPort(iacPort);
console.log(`MIDI output opened on: ${output.getPortName(iacPort)}`);

// === Send Volume (via Pitch Bend) ===
function setVolume(track, value) {
  const channel = track - 1;
  const bend = Math.max(Math.min(value + 8192, 16383), 0);
  const lsb = bend & 0x7F;
  const msb = (bend >> 7) & 0x7F;
  output.sendMessage([0xE0 | channel, lsb, msb]);
  console.log(`🔊 Set Volume → Track ${track} = ${value}`);
}

// === Send Mute (via CC 120) ===
function setMute(track, on) {
  const channel = track - 1;
  output.sendMessage([0xB0 | channel, 120, on ? 127 : 0]);
  console.log(`Set Mute → Track ${track} = ${on}`);
}

module.exports = { setVolume, setMute };
