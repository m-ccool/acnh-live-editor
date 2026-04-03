'use strict';

function syncMusicLibrary(payload) {
  const libraryTracks = Array.isArray(payload && payload.tracks) ? payload.tracks : [];
  const isDegradedLibrary = Boolean(payload && payload.degraded);
  const normalizeMusicTrack = (track) => {
    const id = String(track && track.id || '').trim();
    const title = String(track && track.title || '').trim();

    if (!id || !title) {
      return null;
    }

    return {
      id,
      title,
      kind: track.kind === 'audio' ? 'audio' : 'ambient',
      group: String(track.group || ''),
      source: String(track.source || 'Nookipedia music'),
      attribution: String(track.attribution || ''),
      audioUrl: typeof track.audioUrl === 'string' ? track.audioUrl : null,
      artworkUrl: typeof track.artworkUrl === 'string' && track.artworkUrl
        ? track.artworkUrl
        : DEFAULT_MUSIC_ARTWORK_PATH,
      referenceUrl: typeof track.referenceUrl === 'string' ? track.referenceUrl : ''
    };
  };
  const normalizedTrackMap = new Map();

  DEFAULT_MUSIC_LIBRARY.tracks
    .map(normalizeMusicTrack)
    .filter(Boolean)
    .forEach((track) => {
      normalizedTrackMap.set(track.id, track);
    });

  libraryTracks
    .map(normalizeMusicTrack)
    .filter(Boolean)
    .forEach((track) => {
      const existingTrack = normalizedTrackMap.get(track.id);
      normalizedTrackMap.set(track.id, mergeMusicTrack(existingTrack, track, isDegradedLibrary));
    });

  const normalizedTracks = Array.from(normalizedTrackMap.values());

  if (!normalizedTracks.length) {
    return;
  }

  state.music.library = normalizedTracks;

  const nextDefaultNightTrackId = typeof payload.defaultNightTrackId === 'string' &&
    normalizedTracks.some((track) => track.id === payload.defaultNightTrackId)
    ? payload.defaultNightTrackId
    : (normalizedTracks.some((track) => track.id === DEFAULT_MUSIC_LIBRARY.defaultNightTrackId)
      ? DEFAULT_MUSIC_LIBRARY.defaultNightTrackId
      : normalizedTracks[0].id);

  const nextDefaultSunriseTrackId = typeof payload.defaultSunriseTrackId === 'string' &&
    normalizedTracks.some((track) => track.id === payload.defaultSunriseTrackId)
    ? payload.defaultSunriseTrackId
    : (normalizedTracks.some((track) => track.id === DEFAULT_MUSIC_LIBRARY.defaultSunriseTrackId)
      ? DEFAULT_MUSIC_LIBRARY.defaultSunriseTrackId
      : nextDefaultNightTrackId);

  state.music.defaultNightTrackId = nextDefaultNightTrackId;
  state.music.defaultSunriseTrackId = nextDefaultSunriseTrackId;

  if (state.music.selectedTrackId === nextDefaultNightTrackId || state.music.selectedTrackId === nextDefaultSunriseTrackId) {
    state.music.manualTrackChoice = false;
  }

  if (!state.music.manualTrackChoice) {
    state.music.selectedTrackId = state.theme === THEME_NIGHT
      ? nextDefaultNightTrackId
      : nextDefaultSunriseTrackId;
  }

  if (!normalizedTracks.some((track) => track.id === state.music.selectedTrackId)) {
    state.music.selectedTrackId = state.theme === THEME_NIGHT
      ? nextDefaultNightTrackId
      : nextDefaultSunriseTrackId;
  }
}

