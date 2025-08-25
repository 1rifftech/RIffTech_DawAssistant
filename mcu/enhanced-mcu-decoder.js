// mcu/enhanced-mcu-decoder.js
const { logMixerEvent } = require('../mixer-state/database');

const sessionState = {
  tracks: {},
  transport: {
    playing: false,
    recording: false,
    stopped: true,
    position: { bars: 0, beats: 0, ticks: 0, smpte: '00:00:00:00' },
    tempo: 120.0,
    timeSignature: { numerator: 4, denominator: 4 }
  },
  display: {
    trackNames: {},
    upperDisplay: {},
    lowerDisplay: {},
    timeDisplay: '',
    assignment: '',
    currentBank: 0
  },
  automation: { modes: {}, globalMode: 'read' },
  meters: { tracks: {}, master: { left: 0, right: 0 } },
  buttons: { transport: {}, tracks: {}, function: {}, navigation: {} },
  vpots: {},
  session: {
    lastUpdate: Date.now(),
    connectionStatus: 'disconnected',
    bankOffset: 0,
    selectedTrack: 1
  }
};

function initializeTrack(trackNumber) {
  const trackId = trackNumber.toString();
  
  if (!sessionState.tracks[trackId]) {
    sessionState.tracks[trackId] = {
      number: trackNumber,
      name: `Track ${trackNumber}`,
      volume: 0,
      volumePercent: 0,
      pan: 64,
      mute: false,
      solo: false,
      recordArm: false,
      select: false,
      touch: false,
      lastUpdate: Date.now()
    };
  }
  
  if (!sessionState.automation.modes[trackId]) {
    sessionState.automation.modes[trackId] = {
      read: false, write: false, touch: false, latch: false
    };
  }
  
  if (!sessionState.buttons.tracks[trackId]) {
    sessionState.buttons.tracks[trackId] = {
      mute: false, solo: false, record: false, select: false, vpot: false
    };
  }
  
  if (!sessionState.meters.tracks[trackId]) {
    sessionState.meters.tracks[trackId] = { level: 0, peak: 0, clip: false };
  }
  
  if (!sessionState.vpots[trackId]) {
    sessionState.vpots[trackId] = { value: 64, mode: 'pan', ledRing: 0 };
  }
  
  if (!sessionState.display.trackNames[trackId]) {
    sessionState.display.trackNames[trackId] = `Track ${trackNumber}`;
  }
}

for (let i = 1; i <= 8; i++) {
  initializeTrack(i);
}

