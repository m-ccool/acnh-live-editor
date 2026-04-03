'use strict';

const TOTAL_SLOTS = 40;
const STORAGE_KEY = 'acnh-live-editor-state-v5';
const REPO_URL = 'https://github.com/m-ccool/acnh-live-editor';
const SERVICE_WORKER_VERSION = '47';
const PLAY_ICON_PATH = '/assets/icons/line-md--pause-to-play-filled-transition.svg';
const PAUSE_ICON_PATH = '/assets/icons/line-md--pause.svg';
const CONSOLE_CONNECTED_ICON_PATH = '/assets/icons/codicon--debug-connect.svg';
const CONSOLE_DISCONNECTED_ICON_PATH = '/assets/icons/codicon--debug-disconnect.svg';
const DEFAULT_MUSIC_ARTWORK_PATH = '/assets/icons/Aircheck_NH_Inv_Icon.png';
const THEME_SUNRISE = 'sunrise';
const THEME_NIGHT = 'night';
const DEFAULT_MUSIC_RIBBON_TOP_VH = 56;
const DEFAULT_LOG_PANEL_HEIGHT_VH = 13;
const DEFAULT_MUSIC_LIBRARY = Object.freeze({
  defaultNightTrackId: 'ambient-4am-rainy',
  defaultSunriseTrackId: 'sunrise-animal-crossing-theme',
  tracks: [
    {
      id: 'ambient-4am-rainy',
      title: '4 AM Rainy Weather',
      kind: 'ambient',
      group: 'Theme defaults',
      source: 'Night ambient preset',
      attribution: 'Nintendo Music artwork via Nookipedia',
      audioUrl: null,
      artworkUrl: DEFAULT_MUSIC_ARTWORK_PATH,
      referenceUrl: 'https://nookipedia.com/wiki/K.K._Slider_songs'
    },
    {
      id: 'sunrise-animal-crossing-theme',
      title: 'Animal Crossing Theme',
      kind: 'audio',
      group: 'Theme defaults',
      source: 'Sunrise default theme',
      attribution: 'Animal Crossing: Your Favourite Songs - Original Soundtrack',
      audioUrl: 'https://static.wikia.nocookie.net/animalcrossing/images/3/36/ACCF_Main_Theme.ogg/revision/latest?cb=20150816212904',
      artworkUrl: DEFAULT_MUSIC_ARTWORK_PATH,
      referenceUrl: 'https://nookipedia.com/wiki/Animal_Crossing:_Your_Favourite_Songs_-_Original_Soundtrack'
    }
  ]
});
const DEFAULT_MUSIC_STATE = Object.freeze({
  drawerOpen: true,
  selectedTrackId: DEFAULT_MUSIC_LIBRARY.defaultSunriseTrackId,
  defaultNightTrackId: DEFAULT_MUSIC_LIBRARY.defaultNightTrackId,
  defaultSunriseTrackId: DEFAULT_MUSIC_LIBRARY.defaultSunriseTrackId,
  library: DEFAULT_MUSIC_LIBRARY.tracks.slice(),
  ribbonTopVh: DEFAULT_MUSIC_RIBBON_TOP_VH,
  volume: 0.58,
  loopEnabled: false,
  wantsPlayback: false,
  isPlaying: false,
  manualTrackChoice: false,
  pendingAutoplay: false,
  hasInteracted: false,
  errorMessage: ''
});
const DEFAULT_QUICK_CHEATS = Object.freeze({
  halfSpeed: false,
  doubleSpeed: false,
  wallWalk: false
});
const QUICK_CHEAT_LABELS = Object.freeze({
  halfSpeed: '0.5x island clock',
  doubleSpeed: '2x island clock',
  wallWalk: 'wall walk'
});
let shootingStarTimeoutId = 0;
const dragScroll = {
  pointerId: null,
  active: false,
  moved: false,
  lastX: 0,
  lastY: 0
};
const inventoryTouchTap = {
  index: -1,
  at: 0
};
const shortcutFilterTap = {
  filter: '',
  at: 0,
  armedForClear: false
};
const ambientPlayer = {
  context: null,
  masterGain: null,
  noiseBuffer: null,
  nodes: [],
  active: false
};
const musicRibbonDrag = {
  pointerId: null,
  active: false,
  moved: false,
  suppressClick: false,
  startY: 0,
  startTopVh: DEFAULT_MUSIC_RIBBON_TOP_VH
};
const logPanelDrag = {
  pointerId: null,
  active: false,
  startY: 0,
  startHeightVh: DEFAULT_LOG_PANEL_HEIGHT_VH
};