function mergeMusicTrack(existingTrack, nextTrack, preferExistingMetadata) {
  if (!existingTrack) {
    return nextTrack;
  }

  const keepExistingSource = preferExistingMetadata &&
    isFallbackMusicSource(nextTrack.source) &&
    !isFallbackMusicSource(existingTrack.source);
  const keepExistingAttribution = preferExistingMetadata &&
    isFallbackMusicAttribution(nextTrack.attribution) &&
    !isFallbackMusicAttribution(existingTrack.attribution);
  const shouldKeepExistingArtwork = isPlaceholderMusicArtwork(nextTrack.artworkUrl) &&
    !isPlaceholderMusicArtwork(existingTrack.artworkUrl);
  const shouldKeepExistingReference = preferExistingMetadata &&
    !nextTrack.audioUrl &&
    shouldKeepExistingArtwork &&
    existingTrack.referenceUrl;

  return {
    ...existingTrack,
    ...nextTrack,
    group: nextTrack.group || existingTrack.group,
    source: keepExistingSource ? existingTrack.source : (nextTrack.source || existingTrack.source),
    attribution: keepExistingAttribution ? existingTrack.attribution : (nextTrack.attribution || existingTrack.attribution),
    audioUrl: nextTrack.audioUrl || existingTrack.audioUrl || null,
    artworkUrl: shouldKeepExistingArtwork ? existingTrack.artworkUrl : (nextTrack.artworkUrl || existingTrack.artworkUrl || DEFAULT_MUSIC_ARTWORK_PATH),
    referenceUrl: shouldKeepExistingReference ? existingTrack.referenceUrl : (nextTrack.referenceUrl || existingTrack.referenceUrl || '')
  };
}

function isPlaceholderMusicArtwork(url) {
  return String(url || '').trim() === DEFAULT_MUSIC_ARTWORK_PATH;
}

function isFallbackMusicSource(value) {
  return /^local fallback$/i.test(String(value || '').trim());
}

function isFallbackMusicAttribution(value) {
  return /^fallback music library$/i.test(String(value || '').trim());
}

function renderMusic() {
  const track = getSelectedMusicTrack();
  if (!track) return;

  renderMusicRibbonPosition();

  if (el.musicRibbon) {
    el.musicRibbon.classList.toggle('is-open', state.music.drawerOpen);
  }

  if (el.musicRibbonDrawer) {
    el.musicRibbonDrawer.setAttribute('aria-hidden', state.music.drawerOpen ? 'false' : 'true');
  }

  if (el.musicRibbonToggle) {
    el.musicRibbonToggle.setAttribute('aria-expanded', state.music.drawerOpen ? 'true' : 'false');
    el.musicRibbonToggle.setAttribute('aria-label', state.music.drawerOpen ? 'Close music browser' : 'Open music browser');
    el.musicRibbonToggle.title = state.music.drawerOpen ? 'Close music' : 'Open music';
  }

  renderMusicLibraryOptions(track.id);

  if (el.musicArtwork) {
    el.musicArtwork.src = getMusicPreviewArtworkUrl(track);
    el.musicArtwork.alt = `${track.title} artwork`;
  }

  if (el.musicSourceBadge) {
    el.musicSourceBadge.textContent = getMusicSourceBadgeText(track);
  }

  if (el.musicTrackTitle) {
    el.musicTrackTitle.textContent = track.title;
  }

  if (el.musicTrackMeta) {
    el.musicTrackMeta.textContent = getMusicMetaText(track);
  }

  if (el.musicPlayButton) {
    el.musicPlayButton.setAttribute('aria-label', state.music.isPlaying ? 'Pause music' : 'Play music');
  }

  if (el.musicLoopButton) {
    el.musicLoopButton.setAttribute('aria-pressed', state.music.loopEnabled ? 'true' : 'false');
    el.musicLoopButton.title = state.music.loopEnabled ? 'Loop on' : 'Loop off';
    el.musicLoopButton.classList.toggle('is-active', state.music.loopEnabled);
  }

  if (el.musicPlayIcon) {
    el.musicPlayIcon.src = state.music.isPlaying ? PAUSE_ICON_PATH : PLAY_ICON_PATH;
  }

  const trackCount = getMusicTracks().length;
  el.musicPrevButton.disabled = trackCount < 2;
  el.musicNextButton.disabled = trackCount < 2;

  if (el.musicVolume) {
    el.musicVolume.value = String(Math.round(state.music.volume * 100));
  }

  if (el.musicProgress) {
    el.musicProgress.classList.toggle('is-ambient', track.kind !== 'audio');
  }

  syncMusicVolume();
  if (el.musicAudio) {
    el.musicAudio.loop = state.music.loopEnabled;
  }
  renderMusicProgress();
}

function renderMusicLibraryOptions(selectedTrackId) {
  if (!el.musicLibrarySelect) return;

  const tracks = getMusicTracks();
  window.ACNHReactUI.renderMusicLibraryOptions(el.musicLibrarySelect, { tracks });

  if (tracks.some((track) => track.id === selectedTrackId)) {
    el.musicLibrarySelect.value = selectedTrackId;
  }
}

