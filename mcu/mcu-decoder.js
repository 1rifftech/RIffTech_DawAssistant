// mcu-decoder.js
const { logMixerEvent } = require('../mixer-state/database');

// Define mixerState BEFORE using it
const mixerState = {
  tracks: Array(8).fill(null).map(() => ({
    volume: 0,
    pan: 64,
    mute: false,
    solo: false,
    record: false,
    touch: false,
    trackName: ''
  })),
  transport: {
    playing: false,
    recording: false,
    position: { bars: 0, beats: 0, ticks: 0 },
    tempo: 120,
    smpteTime: '00:00:00:00'
  },
  display: {
    upper: Array(8).fill('        '),
    lower: Array(8).fill('        '),
    assignment: '',
    timeDisplay: ''
  },
  automation: {
    read: Array(8).fill(false),
    write: Array(8).fill(false),
    touch: Array(8).fill(false),
    latch: Array(8).fill(false)
  },
  meters: Array(8).fill(0),
  masterMeter: { left: 0, right: 0 }
};

function decodeMCUMessage(message) {
  const [status, data1, data2] = message;
  
  // Pitch Bend (Faders)
  if ((status & 0xF0) === 0xE0) {
    const channel = status & 0x0F;
    if (channel < 8) {
      const value = (data2 << 7) | data1;
      mixerState.tracks[channel].volume = value;
      console.log(`Channel ${channel + 1} fader: ${value}`);
      logMixerEvent(channel, 'volume', value);
    }
  }
  
  // Note On/Off (Buttons)
  else if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {
    const velocity = (status & 0xF0) === 0x90 ? data2 : 0;
    const pressed = velocity > 0;
    
    // Record buttons (0x00-0x07)
    if (data1 >= 0x00 && data1 <= 0x07) {
      const channel = data1;
      mixerState.tracks[channel].record = pressed;
      console.log(`Channel ${channel + 1} record ${pressed ? 'on' : 'off'}`);
      logMixerEvent(channel, 'record', pressed);
    }
    // Solo buttons (0x08-0x0F)
    else if (data1 >= 0x08 && data1 <= 0x0F) {
      const channel = data1 - 0x08;
      mixerState.tracks[channel].solo = pressed;
      console.log(`Channel ${channel + 1} solo ${pressed ? 'on' : 'off'}`);
      logMixerEvent(channel, 'solo', pressed);
    }
    // Mute buttons (0x10-0x17)
    else if (data1 >= 0x10 && data1 <= 0x17) {
      const channel = data1 - 0x10;
      mixerState.tracks[channel].mute = pressed;
      console.log(`Channel ${channel + 1} mute ${pressed ? 'on' : 'off'}`);
      logMixerEvent(channel, 'mute', pressed);
    }
    // Transport buttons
    else if (data1 === 0x5E) { // Play
      mixerState.transport.playing = pressed;
      console.log(`Play ${pressed ? 'pressed' : 'released'}`);
      logMixerEvent(-1, 'transport', 'play');
    }
    else if (data1 === 0x5D) { // Stop
      mixerState.transport.playing = false;
      console.log(`Stop ${pressed ? 'pressed' : 'released'}`);
      logMixerEvent(-1, 'transport', 'stop');
    }
    else if (data1 === 0x5F) { // Record
      mixerState.transport.recording = pressed;
      console.log(`Record ${pressed ? 'pressed' : 'released'}`);
      logMixerEvent(-1, 'transport', 'record');
    }
  }
  
  // Control Change (V-Pots, etc.)
  else if ((status & 0xF0) === 0xB0) {
    // V-Pots (0x10-0x17)
    if (data1 >= 0x10 && data1 <= 0x17) {
      const channel = data1 - 0x10;
      // V-Pot rotation is relative
      const direction = (data2 & 0x40) ? -1 : 1;
      const speed = data2 & 0x3F;
      const delta = direction * speed;
      
      mixerState.tracks[channel].pan += delta;
      mixerState.tracks[channel].pan = Math.max(0, Math.min(127, mixerState.tracks[channel].pan));
      
      console.log(`Channel ${channel + 1} V-Pot: ${delta > 0 ? '+' : ''}${delta}`);
      logMixerEvent(channel, 'pan', mixerState.tracks[channel].pan);
    }
    // Fader touch (0x68-0x6F)
    else if (data1 >= 0x68 && data1 <= 0x6F) {
      const channel = data1 - 0x68;
      if (channel < 8) {
        mixerState.tracks[channel].touch = data2 > 0;
        console.log(`Channel ${channel + 1} fader ${data2 > 0 ? 'touched' : 'released'}`);
        logMixerEvent(channel, 'touch', data2 > 0);
      }
    }
  }
}

function decodeSysEx(data) {
  // Check for MCU SysEx header
  if (data[0] !== 0xF0 || data[1] !== 0x00 || data[2] !== 0x00 || data[3] !== 0x66) {
    return;
  }
  
  const deviceId = data[4];
  const subId = data[5];
  
  // LCD Display update
  if (subId === 0x12) {
    const offset = data[6];
    const text = [];
    
    for (let i = 7; i < data.length - 1; i++) {
      if (data[i] === 0xF7) break;
      text.push(String.fromCharCode(data[i]));
    }
    
    const displayText = text.join('');
    const row = Math.floor(offset / 56);
    const col = offset % 56;
    const channelIndex = Math.floor(col / 7);
    
    if (row === 0 && channelIndex < 8) {
      // Upper display - track names
      mixerState.tracks[channelIndex].trackName = displayText.trim();
      console.log(`Track ${channelIndex + 1} name: "${displayText.trim()}"`);
      logMixerEvent(channelIndex, 'trackName', displayText.trim());
    }
    
    // Update display arrays
    if (row === 0) {
      mixerState.display.upper[channelIndex] = displayText;
    } else if (row === 1) {
      mixerState.display.lower[channelIndex] = displayText;
    }
  }
  
  // Meter data
  else if ((subId & 0xF0) === 0xD0) {
    const channel = subId & 0x0F;
    const level = data[6];
    if (channel < 8) {
      mixerState.meters[channel] = level;
      console.log(`Channel ${channel + 1} meter: ${level}`);
    }
  }
  
  // Time display
  else if (subId === 0x10) {
    if (data.length >= 17) {
      const timeBytes = data.slice(6, 16);
      const timeStr = timeBytes.map(b => 
        String.fromCharCode(b === 0x00 ? 0x20 : b)
      ).join('');
      mixerState.transport.smpteTime = timeStr;
      console.log(`Time: ${timeStr}`);
    }
  }
}

module.exports = {
  mixerState,
  decodeMCUMessage,
  decodeSysEx
};