const DEFAULT_PLAYER = {
  name: 'Barbara',
  town: 'Okemos',
  wallet: 1246,
  bank: 999912003,
  miles: 9999999,
  avatar: '/assets/items/Bob_NH.png'
};

const DEFAULT_BRIDGE_STATE = {
  connected: false,
  ip: '00.00.00.00',
  mode: 'offline',
  message: 'Bridge listener offline.',
  lastAction: 'Waiting for bridge activity',
  host: '0.0.0.0',
  port: 32840,
  listening: false,
  deviceName: null,
  protocolVersion: null,
  capabilities: [],
  pendingRequests: 0,
  lastCommand: null,
  lastResponse: null,
  remoteStatus: null,
  lastError: null
};
const DEFAULT_CATALOG_STATE = Object.freeze({
  connectionState: 'fallback',
  label: 'Local',
  message: 'Using local starter catalog.',
  searchableCount: 0,
  localCount: 0,
  cachedCount: 0,
  liveConnected: false,
  hasActiveRefresh: false
});
const MODAL_SEARCH_LIMIT = 12;
const MODAL_SEARCH_DEBOUNCE_MS = 180;
const REMOTE_SEARCH_MIN_QUERY_LENGTH = 2;
const LOOKUP_ITEM_LIMIT = 120;
let modalSearchDebounceId = 0;
let modalSearchToken = 0;

const DEFAULT_FILLED_SLOTS = [
  { slot: 1, itemName: 'Golden Axe', count: 1, uses: 27, flag0: 0, flag1: 0 },
  { slot: 2, itemName: 'Iron Nugget', count: 30, uses: 0, flag0: 0, flag1: 0 },
  { slot: 3, itemName: 'Gold Nugget', count: 12, uses: 0, flag0: 0, flag1: 0 },
  { slot: 4, itemName: "Mom's Hand-Knit Sweater (Quilted Pattern)", count: 1, uses: 0, flag0: 0, flag1: 0 },
  { slot: 5, itemName: 'Hardwood', count: 30, uses: 0, flag0: 0, flag1: 0 },
  { slot: 6, itemName: 'Moon Jellyfish', count: 1, uses: 0, flag0: 0, flag1: 0 },
  { slot: 7, itemName: 'Sea Pig', count: 1, uses: 0, flag0: 0, flag1: 0 },
  { slot: 8, itemName: 'Sea Cucumber', count: 1, uses: 0, flag0: 0, flag1: 0 },
  { slot: 9, itemName: 'Vine Ladder Set-Up Kit (Light Brown)', count: 1, uses: 0, flag0: 0, flag1: 0 },
  { slot: 10, itemName: 'Ocarina', count: 1, uses: 0, flag0: 0, flag1: 0 },
  { slot: 34, itemName: 'Gold Nugget', count: 1, uses: 0, flag0: 0, flag1: 0 }
];

const state = {
  player: { ...DEFAULT_PLAYER },
  bridge: { ...DEFAULT_BRIDGE_STATE },
  catalog: {
    ...DEFAULT_CATALOG_STATE,
    modalResults: [],
    modalLoading: false,
    lookupItems: [],
    diagnostics: null,
    diagnosticsLoading: false
  },
  items: [],
  inventory: [],
  copiedSlotPayload: null,
  overwriteGuard: null,
  selectedSlotIndex: 5,
  modalSearchQuery: '',
  modalSearchFilter: 'all',
  modalSearchOpen: false,
  modalPendingItem: null,
  activeTab: 'village',
  activeFilter: 'all',
  theme: THEME_SUNRISE,
  playerModalSection: 'player',
  playerFlagsTab: 'recipes',
  logPanelHeightVh: DEFAULT_LOG_PANEL_HEIGHT_VH,
  quickCheats: { ...DEFAULT_QUICK_CHEATS },
  music: {
    ...DEFAULT_MUSIC_STATE,
    library: DEFAULT_MUSIC_LIBRARY.tracks.slice()
  }
};

const el = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheDom();
  bindEvents();
  updateClock();

  await loadData();
  seedInventory();
  restoreLocalState();
  applyTheme(false);
  renderAll();
  finishBoot();
}