function getMusicTracks() {
  return Array.isArray(state.music.library) && state.music.library.length
    ? state.music.library
    : DEFAULT_MUSIC_LIBRARY.tracks.slice();
}

function getSelectedMusicTrack() {
  const tracks = getMusicTracks();
  return tracks.find((track) => track.id === state.music.selectedTrackId) || tracks[0] || null;
}

function getDefaultNightTrackId() {
  const tracks = getMusicTracks();
  if (tracks.some((track) => track.id === state.music.defaultNightTrackId)) {
    return state.music.defaultNightTrackId;
  }

  return tracks[0] ? tracks[0].id : DEFAULT_MUSIC_LIBRARY.defaultNightTrackId;
}

function getDefaultSunriseTrackId() {
  const tracks = getMusicTracks();
  if (tracks.some((track) => track.id === state.music.defaultSunriseTrackId)) {
    return state.music.defaultSunriseTrackId;
  }

  return tracks[0] ? tracks[0].id : DEFAULT_MUSIC_LIBRARY.defaultSunriseTrackId;
}

function getMusicSourceBadgeText(track) {
  if (track.id === getDefaultNightTrackId()) {
    return 'Night ambience';
  }

  if (track.id === getDefaultSunriseTrackId()) {
    return 'Sunrise theme';
  }

  return 'K.K. Slider';
}

function getMusicPreviewArtworkUrl(track) {
  if (state.music.drawerOpen && track && track.artworkUrl) {
    return track.artworkUrl;
  }

  return DEFAULT_MUSIC_ARTWORK_PATH;
}

function getMusicMetaText(track) {
  if (state.music.errorMessage) {
    return state.music.errorMessage;
  }

  if (state.music.pendingAutoplay) {
    return 'Waiting for your next tap to start';
  }

  if (track.kind !== 'audio') {
    return state.music.manualTrackChoice
      ? 'Ambient loop'
      : 'Night default ambient loop';
  }

  if (el.musicAudio && Number.isFinite(el.musicAudio.duration) && el.musicAudio.duration > 0) {
    return `${formatMusicTime(el.musicAudio.currentTime)} / ${formatMusicTime(el.musicAudio.duration)} · ${track.source}`;
  }

  return `${track.source} · ${track.attribution || 'Nookipedia'}`;
}

function renderMusicProgress() {
  if (!el.musicProgressBar || !el.musicProgress) return;

  const track = getSelectedMusicTrack();
  if (!track || track.kind !== 'audio' || !el.musicAudio || !Number.isFinite(el.musicAudio.duration) || el.musicAudio.duration <= 0) {
    el.musicProgress.classList.add('is-ambient');
    el.musicProgressBar.style.width = '100%';
    return;
  }

  const progress = Math.max(0, Math.min(el.musicAudio.currentTime / el.musicAudio.duration, 1));
  el.musicProgress.classList.remove('is-ambient');
  el.musicProgressBar.style.width = `${(progress * 100).toFixed(2)}%`;
}

function toggleMusicDrawer() {
  state.music.drawerOpen = !state.music.drawerOpen;
  renderMusic();
  persistLocalState();
}

function handleMusicRibbonToggleClick(event) {
  if (musicRibbonDrag.suppressClick) {
    event.preventDefault();
    event.stopPropagation();
    musicRibbonDrag.suppressClick = false;
    return;
  }

  toggleMusicDrawer();
}

function handleMusicRibbonDragStart(event) {
  if (!el.musicRibbon || !el.musicRibbonToggle) return;
  if (event.button !== 0) return;

  musicRibbonDrag.pointerId = event.pointerId;
  musicRibbonDrag.active = true;
  musicRibbonDrag.moved = false;
  musicRibbonDrag.suppressClick = false;
  musicRibbonDrag.startY = event.clientY;
  musicRibbonDrag.startTopVh = normalizeMusicRibbonTopVh(state.music.ribbonTopVh);

  if (typeof el.musicRibbonToggle.setPointerCapture === 'function') {
    el.musicRibbonToggle.setPointerCapture(event.pointerId);
  }
}

