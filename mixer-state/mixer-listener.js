// mixer-state/mixer-listener.js

const midi = require('midi');
const { updateMixerState } = require('./mixer-state');
const { logMixerEvent } = require('./database');

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

if (iacPort === -1) throw new Error('❌ IAC Driver Bus 2 not found for input');

input.ignoreTypes(false, false, false);
input.openPort(iacPort);
console.log(`🎛️ Listening on: ${input.getPortName(iacPort)}`);

// === Decode Pitch Bend helper ===
function decodePitchBend(lsb, msb) {
  return ((msb << 7) | lsb) - 8192;
}

// === Handle incoming MIDI messages ===
input.on('message', (deltaTime, [status, data1, data2]) => {
  console.log('🎹 MIDI IN:', [status, data1, data2]);

  const channel = status & 0x0F;
  const command = status & 0xF0;

  // === Control Change (Mute, Solo, Pan) ===
  if (command === 0xB0) {
    if (data1 === 120) {
      console.log(`🔇 Track ${channel + 1} Mute: ${data2 > 0}`);
      updateMixerState(channel + 1, 'mute', data2 > 0);
      logMixerEvent(channel + 1, 'mute', data2 > 0);
    } else if (data1 === 121) {
      console.log(`🎚️ Track ${channel + 1} Solo: ${data2 > 0}`);
      updateMixerState(channel + 1, 'solo', data2 > 0);
      logMixerEvent(channel + 1, 'solo', data2 > 0);
    } else if (data1 === 10) {
      const pan = data2 - 64;
      console.log(`↔️ Track ${channel + 1} Pan: ${pan}`);
      updateMixerState(channel + 1, 'pan', pan);
      logMixerEvent(channel + 1, 'pan', pan);
    }
  }

  // === Pitch Bend (Volume fader) ===
  else if (command === 0xE0) {
    const value = decodePitchBend(data1, data2);
    console.log(`🔊 Track ${channel + 1} Volume: ${value}`);
    updateMixerState(channel + 1, 'volume', value);
    logMixerEvent(channel + 1, 'volume', value);
  }

//   // === SysEx ===
//   else if (status === 0xF0) {
//     console.log('📡 SysEx received (not yet parsed)');
//   }

  else if (status === 0xF0) {
  // Optional: filter known SysEx spam
  if (data1 === 0 && data2 === 3) return; // ignore Mackie ping
  console.log('📡 SysEx received (not yet parsed)');
}

  // === Skip other command types ===
  else {
    const hex = `0x${status.toString(16).toUpperCase()}`;
    console.log(`⚠️ Unhandled MIDI message (${hex}) - skipping`);
  }
});