function cacheDom() {
  el.loadingScreen = document.getElementById('loading-screen');
  el.appRoot = document.getElementById('app-root');
  el.dateDisplay = document.getElementById('date-display');
  el.timeDisplay = document.getElementById('time-display');

  el.catalogStatus = document.getElementById('catalog-status');
  el.catalogStatusLabel = document.getElementById('catalog-status-label');
  el.bridgeStatusInline = document.getElementById('bridge-status-inline');
  el.bridgeStatus = document.getElementById('bridge-status');
  el.logPanelResizeHandle = document.getElementById('log-panel-resize-handle');
  el.ipDisplay = document.getElementById('ip-display');
  el.logConnectionIndicator = document.getElementById('log-connection-indicator');
  el.logConnectionIcon = document.getElementById('log-connection-icon');
  el.themeToggle = document.getElementById('theme-toggle');
  el.themeToggleIcon = document.getElementById('theme-toggle-icon');
  el.themeToggleLabel = document.getElementById('theme-toggle-label');
  el.themeToggleHint = document.getElementById('theme-toggle-hint');
  el.bridgeToggle = document.getElementById('bridge-toggle');
  el.logRefreshButton = document.getElementById('log-refresh-button');
  el.debugReloadButton = document.getElementById('debug-reload-button');
  el.musicRibbon = document.getElementById('music-ribbon');
  el.musicRibbonDrawer = document.getElementById('music-ribbon-drawer');
  el.musicRibbonToggle = document.getElementById('music-ribbon-toggle');
  el.musicAudio = document.getElementById('music-audio');
  el.musicArtwork = document.getElementById('music-artwork');
  el.musicSourceBadge = document.getElementById('music-source-badge');
  el.musicTrackTitle = document.getElementById('music-track-title');
  el.musicTrackMeta = document.getElementById('music-track-meta');
  el.musicProgress = document.getElementById('music-progress');
  el.musicProgressBar = document.getElementById('music-progress-bar');
  el.musicLoopButton = document.getElementById('music-loop-button');
  el.musicPrevButton = document.getElementById('music-prev-button');
  el.musicPlayButton = document.getElementById('music-play-button');
  el.musicPlayIcon = document.getElementById('music-play-icon');
  el.musicNextButton = document.getElementById('music-next-button');
  el.musicLibrarySelect = document.getElementById('music-library-select');
  el.musicVolume = document.getElementById('music-volume');

  el.playerName = document.getElementById('player-name');
  el.townName = document.getElementById('town-name');
  el.walletValue = document.getElementById('wallet-value');
  el.bankValue = document.getElementById('bank-value');
  el.milesValue = document.getElementById('miles-value');
  el.playerAvatar = document.getElementById('player-avatar');

  el.selectedItemArtbox = document.getElementById('selected-item-artbox');
  el.selectedPreviewImage = document.getElementById('selected-preview-image');
  el.selectedItemName = document.getElementById('selected-item-name');
  el.openSelectedSearchButton = document.getElementById('open-selected-search-button');
  el.copySelectedButton = document.getElementById('copy-selected-button');
  el.copySelectedIcon = document.getElementById('copy-selected-icon');
  el.pasteSelectedButton = document.getElementById('paste-selected-button');

  el.inventoryCard = document.getElementById('inventory-card');
  el.inventoryGrid = document.getElementById('inventory-grid');
  el.shortcutColumn = document.getElementById('shortcut-column');
  el.quickCheatControls = document.getElementById('quick-cheat-controls');

  el.settingsButton = document.getElementById('settings-button');
  el.settingsModal = document.getElementById('settings-modal');
  el.settingsClose = document.getElementById('settings-close');
  el.settingsDebugOutput = document.getElementById('settings-debug-output');
  el.settingsCatalogOutput = document.getElementById('settings-catalog-output');
  el.settingsDebugRefresh = document.getElementById('settings-debug-refresh');
  el.settingsGithubButton = document.getElementById('settings-github-button');

  el.playerModal = document.getElementById('player-modal');
  el.playerModalTitle = document.getElementById('player-modal-title');
  el.playerAvatarButton = document.getElementById('player-avatar-button');
  el.playerModalBust = document.getElementById('player-modal-bust');
  el.playerModalBustName = document.getElementById('player-modal-bust-name');
  el.playerModalBustTown = document.getElementById('player-modal-bust-town');
  el.playerModalSectionButtons = Array.from(document.querySelectorAll('[data-player-section]'));
  el.playerModalViews = {
    player: document.getElementById('player-modal-view-player'),
    storage: document.getElementById('player-modal-view-storage'),
    flags: document.getElementById('player-modal-view-flags')
  };
  el.playerModalFooter = document.getElementById('player-modal-footer');
  el.playerFlagsTabButtons = Array.from(document.querySelectorAll('[data-player-flags-tab]'));
  el.playerFlagsPanels = Array.from(document.querySelectorAll('.player-flags-panel'));
  el.playerInputName = document.getElementById('player-input-name');
  el.playerInputTown = document.getElementById('player-input-town');
  el.playerInputWallet = document.getElementById('player-input-wallet');
  el.playerInputBank = document.getElementById('player-input-bank');
  el.playerInputMiles = document.getElementById('player-input-miles');
  el.playerModalSave = document.getElementById('player-modal-save');

  el.itemModal = document.getElementById('item-modal');
  el.modalPocketTitle = document.getElementById('modal-pocket-title');
  el.modalItemPreview = document.getElementById('modal-item-preview');
  el.modalItemName = document.getElementById('modal-item-name');
  el.modalInputCount = document.getElementById('modal-input-count');
  el.modalInputUses = document.getElementById('modal-input-uses');
  el.modalInputFlag0 = document.getElementById('modal-input-flag0');
  el.modalInputFlag1 = document.getElementById('modal-input-flag1');
  el.modalHex = document.getElementById('modal-hex');
  el.modalSearchFocusButton = document.getElementById('modal-search-focus-button');
  el.modalSearchInput = document.getElementById('modal-search-input');
  el.modalResultsList = document.getElementById('modal-results-list');
  el.modalSearchStack = document.querySelector('.item-modal-search-stack');
  el.modalFilterButtons = document.getElementById('modal-filter-buttons');
  el.modalSelectedPayload = document.getElementById('modal-selected-payload');
  el.clearItemButton = document.getElementById('clear-item-button');
  el.itemModalApply = document.getElementById('item-modal-apply');

  el.tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  el.tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
  el.tabFilledSlots = document.getElementById('tab-filled-slots');
  el.tabStackTotal = document.getElementById('tab-stack-total');
  el.tabActiveCategory = document.getElementById('tab-active-category');
  el.tabCategoryList = document.getElementById('tab-category-list');
  el.tabSelectionName = document.getElementById('tab-selection-name');
  el.tabSelectionHex = document.getElementById('tab-selection-hex');
  el.tabSelectionSource = document.getElementById('tab-selection-source');
  el.tabPlayerSummaryName = document.getElementById('tab-player-summary-name');
  el.tabPlayerSummaryTown = document.getElementById('tab-player-summary-town');
  el.tabPlayerSummaryWallet = document.getElementById('tab-player-summary-wallet');
  el.tabPlayerSummaryMiles = document.getElementById('tab-player-summary-miles');
  el.tabBridgeState = document.getElementById('tab-bridge-state');
  el.tabBridgeMode = document.getElementById('tab-bridge-mode');
  el.tabStorageState = document.getElementById('tab-storage-state');
  el.tabSessionJson = document.getElementById('tab-session-json');
}