function handleMusicRibbonDragMove(event) {
  if (!musicRibbonDrag.active || musicRibbonDrag.pointerId !== event.pointerId) return;

  const deltaY = event.clientY - musicRibbonDrag.startY;
  if (!musicRibbonDrag.moved && Math.abs(deltaY) < 6) {
    return;
  }

  if (!musicRibbonDrag.moved) {
    musicRibbonDrag.moved = true;
    musicRibbonDrag.suppressClick = true;

    if (el.musicRibbon) {
      el.musicRibbon.classList.add('is-dragging');
    }
  }

  const viewportHeight = Math.max(window.innerHeight || 0, 1);
  state.music.ribbonTopVh = normalizeMusicRibbonTopVh(
    musicRibbonDrag.startTopVh + ((deltaY / viewportHeight) * 100)
  );
  renderMusicRibbonPosition();
  event.preventDefault();
}

function handleMusicRibbonDragEnd(event) {
  if (!musicRibbonDrag.active || musicRibbonDrag.pointerId !== event.pointerId) return;

  if (el.musicRibbon) {
    el.musicRibbon.classList.remove('is-dragging');
  }

  if (el.musicRibbonToggle && typeof el.musicRibbonToggle.releasePointerCapture === 'function') {
    try {
      el.musicRibbonToggle.releasePointerCapture(event.pointerId);
    } catch (error) {}
  }

  const shouldPersist = musicRibbonDrag.moved;

  musicRibbonDrag.pointerId = null;
  musicRibbonDrag.active = false;
  musicRibbonDrag.moved = false;
  musicRibbonDrag.startY = 0;
  musicRibbonDrag.startTopVh = normalizeMusicRibbonTopVh(state.music.ribbonTopVh);

  if (shouldPersist) {
    persistLocalState();
  }
}

function renderMusicRibbonPosition() {
  if (!el.musicRibbon) return;

  const normalizedTopVh = normalizeMusicRibbonTopVh(state.music.ribbonTopVh);
  state.music.ribbonTopVh = normalizedTopVh;
  el.musicRibbon.style.top = `${normalizedTopVh.toFixed(2)}vh`;
}

function normalizeMusicRibbonTopVh(value) {
  const numericValue = Number(value);
  const fallbackVh = DEFAULT_MUSIC_RIBBON_TOP_VH;

  if (!Number.isFinite(numericValue)) {
    return fallbackVh;
  }

  const viewportHeight = Math.max(window.innerHeight || 0, 1);
  const ribbonHeight = el.musicRibbon ? (el.musicRibbon.offsetHeight || 96) : 96;
  const minTopPx = 18 + (ribbonHeight / 2);
  const maxTopPx = Math.max(minTopPx, viewportHeight - 18 - (ribbonHeight / 2));
  const minTopVh = (minTopPx / viewportHeight) * 100;
  const maxTopVh = (maxTopPx / viewportHeight) * 100;

  return Math.min(Math.max(numericValue, minTopVh), maxTopVh);
}

function selectMusicTrack(trackId, options = {}) {
  const nextTrack = getMusicTracks().find((track) => track.id === trackId);
  if (!nextTrack) {
    return;
  }

  const previousTrack = getSelectedMusicTrack();
  const trackChanged = !previousTrack || previousTrack.id !== nextTrack.id;

  state.music.selectedTrackId = nextTrack.id;
  state.music.errorMessage = '';

  if (options.manual) {
    state.music.manualTrackChoice = true;
  }

  if (!options.manual && (nextTrack.id === getDefaultNightTrackId() || nextTrack.id === getDefaultSunriseTrackId())) {
    state.music.manualTrackChoice = false;
  }

  if (trackChanged && (state.music.isPlaying || state.music.wantsPlayback || options.autoplay)) {
    startSelectedMusic({ userGesture: options.userGesture === true });
  } else {
    renderMusic();
  }

  persistLocalState();
}

function shiftMusicTrack(delta, manualSelection) {
  const tracks = getMusicTracks();
  if (!tracks.length) return;

  const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === state.music.selectedTrackId));
  const nextIndex = (currentIndex + delta + tracks.length) % tracks.length;

  selectMusicTrack(tracks[nextIndex].id, {
    manual: manualSelection,
    autoplay: state.music.wantsPlayback || manualSelection,
    userGesture: manualSelection
  });
}

function toggleMusicPlayback(userGesture = false) {
  if (state.music.isPlaying) {
    pauseSelectedMusic({ clearIntent: true });
    return;
  }

  startSelectedMusic({ userGesture });
}

