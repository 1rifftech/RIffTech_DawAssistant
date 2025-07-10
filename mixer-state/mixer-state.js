const mixerState = {
  tracks: {},
  lastUpdate: Date.now()
};

function updateMixerState(track, param, value) {
  if (!mixerState.tracks[track]) mixerState.tracks[track] = {};
  mixerState.tracks[track][param] = value;
  mixerState.tracks[track].updated = Date.now();
  mixerState.lastUpdate = Date.now();
}

function getMixerState() {
  return {
    tracks: mixerState.tracks,
    lastUpdate: mixerState.lastUpdate
  };
}

module.exports = { mixerState, updateMixerState, getMixerState };