function bindEvents() {
  el.settingsButton.addEventListener('click', () => {
    openModal(el.settingsModal);
    refreshCatalogDiagnostics();
  });
  el.settingsClose.addEventListener('click', () => closeModal(el.settingsModal));
  el.settingsDebugRefresh.addEventListener('click', () => {
    refreshBridgeStatus('Settings panel refreshed');
  });
  el.settingsGithubButton.addEventListener('click', () => {
    window.open(REPO_URL, '_blank', 'noopener');
  });
  if (el.debugReloadButton) {
    el.debugReloadButton.addEventListener('click', reloadAppShell);
  }
  if (el.logPanelResizeHandle) {
    el.logPanelResizeHandle.addEventListener('pointerdown', handleLogPanelResizeStart);
  }
  el.themeToggle.addEventListener('click', toggleTheme);
  el.musicRibbonToggle.addEventListener('click', handleMusicRibbonToggleClick);
  el.musicRibbonToggle.addEventListener('pointerdown', handleMusicRibbonDragStart);
  el.musicRibbonToggle.addEventListener('pointermove', handleMusicRibbonDragMove);
  el.musicRibbonToggle.addEventListener('pointerup', handleMusicRibbonDragEnd);
  el.musicRibbonToggle.addEventListener('pointercancel', handleMusicRibbonDragEnd);
  el.musicLoopButton.addEventListener('click', () => {
    state.music.loopEnabled = !state.music.loopEnabled;
    if (el.musicAudio) {
      el.musicAudio.loop = state.music.loopEnabled;
    }
    renderMusic();
    persistLocalState();
  });
  el.musicPrevButton.addEventListener('click', () => {
    shiftMusicTrack(-1, true);
  });
  el.musicPlayButton.addEventListener('click', () => {
    registerMusicInteraction();
    toggleMusicPlayback(true);
  });
  el.musicNextButton.addEventListener('click', () => {
    shiftMusicTrack(1, true);
  });
  el.musicLibrarySelect.addEventListener('change', (event) => {
    registerMusicInteraction();
    selectMusicTrack(event.target.value, {
      manual: true,
      autoplay: state.music.wantsPlayback
    });
  });
  el.musicVolume.addEventListener('input', (event) => {
    const nextValue = Number(event.target.value || 0) / 100;
    state.music.volume = Math.min(Math.max(nextValue, 0), 1);
    syncMusicVolume();
    persistLocalState();
  });

  if (el.musicAudio) {
    el.musicAudio.addEventListener('play', () => {
      state.music.isPlaying = true;
      state.music.errorMessage = '';
      renderMusic();
    });

    el.musicAudio.addEventListener('pause', () => {
      if (getSelectedMusicTrack() && getSelectedMusicTrack().kind === 'audio') {
        state.music.isPlaying = false;
        renderMusic();
      }
    });

    el.musicAudio.addEventListener('timeupdate', renderMusicProgress);
    el.musicAudio.addEventListener('loadedmetadata', renderMusicProgress);
    el.musicAudio.addEventListener('ended', () => {
      if (state.music.loopEnabled) {
        return;
      }

      if (state.music.wantsPlayback) {
        shiftMusicTrack(1, false);
        return;
      }

      state.music.isPlaying = false;
      renderMusic();
    });
    el.musicAudio.addEventListener('error', () => {
      state.music.isPlaying = false;
      state.music.pendingAutoplay = false;
      state.music.errorMessage = 'This browser could not start the selected aircheck.';
      renderMusic();
    });
  }

  el.playerAvatarButton.addEventListener('click', openEditPlayerModal);
  el.playerModalSectionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setPlayerModalSection(button.dataset.playerSection || 'player');
    });
  });
  el.playerFlagsTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.playerFlagsTab = button.dataset.playerFlagsTab || 'recipes';
      renderPlayerModal();
    });
  });

  el.playerModalSave.addEventListener('click', applyPlayerEdits);
  bindInlinePlayerFieldEvents();

  el.openSelectedSearchButton.addEventListener('click', () => openItemModalForSelectedSlot());
  el.selectedItemArtbox.addEventListener('click', () => openItemModalForSelectedSlot());

  el.copySelectedButton.addEventListener('click', handleSelectedClipboardButton);
  el.pasteSelectedButton.addEventListener('click', pasteCopiedSlotPayload);

  el.modalSearchInput.addEventListener('input', (event) => {
    state.modalSearchQuery = event.target.value || '';
    state.modalSearchOpen = true;
    queueModalSearch();
  });

  el.modalSearchInput.addEventListener('focus', () => {
    state.modalSearchOpen = true;
    queueModalSearch(true);
  });

  if (el.modalSearchStack) {
    el.modalSearchStack.addEventListener('focusin', () => {
      state.modalSearchOpen = true;
      queueModalSearch(true);
    });

    el.modalSearchStack.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget && el.modalSearchStack.contains(nextTarget)) {
        return;
      }

      window.setTimeout(() => {
        const active = document.activeElement;
        if (!active || !el.modalSearchStack.contains(active)) {
          state.modalSearchOpen = false;
          renderItemModalResults();
        }
      }, 0);
    });
  }

  [el.modalInputCount, el.modalInputUses, el.modalInputFlag0, el.modalInputFlag1].forEach((input) => {
    input.addEventListener('input', renderItemModalPayload);
  });

  el.modalSearchFocusButton.addEventListener('click', focusItemSearch);
  el.clearItemButton.addEventListener('click', clearSelectedSlot);
  el.itemModalApply.addEventListener('click', applyItemEdits);

  if (el.inventoryCard) {
    el.inventoryCard.addEventListener('dblclick', (event) => {
      if (event.target.closest('.inventory-slot')) {
        return;
      }

      resetInventoryFilter();
    });
  }

  el.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
      persistLocalState();
    });
  });

  el.bridgeToggle.addEventListener('click', () => {
    refreshBridgeStatus('Bridge status refreshed');
  });

  el.logRefreshButton.addEventListener('click', () => {
    refreshBridgeStatus('Status log refreshed');
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = document.getElementById(button.getAttribute('data-close-modal'));
      closeModal(modal);
    });
  });

  [el.settingsModal, el.playerModal, el.itemModal].forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal(el.settingsModal);
      closeModal(el.playerModal);
      closeModal(el.itemModal);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    registerMusicInteraction();

    if (!el.itemModal || el.itemModal.classList.contains('hidden')) return;
    if (!el.modalSearchStack) return;
    if (el.modalSearchStack.contains(event.target)) return;
    if (el.modalSearchFocusButton && el.modalSearchFocusButton.contains(event.target)) return;

    state.modalSearchOpen = false;
    renderItemModalResults();
  });

  document.addEventListener('pointerdown', handlePageDragStart, { passive: true });
  document.addEventListener('pointermove', handlePageDragMove, { passive: false });
  document.addEventListener('pointerup', handlePageDragEnd, { passive: true });
  document.addEventListener('pointercancel', handlePageDragEnd, { passive: true });
  document.addEventListener('pointermove', handleLogPanelResizeMove, { passive: false });
  document.addEventListener('pointerup', handleLogPanelResizeEnd, { passive: true });
  document.addEventListener('pointercancel', handleLogPanelResizeEnd, { passive: true });
  document.addEventListener('keydown', registerMusicInteraction);

  window.setInterval(updateClock, 30000);
  window.setInterval(pollBridgeStatus, 4000);
  window.setInterval(refreshCatalogStatus, 15000);
  window.addEventListener('resize', renderMusicRibbonPosition, { passive: true });
  window.addEventListener('resize', renderLogPanelSize, { passive: true });
}