function startSelectedMusic(options = {}) {
  const track = getSelectedMusicTrack();
  if (!track) return;

  state.music.wantsPlayback = true;
  state.music.errorMessage = '';

  if (!state.music.hasInteracted && !options.userGesture) {
    state.music.pendingAutoplay = true;
    state.music.isPlaying = false;
    renderMusic();
    persistLocalState();
    return;
  }

  state.music.pendingAutoplay = false;

  if (track.kind === 'audio' && track.audioUrl) {
    stopAmbientRain();
    playAudioTrack(track);
    return;
  }

  stopAudioTrack(false);
  playAmbientRain();
}

function playAudioTrack(track) {
  if (!el.musicAudio || !track.audioUrl) {
    state.music.isPlaying = false;
    state.music.errorMessage = 'No playable source was available for this track.';
    renderMusic();
    return;
  }

  const shouldSwapSource = el.musicAudio.dataset.trackId !== track.id || el.musicAudio.src !== track.audioUrl;
  if (shouldSwapSource) {
    el.musicAudio.pause();
    el.musicAudio.src = track.audioUrl;
    el.musicAudio.dataset.trackId = track.id;
    el.musicAudio.load();
  }

  el.musicAudio.loop = state.music.loopEnabled;
  syncMusicVolume();

  const playPromise = el.musicAudio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise
      .then(() => {
        state.music.isPlaying = true;
        state.music.errorMessage = '';
        renderMusic();
        persistLocalState();
      })
      .catch(() => {
        state.music.isPlaying = false;
        state.music.pendingAutoplay = true;
        state.music.errorMessage = 'Tap play to start the selected track.';
        renderMusic();
      });
    return;
  }

  state.music.isPlaying = true;
  renderMusic();
  persistLocalState();
}

function stopAudioTrack(shouldClearSource = false) {
  if (!el.musicAudio) return;

  el.musicAudio.pause();

  if (shouldClearSource) {
    el.musicAudio.removeAttribute('src');
    delete el.musicAudio.dataset.trackId;
    el.musicAudio.load();
  }
}

function pauseSelectedMusic(options = {}) {
  const shouldClearIntent = options.clearIntent !== false;

  stopAudioTrack(false);
  stopAmbientRain();

  state.music.isPlaying = false;
  state.music.pendingAutoplay = false;

  if (shouldClearIntent) {
    state.music.wantsPlayback = false;
  }

  renderMusic();

  if (!options.silent) {
    persistLocalState();
  }
}

function registerMusicInteraction() {
  if (!state.music.hasInteracted) {
    state.music.hasInteracted = true;
  }

  if (ambientPlayer.context && ambientPlayer.context.state === 'suspended') {
    ambientPlayer.context.resume().catch(() => {});
  }

  if (state.music.pendingAutoplay && state.music.wantsPlayback && !state.music.isPlaying) {
    startSelectedMusic({ userGesture: true });
  }
}

function syncThemeMusicPreference() {
  const defaultTrackId = state.theme === THEME_NIGHT
    ? getDefaultNightTrackId()
    : getDefaultSunriseTrackId();

  if (!state.music.manualTrackChoice) {
    state.music.selectedTrackId = defaultTrackId;
    state.music.pendingAutoplay = !state.music.hasInteracted;
    startSelectedMusic({ userGesture: false });
    return;
  }

  if (state.music.wantsPlayback && !state.music.isPlaying) {
    startSelectedMusic({ userGesture: false });
    return;
  }

  renderMusic();
}

function syncMusicVolume() {
  if (el.musicAudio) {
    el.musicAudio.volume = state.music.volume;
  }

  if (ambientPlayer.context && ambientPlayer.masterGain) {
    const currentTime = ambientPlayer.context.currentTime;
    const targetGain = ambientPlayer.active ? getAmbientMasterGain() : 0;
    ambientPlayer.masterGain.gain.cancelScheduledValues(currentTime);
    ambientPlayer.masterGain.gain.setTargetAtTime(targetGain, currentTime, 0.18);
  }
}

function getAmbientMasterGain() {
  return Math.max(0.02, state.music.volume * 0.16);
}

