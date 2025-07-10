// api/state.js
const express = require('express');
const router = express.Router();
const { mixerState } = require('../mcu/mcu-decoder');

// Single route definition (remove the duplicate)
router.get('/state', (req, res) => {
  console.log('[API] /api/state hit');
  
  try {
    // Filter out note_ entries and only return actual tracks
    const trackData = {};
    
    Object.entries(mixerState).forEach(([key, value]) => {
      // Skip note_ entries (button presses)
      if (key.startsWith('note_')) return;
      
      // Only process numeric channel keys (1, 2, 3, etc.)
      if (typeof key === 'string' && key.match(/^\d+$/)) {
        // Convert volume from pitch bend range (-8192 to 8191) to percentage (0-100)
        const volumePercent = value.volume !== undefined ? 
          Math.round(((value.volume + 8192) / 16384) * 100) : 0;
        
        // Create clean track data
        trackData[`Track ${key}`] = {
          name: value.name || `Track ${key}`,
          volume: volumePercent,
          pan: value.pan || 0,
          mute: value.mute || false,
          solo: value.solo || false,
          recordArm: value.recordArm || false,
          touch: value.touch || false
        };
      }
    });
    
    console.log('[API] Returning track data:', Object.keys(trackData));
    res.json(trackData);
    
  } catch (error) {
    console.error('[API] Error processing mixer state:', error);
    res.status(500).json({ error: 'Failed to process mixer state' });
  }
});

// Optional: Add separate endpoint for button/note states if needed
router.get('/notes', (req, res) => {
  console.log('[API] /api/notes hit');
  
  try {
    const noteData = {};
    Object.entries(mixerState).forEach(([key, value]) => {
      if (key.startsWith('note_')) {
        noteData[key] = value;
      }
    });
    
    res.json(noteData);
  } catch (error) {
    console.error('[API] Error processing note data:', error);
    res.status(500).json({ error: 'Failed to process note data' });
  }
});

router.get('/test', (req, res) => {
  res.json({ 
    message: 'API is working!', 
    timestamp: new Date(),
    mixerStateKeys: Object.keys(require('../mcu/mcu-decoder').mixerState)
  });
});

module.exports = router;