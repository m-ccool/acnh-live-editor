(() => {
  'use strict';

  const TOTAL_SLOTS = 40;
  const STORAGE_KEY = 'acnh-live-editor-state-v5';
  const REPO_URL = 'https://github.com/m-ccool/acnh-live-editor';
  const SERVICE_WORKER_VERSION = '46';
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
    el.shortcutButtons = Array.from(document.querySelectorAll('.shortcut-btn'));
    el.quickCheatButtons = Array.from(document.querySelectorAll('[data-quick-cheat]'));

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
    el.modalFilterButtons = Array.from(document.querySelectorAll('.modal-filter-btn'));
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

    el.modalFilterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextFilter = button.dataset.modalFilter || 'all';
        state.modalSearchFilter = state.modalSearchFilter === nextFilter ? 'all' : nextFilter;
        state.modalSearchOpen = true;
        queueModalSearch(true);
      });
    });

    el.quickCheatButtons.forEach((button) => {
      button.addEventListener('click', () => {
        toggleQuickCheat(button.dataset.quickCheat || '');
      });
    });

    el.shortcutButtons.forEach((button) => {
      button.addEventListener('click', () => {
        handleShortcutFilterPress(button.dataset.filter || 'all');
      });
    });

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
    el.musicLibrarySelect.innerHTML = '';

    const themeTracks = tracks.filter((track) => track.group === 'Theme defaults');
    const kkTracks = tracks.filter((track) => track.group === 'K.K. Airchecks');
    const remainingTracks = tracks.filter((track) => {
      return track.group !== 'Theme defaults' && track.group !== 'K.K. Airchecks';
    });

    buildMusicOptionGroup('Theme defaults', themeTracks);
    buildMusicOptionGroup('K.K. Airchecks', kkTracks);
    buildMusicOptionGroup('Library', remainingTracks);

    if (tracks.some((track) => track.id === selectedTrackId)) {
      el.musicLibrarySelect.value = selectedTrackId;
    }
  }

  function buildMusicOptionGroup(label, tracks) {
    if (!tracks.length || !el.musicLibrarySelect) return;

    const group = document.createElement('optgroup');
    group.label = label;

    tracks.forEach((track) => {
      const option = document.createElement('option');
      option.value = track.id;
      option.textContent = track.title;
      group.appendChild(option);
    });

    el.musicLibrarySelect.appendChild(group);
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

  function renderPlayer() {
    el.playerName.value = state.player.name;
    el.townName.value = state.player.town;
    el.walletValue.value = formatNumber(state.player.wallet);
    el.bankValue.value = formatNumber(state.player.bank);
    el.milesValue.value = formatNumber(state.player.miles);
    el.playerAvatar.src = state.player.avatar;
  }

  function renderSelectedPreview() {
    const previewItem = getSelectedPreviewItem();

    if (previewItem) {
      el.selectedPreviewImage.src = getPreferredItemPreviewUrl(previewItem);
      el.selectedPreviewImage.alt = previewItem.name;
      el.selectedItemName.textContent = previewItem.name;
    } else {
      el.selectedPreviewImage.removeAttribute('src');
      el.selectedPreviewImage.alt = '';
      el.selectedItemName.textContent = 'Empty slot';
    }
  }

  function renderClipboardState() {
    const canPaste = !!state.copiedSlotPayload;
    el.pasteSelectedButton.disabled = !canPaste;
    el.pasteSelectedButton.classList.toggle('is-ready', canPaste);
    el.pasteSelectedButton.setAttribute('aria-disabled', canPaste ? 'false' : 'true');
    el.pasteSelectedButton.title = canPaste
      ? `Paste ${state.copiedSlotPayload.selectedItem || 'empty slot'} into selected slot`
      : 'Copy an item first';

    el.copySelectedButton.classList.toggle('is-armed', canPaste);
    el.copySelectedButton.setAttribute('aria-label', canPaste ? 'Clear copied item' : 'Copy selected item');
    el.copySelectedButton.title = canPaste ? 'Clear copied item' : 'Copy selected item';

    if (el.copySelectedIcon) {
      el.copySelectedIcon.src = canPaste
        ? '/assets/icons/line-md--clipboard-remove.svg'
        : '/assets/icons/line-md--clipboard.svg';
    }
  }

  function clearOverwriteGuard() {
    state.overwriteGuard = null;
  }

  function getNextOverwriteStep(index) {
    if (!state.overwriteGuard || state.overwriteGuard.slotIndex !== index) {
      return 1;
    }

    return Math.min(state.overwriteGuard.step + 1, 3);
  }

  function renderShortcutButtons() {
    el.shortcutButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.filter === state.activeFilter);
    });
  }

  function commitActiveInventoryFilter(nextFilter) {
    const normalizedFilter = nextFilter || 'all';
    if (state.activeFilter === normalizedFilter) {
      return;
    }

    state.activeFilter = normalizedFilter;
    renderShortcutButtons();
    renderInventory();
    renderDerivedPanels();
    persistLocalState();
  }

  function resetShortcutFilterTapState() {
    shortcutFilterTap.filter = '';
    shortcutFilterTap.at = 0;
    shortcutFilterTap.armedForClear = false;
  }

  function handleShortcutFilterPress(nextFilter) {
    const normalizedFilter = nextFilter || 'all';
    const now = Date.now();
    const wasActive = state.activeFilter === normalizedFilter;
    const isRapidRepeat = shortcutFilterTap.filter === normalizedFilter && now - shortcutFilterTap.at < 320;

    if (isRapidRepeat) {
      if (shortcutFilterTap.armedForClear && wasActive) {
        resetShortcutFilterTapState();
        commitActiveInventoryFilter('all');
      } else {
        resetShortcutFilterTapState();
      }
      return;
    }

    shortcutFilterTap.filter = normalizedFilter;
    shortcutFilterTap.at = now;
    shortcutFilterTap.armedForClear = wasActive;

    if (!wasActive) {
      commitActiveInventoryFilter(normalizedFilter);
    }
  }

  function renderQuickCheatButtons() {
    el.quickCheatButtons.forEach((button) => {
      const cheatId = button.dataset.quickCheat || '';
      const active = isQuickCheatActive(cheatId);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function toggleQuickCheat(cheatId) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_QUICK_CHEATS, cheatId)) {
      return;
    }

    if (cheatId === 'halfSpeed' || cheatId === 'doubleSpeed') {
      const nextActive = !state.quickCheats[cheatId];
      state.quickCheats.halfSpeed = false;
      state.quickCheats.doubleSpeed = false;
      state.quickCheats[cheatId] = nextActive;
    } else {
      state.quickCheats[cheatId] = !state.quickCheats[cheatId];
    }

    state.bridge.lastAction = `${isQuickCheatActive(cheatId) ? 'Enabled' : 'Disabled'} ${getQuickCheatLabel(cheatId)}`;
    renderQuickCheatButtons();
    renderBridge();
    renderDerivedPanels();
    persistLocalState();
  }

  function isQuickCheatActive(cheatId) {
    return Boolean(state.quickCheats[cheatId]);
  }

  function getQuickCheatLabel(cheatId) {
    return QUICK_CHEAT_LABELS[cheatId] || cheatId;
  }

  function getEnabledQuickCheatSummary() {
    return Object.keys(DEFAULT_QUICK_CHEATS)
      .filter((cheatId) => state.quickCheats[cheatId])
      .map((cheatId) => getQuickCheatLabel(cheatId));
  }

  function renderInventory() {
    el.inventoryGrid.innerHTML = '';

    state.inventory.forEach((slot, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-slot';

      if (index === state.selectedSlotIndex) {
        button.classList.add('is-selected');
      }

      if (state.overwriteGuard && state.overwriteGuard.slotIndex === index) {
        button.classList.add(`is-paste-armed-${state.overwriteGuard.step}`);
      }

      if (slot.item && state.activeFilter !== 'all' && normalizeCategory(slot.item.category) !== normalizeCategory(state.activeFilter)) {
        button.style.opacity = '0.3';
      }

      button.innerHTML = `<span class="slot-index">${slot.slot}</span>`;

      if (slot.item) {
        const img = document.createElement('img');
        img.src = slot.item.icon_url || slot.item.image_url || '';
        img.alt = slot.item.name;
        img.onerror = () => {
          img.style.display = 'none';
        };
        button.appendChild(img);
      }

      button.addEventListener('click', () => {
        if (state.overwriteGuard && state.overwriteGuard.slotIndex !== index) {
          clearOverwriteGuard();
        }

        state.selectedSlotIndex = index;
        state.modalSearchQuery = '';
        if (el.modalSearchInput) el.modalSearchInput.value = '';
        renderBridge();
        renderInventory();
        renderSelectedPreview();
        renderClipboardState();
        renderItemModal();
      });

      button.addEventListener('pointerup', async (event) => {
        if (event.pointerType !== 'touch') return;

        const now = Date.now();
        const isDoubleTap = inventoryTouchTap.index === index && now - inventoryTouchTap.at < 320;
        inventoryTouchTap.index = index;
        inventoryTouchTap.at = now;

        if (!isDoubleTap) return;

        state.selectedSlotIndex = index;
        await handleInventorySlotDoubleClick(index);
      });

      button.addEventListener('dblclick', async () => {
        state.selectedSlotIndex = index;
        await handleInventorySlotDoubleClick(index);
      });

      el.inventoryGrid.appendChild(button);
    });
  }

  function resetInventoryFilter() {
    if (state.activeFilter === 'all') {
      return;
    }

    resetShortcutFilterTapState();
    clearOverwriteGuard();
    state.bridge.lastAction = 'Inventory filter reset';
    commitActiveInventoryFilter('all');
    renderBridge();
    renderSelectedPreview();
    renderClipboardState();
  }

  async function handleInventorySlotDoubleClick(index) {
    const payload = await resolveCopiedSlotPayload();

    if (!payload) {
      clearOverwriteGuard();
      openItemModalForSelectedSlot();
      return;
    }

    state.copiedSlotPayload = payload;

    const slot = state.inventory[index];

    if (!slot.item) {
      clearOverwriteGuard();
      applyCopiedPayloadToSlot(index, payload, false);
      return;
    }

    const nextStep = getNextOverwriteStep(index);
    state.overwriteGuard = {
      slotIndex: index,
      step: nextStep
    };

    if (nextStep >= 3) {
      clearOverwriteGuard();
      applyCopiedPayloadToSlot(index, payload, true);
      return;
    }

    state.bridge.lastAction = `Overwrite slot ${slot.slot}: ${nextStep}/3`;
    renderBridge();
    renderInventory();
    renderSelectedPreview();
    renderClipboardState();
    renderDerivedPanels();
    renderItemModal();
  }

  function renderTabs() {
    el.tabButtons.forEach((button) => {
      const active = button.dataset.tab === state.activeTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    el.tabPanels.forEach((panel) => {
      const panelTab = panel.id.replace('tab-panel-', '');
      const active = panelTab === state.activeTab;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  }

  function renderWorkspacePanels() {
    const slot = getSelectedSlot();
    const filledSlots = state.inventory.filter((entry) => entry.item).length;
    const stackTotal = state.inventory.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
    const categories = getCategorySummary();

    el.tabFilledSlots.textContent = `${filledSlots} / ${TOTAL_SLOTS}`;
    el.tabStackTotal.textContent = formatNumber(stackTotal);
    el.tabActiveCategory.textContent = slot.item ? slot.item.category || 'Unsorted' : 'Empty';

    el.tabCategoryList.innerHTML = '';

    if (!categories.length) {
      const empty = document.createElement('div');
      empty.className = 'tab-empty-state';
      empty.textContent = 'No catalog items are assigned to pockets yet.';
      el.tabCategoryList.appendChild(empty);
    } else {
      categories.slice(0, 5).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'tab-list-row';
        row.innerHTML = `<span>${entry.category}</span><strong>${entry.count}</strong>`;
        el.tabCategoryList.appendChild(row);
      });
    }

    el.tabSelectionName.textContent = slot.item ? slot.item.name : 'Empty slot';
    el.tabSelectionHex.textContent = slot.hex || '00000000';
    el.tabSelectionSource.textContent = slot.item
      ? getItemSourceLabel(slot.item)
      : 'No source';

    el.tabPlayerSummaryName.textContent = state.player.name;
    el.tabPlayerSummaryTown.textContent = state.player.town;
    el.tabPlayerSummaryWallet.textContent = formatNumber(state.player.wallet);
    el.tabPlayerSummaryMiles.textContent = formatNumber(state.player.miles);

    el.tabBridgeState.textContent = state.bridge.connected ? 'Connected' : 'Offline';
    el.tabBridgeMode.textContent = state.bridge.mode;
    el.tabStorageState.textContent = isLocalStorageAvailable() ? 'Saved locally' : 'Unavailable';
    el.tabSessionJson.textContent = JSON.stringify(buildSelectedSlotPayload(slot), null, 2);
  }

  function renderSettingsDebug() {
    if (!el.settingsDebugOutput) return;

    const slot = getSelectedSlot();
    const summary = [
      state.bridge.connected ? 'Bridge online' : 'Bridge offline',
      state.bridge.mode,
      `${state.catalog.label} catalog`,
      `${state.catalog.searchableCount || state.items.length} items`,
      `slot ${slot.slot}`
    ];

    el.settingsDebugOutput.textContent = summary.join(' | ');

    if (el.settingsCatalogOutput) {
      el.settingsCatalogOutput.textContent = getCatalogDiagnosticsSummary();
    }
  }

  function renderItemModal() {
    const slot = getSelectedSlot();
    const item = state.modalPendingItem || slot.item;

    el.modalPocketTitle.textContent = `Pocket ${slot.slot} · ${item ? item.name : 'Empty slot'}`;
    el.modalItemName.textContent = item ? item.name : 'Empty slot';
    el.modalInputCount.value = String(slot.count);
    el.modalInputUses.value = String(slot.uses);
    el.modalInputFlag0.value = String(slot.flag0);
    el.modalInputFlag1.value = String(slot.flag1);
    el.modalHex.textContent = item ? deriveHexFromItem(item) : (slot.hex || '00000000');

    if (item) {
      el.modalItemPreview.src = getPreferredItemPreviewUrl(item);
      el.modalItemPreview.alt = item.name;
    } else {
      el.modalItemPreview.removeAttribute('src');
      el.modalItemPreview.alt = '';
    }

    renderItemModalPayload();
    renderItemModalResults();
  }

  function renderItemModalResults() {
    el.modalResultsList.classList.toggle('is-collapsed', !state.modalSearchOpen);
    renderModalFilterButtons();

    if (!state.modalSearchOpen) {
      return;
    }

    el.modalResultsList.innerHTML = '';

    const results = state.catalog.modalResults.slice(0, MODAL_SEARCH_LIMIT);

    if (state.catalog.modalLoading && !results.length) {
      const loading = document.createElement('div');
      loading.className = 'modal-result-row is-empty';
      loading.textContent = 'Searching catalog...';
      el.modalResultsList.appendChild(loading);
      return;
    }

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'modal-result-row is-empty';
      empty.textContent = getModalSearchEmptyStateText();
      el.modalResultsList.appendChild(empty);
      return;
    }

    results.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'modal-result-row';
      row.textContent = item.name;

      const activeItem = state.modalPendingItem || getSelectedSlot().item;
      if (activeItem && normalizeItemLookup(activeItem.file_name || activeItem.name) === normalizeItemLookup(item.file_name || item.name)) {
        row.classList.add('is-selected');
      }

      row.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        assignItemToSelectedSlot(item);
      });

      row.addEventListener('click', (event) => {
        event.preventDefault();
        assignItemToSelectedSlot(item);
      });

      el.modalResultsList.appendChild(row);
    });
  }

  function assignItemToSelectedSlot(item) {
    rememberCatalogItems([item]);
    state.modalPendingItem = item;
    state.modalSearchQuery = item.name;
    if (el.modalSearchInput) {
      el.modalSearchInput.value = item.name;
    }
    state.modalSearchOpen = false;
    renderItemModal();
  }

  function clearSelectedSlot() {
    const slot = getSelectedSlot();
    const cleared = emptySlot(slot.slot);

    Object.assign(slot, cleared);
    state.modalPendingItem = null;

    state.bridge.lastAction = `Cleared slot ${slot.slot}`;
    clearOverwriteGuard();
    renderBridge();
    renderInventory();
    renderSelectedPreview();
    renderClipboardState();
    renderDerivedPanels();
    renderItemModal();
    persistLocalState();
  }

  function openItemModalForSelectedSlot() {
    state.modalPendingItem = getSelectedSlot().item || null;
    state.modalSearchQuery = '';
    state.modalSearchFilter = 'all';
    state.modalSearchOpen = false;
    state.catalog.modalResults = [];
    el.modalSearchInput.value = '';
    renderItemModal();
    openModal(el.itemModal);
    focusItemSearch();
  }

  function applyItemEdits() {
    const slot = getSelectedSlot();
    const item = state.modalPendingItem;

    if (item) {
      rememberCatalogItems([item]);
      slot.item = item;
      slot.itemId = item.file_name || item.name;
      slot.internalId = item.internal_id || null;
      slot.hex = deriveHexFromItem(item);
    } else {
      slot.item = null;
      slot.itemId = null;
      slot.internalId = null;
      slot.hex = '00000000';
    }

    slot.count = normalizeWholeNumber(el.modalInputCount.value, slot.count);
    slot.uses = normalizeWholeNumber(el.modalInputUses.value, slot.uses);
    slot.flag0 = normalizeWholeNumber(el.modalInputFlag0.value, slot.flag0);
    slot.flag1 = normalizeWholeNumber(el.modalInputFlag1.value, slot.flag1);

    state.bridge.lastAction = item
      ? `Updated slot ${slot.slot} to "${item.name}"`
      : `Cleared slot ${slot.slot}`;
    clearOverwriteGuard();
    renderBridge();
    renderInventory();
    renderSelectedPreview();
    renderClipboardState();
    renderDerivedPanels();
    renderItemModal();
    persistLocalState();
  }

  function renderItemModalPayload() {
    if (!el.modalSelectedPayload) return;
    el.modalSelectedPayload.textContent = JSON.stringify(buildItemModalPayload(), null, 2);
  }

  function buildItemModalPayload() {
    const slot = getSelectedSlot();
    const item = state.modalPendingItem || slot.item;
    const payload = {
      selectedSlot: slot.slot,
      selectedItem: item ? item.name : null,
      itemId: item ? (item.file_name || item.name) : null,
      internalId: item ? (item.internal_id || null) : null,
      hex: item ? deriveHexFromItem(item) : '00000000',
      count: slot.count,
      uses: slot.uses,
      flag0: slot.flag0,
      flag1: slot.flag1
    };

    payload.count = normalizeWholeNumber(el.modalInputCount.value, slot.count);
    payload.uses = normalizeWholeNumber(el.modalInputUses.value, slot.uses);
    payload.flag0 = normalizeWholeNumber(el.modalInputFlag0.value, slot.flag0);
    payload.flag1 = normalizeWholeNumber(el.modalInputFlag1.value, slot.flag1);

    return payload;
  }

  function handleSelectedClipboardButton() {
    if (state.copiedSlotPayload) {
      clearCopiedSlotPayload();
      return;
    }

    copySelectedSlotPayload();
  }

  function copySelectedSlotPayload() {
    const slot = getSelectedSlot();
    const payload = buildClipboardPayload(slot);
    state.copiedSlotPayload = payload;

    const text = JSON.stringify(payload, null, 2);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }

    state.bridge.lastAction = `Copied slot ${slot.slot} payload`;
    renderClipboardState();
    renderBridge();
    renderSelectedPreview();
    persistLocalState();
  }

  function clearCopiedSlotPayload() {
    state.copiedSlotPayload = null;
    clearOverwriteGuard();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('').catch(() => {});
    }

    state.bridge.lastAction = 'Cleared copied payload';
    renderBridge();
    renderClipboardState();
    renderInventory();
    renderSelectedPreview();
    persistLocalState();
  }

  async function pasteCopiedSlotPayload() {
    const payload = await resolveCopiedSlotPayload();
    if (!payload) {
      state.bridge.lastAction = 'Paste failed: no copied payload available';
      renderBridge();
      return;
    }

    state.copiedSlotPayload = payload;
    clearOverwriteGuard();
    applyCopiedPayloadToSlot(state.selectedSlotIndex, payload, !!getSelectedSlot().item);
  }

  function getSelectedSlot() {
    return state.inventory[state.selectedSlotIndex] || emptySlot(Math.max(1, state.selectedSlotIndex + 1));
  }

  function getFilteredItems(query) {
    const q = String(query || '').trim().toLowerCase();

    return state.items.filter((item) => {
      const matchesCategory =
        state.activeFilter === 'all' ||
        normalizeCategory(item.category) === normalizeCategory(state.activeFilter);

      if (!matchesCategory) return false;
      if (!q) return true;

      const haystack = [
        item.name,
        item.category,
        item.file_name,
        ...(item.source_files || [])
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }

  function hydratePlayerForm() {
    el.playerInputName.value = state.player.name;
    el.playerInputTown.value = state.player.town;
    el.playerInputWallet.value = state.player.wallet;
    el.playerInputBank.value = state.player.bank;
    el.playerInputMiles.value = state.player.miles;
    renderPlayerModal();
  }

  function getModalFilteredItems(query) {
    const q = String(query || '').trim().toLowerCase();

    return getKnownCatalogItems().filter((item) => {
      const matchesCategory =
        state.modalSearchFilter === 'all' ||
        normalizeCategory(item.category) === normalizeCategory(state.modalSearchFilter);

      if (!matchesCategory) return false;
      if (!q) return true;

      const haystack = [
        item.name,
        item.category,
        item.file_name,
        ...(item.source_files || [])
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }

  function getModalSearchEmptyStateText() {
    const query = String(state.modalSearchQuery || '').trim();
    if (query && query.length < REMOTE_SEARCH_MIN_QUERY_LENGTH) {
      return `Type at least ${REMOTE_SEARCH_MIN_QUERY_LENGTH} characters to search live catalog.`;
    }

    return state.modalSearchFilter === 'all'
      ? 'No matching items found.'
      : `No ${String(state.modalSearchFilter).toLowerCase()} items found.`;
  }

  function renderModalFilterButtons() {
    el.modalFilterButtons.forEach((button) => {
      button.classList.toggle('is-active', (button.dataset.modalFilter || 'all') === state.modalSearchFilter);
    });
  }

  function openEditPlayerModal() {
    state.playerModalSection = 'player';
    state.playerFlagsTab = 'recipes';
    hydratePlayerForm();
    openModal(el.playerModal);
  }

  function applyPlayerEdits() {
    commitPlayerState({
      name: sanitizeText(el.playerInputName.value, state.player.name),
      town: sanitizeText(el.playerInputTown.value, state.player.town),
      wallet: normalizeLooseNumber(el.playerInputWallet.value, state.player.wallet),
      bank: normalizeLooseNumber(el.playerInputBank.value, state.player.bank),
      miles: normalizeLooseNumber(el.playerInputMiles.value, state.player.miles)
    }, 'Player values updated locally');

    closeModal(el.playerModal);
  }

  function setPlayerModalSection(section) {
    const nextSection = ['player', 'storage', 'flags'].includes(section) ? section : 'player';
    state.playerModalSection = nextSection;
    renderPlayerModal();
  }

  function bindInlinePlayerFieldEvents() {
    const inlineFields = [
      el.playerName,
      el.townName,
      el.walletValue,
      el.bankValue,
      el.milesValue
    ].filter(Boolean);

    inlineFields.forEach((field) => {
      field.addEventListener('focus', () => {
        if (field === el.walletValue) {
          field.value = String(state.player.wallet);
        } else if (field === el.bankValue) {
          field.value = String(state.player.bank);
        } else if (field === el.milesValue) {
          field.value = String(state.player.miles);
        }
      });

      field.addEventListener('blur', applyInlinePlayerEdits);
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          field.blur();
        }
      });
    });
  }

  function applyInlinePlayerEdits() {
    commitPlayerState({
      name: sanitizeText(el.playerName.value, state.player.name),
      town: sanitizeText(el.townName.value, state.player.town),
      wallet: normalizeLooseNumber(el.walletValue.value, state.player.wallet),
      bank: normalizeLooseNumber(el.bankValue.value, state.player.bank),
      miles: normalizeLooseNumber(el.milesValue.value, state.player.miles)
    }, 'Player values updated inline');
  }

  function commitPlayerState(nextPlayer, actionText) {
    const changed =
      nextPlayer.name !== state.player.name ||
      nextPlayer.town !== state.player.town ||
      nextPlayer.wallet !== state.player.wallet ||
      nextPlayer.bank !== state.player.bank ||
      nextPlayer.miles !== state.player.miles;

    state.player = {
      ...state.player,
      ...nextPlayer
    };

    renderPlayer();
    hydratePlayerForm();

    if (!changed) {
      return;
    }

    state.bridge.lastAction = actionText;
    renderBridge();
    renderDerivedPanels();
    persistLocalState();
  }

  function persistLocalState() {
    const payload = {
      player: state.player,
      selectedSlotIndex: state.selectedSlotIndex,
      activeTab: state.activeTab,
      activeFilter: state.activeFilter,
      logPanelHeightVh: state.logPanelHeightVh,
      quickCheats: state.quickCheats,
      theme: state.theme,
      music: {
        drawerOpen: state.music.drawerOpen,
        selectedTrackId: state.music.selectedTrackId,
        ribbonTopVh: state.music.ribbonTopVh,
        volume: state.music.volume,
        loopEnabled: state.music.loopEnabled,
        wantsPlayback: state.music.wantsPlayback,
        manualTrackChoice: state.music.manualTrackChoice
      },
      copiedSlotPayload: state.copiedSlotPayload,
      inventory: state.inventory.map((slot) => ({
        slot: slot.slot,
        itemId: slot.itemId,
        itemSnapshot: slot.item ? createCatalogItemSnapshot(slot.item) : null,
        count: slot.count,
        uses: slot.uses,
        flag0: slot.flag0,
        flag1: slot.flag1,
        hex: slot.hex
      }))
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error(error);
    }
  }

  function restoreLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);

      if (saved.player) {
        state.player = {
          ...state.player,
          ...saved.player
        };
      }

      if (typeof saved.selectedSlotIndex === 'number') {
        state.selectedSlotIndex = Math.min(Math.max(saved.selectedSlotIndex, 0), state.inventory.length - 1);
      }

      if (typeof saved.activeTab === 'string' && el.tabButtons.some((button) => button.dataset.tab === saved.activeTab)) {
        state.activeTab = saved.activeTab;
      }

      if (typeof saved.activeFilter === 'string') {
        const hasFilter = saved.activeFilter === 'all' || el.shortcutButtons.some((button) => button.dataset.filter === saved.activeFilter);
        if (hasFilter) {
          state.activeFilter = saved.activeFilter;
        }
      }

      if (typeof saved.logPanelHeightVh === 'number' && Number.isFinite(saved.logPanelHeightVh)) {
        state.logPanelHeightVh = normalizeLogPanelHeightVh(saved.logPanelHeightVh);
      }

      if (saved.quickCheats && typeof saved.quickCheats === 'object') {
        const hasDoubleSpeed = saved.quickCheats.doubleSpeed === true;
        state.quickCheats = {
          halfSpeed: saved.quickCheats.halfSpeed === true && !hasDoubleSpeed,
          doubleSpeed: hasDoubleSpeed,
          wallWalk: saved.quickCheats.wallWalk === true
        };
      }

      if (saved.theme === THEME_SUNRISE || saved.theme === THEME_NIGHT) {
        state.theme = saved.theme;
      }

      if (saved.music && typeof saved.music === 'object') {
        if (typeof saved.music.drawerOpen === 'boolean') {
          state.music.drawerOpen = saved.music.drawerOpen;
        }

        if (typeof saved.music.selectedTrackId === 'string') {
          state.music.selectedTrackId = saved.music.selectedTrackId;
        }

        if (typeof saved.music.ribbonTopVh === 'number' && Number.isFinite(saved.music.ribbonTopVh)) {
          state.music.ribbonTopVh = saved.music.ribbonTopVh;
        }

        if (typeof saved.music.volume === 'number' && Number.isFinite(saved.music.volume)) {
          state.music.volume = Math.min(Math.max(saved.music.volume, 0), 1);
        }

        if (typeof saved.music.loopEnabled === 'boolean') {
          state.music.loopEnabled = saved.music.loopEnabled;
        }

        if (typeof saved.music.wantsPlayback === 'boolean') {
          state.music.wantsPlayback = saved.music.wantsPlayback;
        }

        if (typeof saved.music.manualTrackChoice === 'boolean') {
          state.music.manualTrackChoice = saved.music.manualTrackChoice;
        }
      }

      if (state.music.selectedTrackId === getDefaultNightTrackId() || state.music.selectedTrackId === getDefaultSunriseTrackId()) {
        state.music.manualTrackChoice = false;
      }

      if (!state.music.manualTrackChoice) {
        state.music.selectedTrackId = state.theme === THEME_NIGHT
          ? getDefaultNightTrackId()
          : getDefaultSunriseTrackId();
      }

      if (!getMusicTracks().some((track) => track.id === state.music.selectedTrackId)) {
        state.music.manualTrackChoice = false;
        state.music.selectedTrackId = state.theme === THEME_NIGHT
          ? getDefaultNightTrackId()
          : getDefaultSunriseTrackId();
      }

      if (saved.copiedSlotPayload && isClipboardPayload(saved.copiedSlotPayload)) {
        state.copiedSlotPayload = saved.copiedSlotPayload;
      }

      if (Array.isArray(saved.inventory)) {
        saved.inventory.forEach((savedSlot) => {
          const target = state.inventory.find((slot) => slot.slot === savedSlot.slot);
          if (!target) return;

          if (savedSlot.itemId) {
            const foundItem = findItemByLookup(savedSlot.itemId, savedSlot.itemSnapshot && savedSlot.itemSnapshot.name);

            if (foundItem) {
              rememberCatalogItems([foundItem]);
              target.item = foundItem;
              target.itemId = foundItem.file_name || foundItem.name;
              target.internalId = foundItem.internal_id || null;
              target.hex = savedSlot.hex || deriveHexFromItem(foundItem);
            } else if (isCatalogItemSnapshot(savedSlot.itemSnapshot)) {
              rememberCatalogItems([savedSlot.itemSnapshot]);
              target.item = savedSlot.itemSnapshot;
              target.itemId = savedSlot.itemSnapshot.file_name || savedSlot.itemSnapshot.name;
              target.internalId = savedSlot.itemSnapshot.internal_id || null;
              target.hex = savedSlot.hex || deriveHexFromItem(savedSlot.itemSnapshot);
            }
          } else {
            target.item = null;
            target.itemId = null;
            target.internalId = null;
            target.hex = savedSlot.hex || '00000000';
          }

          target.count = normalizeNumber(savedSlot.count, target.count);
          target.uses = normalizeNumber(savedSlot.uses, target.uses);
          target.flag0 = normalizeNumber(savedSlot.flag0, target.flag0);
          target.flag1 = normalizeNumber(savedSlot.flag1, target.flag1);
        });
      }
    } catch (error) {
      console.error(error);
    }
  }

  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    syncModalState();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');

    if (modal === el.itemModal) {
      state.modalSearchOpen = false;
      state.modalPendingItem = null;
    }

    syncModalState();
  }

  function syncModalState() {
    document.body.classList.toggle('modal-open', hasOpenModal());
  }

  function updateClock() {
    const now = new Date();

    if (el.dateDisplay) {
      el.dateDisplay.textContent = now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }

    if (el.timeDisplay) {
      el.timeDisplay.textContent = now.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });
    }
  }

  async function refreshBridgeStatus(lastAction) {
    try {
      const statusResponse = await fetch('/api/status', { cache: 'no-store' });
      if (statusResponse.ok) {
        syncBridgeStatus(await statusResponse.json());
      }
    } catch (error) {
      console.error(error);
    }

    await refreshCatalogStatus();
    refreshCatalogDiagnostics();

    state.bridge.lastAction = lastAction;
    renderBridge();
    renderDerivedPanels();
    persistLocalState();
  }

  async function pollBridgeStatus() {
    try {
      const statusResponse = await fetch('/api/status', { cache: 'no-store' });
      if (statusResponse.ok) {
        syncBridgeStatus(await statusResponse.json());
        renderBridge();
        renderDerivedPanels();
      }
    } catch (error) {
      console.error(error);
    }
  }

  function buildClouds() {
    const layer = document.getElementById('clouds-layer');
    if (!layer) return;

    layer.innerHTML = '';

    const fragment = document.createDocumentFragment();
    const isNight = state.theme === THEME_NIGHT;
    const config = isNight
      ? {
          count: 9,
          widthMin: 152,
          widthRange: 214,
          heightMin: 0.1,
          heightRange: 0.12,
          topMin: 12,
          topRange: 42,
          durationMin: 108,
          durationRange: 38,
          opacityMin: 0.1,
          opacityRange: 0.1,
          blurMin: 4.5,
          blurRange: 3.4,
          driftMin: -5,
          driftRange: 10
        }
      : {
          count: 6,
          widthMin: 188,
          widthRange: 144,
          heightMin: 0.2,
          heightRange: 0.08,
          topMin: 10,
          topRange: 22,
          durationMin: 102,
          durationRange: 22,
          opacityMin: 0.22,
          opacityRange: 0.06,
          blurMin: 1.5,
          blurRange: 1.1,
          driftMin: -3,
          driftRange: 6
        };

    for (let i = 0; i < config.count; i += 1) {
      const cloud = document.createElement('span');
      cloud.className = 'cloud';
      cloud.classList.add(isNight
        ? (Math.random() < 0.72 ? 'cloud--wispy' : 'cloud--puff')
        : 'cloud--day-round');

      const width = config.widthMin + Math.random() * config.widthRange;
      const height = width * (config.heightMin + Math.random() * config.heightRange);
      const top = config.topMin + Math.random() * config.topRange;
      const left = -8 + Math.random() * 110;
      const duration = config.durationMin + Math.random() * config.durationRange;
      const delay = Math.random() * -duration;
      const opacity = config.opacityMin + Math.random() * config.opacityRange;
      const blur = config.blurMin + Math.random() * config.blurRange;

      cloud.style.width = `${width.toFixed(2)}px`;
      cloud.style.height = `${height.toFixed(2)}px`;
      cloud.style.top = `${top.toFixed(2)}%`;
      cloud.style.left = `${left.toFixed(2)}%`;
      cloud.style.setProperty('--cloud-duration', `${duration.toFixed(2)}s`);
      cloud.style.animationDelay = `${delay.toFixed(2)}s`;
      cloud.style.setProperty('--cloud-opacity', opacity.toFixed(2));
      cloud.style.setProperty('--cloud-blur', `${blur.toFixed(2)}px`);
      cloud.style.setProperty('--cloud-drift-y', `${(config.driftMin + Math.random() * config.driftRange).toFixed(2)}px`);
      cloud.style.setProperty('--cloud-scale-y', (isNight ? (0.88 + Math.random() * 0.28) : (0.94 + Math.random() * 0.1)).toFixed(2));
      cloud.style.setProperty('--cloud-skew', `${(isNight ? randomBetween(-2.8, 2.8) : randomBetween(-0.8, 0.8)).toFixed(2)}deg`);

      fragment.appendChild(cloud);
    }

    layer.appendChild(fragment);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function buildAurora() {
    const layer = document.getElementById('aurora-layer');
    if (!layer) return;

    layer.innerHTML = '';

    if (state.theme !== THEME_NIGHT) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const ribbonCount = 5;

    for (let i = 0; i < ribbonCount; i += 1) {
      const ribbon = document.createElement('span');
      ribbon.className = 'aurora-ribbon';

      const width = randomBetween(132, 176) + (i === 0 ? 8 : 0);
      const height = randomBetween(18, 28) + (i === 0 ? 3 : 0);
      const top = randomBetween(4, 12) + i * 4.6;
      const left = randomBetween(-18, -4) + i * 1.8;
      const rotate = randomBetween(-2.8, 2.8);
      const opacity = randomBetween(0.12, 0.22);
      const blur = randomBetween(48, 72);
      const duration = randomBetween(30, 46);
      const delay = randomBetween(-duration, 0);
      const driftX = (i % 2 === 0 ? 1 : -1) * randomBetween(8, 18);
      const rise = randomBetween(10, 22);

      ribbon.style.width = `${width.toFixed(2)}vw`;
      ribbon.style.height = `${height.toFixed(2)}vh`;
      ribbon.style.top = `${top.toFixed(2)}%`;
      ribbon.style.left = `${left.toFixed(2)}%`;
      ribbon.style.zIndex = String(ribbonCount - i);
      ribbon.style.setProperty('--aurora-rotate', `${rotate.toFixed(2)}deg`);
      ribbon.style.setProperty('--aurora-opacity', opacity.toFixed(2));
      ribbon.style.setProperty('--aurora-blur', `${blur.toFixed(2)}px`);
      ribbon.style.setProperty('--aurora-duration', `${duration.toFixed(2)}s`);
      ribbon.style.setProperty('--aurora-delay', `${delay.toFixed(2)}s`);
      ribbon.style.setProperty('--aurora-drift-x', `${driftX.toFixed(2)}vw`);
      ribbon.style.setProperty('--aurora-rise', `${rise.toFixed(2)}px`);

      if (i % 2 === 1) {
        ribbon.classList.add('is-secondary');
      }

      if (i >= ribbonCount - 2) {
        ribbon.classList.add('is-far');
      }

      fragment.appendChild(ribbon);
    }

    layer.appendChild(fragment);
  }

  function buildStars() {
    const layer = document.getElementById('stars-layer');
    if (!layer) return;

    layer.innerHTML = '';

    const fragment = document.createDocumentFragment();
    const config = state.theme === THEME_NIGHT
      ? {
          count: 224,
          sizeMin: 0.75,
          sizeRange: 2.5,
          durationMin: 2.8,
          durationRange: 5.8,
          driftDurationMin: 14,
          driftDurationRange: 20,
          topRange: 92,
          opacityMin: 0.62,
          opacityRange: 0.28
        }
      : {
          count: 98,
          sizeMin: 1.2,
          sizeRange: 3.2,
          durationMin: 2.1,
          durationRange: 4.3,
          driftDurationMin: 8,
          driftDurationRange: 16,
          topRange: 72,
          opacityMin: 0.7,
          opacityRange: 0.28
        };

    for (let i = 0; i < config.count; i += 1) {
      const star = document.createElement('span');
      let variant = 'star--soft';

      if (state.theme === THEME_NIGHT) {
        const roll = Math.random();
        if (roll < 0.62) {
          variant = 'star--tiny';
        } else if (roll < 0.9) {
          variant = 'star--soft';
        } else {
          variant = 'star--bright';
        }
      }

      star.className = `star ${variant}`;
      const size = config.sizeMin + Math.random() * config.sizeRange;
      const duration = config.durationMin + Math.random() * config.durationRange;
      const driftDuration = config.driftDurationMin + Math.random() * config.driftDurationRange;
      const driftX = state.theme === THEME_NIGHT
        ? (Math.random() * 8 - 4).toFixed(2)
        : (Math.random() * 14 - 7).toFixed(2);
      const driftY = state.theme === THEME_NIGHT
        ? (Math.random() * 8 - 5).toFixed(2)
        : (Math.random() * 16 - 10).toFixed(2);

      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * config.topRange}%`;
      star.style.setProperty('--star-size', `${size.toFixed(2)}px`);
      star.style.setProperty('--star-opacity', (config.opacityMin + Math.random() * config.opacityRange).toFixed(2));
      star.style.setProperty('--star-duration', `${duration.toFixed(2)}s`);
      star.style.setProperty('--star-drift-duration', `${driftDuration.toFixed(2)}s`);
      star.style.setProperty('--star-drift-x', `${driftX}px`);
      star.style.setProperty('--star-drift-y', `${driftY}px`);
      star.style.animationDelay = `${(Math.random() * 6).toFixed(2)}s`;
      fragment.appendChild(star);
    }

    layer.appendChild(fragment);
  }

  function buildShootingStars() {
    const layer = document.getElementById('shooting-stars-layer');
    if (!layer) return;

    if (shootingStarTimeoutId) {
      window.clearTimeout(shootingStarTimeoutId);
      shootingStarTimeoutId = 0;
    }

    layer.innerHTML = '';

    if (state.theme !== THEME_NIGHT) {
      return;
    }

    shootingStarTimeoutId = window.setTimeout(() => {
      spawnShootingStar(true);
    }, 1800 + Math.random() * 2600);
  }

  function spawnShootingStar(shouldReschedule = false) {
    const layer = document.getElementById('shooting-stars-layer');
    if (!layer || state.theme !== THEME_NIGHT) {
      shootingStarTimeoutId = 0;
      return;
    }

    const streak = document.createElement('span');
    streak.className = 'shooting-star';

    const length = 108 + Math.random() * 48;
    const top = 8 + Math.random() * 24;
    const left = 6 + Math.random() * 60;
    const duration = 0.95 + Math.random() * 0.4;
    const angle = -26 + Math.random() * 6;
    const glow = 0.24 + Math.random() * 0.14;
    const travelX = 220 + Math.random() * 90;
    const travelY = 72 + Math.random() * 36;
    const tailOpacity = 0.5 + Math.random() * 0.18;

    streak.style.width = `${length.toFixed(2)}px`;
    streak.style.top = `${top.toFixed(2)}%`;
    streak.style.left = `${left.toFixed(2)}%`;
    streak.style.setProperty('--shoot-duration', `${duration.toFixed(2)}s`);
    streak.style.setProperty('--shoot-angle', `${angle.toFixed(2)}deg`);
    streak.style.setProperty('--shoot-travel-x', `${travelX.toFixed(2)}px`);
    streak.style.setProperty('--shoot-travel-y', `${travelY.toFixed(2)}px`);
    streak.style.setProperty('--shoot-glow', glow.toFixed(2));
    streak.style.setProperty('--shoot-tail-opacity', tailOpacity.toFixed(2));

    streak.addEventListener('animationend', () => {
      streak.remove();
    }, { once: true });

    layer.appendChild(streak);

    if (shouldReschedule) {
      shootingStarTimeoutId = window.setTimeout(() => {
        spawnShootingStar(true);
      }, 7000 + Math.random() * 9000);
    }
  }

  function finishBoot() {
    window.setTimeout(() => {
      el.loadingScreen.classList.add('hidden');
      el.appRoot.classList.remove('app-hidden');
    }, 700);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function normalizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeLooseNumber(value, fallback) {
    const cleaned = String(value || '').replace(/,/g, '').trim();
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeWholeNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.trunc(parsed));
  }

  function sanitizeText(value, fallback) {
    const next = String(value || '').trim();
    return next || fallback;
  }

  function normalizeCategory(value) {
    return String(value || '').trim().toLowerCase();
  }

  function syncBridgeStatus(status) {
    state.bridge.connected = !!status.connected;
    state.bridge.mode = String(status.bridge || state.bridge.mode || 'pending');
    state.bridge.ip = getBridgeIp(status);
    state.bridge.host = String(status && status.bridgeHost || state.bridge.host || '0.0.0.0');
    state.bridge.port = Number(status && status.bridgePort || state.bridge.port || 32840);
    state.bridge.listening = Boolean(status && status.listening);
    state.bridge.deviceName = status && status.deviceName ? String(status.deviceName) : null;
    state.bridge.protocolVersion = status && status.protocolVersion ? String(status.protocolVersion) : null;
    state.bridge.capabilities = Array.isArray(status && status.capabilities) ? status.capabilities.slice() : [];
    state.bridge.pendingRequests = Number(status && status.pendingRequests || 0);
    state.bridge.lastCommand = status && status.lastCommand && typeof status.lastCommand === 'object'
      ? status.lastCommand
      : null;
    state.bridge.lastResponse = status && status.lastResponse && typeof status.lastResponse === 'object'
      ? status.lastResponse
      : null;
    state.bridge.remoteStatus = status && status.remoteStatus && typeof status.remoteStatus === 'object'
      ? status.remoteStatus
      : null;
    state.bridge.lastError = status && status.lastError ? String(status.lastError) : null;
    state.bridge.message = status && status.message
      ? String(status.message)
      : (state.bridge.connected
        ? `Bridge ${state.bridge.mode} and ready for sync.`
        : `Bridge ${state.bridge.mode}. Read/write disabled.`);
  }

  async function refreshCatalogStatus() {
    try {
      const response = await fetch('/api/catalog/status', { cache: 'no-store' });
      if (response.ok) {
        syncCatalogStatus(await response.json());
        renderBridge();
        renderDerivedPanels();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshCatalogDiagnostics() {
    if (state.catalog.diagnosticsLoading) {
      return;
    }

    state.catalog.diagnosticsLoading = true;
    renderSettingsDebug();

    try {
      const response = await fetch('/api/catalog/diagnostics', { cache: 'no-store' });
      if (response.ok) {
        state.catalog.diagnostics = await response.json();
      }
    } catch (error) {
      state.catalog.diagnostics = {
        generatedAt: new Date().toISOString(),
        error: error.message
      };
    } finally {
      state.catalog.diagnosticsLoading = false;
      renderSettingsDebug();
    }
  }

  function syncCatalogStatus(status) {
    state.catalog.connectionState = String(status && status.connectionState || DEFAULT_CATALOG_STATE.connectionState);
    state.catalog.label = String(status && status.label || DEFAULT_CATALOG_STATE.label);
    state.catalog.message = String(status && status.message || DEFAULT_CATALOG_STATE.message);
    state.catalog.searchableCount = Number(status && status.searchableCount || 0);
    state.catalog.localCount = Number(status && status.localCount || 0);
    state.catalog.cachedCount = Number(status && status.cachedCount || 0);
    state.catalog.liveConnected = Boolean(status && status.liveConnected);
    state.catalog.hasActiveRefresh = Boolean(status && status.hasActiveRefresh);
  }

  function getCatalogDiagnosticsSummary() {
    if (state.catalog.diagnosticsLoading) {
      return 'Checking Nookipedia connection...';
    }

    const diagnostics = state.catalog.diagnostics;
    if (!diagnostics) {
      return 'Open Settings or press refresh to run diagnostics.';
    }

    if (diagnostics.error) {
      return `Probe failed\n${diagnostics.error}`;
    }

    const tls = diagnostics.tcpTls || {};
    const httpDoc = diagnostics.httpDoc || {};
    const httpApi = diagnostics.httpApi || {};
    const describeProbe = (probe) => {
      if (probe.ok) {
        return `ok in ${probe.firstByteMs}ms`;
      }

      if (typeof probe.status === 'number' && probe.status > 0) {
        return `HTTP ${probe.status}`;
      }

      return probe.error || 'failed';
    };

    return [
      `State: ${state.catalog.label} (${state.catalog.connectionState})`,
      `TLS: ${tls.ok ? `ok in ${tls.elapsedMs}ms` : tls.error || 'failed'}`,
      `Doc: ${describeProbe(httpDoc)}`,
      `API: ${describeProbe(httpApi)}`,
      `Last error: ${state.catalog.message || 'none'}`
    ].join('\n');
  }

  function getBridgeIp(status) {
    const raw = status && typeof status.ip === 'string' ? status.ip.trim() : '';
    if (raw) return raw;

    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      return DEFAULT_BRIDGE_STATE.ip;
    }

    return host;
  }

  function buildSelectedSlotPayload(slot) {
    return {
      selectedSlot: slot.slot,
      selectedItem: slot.item ? slot.item.name : null,
      itemId: slot.itemId,
      internalId: slot.internalId,
      hex: slot.hex,
      count: slot.count,
      uses: slot.uses,
      flag0: slot.flag0,
      flag1: slot.flag1
    };
  }

  function buildClipboardPayload(slot) {
    return {
      ...buildSelectedSlotPayload(slot),
      itemSnapshot: slot.item ? createCatalogItemSnapshot(slot.item) : null,
      copiedAt: new Date().toISOString()
    };
  }

  function applyCopiedPayloadToSlot(index, payload, overwroteExistingItem) {
    const slot = state.inventory[index];

    if (!payload.itemId) {
      Object.assign(slot, emptySlot(slot.slot));
      state.bridge.lastAction = `Pasted empty slot into slot ${slot.slot}`;
    } else {
      const item = findItemByLookup(payload.itemId, payload.selectedItem);

      if (!item) {
        if (isCatalogItemSnapshot(payload.itemSnapshot)) {
          rememberCatalogItems([payload.itemSnapshot]);
          slot.item = payload.itemSnapshot;
          slot.itemId = payload.itemSnapshot.file_name || payload.itemSnapshot.name;
          slot.internalId = payload.itemSnapshot.internal_id || null;
          slot.hex = payload.hex || deriveHexFromItem(payload.itemSnapshot);
          slot.count = normalizeWholeNumber(payload.count, 0);
          slot.uses = normalizeWholeNumber(payload.uses, 0);
          slot.flag0 = normalizeWholeNumber(payload.flag0, 0);
          slot.flag1 = normalizeWholeNumber(payload.flag1, 0);
          state.bridge.lastAction = overwroteExistingItem
            ? `Overwrote slot ${slot.slot} with "${payload.itemSnapshot.name}"`
            : `Pasted "${payload.itemSnapshot.name}" into slot ${slot.slot}`;
        } else {
          state.bridge.lastAction = `Paste failed: missing catalog item "${payload.itemId}"`;
          renderBridge();
          return;
        }
      } else {
        rememberCatalogItems([item]);
        slot.item = item;
        slot.itemId = item.file_name || item.name;
        slot.internalId = item.internal_id || null;
        slot.hex = payload.hex || deriveHexFromItem(item);
        slot.count = normalizeWholeNumber(payload.count, 0);
        slot.uses = normalizeWholeNumber(payload.uses, 0);
        slot.flag0 = normalizeWholeNumber(payload.flag0, 0);
        slot.flag1 = normalizeWholeNumber(payload.flag1, 0);
        state.bridge.lastAction = overwroteExistingItem
          ? `Overwrote slot ${slot.slot} with "${item.name}"`
          : `Pasted "${item.name}" into slot ${slot.slot}`;
      }
    }

    renderBridge();
    renderInventory();
    renderSelectedPreview();
    renderClipboardState();
    renderDerivedPanels();
    renderItemModal();
    persistLocalState();
  }

  async function resolveCopiedSlotPayload() {
    if (isClipboardPayload(state.copiedSlotPayload)) {
      return state.copiedSlotPayload;
    }

    if (!navigator.clipboard || !navigator.clipboard.readText) {
      return null;
    }

    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      return isClipboardPayload(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function isClipboardPayload(value) {
    return !!value && typeof value === 'object' && typeof value.selectedSlot === 'number' && 'itemId' in value;
  }

  function findItemByLookup(itemId, itemName) {
    return getKnownCatalogItems().find((item) => {
      return (
        normalizeItemLookup(item.file_name) === normalizeItemLookup(itemId) ||
        normalizeItemLookup(item.name) === normalizeItemLookup(itemId) ||
        normalizeItemLookup(item.name) === normalizeItemLookup(itemName)
      );
    }) || null;
  }

  function getKnownCatalogItems() {
    const merged = [];
    const seen = new Set();

    [state.items, state.catalog.lookupItems].forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((item) => {
        const key = normalizeItemLookup(item && (item.file_name || item.name));
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
    });

    return merged;
  }

  function rememberCatalogItems(items) {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!isCatalogItemSnapshot(item)) return;
      const key = normalizeItemLookup(item.file_name || item.name);
      const existingIndex = state.catalog.lookupItems.findIndex((entry) => {
        return normalizeItemLookup(entry.file_name || entry.name) === key;
      });

      if (existingIndex >= 0) {
        state.catalog.lookupItems[existingIndex] = item;
      } else {
        state.catalog.lookupItems.push(item);
      }
    });

    if (state.catalog.lookupItems.length > LOOKUP_ITEM_LIMIT) {
      state.catalog.lookupItems = state.catalog.lookupItems.slice(-LOOKUP_ITEM_LIMIT);
    }
  }

  function createCatalogItemSnapshot(item) {
    if (!isCatalogItemSnapshot(item)) return null;
    return {
      name: item.name || null,
      category: item.category || '',
      icon_url: item.icon_url || null,
      image_url: item.image_url || null,
      preview_url: item.preview_url || null,
      internal_id: typeof item.internal_id === 'number' ? item.internal_id : null,
      file_name: item.file_name || item.name || null,
      source_files: Array.isArray(item.source_files) ? item.source_files.slice(0, 4) : []
    };
  }

  function isCatalogItemSnapshot(value) {
    return !!value && typeof value === 'object' && typeof value.name === 'string';
  }

  function queueModalSearch(immediate) {
    window.clearTimeout(modalSearchDebounceId);
    if (!state.modalSearchOpen) {
      return;
    }

    if (immediate) {
      runModalSearch();
      return;
    }

    modalSearchDebounceId = window.setTimeout(runModalSearch, MODAL_SEARCH_DEBOUNCE_MS);
  }

  async function runModalSearch() {
    const token = ++modalSearchToken;
    const query = String(state.modalSearchQuery || '').trim();
    const shouldUseRemoteSearch = query.length >= REMOTE_SEARCH_MIN_QUERY_LENGTH;

    if (!shouldUseRemoteSearch) {
      state.catalog.modalLoading = false;
      state.catalog.modalResults = getModalFilteredItems(query).slice(0, MODAL_SEARCH_LIMIT);
      renderItemModalResults();
      return;
    }

    state.catalog.modalLoading = true;
    renderItemModalResults();

    try {
      const params = new URLSearchParams({
        q: query,
        filter: state.modalSearchFilter || 'all',
        limit: String(MODAL_SEARCH_LIMIT)
      });
      const response = await fetch(`/api/items/search?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Search failed with ${response.status}`);
      }

      const payload = await response.json();
      if (token !== modalSearchToken) return;

      state.catalog.modalResults = Array.isArray(payload.items) ? payload.items : [];
      rememberCatalogItems(state.catalog.modalResults);
      if (payload.status) {
        syncCatalogStatus(payload.status);
      }
    } catch (error) {
      if (token !== modalSearchToken) return;
      state.catalog.modalResults = getModalFilteredItems(state.modalSearchQuery).slice(0, MODAL_SEARCH_LIMIT);
    } finally {
      if (token !== modalSearchToken) return;
      state.catalog.modalLoading = false;
      renderItemModalResults();
      renderBridge();
      renderDerivedPanels();
    }
  }

  function getCatalogIndicatorGlyph() {
    if (state.catalog.connectionState === 'live') return '✓';
    if (state.catalog.connectionState === 'syncing') return '…';
    if (state.catalog.connectionState === 'cached') return '◌';
    if (state.catalog.connectionState === 'fallback') return '!';
    return '✕';
  }

  function getSelectedPreviewItem() {
    if (state.copiedSlotPayload && state.copiedSlotPayload.itemId) {
      return findItemByLookup(state.copiedSlotPayload.itemId, state.copiedSlotPayload.selectedItem);
    }

    const slot = getSelectedSlot();
    return slot.item || null;
  }

  function renderPlayerModal() {
    if (el.playerModalBust) {
      el.playerModalBust.src = state.player.avatar || '/assets/items/Bob_NH.png';
    }

    if (el.playerModalBustName) {
      el.playerModalBustName.textContent = state.player.name;
    }

    if (el.playerModalBustTown) {
      el.playerModalBustTown.textContent = state.player.town;
    }

    if (el.playerModalTitle) {
      if (state.playerModalSection === 'flags') {
        el.playerModalTitle.textContent = 'Edit Flags';
      } else if (state.playerModalSection === 'storage') {
        el.playerModalTitle.textContent = 'Player Storage';
      } else {
        el.playerModalTitle.textContent = 'Edit Player';
      }
    }

    el.playerModalSectionButtons.forEach((button) => {
      const active = (button.dataset.playerSection || 'player') === state.playerModalSection;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    Object.entries(el.playerModalViews).forEach(([section, view]) => {
      if (!view) return;
      view.hidden = section !== state.playerModalSection;
    });

    if (el.playerModalFooter) {
      el.playerModalFooter.hidden = state.playerModalSection !== 'player';
    }

    renderPlayerFlagsTabs();
  }

  function renderPlayerFlagsTabs() {
    el.playerFlagsTabButtons.forEach((button) => {
      const active = (button.dataset.playerFlagsTab || 'recipes') === state.playerFlagsTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    el.playerFlagsPanels.forEach((panel) => {
      const tabName = panel.id.replace('player-flags-panel-', '');
      const active = tabName === state.playerFlagsTab;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  }

  function getPreferredItemPreviewUrl(item) {
    if (!item) return '';
    return item.preview_url || item.image_url || item.icon_url || '';
  }

  function getCategorySummary() {
    const map = new Map();

    state.inventory.forEach((slot) => {
      if (!slot.item) return;
      const category = slot.item.category || 'Unsorted';
      map.set(category, (map.get(category) || 0) + 1);
    });

    return Array.from(map.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }

  function getItemSourceLabel(item) {
    if (Array.isArray(item.source_files) && item.source_files.length > 0) {
      return item.source_files[0];
    }

    return item.file_name || 'Local catalog';
  }

  function isLocalStorageAvailable() {
    try {
      const probe = '__acnh_probe__';
      localStorage.setItem(probe, probe);
      localStorage.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  }

  function focusItemSearch() {
    if (!el.modalSearchInput) return;
    el.modalSearchInput.focus();
    el.modalSearchInput.select();
  }

  function toggleTheme() {
    state.theme = state.theme === THEME_NIGHT ? THEME_SUNRISE : THEME_NIGHT;
    applyTheme();
    state.bridge.lastAction = `Theme switched to ${getThemeLabel(state.theme)}`;
    renderBridge();
    renderDerivedPanels();
    persistLocalState();
  }

  function applyTheme(shouldPersist = false) {
    document.body.dataset.theme = state.theme;

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', state.theme === THEME_NIGHT ? '#091235' : '#f6b084');
    }

    buildClouds();
    buildAurora();
    buildStars();
    buildShootingStars();
    renderThemeToggle();
    syncThemeMusicPreference();

    if (shouldPersist) {
      persistLocalState();
    }
  }

  function renderThemeToggle() {
    if (!el.themeToggle) return;

    const isNight = state.theme === THEME_NIGHT;
    const nextTheme = isNight ? THEME_SUNRISE : THEME_NIGHT;

    el.themeToggle.classList.toggle('is-night', isNight);
    el.themeToggle.setAttribute('aria-label', `Switch to ${getThemeLabel(nextTheme)} theme`);
    el.themeToggle.title = `Switch to ${getThemeLabel(nextTheme)}`;
    el.themeToggle.setAttribute('aria-pressed', isNight ? 'true' : 'false');

    if (el.themeToggleLabel) {
      el.themeToggleLabel.textContent = getThemeLabel(state.theme);
    }

    if (el.themeToggleHint) {
      el.themeToggleHint.textContent = `Switch to ${getThemeLabel(nextTheme)}`;
    }

    if (el.themeToggleIcon) {
      el.themeToggleIcon.src = isNight
        ? '/assets/icons/line-md--sunny-filled-loop-to-moon-filled-alt-loop-transition.svg'
        : '/assets/icons/line-md--sun-rising-filled-loop.svg';
    }
  }

  function getThemeLabel(theme) {
    return theme === THEME_NIGHT ? 'Night' : 'Sun rise';
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`./service-worker.js?v=${SERVICE_WORKER_VERSION}`).catch(() => {});
    });
  }
})();
