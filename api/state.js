// api/enhanced-state.js
const express = require('express');
const router = express.Router();
const { 
  getCompleteSessionState, 
  getAPICompatibleState,
  sessionState,
  resetSessionState,
  updateSessionMeta,
  getTrack
} = require('../mcu/enhanced-mcu-decoder');

// Complete session state endpoint
router.get('/session', (req, res) => {
  console.log('[API] /api/session - Complete session state requested');
  
  try {
    const completeState = getCompleteSessionState();
    res.json(completeState);
  } catch (error) {
    console.error('[API] Error getting complete session state:', error);
    res.status(500).json({ error: 'Failed to get session state' });
  }
});

// Legacy compatible state endpoint (for existing mixer UI)
router.get('/state', (req, res) => {
  console.log('[API] /api/state - Legacy compatible state requested');
  
  try {
    const apiState = getAPICompatibleState();
    res.json(apiState);
  } catch (error) {
    console.error('[API] Error getting API compatible state:', error);
    res.status(500).json({ error: 'Failed to get mixer state' });
  }
});

// Individual track endpoint
router.get('/track/:number', (req, res) => {
  const trackNumber = parseInt(req.params.number);
  
  if (isNaN(trackNumber) || trackNumber < 1 || trackNumber > 8) {
    return res.status(400).json({ error: 'Invalid track number. Must be 1-8.' });
  }
  
  try {
    const track = getTrack(trackNumber);
    res.json({
      track: trackNumber,
      data: track,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`[API] Error getting track ${trackNumber}:`, error);
    res.status(500).json({ error: `Failed to get track ${trackNumber}` });
  }
});

// Transport state endpoint
router.get('/transport', (req, res) => {
  console.log('[API] /api/transport - Transport state requested');
  
  try {
    res.json({
      transport: sessionState.transport,
      buttons: sessionState.buttons.transport,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[API] Error getting transport state:', error);
    res.status(500).json({ error: 'Failed to get transport state' });
  }
});

// Meters endpoint
router.get('/meters', (req, res) => {
  console.log('[API] /api/meters - Meter data requested');
  
  try {
    res.json({
      meters: sessionState.meters,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[API] Error getting meter data:', error);
    res.status(500).json({ error: 'Failed to get meter data' });
  }
});

// Display data endpoint
router.get('/display', (req, res) => {
  console.log('[API] /api/display - Display data requested');
  
  try {
    res.json({
      display: sessionState.display,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[API] Error getting display data:', error);
    res.status(500).json({ error: 'Failed to get display data' });
  }
});

// Session summary endpoint
router.get('/summary', (req, res) => {
  console.log('[API] /api/summary - Session summary requested');
  
  try {
    const state = getCompleteSessionState();
    res.json({
      summary: state.summary,
      connection: {
        status: sessionState.session.connectionStatus,
        lastUpdate: sessionState.session.lastUpdate,
        timeSinceLastUpdate: Date.now() - sessionState.session.lastUpdate
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[API] Error getting session summary:', error);
    res.status(500).json({ error: 'Failed to get session summary' });
  }
});

// Reset session endpoint (useful for debugging)
router.post('/reset', (req, res) => {
  console.log('[API] /api/reset - Resetting session state');
  
  try {
    resetSessionState();
    res.json({ 
      message: 'Session state reset successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[API] Error resetting session:', error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  const timeSinceLastUpdate = Date.now() - sessionState.session.lastUpdate;
  const isHealthy = timeSinceLastUpdate < 30000; // 30 seconds
  
  res.json({
    status: isHealthy ? 'healthy' : 'stale',
    connection: sessionState.session.connectionStatus,
    lastUpdate: sessionState.session.lastUpdate,
    timeSinceLastUpdate: timeSinceLastUpdate,
    trackCount: Object.keys(sessionState.tracks).length,
    timestamp: Date.now()
  });
});

// Bulk state export (for debugging/analysis)
router.get('/export', (req, res) => {
  console.log('[API] /api/export - Full state export requested');
  
  try {
    const completeState = getCompleteSessionState();
    
    // Add export metadata
    const exportData = {
      exportTime: new Date().toISOString(),
      version: '1.0',
      source: 'DAW-Assistant',
      data: completeState
    };
    
    res.json(exportData);
  } catch (error) {
    console.error('[API] Error exporting state:', error);
    res.status(500).json({ error: 'Failed to export state' });
  }
});

// Live state streaming endpoint (for real-time updates)
router.get('/live', (req, res) => {
  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  const sendUpdate = () => {
    try {
      const state = getCompleteSessionState();
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    } catch (error) {
      console.error('[API] Error in live stream:', error);
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    }
  };
  
  // Send initial state
  sendUpdate();
  
  // Send updates every second
  const interval = setInterval(sendUpdate, 1000);
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    console.log('[API] Live stream client disconnected');
  });
  
  console.log('[API] Live stream started');
});

module.exports = router;