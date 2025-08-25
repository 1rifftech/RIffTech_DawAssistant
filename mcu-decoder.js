// MCU Decoder for Logic Pro - Working Version Based on Diagnostic
// This version is tailored to what your Logic Pro is actually sending

const midi = require('midi');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

class MCUDecoder {
    constructor() {
        this.state = {
            channels: Array(8).fill(null).map((_, i) => ({
                index: i,
                fader: 0,
                vPot: 0,
                vPotMode: 'pan',
                mute: false,
                solo: false,
                rec: false,
                select: false,
                touched: false,
                meter: 0,
                name: `Track ${i + 1}`,  // Default names since Logic isn't sending them
                displayUpper: '',
                displayLower: '',
                panValue: 0  // -63 to +63
            })),
            masterFader: 0,
            transport: {
                play: false,
                stop: false,
                record: false,
                fastForward: false,
                rewind: false,
                loop: false,
                click: false,
                solo: false
            },
            timecode: {
                bars: 1,
                beats: 1,
                subdivisions: 1,
                ticks: 0,
                frames: 0,
                seconds: 0,
                minutes: 0,
                hours: 0,
                display: '001.01.01.000'  // Default since Logic isn't sending
            },
            assignment: {
                track: true,
                send: false,
                pan: false,
                plugin: false,
                eq: false,
                instrument: false
            },
            automation: {
                read: false,
                write: false,
                trim: false,
                touch: false,
                latch: false,
                group: false
            },
            modifiers: {
                shift: false,
                option: false,
                control: false,
                alt: false
            },
            display: {
                mainTime: '001.01.01.000',
                assignmentDisplay: '',
                trackNumber: 0,
                groupNumber: 0
            },
            jog: {
                position: 0,
                direction: 0
            },
            scrub: false,
            zoom: {
                horizontal: 0,
                vertical: 0
            }
        };
        
        this.clients = new Set();
        this.midiInput = null;
        this.midiOutput = null;
        this.buttonStates = {};  // Track button states to avoid duplicate processing
        this.lastCCValues = new Array(128).fill(0);  // Track CC values
    }

    // Initialize MIDI connections
    initMIDI() {
        this.midiInput = new midi.Input();
        this.midiOutput = new midi.Output();
        
        const inputCount = this.midiInput.getPortCount();
        const outputCount = this.midiOutput.getPortCount();
        
        console.log('\n=== Available MIDI Ports ===');
        console.log('INPUTS:');
        for (let i = 0; i < inputCount; i++) {
            const name = this.midiInput.getPortName(i);
            console.log(`  ${i}: ${name}`);
        }
        
        console.log('\nOUTPUTS:');
        for (let i = 0; i < outputCount; i++) {
            const name = this.midiOutput.getPortName(i);
            console.log(`  ${i}: ${name}`);
        }
        console.log('===========================\n');
        
        // Force IAC Driver Bus 2
        let mcuInputPort = 1;
        let mcuOutputPort = 1;
        
        if (mcuInputPort >= 0 && mcuInputPort < inputCount) {
            this.midiInput.openPort(mcuInputPort);
            
            this.midiInput.on('message', (deltaTime, message) => {
                // Skip clock/active sensing
                if (message[0] !== 0xF8 && message[0] !== 0xFE) {
                    this.processMIDI(message);
                }
            });
            
            console.log(`✓ MIDI input connected to port ${mcuInputPort}`);
        }
        
        if (mcuOutputPort >= 0 && mcuOutputPort < outputCount) {
            this.midiOutput.openPort(mcuOutputPort);
            console.log(`✓ MIDI output connected to port ${mcuOutputPort}`);
            
            // Send MCU handshake
            setTimeout(() => {
                console.log('Sending MCU handshake...');
                this.midiOutput.sendMessage([0xF0, 0x00, 0x00, 0x66, 0x14, 0x00, 0xF7]);
            }, 1000);
        }
    }