function handlePageDragStart(event) {
  if (event.pointerType === 'touch') return;
  if (event.button !== 0) return;
  if (hasOpenModal()) return;
  if (logPanelDrag.active) return;
  if (shouldIgnoreDragScrollTarget(event.target)) return;

  dragScroll.pointerId = event.pointerId;
  dragScroll.active = true;
  dragScroll.moved = false;
  dragScroll.lastX = event.clientX;
  dragScroll.lastY = event.clientY;
}

function handlePageDragMove(event) {
  if (!dragScroll.active || dragScroll.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - dragScroll.lastX;
  const deltaY = event.clientY - dragScroll.lastY;

  if (!dragScroll.moved) {
    const distance = Math.abs(event.clientX - dragScroll.lastX) + Math.abs(event.clientY - dragScroll.lastY);
    if (distance < 3) {
      return;
    }

    dragScroll.moved = true;
    document.body.classList.add('is-drag-scrolling');
  }

  dragScroll.lastX = event.clientX;
  dragScroll.lastY = event.clientY;

  window.scrollBy({
    left: -deltaX,
    top: -deltaY,
    behavior: 'auto'
  });

  event.preventDefault();
}

function handlePageDragEnd(event) {
  if (!dragScroll.active || dragScroll.pointerId !== event.pointerId) return;

  dragScroll.pointerId = null;
  dragScroll.active = false;
  dragScroll.lastX = 0;
  dragScroll.lastY = 0;

  if (dragScroll.moved) {
    dragScroll.moved = false;
    document.body.classList.remove('is-drag-scrolling');
  }
}

function hasOpenModal() {
  return [el.settingsModal, el.playerModal, el.itemModal].some((modal) => {
    return modal && !modal.classList.contains('hidden');
  });
}

function shouldIgnoreDragScrollTarget(target) {
  if (!(target instanceof Element)) {
    return true;
  }

  return !!target.closest([
    'button',
    'input',
    'textarea',
    'select',
    'a',
    'label',
    '[role="tab"]',
    '[contenteditable="true"]',
    '.mini-code-block',
    '.modal-results-list',
    '.modal-result-row',
    '.settings-debug-box',
    '.search-input',
    '.field-wrap',
    '.log-panel-resize-handle'
  ].join(','));
}

function handleLogPanelResizeStart(event) {
  if (!el.logPanelResizeHandle || event.target !== el.logPanelResizeHandle && !el.logPanelResizeHandle.contains(event.target)) {
    return;
  }

  event.preventDefault();
  logPanelDrag.pointerId = event.pointerId;
  logPanelDrag.active = true;
  logPanelDrag.startY = event.clientY;
  logPanelDrag.startHeightVh = normalizeLogPanelHeightVh(state.logPanelHeightVh);
  if (el.logPanelResizeHandle.setPointerCapture) {
    el.logPanelResizeHandle.setPointerCapture(event.pointerId);
  }
}

function handleLogPanelResizeMove(event) {
  if (!logPanelDrag.active || logPanelDrag.pointerId !== event.pointerId) return;

  const deltaVh = ((event.clientY - logPanelDrag.startY) / Math.max(window.innerHeight, 1)) * 100;
  state.logPanelHeightVh = normalizeLogPanelHeightVh(logPanelDrag.startHeightVh + deltaVh);
  renderLogPanelSize();
  event.preventDefault();
}

function handleLogPanelResizeEnd(event) {
  if (!logPanelDrag.active || logPanelDrag.pointerId !== event.pointerId) return;

  if (el.logPanelResizeHandle && el.logPanelResizeHandle.releasePointerCapture) {
    try {
      el.logPanelResizeHandle.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore browsers that already released the pointer capture.
    }
  }

  logPanelDrag.pointerId = null;
  logPanelDrag.active = false;
  logPanelDrag.startY = 0;
  logPanelDrag.startHeightVh = DEFAULT_LOG_PANEL_HEIGHT_VH;
  persistLocalState();
}

function normalizeLogPanelHeightVh(value) {
  if (!Number.isFinite(value)) return DEFAULT_LOG_PANEL_HEIGHT_VH;
  return Math.min(Math.max(value, 13), 42);
}

function renderLogPanelSize() {
  if (!el.bridgeStatus) return;
  state.logPanelHeightVh = normalizeLogPanelHeightVh(state.logPanelHeightVh);
  el.bridgeStatus.style.setProperty('--log-console-height', `${state.logPanelHeightVh.toFixed(2)}vh`);
}

async function reloadAppShell() {
  if (el.debugReloadButton) {
    el.debugReloadButton.classList.add('is-reloading');
    el.debugReloadButton.setAttribute('aria-busy', 'true');
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.update().catch(() => {}))
      );
    }
  } catch (error) {}

  window.location.reload();
}