function enhancedMCUDecode(message) {
  const [status, data1, data2] = message;
  sessionState.session.lastUpdate = Date.now();
  sessionState.session.connectionStatus = 'connected';
  
  // Pitch Bend (Faders) - 0xE0-0xE7
  if ((status & 0xF0) === 0xE0) {
    const channel = (status & 0x0F) + 1;
    const value = (data2 << 7) | data1;
    const volumePercent = Math.round(((value + 8192) / 16384) * 100);
    
    initializeTrack(channel);
    sessionState.tracks[channel.toString()].volume = value;
    sessionState.tracks[channel.toString()].volumePercent = volumePercent;
    sessionState.tracks[channel.toString()].lastUpdate = Date.now();
    
    console.log(`Fader ${channel}: ${volumePercent}%`);
    logMixerEvent(channel, 'volume', value);
    
    return { type: 'fader', channel: channel, value: value, percentage: volumePercent };
  }
  
  // Note On/Off (Buttons) - 0x90/0x80
  else if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {
    const velocity = (status & 0xF0) === 0x90 ? data2 : 0;
    const pressed = velocity > 0;
    
    // Record buttons (0x00-0x07)
    if (data1 >= 0x00 && data1 <= 0x07) {
      const channel = data1 + 1;
      initializeTrack(channel);
      sessionState.tracks[channel.toString()].recordArm = pressed;
      sessionState.buttons.tracks[channel.toString()].record = pressed;
      
      console.log(`Record ${channel}: ${pressed ? 'ARM' : 'DISARM'}`);
      logMixerEvent(channel, 'record', pressed);
      
      return { type: 'button', action: 'record', channel: channel, pressed: pressed };
    }
    
    // Solo buttons (0x08-0x0F)
    else if (data1 >= 0x08 && data1 <= 0x0F) {
      const channel = (data1 - 0x08) + 1;
      initializeTrack(channel);
      sessionState.tracks[channel.toString()].solo = pressed;
      sessionState.buttons.tracks[channel.toString()].solo = pressed;
      
      console.log(`Solo ${channel}: ${pressed ? 'ON' : 'OFF'}`);
      logMixerEvent(channel, 'solo', pressed);
      
      return { type: 'button', action: 'solo', channel: channel, pressed: pressed };
    }
    
    // Mute buttons (0x10-0x17)
    else if (data1 >= 0x10 && data1 <= 0x17) {
      const channel = (data1 - 0x10) + 1;
      initializeTrack(channel);
      sessionState.tracks[channel.toString()].mute = pressed;
      sessionState.buttons.tracks[channel.toString()].mute = pressed;
      
      console.log(`Mute ${channel}: ${pressed ? 'ON' : 'OFF'}`);
      logMixerEvent(channel, 'mute', pressed);
      
      return { type: 'button', action: 'mute', channel: channel, pressed: pressed };
    }
    
    // Select buttons (0x18-0x1F)
    else if (data1 >= 0x18 && data1 <= 0x1F) {
      const channel = (data1 - 0x18) + 1;
      initializeTrack(channel);
      
      Object.keys(sessionState.tracks).forEach(trackId => {
        sessionState.tracks[trackId].select = false;
        sessionState.buttons.tracks[trackId].select = false;
      });
      
      sessionState.tracks[channel.toString()].select = pressed;
      sessionState.buttons.tracks[channel.toString()].select = pressed;
      sessionState.session.selectedTrack = pressed ? channel : 1;
      
      console.log(`Select ${channel}: ${pressed ? 'ON' : 'OFF'}`);
      logMixerEvent(channel, 'select', pressed);
      
      return { type: 'button', action: 'select', channel: channel, pressed: pressed };
    }
    
    // Transport buttons
    else if (data1 === 0x5E) { // Play
      sessionState.transport.playing = pressed;
      sessionState.transport.stopped = !pressed;
      sessionState.buttons.transport.play = pressed;
      
      console.log(`Transport PLAY: ${pressed ? 'START' : 'STOP'}`);
      logMixerEvent(-1, 'transport', 'play');
      
      return { type: 'transport', action: 'play', pressed: pressed };
    }
    
    else if (data1 === 0x5D) { // Stop
      sessionState.transport.playing = false;
      sessionState.transport.recording = false;
      sessionState.transport.stopped = true;
      sessionState.buttons.transport.stop = pressed;
      
      console.log(`Transport STOP: ${pressed ? 'PRESSED' : 'RELEASED'}`);
      logMixerEvent(-1, 'transport', 'stop');
      
      return { type: 'transport', action: 'stop', pressed: pressed };
    }
    
    else if (data1 === 0x5F) { // Record
      sessionState.transport.recording = pressed;
      sessionState.buttons.transport.record = pressed;
      
      console.log(`Transport RECORD: ${pressed ? 'START' : 'STOP'}`);
      logMixerEvent(-1, 'transport', 'record');
      
      return { type: 'transport', action: 'record', pressed: pressed };
    }
  }
  
  // Control Change (V-Pots, Touch, etc.) - 0xB0-0xB7
  else if ((status & 0xF0) === 0xB0) {
    // V-Pots (Encoders) 0x10-0x17
    if (data1 >= 0x10 && data1 <= 0x17) {
      const channel = (data1 - 0x10) + 1;
      initializeTrack(channel);
      
      const direction = (data2 & 0x40) ? -1 : 1;
      const speed = data2 & 0x3F;
      const delta = direction * speed;
      
      const currentPan = sessionState.tracks[channel.toString()].pan;
      const newPan = Math.max(0, Math.min(127, currentPan + delta));
      sessionState.tracks[channel.toString()].pan = newPan;
      sessionState.vpots[channel.toString()].value = newPan;
      
      console.log(`V-Pot ${channel}: ${delta > 0 ? '+' : ''}${delta} (pan: ${newPan})`);
      logMixerEvent(channel, 'pan', newPan);
      
      return { type: 'encoder', channel: channel, delta: delta, value: newPan };
    }
    
    // Fader Touch (0x68-0x6F)
    else if (data1 >= 0x68 && data1 <= 0x6F) {
      const channel = (data1 - 0x68) + 1;
      if (channel <= 8) {
        initializeTrack(channel);
        const touched = data2 > 0;
        sessionState.tracks[channel.toString()].touch = touched;
        
        console.log(`Touch ${channel}: ${touched ? 'DOWN' : 'UP'}`);
        logMixerEvent(channel, 'touch', touched);
        
        return { type: 'touch', channel: channel, touched: touched };
      }
    }
  }
  
  return null;
}