async function playAmbientRain() {
  const audioContext = await ensureAmbientContext();
  if (!audioContext) {
    state.music.isPlaying = false;
    state.music.pendingAutoplay = true;
    renderMusic();
    return;
  }

  stopAmbientRain();

  ambientPlayer.masterGain.gain.setValueAtTime(0, audioContext.currentTime);
  ambientPlayer.masterGain.gain.linearRampToValueAtTime(getAmbientMasterGain(), audioContext.currentTime + 0.4);

  ambientPlayer.nodes = [
    createAmbientNoiseLayer(audioContext, { type: 'lowpass', frequency: 1800, q: 0.5, gain: 0.75, lfoRate: 0.04, lfoDepth: 0.08 }),
    createAmbientNoiseLayer(audioContext, { type: 'bandpass', frequency: 5600, q: 0.45, gain: 0.22, lfoRate: 0.06, lfoDepth: 0.04 }),
    createAmbientNoiseLayer(audioContext, { type: 'highpass', frequency: 940, q: 0.2, gain: 0.12, lfoRate: 0.03, lfoDepth: 0.03 }),
    createAmbientPadLayer(audioContext, { frequency: 220, gain: 0.04, filterFrequency: 820, lfoRate: 0.021, lfoDepth: 0.012 }),
    createAmbientPadLayer(audioContext, { frequency: 329.63, gain: 0.024, filterFrequency: 620, lfoRate: 0.028, lfoDepth: 0.01 })
  ];

  ambientPlayer.nodes.forEach((node) => node.start());
  ambientPlayer.active = true;
  state.music.isPlaying = true;
  state.music.errorMessage = '';
  renderMusic();
  persistLocalState();
}

function stopAmbientRain() {
  ambientPlayer.nodes.forEach((node) => {
    try {
      node.stop();
    } catch (error) {
      // Ignore stale Web Audio nodes during track switches.
    }
  });

  ambientPlayer.nodes = [];
  ambientPlayer.active = false;

  if (ambientPlayer.context && ambientPlayer.masterGain) {
    ambientPlayer.masterGain.gain.cancelScheduledValues(ambientPlayer.context.currentTime);
    ambientPlayer.masterGain.gain.setTargetAtTime(0, ambientPlayer.context.currentTime, 0.14);
  }
}

async function ensureAmbientContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!ambientPlayer.context) {
    ambientPlayer.context = new AudioContextCtor();
    ambientPlayer.masterGain = ambientPlayer.context.createGain();
    ambientPlayer.masterGain.gain.value = 0;
    ambientPlayer.masterGain.connect(ambientPlayer.context.destination);
  }

  try {
    await ambientPlayer.context.resume();
  } catch (error) {
    return null;
  }

  return ambientPlayer.context;
}

function createAmbientNoiseLayer(audioContext, options) {
  const source = audioContext.createBufferSource();
  source.buffer = getAmbientNoiseBuffer(audioContext);
  source.loop = true;

  const filter = audioContext.createBiquadFilter();
  filter.type = options.type;
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q || 0;

  const gain = audioContext.createGain();
  gain.gain.value = options.gain;

  const lfo = audioContext.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = options.lfoRate;

  const lfoGain = audioContext.createGain();
  lfoGain.gain.value = options.lfoDepth;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ambientPlayer.masterGain);
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  return {
    start() {
      source.start();
      lfo.start();
    },
    stop() {
      source.stop();
      lfo.stop();
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
    }
  };
}

function createAmbientPadLayer(audioContext, options) {
  const oscillator = audioContext.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.value = options.frequency;

  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = options.filterFrequency;

  const gain = audioContext.createGain();
  gain.gain.value = options.gain;

  const lfo = audioContext.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = options.lfoRate;

  const lfoGain = audioContext.createGain();
  lfoGain.gain.value = options.lfoDepth;

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(ambientPlayer.masterGain);
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  return {
    start() {
      oscillator.start();
      lfo.start();
    },
    stop() {
      oscillator.stop();
      lfo.stop();
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
    }
  };
}

function getAmbientNoiseBuffer(audioContext) {
  if (ambientPlayer.noiseBuffer) {
    return ambientPlayer.noiseBuffer;
  }

  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }

  ambientPlayer.noiseBuffer = buffer;
  return ambientPlayer.noiseBuffer;
}

function formatMusicTime(value) {
  const totalSeconds = Math.max(0, Math.floor(value || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