    // Process incoming MIDI messages
    processMIDI(message) {
        if (!message || message.length === 0) return;
        
        const [status, data1, data2] = message;
        const channel = status & 0x0F;
        const messageType = status & 0xF0;
        
        const decoded = {
            raw: Array.from(message),
            timestamp: Date.now()
        };

        // Note On/Off messages (buttons)
        if (messageType === 0x90 || messageType === 0x80) {
            const pressed = messageType === 0x90 && data2 > 0;
            const buttonKey = `${data1}_${pressed}`;
            
            // Avoid duplicate processing
            if (this.buttonStates[buttonKey] === Date.now()) return;
            this.buttonStates[buttonKey] = Date.now();
            
            decoded.type = 'button';
            decoded.pressed = pressed;
            
            // REC buttons (0x00-0x07) - FIXED mapping
            if (data1 >= 0x00 && data1 <= 0x07) {
                const ch = data1;
                decoded.channel = ch;
                decoded.button = 'rec';
                this.state.channels[ch].rec = pressed;
                console.log(`REC CH${ch}: ${pressed}`);
            }
            // SOLO buttons (0x08-0x0F)
            else if (data1 >= 0x08 && data1 <= 0x0F) {
                const ch = data1 - 0x08;
                decoded.channel = ch;
                decoded.button = 'solo';
                this.state.channels[ch].solo = pressed;
                console.log(`SOLO CH${ch}: ${pressed}`);
            }
            // MUTE buttons (0x10-0x17)
            else if (data1 >= 0x10 && data1 <= 0x17) {
                const ch = data1 - 0x10;
                decoded.channel = ch;
                decoded.button = 'mute';
                this.state.channels[ch].mute = pressed;
                console.log(`MUTE CH${ch}: ${pressed}`);
            }
            // SELECT buttons (0x18-0x1F) - These should NOT set REC
            else if (data1 >= 0x18 && data1 <= 0x1F) {
                const ch = data1 - 0x18;
                decoded.channel = ch;
                decoded.button = 'select';
                
                if (pressed) {
                    // Clear all other selections
                    for (let i = 0; i < 8; i++) {
                        this.state.channels[i].select = (i === ch);
                    }
                } else {
                    this.state.channels[ch].select = false;
                }
                console.log(`SELECT CH${ch}: ${pressed}`);
            }
            // Transport controls
            else if (data1 === 0x5B) {
                decoded.button = 'rewind';
                this.state.transport.rewind = pressed;
            }
            else if (data1 === 0x5C) {
                decoded.button = 'fastForward';
                this.state.transport.fastForward = pressed;
            }
            else if (data1 === 0x5D) {
                decoded.button = 'stop';
                this.state.transport.stop = pressed;
                if (pressed) {
                    this.state.transport.play = false;
                    this.state.transport.record = false;
                }
            }
            else if (data1 === 0x5E) {
                decoded.button = 'play';
                this.state.transport.play = pressed;
                if (pressed) {
                    this.state.transport.stop = false;
                }
            }
            else if (data1 === 0x5F) {
                decoded.button = 'record';
                this.state.transport.record = pressed;
            }
        }
        
        // Control Change messages
        else if (messageType === 0xB0) {
            decoded.type = 'cc';
            
            // Standard V-Pot messages (0x10-0x17)
            if (data1 >= 0x10 && data1 <= 0x17) {
                const ch = data1 - 0x10;
                const direction = (data2 & 0x40) ? -1 : 1;
                const speed = data2 & 0x0F;
                
                // Update pan value
                this.state.channels[ch].panValue += direction * speed;
                this.state.channels[ch].panValue = Math.max(-63, Math.min(63, this.state.channels[ch].panValue));
                this.state.channels[ch].vPot = this.state.channels[ch].panValue;
                
                decoded.channel = ch;
                decoded.vpot = this.state.channels[ch].panValue;
                console.log(`V-POT CH${ch}: ${this.state.channels[ch].panValue}`);
            }
            // Pan/Send controllers (your Logic seems to use different CCs)
            else if (data1 >= 0x30 && data1 <= 0x37) {
                // Alternative pan control
                const ch = data1 - 0x30;
                if (ch < 8) {
                    // Convert 0-127 to -63 to +63
                    this.state.channels[ch].panValue = Math.round((data2 - 64) * (63/64));
                    this.state.channels[ch].vPot = this.state.channels[ch].panValue;
                    console.log(`PAN CC CH${ch}: ${this.state.channels[ch].panValue}`);
                }
            }
            // Store all CC values for debugging
            this.lastCCValues[data1] = data2;
        }
        
        // Pitch Bend (Faders)
        else if (messageType === 0xE0) {
            decoded.type = 'fader';
            const value = data1 | (data2 << 7);
            
            if (channel <= 7) {
                decoded.channel = channel;
                decoded.value = value;
                this.state.channels[channel].fader = value;
                console.log(`FADER CH${channel}: ${Math.round((value/16383)*100)}%`);
            } else if (channel === 8) {
                decoded.channel = 'master';
                decoded.value = value;
                this.state.masterFader = value;
                console.log(`MASTER FADER: ${Math.round((value/16383)*100)}%`);
            }
        }
        
        // SysEx messages (if they ever come through)
        else if (status === 0xF0) {
            console.log('SysEx received:', Array.from(message).map(b => b.toString(16)).join(' '));
            // Your Logic doesn't seem to send these, so we'll ignore for now
        }
        
        // Broadcast state update
        this.broadcast({
            event: 'midi',
            data: decoded,
            state: this.state
        });
    }