function enhancedSysExDecode(data) {
  if (data[0] !== 0xF0 || data[1] !== 0x00 || data[2] !== 0x00 || data[3] !== 0x66) {
    return null;
  }
  
  const deviceId = data[4];
  const subId = data[5];
  
  // LCD Display update (0x12)
  if (subId === 0x12) {
    const offset = data[6];
    const text = [];
    
    for (let i = 7; i < data.length - 1; i++) {
      if (data[i] === 0xF7) break;
      text.push(String.fromCharCode(data[i]));
    }
    
    const displayText = text.join('').trim();
    const row = Math.floor(offset / 56);
    const col = offset % 56;
    const channelIndex = Math.floor(col / 7) + 1;
    
    if (channelIndex <= 8) {
      initializeTrack(channelIndex);
      
      if (row === 0) {
        sessionState.display.trackNames[channelIndex.toString()] = displayText;
        sessionState.tracks[channelIndex.toString()].name = displayText || `Track ${channelIndex}`;
        sessionState.display.upperDisplay[channelIndex.toString()] = displayText;
        
        console.log(`Track ${channelIndex} name: "${displayText}"`);
        logMixerEvent(channelIndex, 'trackName', displayText);
      } else if (row === 1) {
        sessionState.display.lowerDisplay[channelIndex.toString()] = displayText;
        console.log(`Track ${channelIndex} lower display: "${displayText}"`);
      }
    }
    
    return { type: 'display', row: row, channel: channelIndex, text: displayText, offset: offset };
  }
  
  // Meter data (0xD0-0xDF)
  else if ((subId & 0xF0) === 0xD0) {
    const channel = (subId & 0x0F) + 1;
    if (channel <= 8) {
      const level = data[6];
      initializeTrack(channel);
      sessionState.meters.tracks[channel.toString()].level = level;
      
      if (level > 120) {
        sessionState.meters.tracks[channel.toString()].clip = true;
        sessionState.meters.tracks[channel.toString()].peak = level;
      }
      
      console.log(`Meter ${channel}: ${level}`);
      
      return { type: 'meter', channel: channel, level: level };
    }
  }
  
  // Time display (0x10)
  else if (subId === 0x10) {
    if (data.length >= 17) {
      const timeBytes = data.slice(6, 16);
      const timeStr = timeBytes.map(b => 
        String.fromCharCode(b === 0x00 ? 0x20 : b)
      ).join('').trim();
      
      sessionState.transport.position.smpte = timeStr;
      sessionState.display.timeDisplay = timeStr;
      
      const barsBeatMatch = timeStr.match(/(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (barsBeatMatch) {
        sessionState.transport.position.bars = parseInt(barsBeatMatch[1]);
        sessionState.transport.position.beats = parseInt(barsBeatMatch[2]);
        sessionState.transport.position.ticks = parseInt(barsBeatMatch[3]);
      }
      
      console.log(`Time display: ${timeStr}`);
      
      return { type: 'timeDisplay', time: timeStr, position: sessionState.transport.position };
    }
  }
  
  return null;
}

function getCompleteSessionState() {
  return {
    ...sessionState,
    summary: {
      totalTracks: Object.keys(sessionState.tracks).length,
      activeTracks: Object.values(sessionState.tracks).filter(t => !t.mute).length,
      mutedTracks: Object.values(sessionState.tracks).filter(t => t.mute).length,
      soloedTracks: Object.values(sessionState.tracks).filter(t => t.solo).length,
      recordArmedTracks: Object.values(sessionState.tracks).filter(t => t.recordArm).length,
      isPlaying: sessionState.transport.playing,
      isRecording: sessionState.transport.recording,
      selectedTrack: sessionState.session.selectedTrack,
      lastUpdate: sessionState.session.lastUpdate
    }
  };
}

function getAPICompatibleState() {
  const apiState = {};
  
  Object.entries(sessionState.tracks).forEach(([trackId, track]) => {
    apiState[`Track ${trackId}`] = {
      name: track.name,
      volume: track.volumePercent,
      pan: track.pan,
      mute: track.mute,
      solo: track.solo,
      recordArm: track.recordArm,
      touch: track.touch,
      select: track.select,
      lastUpdate: track.lastUpdate
    };
  });
  
  return apiState;
}

function resetSessionState() {
  Object.keys(sessionState.tracks).forEach(trackId => {
    sessionState.tracks[trackId] = {
      ...sessionState.tracks[trackId],
      volume: 0,
      volumePercent: 0,
      pan: 64,
      mute: false,
      solo: false,
      recordArm: false,
      select: false,
      touch: false,
      lastUpdate: Date.now()
    };
  });
  
  sessionState.transport = {
    playing: false,
    recording: false,
    stopped: true,
    position: { bars: 0, beats: 0, ticks: 0, smpte: '00:00:00:00' },
    tempo: 120.0,
    timeSignature: { numerator: 4, denominator: 4 }
  };
  
  Object.keys(sessionState.buttons.tracks).forEach(trackId => {
    Object.keys(sessionState.buttons.tracks[trackId]).forEach(button => {
      sessionState.buttons.tracks[trackId][button] = false;
    });
  });
  
  Object.keys(sessionState.buttons.transport).forEach(button => {
    sessionState.buttons.transport[button] = false;
  });
  
  sessionState.session.lastUpdate = Date.now();
  console.log('Session state reset');
}

function updateSessionMeta(key, value) {
  sessionState.session[key] = value;
  sessionState.session.lastUpdate = Date.now();
}

function getTrack(trackNumber) {
  initializeTrack(trackNumber);
  return sessionState.tracks[trackNumber.toString()];
}

module.exports = {
  sessionState,
  enhancedMCUDecode,
  enhancedSysExDecode,
  getCompleteSessionState,
  getAPICompatibleState,
  resetSessionState,
  updateSessionMeta,
  getTrack,
  initializeTrack,
  
  // Legacy exports for backward compatibility
  mixerState: sessionState,
  decodeMCUMessage: enhancedMCUDecode,
  decodeSysEx: enhancedSysExDecode
};