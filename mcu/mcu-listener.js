// mcu/enhanced-mcu-listener.js
const midi = require('midi');
const { 
  enhancedMCUDecode, 
  enhancedSysExDecode, 
  updateSessionMeta,
  getCompleteSessionState 
} = require('./enhanced-mcu-decoder');

// Create MIDI input instance
const input = new midi.Input();

// Print all available MIDI ports for debugging
console.log('🔍 Available MIDI Input Ports:');
for (let i = 0; i < input.getPortCount(); i++) {
  console.log(`  ${i}: ${input.getPortName(i)}`);
}

// Find and connect to IAC Driver Bus 2
let iacPort = -1;
for (let i = 0; i < input.getPortCount(); i++) {
  const name = input.getPortName(i);
  if (name.includes('IAC Driver Bus 2')) {
    iacPort = i;
    break;
  }
}

if (iacPort === -1) {
  console.error('❌ IAC Driver Bus 2 not found for input');
  console.log('💡 Make sure you have:');
  console.log('   1. Created IAC Driver Bus 2 in Audio MIDI Setup');
  console.log('   2. Configured Logic Pro to use MCU protocol on Bus 2');
  process.exit(1);
}

// Configure MIDI input
input.ignoreTypes(false, false, false); // Enable SysEx, timing, and active sensing
input.openPort(iacPort);

console.log(`✅ MIDI Input connected: ${input.getPortName(iacPort)}`);
updateSessionMeta('connectionStatus', 'connected');

// SysEx message buffering
let sysexBuffer = [];
let inSysex = false;
let messageCount = 0;

// Enhanced message handler
input.on('message', (deltaTime, message) => {
  messageCount++;
  
  // Log every message for debugging (you can disable this later)
  console.log(`[${messageCount.toString().padStart(4, '0')}] MIDI: [${message.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}]`);
  
  try {
    // Handle SysEx messages (can be multi-part)
    if (message[0] === 0xF0) {
      console.log('📱 SysEx START detected');
      inSysex = true;
      sysexBuffer = [...message];
      
      // Check if complete SysEx in single message
      if (message.includes(0xF7)) {
        console.log('📱 Complete SysEx in single message');
        inSysex = false;
        const result = enhancedSysExDecode(sysexBuffer);
        if (result) {
          console.log('✅ SysEx decoded:', result);
          handleDecodedMessage(result);
        }
        sysexBuffer = [];
      }
    } 
    else if (inSysex) {
      // Continuation of SysEx
      sysexBuffer.push(...message);
      console.log(`📱 SysEx CONTINUE (buffer length: ${sysexBuffer.length})`);
      
      // Check for end of SysEx
      if (message.includes(0xF7)) {
        console.log('📱 SysEx END detected');
        inSysex = false;
        const result = enhancedSysExDecode(sysexBuffer);
        if (result) {
          console.log('✅ SysEx decoded:', result);
          handleDecodedMessage(result);
        }
        sysexBuffer = [];
      }
    } 
    else {
      // Regular MIDI messages (Note On/Off, CC, Pitch Bend)
      const result = enhancedMCUDecode(message);
      if (result) {
        console.log('✅ MIDI decoded:', result);
        handleDecodedMessage(result);
      } else {
        console.log('⚠️ Unhandled MIDI message');
      }
    }
    
    // Update connection timestamp
    updateSessionMeta('lastUpdate', Date.now());
    
  } catch (error) {
    console.error('💥 Error processing MIDI message:', error);
    console.error('Message was:', message);
  }
});

// Handle decoded messages (you can extend this for real-time features)
function handleDecodedMessage(decodedMessage) {
  switch (decodedMessage.type) {
    case 'fader':
      console.log(`🎚️ Fader ${decodedMessage.channel}: ${decodedMessage.percentage}%`);
      // Could emit WebSocket event here for real-time UI updates
      break;
      
    case 'button':
      const emoji = decodedMessage.action === 'mute' ? '🔇' : 
                   decodedMessage.action === 'solo' ? '🟡' : 
                   decodedMessage.action === 'record' ? '🔴' : '🔘';
      console.log(`${emoji} ${decodedMessage.action.toUpperCase()} ${decodedMessage.channel}: ${decodedMessage.pressed ? 'ON' : 'OFF'}`);
      break;
      
    case 'transport':
      const transportEmoji = decodedMessage.action === 'play' ? '▶️' : 
                            decodedMessage.action === 'stop' ? '⏹️' : 
                            decodedMessage.action === 'record' ? '⏺️' : '🎮';
      console.log(`${transportEmoji} Transport ${decodedMessage.action.toUpperCase()}: ${decodedMessage.pressed ? 'ON' : 'OFF'}`);
      break;
      
    case 'encoder':
      console.log(`🎛️ Encoder ${decodedMessage.channel}: ${decodedMessage.delta > 0 ? 'CW' : 'CCW'} (${decodedMessage.value})`);
      break;
      
    case 'touch':
      console.log(`👆 Touch ${decodedMessage.channel}: ${decodedMessage.touched ? 'DOWN' : 'UP'}`);
      break;
      
    case 'display':
      if (decodedMessage.row === 0 && decodedMessage.text) {
        console.log(`🏷️ Track ${decodedMessage.channel} name: "${decodedMessage.text}"`);
      }
      break;
      
    case 'meter':
      if (decodedMessage.level > 100) {
        console.log(`📊 Meter ${decodedMessage.channel}: ${decodedMessage.level} (LOUD!)`);
      }
      break;
      
    case 'timeDisplay':
      console.log(`⏰ Time: ${decodedMessage.time}`);
      break;
      
    default:
      console.log('ℹ️ Other MCU event:', decodedMessage.type);
  }
}

// Connection monitoring
setInterval(() => {
  const state = getCompleteSessionState();
  const timeSinceLastUpdate = Date.now() - state.session.lastUpdate;
  
  if (timeSinceLastUpdate > 30000) { // 30 seconds
    console.log('⚠️ No MIDI data received in 30 seconds - check Logic Pro MCU connection');
    updateSessionMeta('connectionStatus', 'timeout');
  }
}, 30000);

// Periodic session state logging (every 60 seconds)
setInterval(() => {
  const state = getCompleteSessionState();
  console.log('📈 Session Status:');
  console.log(`   🎵 Tracks: ${state.summary.totalTracks} total, ${state.summary.activeTracks} active`);
  console.log(`   🎮 Transport: ${state.transport.playing ? 'Playing' : 'Stopped'} | Time: ${state.transport.position.smpte}`);
  console.log(`   📊 Messages processed: ${messageCount}`);
  console.log(`   🔗 Connection: ${state.session.connectionStatus}`);
}, 60000);

// Error handling
input.on('error', (error) => {
  console.error('💥 MIDI Input Error:', error);
  updateSessionMeta('connectionStatus', 'error');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Closing MIDI input connection...');
  updateSessionMeta('connectionStatus', 'disconnected');
  input.closePort();
  console.log('✅ MIDI input closed');
  process.exit(0);
});

// Export for potential use by other modules
module.exports = {
  input,
  messageCount: () => messageCount,
  isConnected: () => input.isPortOpen(),
  getPortName: () => iacPort !== -1 ? input.getPortName(iacPort) : 'Not connected'
};