async function loadData() {
  try {
    const itemsResponse = await fetch('/api/items', { cache: 'no-store' });
    if (itemsResponse.ok) {
      const items = await itemsResponse.json();
      state.items = Array.isArray(items) ? items : [];
      rememberCatalogItems(state.items);
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const catalogStatusResponse = await fetch('/api/catalog/status', { cache: 'no-store' });
    if (catalogStatusResponse.ok) {
      syncCatalogStatus(await catalogStatusResponse.json());
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const musicResponse = await fetch('/api/music/library', { cache: 'no-store' });
    if (musicResponse.ok) {
      syncMusicLibrary(await musicResponse.json());
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const statusResponse = await fetch('/api/status', { cache: 'no-store' });
    if (statusResponse.ok) {
      syncBridgeStatus(await statusResponse.json());
    }
  } catch (error) {
    console.error(error);
  }
}

function seedInventory() {
  const slots = [];

  for (let i = 1; i <= TOTAL_SLOTS; i += 1) {
    const defaultEntry = DEFAULT_FILLED_SLOTS.find((slot) => slot.slot === i);

    if (!defaultEntry) {
      slots.push(emptySlot(i));
      continue;
    }

    const item = state.items.find((entry) => {
      return normalizeItemLookup(entry.name) === normalizeItemLookup(defaultEntry.itemName);
    }) || null;

    slots.push(buildSlot(i, item, defaultEntry.count, defaultEntry.uses, defaultEntry.flag0, defaultEntry.flag1));
  }

  state.inventory = slots;
}

function emptySlot(index) {
  return {
    slot: index,
    item: null,
    itemId: null,
    internalId: null,
    hex: '00000000',
    count: 0,
    uses: 0,
    flag0: 0,
    flag1: 0
  };
}

function buildSlot(slotIndex, item, count, uses, flag0, flag1) {
  return {
    slot: slotIndex,
    item: item || null,
    itemId: item ? item.file_name || item.name : null,
    internalId: item ? item.internal_id || null : null,
    hex: deriveHexFromItem(item),
    count: Number(count || 0),
    uses: Number(uses || 0),
    flag0: Number(flag0 || 0),
    flag1: Number(flag1 || 0)
  };
}

function deriveHexFromItem(item) {
  if (!item || typeof item.internal_id !== 'number') return '00000000';
  return item.internal_id.toString(16).toUpperCase().padStart(8, '0');
}

function normalizeItemLookup(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function renderAll() {
  renderLogPanelSize();
  renderThemeToggle();
  renderBridge();
  renderMusic();
  renderPlayer();
  renderQuickCheatButtons();
  renderShortcutButtons();
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderTabs();
  renderDerivedPanels();
  renderItemModal();
}

function renderDerivedPanels() {
  renderWorkspacePanels();
  renderSettingsDebug();
}

function renderBridge() {
  const catalogReady = state.catalog.searchableCount > 0 || state.items.length > 0;
  const catalogGlyph = getCatalogIndicatorGlyph();

  el.catalogStatus.textContent = catalogGlyph;
  el.catalogStatus.classList.toggle('is-ok', state.catalog.connectionState === 'live');
  el.catalogStatus.classList.toggle('is-warn', state.catalog.connectionState === 'syncing' || state.catalog.connectionState === 'cached' || state.catalog.connectionState === 'fallback');
  el.catalogStatus.classList.toggle('is-bad', state.catalog.connectionState === 'offline');
  el.catalogStatus.title = state.catalog.message || '';

  if (el.catalogStatusLabel) {
    el.catalogStatusLabel.textContent = state.catalog.label || 'Local';
    el.catalogStatusLabel.title = state.catalog.message || '';
  }

  el.bridgeStatusInline.textContent = state.bridge.connected ? '✓' : '✕';
  el.bridgeStatusInline.classList.toggle('is-ok', state.bridge.connected);
  el.bridgeStatusInline.classList.toggle('is-bad', !state.bridge.connected);
  el.bridgeStatusInline.classList.remove('is-warn');

  el.bridgeToggle.classList.toggle('is-on', state.bridge.connected);
  el.bridgeToggle.setAttribute('aria-pressed', state.bridge.connected ? 'true' : 'false');
  el.bridgeToggle.title = state.bridge.connected
    ? 'Bridge connected'
    : (state.bridge.listening ? 'Bridge listener active' : 'Bridge listener offline');

  el.ipDisplay.textContent = state.bridge.connected
    ? `Bridge: ${state.bridge.ip}`
    : `Listening: ${state.bridge.host}:${state.bridge.port}`;

  if (el.logConnectionIndicator) {
    el.logConnectionIndicator.classList.toggle('is-online', state.bridge.connected);
    el.logConnectionIndicator.classList.toggle('is-offline', !state.bridge.connected);
    el.logConnectionIndicator.setAttribute('aria-label', state.bridge.connected ? 'Bridge connected' : 'Bridge disconnected');
    el.logConnectionIndicator.title = state.bridge.message || (state.bridge.connected ? 'Bridge connected' : 'Bridge disconnected');
  }

  if (el.logConnectionIcon) {
    el.logConnectionIcon.src = state.bridge.connected
      ? CONSOLE_CONNECTED_ICON_PATH
      : CONSOLE_DISCONNECTED_ICON_PATH;
  }

  const selectedSlot = getSelectedSlot();

  const block = {
    connected: state.bridge.connected,
    ip: state.bridge.ip,
    host: state.bridge.host,
    port: state.bridge.port,
    listening: state.bridge.listening,
    deviceName: state.bridge.deviceName,
    protocolVersion: state.bridge.protocolVersion,
    capabilities: state.bridge.capabilities,
    pendingRequests: state.bridge.pendingRequests,
    mode: state.bridge.mode,
    catalogReady,
    catalogState: state.catalog.connectionState,
    catalogLabel: state.catalog.label,
    itemCount: state.catalog.searchableCount || state.items.length,
    quickCheats: getEnabledQuickCheatSummary(),
    ...buildSelectedSlotPayload(selectedSlot),
    message: state.bridge.message,
    lastError: state.bridge.lastError,
    lastCommand: state.bridge.lastCommand,
    lastResponse: state.bridge.lastResponse,
    remoteStatus: state.bridge.remoteStatus,
    lastAction: state.bridge.lastAction
  };

  el.bridgeStatus.textContent = JSON.stringify(block, null, 2);
}