    // Send device query
    sendDeviceQuery() {
        if (this.midiOutput) {
            const query = [0xF0, 0x00, 0x00, 0x66, 0x14, 0x00, 0xF7];
            this.midiOutput.sendMessage(query);
        }
    }

    // Broadcast to all WebSocket clients
    broadcast(data) {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Start WebSocket server
    startServer(port = 8080) {
        const app = express();
        const server = http.createServer(app);
        const wss = new WebSocket.Server({ server });
        
        app.use(express.json());
        app.use(express.static(path.join(__dirname)));
        
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'monitor.html'));
        });
        
        app.get('/api/state', (req, res) => {
            res.json(this.state);
        });
        
        app.get('/api/channels', (req, res) => {
            res.json(this.state.channels);
        });
        
        app.get('/api/channels/:id', (req, res) => {
            const id = parseInt(req.params.id);
            if (id >= 0 && id < 8) {
                res.json(this.state.channels[id]);
            } else {
                res.status(404).json({ error: 'Channel not found' });
            }
        });
        
        app.get('/api/transport', (req, res) => {
            res.json(this.state.transport);
        });
        
        app.get('/api/timecode', (req, res) => {
            res.json(this.state.timecode);
        });
        
        // WebSocket connection
        wss.on('connection', (ws) => {
            console.log('✓ Client connected');
            this.clients.add(ws);
            
            // Send initial state
            ws.send(JSON.stringify({
                event: 'connected',
                state: this.state
            }));
            
            ws.on('close', () => {
                console.log('✗ Client disconnected');
                this.clients.delete(ws);
            });
            
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'ping') {
                        ws.send(JSON.stringify({ type: 'pong' }));
                    }
                } catch (e) {
                    console.error('Invalid WebSocket message:', e);
                }
            });
        });
        
        server.listen(port, () => {
            console.log('\n========================================');
            console.log('MCU Decoder Server Started!');
            console.log('========================================');
            console.log(`Monitor UI:  http://localhost:${port}`);
            console.log(`WebSocket:   ws://localhost:${port}`);
            console.log(`REST API:    http://localhost:${port}/api`);
            console.log('========================================');
            console.log('\nNOTE: Your Logic Pro is not sending:');
            console.log('- Track names (using default names)');
            console.log('- Timecode display (showing default)');
            console.log('- LCD text updates');
            console.log('\nTo fix this in Logic Pro:');
            console.log('1. Delete the current Mackie Control');
            console.log('2. Add a new one and select "Mackie Control Universal"');
            console.log('3. Make sure to use MCU (not HUI) mode');
            console.log('========================================\n');
        });
    }
}

// Usage
const decoder = new MCUDecoder();
decoder.initMIDI();
decoder.startServer(8080);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (decoder.midiInput) decoder.midiInput.closePort();
    if (decoder.midiOutput) decoder.midiOutput.closePort();
    process.exit();
});