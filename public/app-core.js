'use strict';

const TOTAL_SLOTS = 40;
const STORAGE_KEY = 'acnh-live-editor-state-v5';
const REPO_URL = 'https://github.com/m-ccool/acnh-live-editor';
const SERVICE_WORKER_VERSION = '107';
const PLAY_ICON_PATH = './assets/icons/line-md--pause-to-play-filled-transition.svg';
const PAUSE_ICON_PATH = './assets/icons/line-md--pause.svg';
const CONSOLE_CONNECTED_ICON_PATH = './assets/icons/codicon--debug-connect.svg';
const CONSOLE_DISCONNECTED_ICON_PATH = './assets/icons/codicon--debug-disconnect.svg';
const DEFAULT_MUSIC_ARTWORK_PATH = './assets/icons/Aircheck_NH_Inv_Icon.png';
const THEME_SUNRISE = 'sunrise';
const THEME_NIGHT = 'night';
const DEFAULT_MUSIC_RIBBON_TOP_VH = 56;
const DEFAULT_LOG_PANEL_HEIGHT_VH = 13;
const DEFAULT_TEST_PAYLOAD_KEY = 'off';
const TEST_PAYLOAD_OPTION_DEFS = Object.freeze({
  off: {
    label: 'OFF',
    path: null
  },
  'live-ok': {
    label: 'LIVE OK',
    path: './test-payloads/live-ok.json'
  },
  'bridge-disconnected': {
    label: 'DISCONNECTED',
    path: './test-payloads/bridge-disconnected.json'
  },
  'acnh-error': {
    label: 'ACNH ERROR',
    path: './test-payloads/acnh-error.json'
  }
});
const DEFAULT_TEST_PAYLOAD = Object.freeze({
  meta: {
    name: 'Fallback local test payload',
    version: 1,
    source: 'fallback'
  },
  catalog: {
    connectionState: 'syncing',
    label: 'Simulated',
    message: 'TEST payload active: catalog status is synthetic.',
    searchableCount: 999
  },
  bridge: {
    connected: true,
    ip: '10.99.0.42',
    listenerIp: '10.99.0.1',
    host: '0.0.0.0',
    port: 32840,
    listening: true,
    mode: 'test-payload',
    message: 'TEST payload active: bridge status is synthetic.',
    lastAction: 'Injected synthetic bridge status',
    gameDataSource: 'test-payload',
    ryujinxRunning: true,
    ryujinxMatchCount: 1,
    inventorySource: 'test-payload'
  }
});
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
      audioUrls: [
        'https://static.wikia.nocookie.net/animalcrossing/images/3/36/ACCF_Main_Theme.ogg/revision/latest?cb=20150816212904',
        'https://static.wikia.nocookie.net/animalcrossing/images/3/36/ACCF_Main_Theme.ogg'
      ],
      artworkUrl: DEFAULT_MUSIC_ARTWORK_PATH,
      referenceUrl: 'https://nookipedia.com/wiki/Animal_Crossing:_Your_Favourite_Songs_-_Original_Soundtrack'
    }
  ]
});
const DEFAULT_MUSIC_STATE = Object.freeze({
  drawerOpen: false,
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
  wallWalk: false,
  wallet: false
});
const QUICK_CHEAT_LABELS = Object.freeze({
  halfSpeed: '0.5x island clock',
  doubleSpeed: '2x island clock',
  wallWalk: 'wall walk',
  wallet: 'wallet'
});
let shootingStarTimeoutId = 0;
const prevDataSnapshot = {
  playerHash: '',
  inventoryHash: ''
};
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
  name: '',
  town: '',
  wallet: 0,
  bank: 0,
  miles: 0,
  avatar: './assets/items/Bob_NH.png'
};

const DEFAULT_BRIDGE_STATE = {
  connected: false,
  ip: '00.00.00.00',
  listenerIp: null,
  clientIp: null,
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
  lastError: null,
  inventoryAdapter: null,
  inventorySource: 'local-cache',
  lastInventorySyncAt: null,
  gameDataSource: 'none',
  lastGameDataSyncAt: null,
  lastGameSaveAt: null,
  lastGameDataFilePath: null,
  ryujinxRunning: null,
  ryujinxMatchCount: 0,
  ryujinxMatches: [],
  pollPaused: false
};
const DEFAULT_CATALOG_STATE = Object.freeze({
  connectionState: 'fallback',
  label: 'Offline',
  message: 'Nookipedia API key is not configured.',
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

const DEFAULT_FILLED_SLOTS = [];

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
  copiedSlotSourceIndex: null,
  copiedSlotMode: null,
  copiedSlotBadgeIndex: null,
  overwriteGuard: null,
  pendingInventorySlot: null,
  selectedSlotIndex: 0,
  hasUserSelectedSlot: false,
  modalSearchQuery: '',
  modalSearchFilter: 'all',
  modalSearchOpen: false,
  modalPendingItem: null,
  activeTab: 'villagers',
  activeFilter: 'all',
  theme: THEME_NIGHT,
  playerModalSection: 'player',
  playerFlagsTab: 'recipes',
  logPanelHeightVh: DEFAULT_LOG_PANEL_HEIGHT_VH,
  quickCheats: { ...DEFAULT_QUICK_CHEATS },
  music: {
    ...DEFAULT_MUSIC_STATE,
    library: DEFAULT_MUSIC_LIBRARY.tracks.slice()
  },
  bridgePollIntervalId: null,
  playerSaveSnapshot: null,
  villagers: [],
  pinnedPresets: JSON.parse(localStorage.getItem('acnh-pinned-presets') || 'null') || ['tools','materials'],
  customPresets: JSON.parse(localStorage.getItem('acnh-custom-presets') || '[]'),
  uiLoading: {
    boot: true,
    player: false,
    inventory: false,
    search: false
  },
  testDataMode: false,
  testPayload: null,
  testPayloadLoaded: false,
  testPayloadKey: DEFAULT_TEST_PAYLOAD_KEY
};

const el = {};

function renderUiLoadingState() {
  if (!document || !document.body) return;

  const bootLoading = Boolean(state.uiLoading && state.uiLoading.boot);
  const playerLoading = Boolean(state.uiLoading && state.uiLoading.player);
  const inventoryLoading = Boolean(state.uiLoading && state.uiLoading.inventory);
  const searchLoading = Boolean(state.uiLoading && state.uiLoading.search);

  document.body.classList.toggle('ui-loading-boot', bootLoading);
  document.body.classList.toggle('ui-loading-player', playerLoading);
  document.body.classList.toggle('ui-loading-inventory', inventoryLoading);
  document.body.classList.toggle('ui-loading-search', searchLoading);

  if (el.playerPanel) {
    el.playerPanel.classList.toggle('is-loading', bootLoading || playerLoading);
  }

  if (el.inventoryCard) {
    el.inventoryCard.classList.toggle('is-loading', bootLoading || inventoryLoading);
  }

  if (el.invQuickSearch) {
    el.invQuickSearch.classList.toggle('is-loading', searchLoading);
    el.invQuickSearch.setAttribute('aria-busy', searchLoading ? 'true' : 'false');
  }
}

function setUiLoading(section, isLoading) {
  if (!state.uiLoading || !Object.prototype.hasOwnProperty.call(state.uiLoading, section)) {
    return;
  }

  state.uiLoading[section] = Boolean(isLoading);
  renderUiLoadingState();
}

async function handleConnectBridgeClick() {
  if (!el.deployButton || el.deployButton.disabled) return;
  const label = document.getElementById('deploy-button-label');
  el.deployButton.disabled = true;
  el.deployButton.classList.add('is-busy');
  if (label) label.textContent = '⏳ Connecting…';
  let data = null;
  try {
    const res = await apiFetch('/api/connect-bridge', { method: 'POST', cache: 'no-store' });
    data = await res.json();
    if (label) label.textContent = data.ok ? '✓ Connected' : '✗ Failed';
  } catch (err) {
    data = { ok: false, error: err.message };
    if (label) label.textContent = '✗ Error';
    console.error('[connect-bridge]', err);
  }
  showDeployToast(data);
  el.deployButton.classList.remove('is-busy');
  // Refresh bridge status so dot + status chips update immediately
  if (typeof refreshBridgeStatus === 'function') {
    setTimeout(() => refreshBridgeStatus('Bridge reconnect').catch(() => {}), 800);
  }
  setTimeout(() => {
    if (label) label.textContent = '⚡ Connect Bridge';
    if (el.deployButton) el.deployButton.disabled = false;
  }, 4000);
}

function showDeployToast(data) {
  if (!el.deployToast) return;
  const lines = [];
  if (data && data.steps) {
    data.steps.forEach(s => {
      const out = (s.out || '').trim();
      lines.push(`${s.ok ? '✓' : '✗'} ${s.step}${out ? ': ' + out.slice(0, 70) : ''}`);
    });
  } else if (data && data.error) {
    lines.push(`✗ ${String(data.error).slice(0, 120)}`);
  }
  // Always show toast when called — even on empty steps show a status line
  if (!lines.length) {
    lines.push(data && data.ok ? '✓ Bridge command sent' : '✗ No response from server');
  }
  el.deployToast.textContent = lines.join('\n');
  el.deployToast.classList.add('is-visible');
  clearTimeout(el._toastTimeout);
  el._toastTimeout = setTimeout(() => { if (el.deployToast) el.deployToast.classList.remove('is-visible'); }, 7000);
}

function showToast(message, duration) {
  if (!el.deployToast) return;
  el.deployToast.textContent = message;
  el.deployToast.classList.add('is-visible');
  clearTimeout(el._toastTimeout);
  el._toastTimeout = setTimeout(() => { if (el.deployToast) el.deployToast.classList.remove('is-visible'); }, duration || 3000);
}

// Global tab-enter shimmer: brief loading overlay on every tab switch so the
// user sees a consistent transition regardless of the panel's data-load path.
function playTabEnterShimmer(tabName) {
  const panel = document.getElementById(`tab-panel-${tabName}`);
  if (!panel) return;
  panel.classList.remove('is-tab-entering');
  // Force reflow so the class removal + re-add restarts the animation cleanly.
  void panel.offsetWidth;
  panel.classList.add('is-tab-entering');
  clearTimeout(panel._tabShimmerTimeout);
  panel._tabShimmerTimeout = setTimeout(() => {
    panel.classList.remove('is-tab-entering');
  }, 420);
}

document.addEventListener('DOMContentLoaded', init);

// ── On-screen keyboard (Steam Deck / iOS) handling ────────────────
// When the OSK opens, `window.visualViewport` shrinks. Scroll the currently
// focused input into the remaining visible area so users can see what they're
// typing instead of the keyboard covering the field.
(function setupVisualViewportOsk() {
  if (typeof window === 'undefined' || !window.visualViewport) return;
  const vv = window.visualViewport;
  let scrollScheduled = false;
  function scrollFocusedIntoView() {
    scrollScheduled = false;
    const active = document.activeElement;
    if (!active) return;
    const tag = active.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !active.isContentEditable) return;
    const rect = active.getBoundingClientRect();
    const vvBottom = vv.height + vv.offsetTop;
    // If the field is below the OSK-adjusted viewport, scroll it into view.
    if (rect.bottom > vvBottom - 12) {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  function schedule() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    // Wait one frame so the viewport metrics settle before measuring.
    requestAnimationFrame(scrollFocusedIntoView);
  }
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
})();

// ── Utility panel (topbar controls popover) ──────────────────────
// Wires the single hamburger trigger to a slide-in panel that dispatches
// actions to the (now hidden) legacy action buttons. Keeps all existing
// wiring intact — only routes clicks through the new surface.
(function setupUtilityPanel() {
  if (typeof document === 'undefined') return;
  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('utility-panel');
    const backdrop = document.getElementById('utility-panel-backdrop');
    const trigger = document.getElementById('utility-panel-trigger');
    const closeBtn = document.getElementById('utility-panel-close');
    const statusMirror = document.getElementById('utility-status-mirror');
    const themeLabel = document.getElementById('utility-theme-label');
    const downloadHint = document.getElementById('utility-download-hint');
    const versionFoot = document.getElementById('utility-foot-version');
    const brandVersion = document.getElementById('brand-version');
    const triggerDot = document.getElementById('utility-trigger-status-dot');

    if (!panel || !trigger || !backdrop) return;

    // The panel is authored inside #app-root for markup locality, but #app-root
    // has a `transform` on it — which makes it a containing block for any
    // position:fixed descendants. That would break the panel's viewport-fixed
    // slide-in. Reparent to document.body so it's fixed to the actual viewport.
    if (panel.parentNode !== document.body) document.body.appendChild(panel);
    if (backdrop.parentNode !== document.body) document.body.appendChild(backdrop);

    function openPanel() {
      panel.classList.add('is-visible');
      backdrop.classList.add('is-visible');
      trigger.setAttribute('aria-expanded', 'true');
      panel.setAttribute('aria-modal', 'true');
      syncStatusMirror();
      syncThemeLabel();
    }
    function closePanel() {
      panel.classList.remove('is-visible');
      backdrop.classList.remove('is-visible');
      trigger.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-modal', 'false');
    }
    trigger.addEventListener('click', () => {
      if (panel.classList.contains('is-visible')) closePanel();
      else openPanel();
    });
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    backdrop.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('is-visible')) closePanel();
    });

    // Mirror the top-bar status pills into the panel + update trigger dot.
    function syncStatusMirror() {
      if (!statusMirror) return;
      const rows = [
        { id: 'api-status-pill', label: 'API', valueId: 'catalog-status-label' },
        { id: 'ryujinx-status-chip', label: 'System · Ryujinx', valueId: null },
        { id: 'acnh-data-status-chip', label: 'Game', valueId: null },
      ];
      let overallState = 'is-ok';
      const html = rows.map((row) => {
        const source = document.getElementById(row.id);
        let stateClass = '';
        if (source) {
          // Source pills use is-ok / is-warn / is-bad (also legacy is-good / is-error).
          if (source.classList.contains('is-ok') || source.classList.contains('is-good')) stateClass = 'is-ok';
          else if (source.classList.contains('is-bad') || source.classList.contains('is-error')) stateClass = 'is-error';
          else if (source.classList.contains('is-warn')) stateClass = '';
        }
        if (stateClass === 'is-error') overallState = 'is-error';
        else if (stateClass === '' && overallState === 'is-ok') overallState = '';
        const valueEl = row.valueId ? document.getElementById(row.valueId) : null;
        const valueText = valueEl ? (valueEl.textContent || '').trim() : '';
        return `<div class="utility-status-row">
          <span class="utility-status-row-dot ${stateClass}"></span>
          <span class="utility-status-row-label">${row.label}</span>
          <span class="utility-status-row-value">${valueText}</span>
        </div>`;
      }).join('');
      statusMirror.innerHTML = html;

      if (triggerDot) {
        triggerDot.classList.remove('is-ok', 'is-error');
        if (overallState === 'is-ok') triggerDot.classList.add('is-ok');
        else if (overallState === 'is-error') triggerDot.classList.add('is-error');
      }
    }
    // Sync periodically so the panel status stays fresh while open,
    // and the trigger dot reflects overall health always.
    syncStatusMirror();
    setInterval(syncStatusMirror, 3000);

    // Server caches git fetch results for 15 min, so polling here is cheap.
    const updateBtn = panel.querySelector('[data-utility-action="update"]');
    if (updateBtn) {
      async function refreshRepoStatus() {
        const label = updateBtn.querySelector('.utility-action-label');
        try {
          const r = await fetch('/api/repo-status', { cache: 'no-store' });
          if (!r.ok) throw new Error(`Repo status failed with ${r.status}`);
          const data = await r.json();
          if (!data || !data.ok) throw new Error('Repo status unavailable');
          const behind = Number(data && data.behind || 0);
          if (behind > 0) {
            if (label) label.textContent = `Update ${data.branch}@${data.remote}`;
            updateBtn.title = `${behind} commit${behind === 1 ? '' : 's'} behind origin/${data.branch} (${data.local} → ${data.remote})`;
          } else {
            if (label) label.textContent = `Current ${data.branch}@${data.local}`;
            updateBtn.title = `Check and pull origin/${data.branch}`;
          }
        } catch (_) {
          if (label) label.textContent = 'Update unavailable';
          updateBtn.title = 'Repository status unavailable';
        }
      }
      refreshRepoStatus();
      setInterval(refreshRepoStatus, 15 * 60 * 1000);
    }

    function syncThemeLabel() {
      const isNight = document.body.dataset.theme === 'night';
      if (themeLabel) themeLabel.textContent = isNight ? 'Night Mode' : 'Day Mode';
      // Flip which animated theme icon is visible (day/night) to mirror the
      // legacy topbar theme toggle behavior.
      const themeBtn = panel.querySelector('[data-utility-action="theme"]');
      if (themeBtn) themeBtn.classList.toggle('is-night', isNight);
    }
    syncThemeLabel();

    // Show the deployed branch and commit in the footer.
    if (versionFoot) {
      fetch('/api/repo-status', { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data || !data.ok) return;
          const version = `${data.branch}@${data.local}`;
          versionFoot.textContent = `ACNH Live Editor · ${version}`;
          if (brandVersion) brandVersion.textContent = version;
        })
        .catch(() => {});
    }

    // Dispatch panel actions to the corresponding legacy button/element.
    panel.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-utility-action]');
      if (!btn) return;
      const action = btn.dataset.utilityAction;
      switch (action) {
        case 'reload':
          document.getElementById('reload-button')?.click();
          closePanel();
          break;
        case 'update':
          await runUpdateAction(btn);
          break;
        case 'test':
          toggleTestMode(btn);
          break;
        case 'loadsave':
          document.getElementById('open-backups-btn')?.click();
          closePanel();
          break;
        case 'download-assets':
          await runDownloadAssets(btn);
          break;
        case 'settings':
          document.getElementById('settings-button')?.click();
          closePanel();
          break;
        case 'theme':
          document.getElementById('theme-toggle')?.click();
          syncThemeLabel();
          break;
      }
    });

    // ── Test-mode inline pill toggle ─────────────────────────────
    // Selects the "off" or "live-ok" test-state option in the hidden legacy
    // menu, then reflects state on the panel button (pill + aria-pressed).
    const TEST_OFF_KEY = 'off';
    const TEST_ON_KEY  = 'live-ok';

    function detectTestModeOn() {
      return state.testDataMode === true;
    }

    function reflectTestPill() {
      const btn = panel.querySelector('[data-utility-action="test"]');
      if (!btn) return;
      const on = detectTestModeOn();
      const pill = btn.querySelector('#utility-test-pill');
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
      if (pill) pill.textContent = on ? 'ON' : 'OFF';
    }

    function toggleTestMode() {
      const on = detectTestModeOn();
      const nextKey = on ? TEST_OFF_KEY : TEST_ON_KEY;
      const opt = document.querySelector(`.test-state-option[data-test-payload-key="${nextKey}"]`);
      if (opt) opt.click();
      // Delay reflect so state has propagated.
      setTimeout(reflectTestPill, 30);
    }
    reflectTestPill();
    setInterval(reflectTestPill, 3000);

    // ── Download-Assets green-dot indicator ──────────────────────
    async function reflectDownloadDot() {
      const dot = document.getElementById('utility-download-dot');
      if (!dot || !('caches' in window)) return;
      try {
        const cache = await caches.open('acnh-villager-assets-v1');
        const keys = await cache.keys();
        dot.classList.toggle('is-ok', keys.length > 0);
        const hint = document.getElementById('utility-download-hint');
        if (hint) hint.textContent = keys.length > 0 ? `${keys.length} cached` : '';
      } catch (_) { /* ignore */ }
    }
    reflectDownloadDot();

    async function runUpdateAction(btn) {
      btn.classList.add('is-busy');
      const label = btn.querySelector('.utility-action-label');
      const original = label ? label.textContent : 'Update';
      if (label) label.textContent = 'Updating…';
      try {
        const res = await fetch('/api/update-local', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          if (label) label.textContent = 'Restarting…';
          const expectedCommit = data.commit;
          window.setTimeout(async () => {
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
              try {
                const statusResponse = await fetch(`/api/repo-status?t=${Date.now()}`, { cache: 'no-store' });
                const status = statusResponse.ok ? await statusResponse.json() : null;
                if (status && status.ok && status.branch === data.branch && status.local === expectedCommit) {
                  window.location.replace(`${window.location.pathname}?v=${expectedCommit}`);
                  return;
                }
              } catch (_) {}
              await new Promise((resolve) => window.setTimeout(resolve, 1000));
            }
            if (label) label.textContent = 'Restart failed';
            btn.classList.remove('is-busy');
          }, 2000);
        } else {
          if (label) label.textContent = 'Update failed';
          setTimeout(() => { if (label) label.textContent = original; btn.classList.remove('is-busy'); }, 2500);
        }
      } catch (_) {
        if (label) label.textContent = 'Update failed';
        setTimeout(() => { if (label) label.textContent = original; btn.classList.remove('is-busy'); }, 2500);
      }
    }

    async function runDownloadAssets(btn) {
      if (!('caches' in window)) {
        if (downloadHint) downloadHint.textContent = 'Cache API unavailable';
        return;
      }
      btn.classList.add('is-busy');
      const label = btn.querySelector('.utility-action-label');
      const original = label ? label.textContent : 'Download Assets';
      try {
        const villagers = Array.isArray(window.state?.villagers) ? window.state.villagers : [];
        // Also probe API for any known villagers list if state is empty
        const names = Array.from(new Set(villagers.map(v => v && v.name).filter(Boolean)));
        if (names.length === 0) {
          const res = await fetch('/api/bridge/read-villagers', { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const payload = data.payload || data;
            const bridgeVillagers = Array.isArray(payload.villagers) ? payload.villagers : [];
            bridgeVillagers.forEach(v => { if (v && v.name) names.push(v.name); });
          }
        }
        const cache = await caches.open('acnh-villager-assets-v1');
        const urls = [];
        names.forEach((n) => {
          const safe = String(n).trim().replace(/[^a-zA-Z0-9 _'\-]/g, '');
          if (!safe) return;
          urls.push(`/api/villager-icon/${encodeURIComponent(safe)}?v=4`);
          urls.push(`/api/villager-art/${encodeURIComponent(safe)}`);
        });
        let done = 0;
        for (const url of urls) {
          try {
            await cache.add(url);
          } catch (_) { /* ignore individual failures */ }
          done += 1;
          if (label) label.textContent = `Cached ${done}/${urls.length}`;
        }
        if (label) label.textContent = 'Assets cached';
        if (downloadHint) downloadHint.textContent = `${done} files stored locally`;
        reflectDownloadDot();
        setTimeout(() => {
          if (label) label.textContent = original;
          btn.classList.remove('is-busy');
        }, 2500);
      } catch (err) {
        if (label) label.textContent = 'Cache failed';
        setTimeout(() => {
          if (label) label.textContent = original;
          btn.classList.remove('is-busy');
        }, 2500);
      }
    }
  });
})();


async function init() {
  cacheDom();
  bindEvents();
  renderUiLoadingState();
  renderPresetBar();
  updateClock();

  await loadData();
  seedInventory();
  restoreLocalState();
  if (state.testDataMode && state.testPayloadKey !== DEFAULT_TEST_PAYLOAD_KEY) {
    await hydrateTestPayload(state.testPayloadKey);
  }
  applyTheme(false);
  renderAll();
  updateDataSnapshot();
  primeSelectedMusicSource();
  if (typeof initVillagersTab === 'function') initVillagersTab();
  const bootLoadingStart = performance.now();
  const minBootLoadingMs = 1200;
  const justReloaded = sessionStorage.getItem('justReloaded') === '1';
  const maxRetries = justReloaded ? 8 : 3;
  let bridgeConnected = false;
  let lastAttempt = 0;
  
  try {
    setUiLoading('boot', true);
    setUiLoading('player', true);
    setUiLoading('inventory', true);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lastAttempt = attempt;
      try {
        await refreshBridgeStatus(`Boot live sync (attempt ${attempt}/${maxRetries})`);
        // Check if bridge is actually connected
        bridgeConnected = state.bridge && state.bridge.connected;
        if (bridgeConnected) {
          break;
        } else if (attempt < maxRetries) {
          // Bridge sync completed but didn't connect, retry
          await new Promise((resolve) => window.setTimeout(resolve, 600));
        }
      } catch (error) {
        console.error(`Boot sync attempt ${attempt} failed:`, error);
        if (attempt < maxRetries) {
          await new Promise((resolve) => window.setTimeout(resolve, 600));
        }
      }
    }
    
    if (!bridgeConnected && justReloaded) {
      console.warn(`Bridge not connected after ${lastAttempt} attempts`);
    }
  } catch (error) {
    console.error('Boot initialization error:', error);
  } finally {
    sessionStorage.removeItem('justReloaded');
    const elapsed = performance.now() - bootLoadingStart;
    const remaining = minBootLoadingMs - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
    }
    setUiLoading('boot', false);
    setUiLoading('player', false);
    setUiLoading('inventory', false);
  }
  finishBoot();
}

function cacheDom() {
  el.loadingScreen = document.getElementById('loading-screen');
  el.appRoot = document.getElementById('app-root');
  el.dateDisplay = document.getElementById('date-display');
  el.timeDisplay = document.getElementById('time-display');

  el.catalogStatus = document.getElementById('api-status-pill');
  el.catalogStatusLabel = document.getElementById('catalog-status-label');
  el.playerSaveBtn = document.getElementById('player-save-btn');
  el.playerLoadBtn = document.getElementById('player-load-btn');
  el.bridgeStatusInline = document.getElementById('bridge-status-inline');
  el.ryujinxStatusChip = document.getElementById('ryujinx-status-chip');
  el.acnhDataStatusChip = document.getElementById('acnh-data-status-chip');
  el.bridgeStatus = document.getElementById('bridge-status');
  el.logPanelResizeHandle = document.getElementById('log-panel-resize-handle');
  el.ipDisplay = document.getElementById('ip-display');
  el.logConnectionIndicator = document.getElementById('log-connection-indicator');
  el.logConnectionIcon = document.getElementById('log-connection-icon');
  el.themeToggle = document.getElementById('theme-toggle');
  el.themeToggleIconDay = document.getElementById('theme-toggle-icon-day');
  el.themeToggleIconNight = document.getElementById('theme-toggle-icon-night');
  el.reloadButton = document.getElementById('reload-button');
  el.bridgeToggle = document.getElementById('bridge-toggle');
  el.logRefreshButton = document.getElementById('log-refresh-button');
  el.villagerRoster = document.getElementById('villager-roster');
  el.villagerCountBadge = document.getElementById('villager-count-badge');
  el.refreshVillagersBtn = document.getElementById('refresh-villagers-btn');
  el.testStateMenuWrap = document.querySelector('.topbar-test-menu-wrap');
  el.testStateMenuButton = document.getElementById('test-state-menu-button');
  el.testStateMenu = document.getElementById('test-state-menu');
  el.testStateOptions = Array.from(document.querySelectorAll('[data-test-payload-key]'));
  el.logTestPayloadVersion = document.getElementById('log-test-payload-version');
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
  el.injectMaxWallet = document.getElementById('inject-max-wallet');
  el.injectMaxBank = document.getElementById('inject-max-bank');
  el.injectMaxMiles = document.getElementById('inject-max-miles');
  el.playerAvatar = document.getElementById('player-avatar');
  el.pauseBridgeButton = document.getElementById('pause-bridge-button');
  el.writeBridgeButton = document.getElementById('write-bridge-button');

  el.selectedItemArtbox = document.getElementById('selected-item-artbox');
  el.selectedPreviewImage = document.getElementById('selected-preview-image');
  el.selectedItemName = document.getElementById('selected-item-name');
  el.openSelectedSearchButton = null; // replaced by inv-quick-search input
  el.invQuickSearch = document.getElementById('inv-quick-search');
  el.invQuickSearchResults = document.getElementById('inv-quick-search-results');
  el.copySelectedButton = document.getElementById('copy-selected-button');
  el.copySelectedIcon = document.getElementById('copy-selected-icon');
  el.pasteSelectedButton = document.getElementById('paste-selected-button');

  el.playerPanel = document.getElementById('player-panel');
  el.playerPanelEnd = document.getElementById('player-panel-end');
  el.cheatsRibbon = document.getElementById('cheats-ribbon');
  el.cheatsRibbonDrawer = document.getElementById('cheats-ribbon-drawer');
  el.cheatsRibbonToggle = document.getElementById('cheats-ribbon-toggle');
  el.selectedItemSticky = document.getElementById('selected-item-sticky');
  el.selectedItemStickyImg = document.getElementById('selected-item-sticky-img');
  el.selectedItemStickyName = document.getElementById('selected-item-sticky-name');

  // Cheats sidebar ribbon toggle + vertical drag (mirrors music ribbon drag)
  if (el.cheatsRibbon && el.cheatsRibbonToggle && el.cheatsRibbonDrawer) {
    const cheatsDrag = { active: false, moved: false, suppressClick: false, pointerId: null, startY: 0, startTopVh: 32 };

    function togglePanel() {
      const isOpen = el.cheatsRibbon.classList.toggle('is-open');
      el.cheatsRibbonToggle.setAttribute('aria-expanded', String(isOpen));
      el.cheatsRibbonDrawer.setAttribute('aria-hidden', String(!isOpen));
      el.cheatsRibbonToggle.setAttribute(
        'aria-label',
        isOpen ? 'Close cheats menu' : 'Open cheats menu'
      );
    }

    el.cheatsRibbonToggle.addEventListener('click', (event) => {
      if (cheatsDrag.suppressClick) {
        cheatsDrag.suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      togglePanel();
    });

    el.cheatsRibbonToggle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      cheatsDrag.pointerId = event.pointerId;
      cheatsDrag.active = true;
      cheatsDrag.moved = false;
      cheatsDrag.suppressClick = false;
      cheatsDrag.startY = event.clientY;
      const currentTop = parseFloat(el.cheatsRibbon.style.top) || 32;
      cheatsDrag.startTopVh = currentTop;
      if (typeof el.cheatsRibbonToggle.setPointerCapture === 'function') {
        el.cheatsRibbonToggle.setPointerCapture(event.pointerId);
      }
    });

    el.cheatsRibbonToggle.addEventListener('pointermove', (event) => {
      if (!cheatsDrag.active || cheatsDrag.pointerId !== event.pointerId) return;
      const deltaY = event.clientY - cheatsDrag.startY;
      if (!cheatsDrag.moved && Math.abs(deltaY) < 6) return;
      if (!cheatsDrag.moved) {
        cheatsDrag.moved = true;
        cheatsDrag.suppressClick = true;
        el.cheatsRibbon.classList.add('is-dragging');
      }
      const vh = Math.max(window.innerHeight || 1, 1);
      const nextVh = Math.min(90, Math.max(8, cheatsDrag.startTopVh + ((deltaY / vh) * 100)));
      el.cheatsRibbon.style.top = `${nextVh.toFixed(2)}vh`;
      event.preventDefault();
    });

    function endDrag(event) {
      if (!cheatsDrag.active || cheatsDrag.pointerId !== event.pointerId) return;
      el.cheatsRibbon.classList.remove('is-dragging');
      if (typeof el.cheatsRibbonToggle.releasePointerCapture === 'function') {
        try { el.cheatsRibbonToggle.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      cheatsDrag.active = false;
      cheatsDrag.pointerId = null;
    }
    el.cheatsRibbonToggle.addEventListener('pointerup', endDrag);
    el.cheatsRibbonToggle.addEventListener('pointercancel', endDrag);
  }

  // Sticky selected-item bar — show when artbox scrolled off, hide when panel ends
  if (el.selectedItemArtbox && el.playerPanelEnd && el.selectedItemSticky) {
    let artboxVisible = true;
    let panelEndVisible = true;
    const updateStickyBar = () => {
      const hasItem = el.selectedItemStickyName && el.selectedItemStickyName.textContent !== 'Empty slot';
      const show = hasItem && !artboxVisible;
      el.selectedItemSticky.hidden = !show;
    };
    new IntersectionObserver(entries => {
      artboxVisible = entries[0].isIntersecting;
      updateStickyBar();
    }, { threshold: 0.1 }).observe(el.selectedItemArtbox);
    new IntersectionObserver(entries => {
      panelEndVisible = entries[0].isIntersecting;
      updateStickyBar();
    }, { threshold: 0 }).observe(el.playerPanelEnd);
    window._updateStickyBar = updateStickyBar;

    // Sticky pill click → trigger artbox click (opens edit modal)
    el.selectedItemSticky.addEventListener('click', () => {
      if (el.selectedItemArtbox) el.selectedItemArtbox.click();
    });
  }

  el.inventoryCard = document.getElementById('inventory-card');
  el.inventoryGrid = document.getElementById('inventory-grid');
  el.shortcutColumn = document.getElementById('shortcut-column');
  el.quickCheatControls = document.getElementById('quick-cheat-controls');

  el.deployButton = document.getElementById('deploy-button');
  el.connectBridgeDot = document.getElementById('connect-bridge-dot');
  el.deployToast = document.getElementById('deploy-toast');
  el.settingsButton = document.getElementById('settings-button');
  el.settingsModal = document.getElementById('settings-modal');
  el.settingsClose = document.getElementById('settings-close');
  el.settingsDebugOutput = document.getElementById('settings-debug-output');
  el.settingsCatalogOutput = document.getElementById('settings-catalog-output');
  el.settingsDebugRefresh = document.getElementById('settings-debug-refresh');
  el.settingsGithubButton = document.getElementById('settings-github-button');

  el.presetManagerModal = document.getElementById('preset-manager-modal');

  el.backupsModal = document.getElementById('backups-modal');
  el.backupsList = document.getElementById('backups-list');
  el.backupsCreateBtn = document.getElementById('backups-create-btn');
  el.backupsStatusMsg = document.getElementById('backups-status-msg');
  el.openBackupsBtn = document.getElementById('open-backups-btn');

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

  el.villagerModal = document.getElementById('villager-modal');
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

// ── Preset Manager ─────────────────────────────────────────────────────────

const BUILTIN_PRESET_KEYS = ['tools','gold','materials','dye','trees','bushes','roses','tulips'];
const BUILTIN_PRESET_LABELS = { tools:'Tools', gold:'Gold', materials:'Materials', dye:'Dye', trees:'Trees', bushes:'Bushes', roses:'Roses', tulips:'Tulips' };
const BUILTIN_PRESET_COLORS = {
  tools:     { bg: 'rgba(255,180,60,0.13)',  border: 'rgba(255,180,60,0.30)'  },
  gold:      { bg: 'rgba(255,215,0,0.13)',   border: 'rgba(255,215,0,0.30)'   },
  materials: { bg: 'rgba(98,214,111,0.11)',  border: 'rgba(98,214,111,0.28)'  },
  dye:       { bg: 'rgba(200,90,220,0.11)',  border: 'rgba(200,90,220,0.28)'  },
  trees:     { bg: 'rgba(80,180,80,0.11)',   border: 'rgba(80,180,80,0.26)'   },
  bushes:    { bg: 'rgba(60,160,100,0.11)',  border: 'rgba(60,160,100,0.26)'  },
  roses:     { bg: 'rgba(220,60,80,0.11)',   border: 'rgba(220,60,80,0.28)'   },
  tulips:    { bg: 'rgba(255,120,160,0.11)', border: 'rgba(255,120,160,0.28)' },
};

function getPresetChipStyle(key) {
  if (BUILTIN_PRESET_COLORS[key]) {
    const c = BUILTIN_PRESET_COLORS[key];
    return `background:${c.bg};border-color:${c.border};`;
  }
  if (key.startsWith('custom:')) {
    const cp = state.customPresets.find(p => p.id === key.slice(7));
    if (cp && cp.swatch) return `background:${cp.swatch.rgba};border-color:${cp.swatch.color}44;`;
  }
  return '';
}
const PM_SWATCHES = [
  { label:'Amber',  color:'#ffca50', rgba:'rgba(255,202,80,0.13)'  },
  { label:'Green',  color:'#62d66f', rgba:'rgba(98,214,111,0.13)'  },
  { label:'Blue',   color:'#64a0ff', rgba:'rgba(100,160,255,0.13)' },
  { label:'Purple', color:'#c85adc', rgba:'rgba(200,90,220,0.13)'  },
  { label:'Pink',   color:'#ff78a0', rgba:'rgba(255,120,160,0.13)' },
  { label:'Red',    color:'#ff6446', rgba:'rgba(255,100,70,0.13)'  },
  { label:'Gold',   color:'#ffd700', rgba:'rgba(255,215,0,0.13)'   },
  { label:'Grey',   color:'#b4b4b4', rgba:'rgba(180,180,180,0.10)' },
];
let pmSelectedSwatch = PM_SWATCHES[0];
let pmItemRows = [];

function savePinnedPresets() {
  localStorage.setItem('acnh-pinned-presets', JSON.stringify(state.pinnedPresets));
}

function saveCustomPresets() {
  localStorage.setItem('acnh-custom-presets', JSON.stringify(state.customPresets));
}

function getPresetLabel(key) {
  if (BUILTIN_PRESET_LABELS[key]) return BUILTIN_PRESET_LABELS[key];
  if (key.startsWith('custom:')) {
    const cp = state.customPresets.find(p => p.id === key.slice(7));
    return cp ? cp.name : key;
  }
  return key;
}

function renderPresetBar() {
  // Show/hide built-in buttons
  BUILTIN_PRESET_KEYS.forEach(key => {
    const btn = document.getElementById(`preset-${key}-btn`);
    if (btn) btn.classList.toggle('preset-btn-hidden', !state.pinnedPresets.includes(key));
  });
  // Render custom preset buttons dynamically
  const container = document.getElementById('preset-custom-bar-items');
  if (!container) return;
  container.innerHTML = '';
  state.pinnedPresets.filter(k => k.startsWith('custom:')).forEach(key => {
    const id = key.slice(7);
    const cp = state.customPresets.find(p => p.id === id);
    if (!cp) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-btn preset-btn preset-btn-custom';
    btn.dataset.preset = key;
    btn.id = `preset-${key}-btn`;
    btn.textContent = cp.name;
    if (cp.swatch) {
      btn.style.background = cp.swatch.rgba;
      btn.style.borderColor = cp.swatch.color + '44';
    }
    bindPresetLongPress(btn);
    container.appendChild(btn);
  });
}

function bindPresetLongPress(btn) {
  let lpTimer = null;
  let lpFired = false;
  btn.addEventListener('pointerdown', () => {
    lpFired = false;
    lpTimer = setTimeout(() => {
      lpFired = true;
      btn.classList.remove('is-holding');
      const key = btn.dataset.preset;
      const label = getPresetLabel(key);
      state.pinnedPresets = state.pinnedPresets.filter(k => k !== key);
      savePinnedPresets();
      renderPresetBar();
      showToast(`✓ "${label}" removed — tap + to re-add`);
    }, 650);
    btn.classList.add('is-holding');
  });
  btn.addEventListener('pointerup', () => {
    clearTimeout(lpTimer);
    btn.classList.remove('is-holding');
    lpFired = false;
  });
  btn.addEventListener('pointerleave', () => {
    clearTimeout(lpTimer);
    btn.classList.remove('is-holding');
    lpFired = false;
  });
  btn.addEventListener('dblclick', () => {
    if (!lpFired) applyInventoryPreset(btn.dataset.preset);
  });
  btn.addEventListener('contextmenu', e => e.preventDefault());
  const label = getPresetLabel(btn.dataset.preset);
  btn.title = `Double-click to inject "${label}" preset · Hold to remove`;
}

function initPresetBar() {
  // Attach long-press + click to all static built-in buttons
  BUILTIN_PRESET_KEYS.forEach(key => {
    const btn = document.getElementById(`preset-${key}-btn`);
    if (btn) bindPresetLongPress(btn);
  });
  // "+" opens preset manager
  const customBtn = document.getElementById('preset-custom-btn');
  if (customBtn) {
    customBtn.addEventListener('click', openPresetManagerModal);
    customBtn.title = 'Manage presets — add or remove from the bar';
  }
}

function openPresetManagerModal() {
  if (!el.presetManagerModal) return;
  pmItemRows = [];
  pmSelectedSwatch = PM_SWATCHES[0];
  renderPresetManagerModal();
  openModal(el.presetManagerModal);
  initPresetItemSearch();
  initPresetSaveBtn();
  const closeBtn = document.getElementById('preset-manager-close');
  if (closeBtn) closeBtn.onclick = () => {
    const portal = document.getElementById('pm-suggestions-portal');
    if (portal) portal.remove();
    closeModal(el.presetManagerModal);
  };
}

function renderPresetManagerModal() {
  const pinnedContainer = document.getElementById('pm-pinned-chips');
  const availableContainer = document.getElementById('pm-available-chips');

  // Pinned chips
  if (pinnedContainer) {
    pinnedContainer.innerHTML = '';
    if (state.pinnedPresets.length === 0) {
      pinnedContainer.innerHTML = '<span class="pm-empty">No presets pinned</span>';
    } else {
      state.pinnedPresets.forEach(key => {
        const label = getPresetLabel(key);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pm-chip pm-chip-pinned';
        chip.dataset.preset = key;
        const style = getPresetChipStyle(key);
        if (style) chip.style.cssText = style;
        chip.innerHTML = `${escapeHtml(label)} <span class="pm-chip-x">✕</span>`;
        chip.addEventListener('click', () => {
          state.pinnedPresets = state.pinnedPresets.filter(k => k !== key);
          savePinnedPresets();
          renderPresetBar();
          renderPresetManagerModal();
        });
        pinnedContainer.appendChild(chip);
      });
    }
  }

  // Available (unpinned) chips
  if (availableContainer) {
    availableContainer.innerHTML = '';
    const allKeys = [
      ...BUILTIN_PRESET_KEYS,
      ...state.customPresets.map(p => `custom:${p.id}`),
    ];
    const unpinned = allKeys.filter(k => !state.pinnedPresets.includes(k));
    if (unpinned.length === 0) {
      availableContainer.innerHTML = '<span class="pm-empty">All presets are on the shortcut bar</span>';
    } else {
      unpinned.forEach(key => {
        const label = getPresetLabel(key);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pm-chip pm-chip-available';
        const style = getPresetChipStyle(key);
        if (style) chip.style.cssText = style;
        chip.innerHTML = `<span class="pm-chip-plus">+</span> ${escapeHtml(label)}`;
        chip.addEventListener('click', () => {
          if (!state.pinnedPresets.includes(key)) {
            state.pinnedPresets.push(key);
            savePinnedPresets();
            renderPresetBar();
            renderPresetManagerModal();
          }
        });
        availableContainer.appendChild(chip);
      });
    }
  }

  renderPresetSwatches();
}

function renderPresetSwatches() {
  const container = document.getElementById('pm-swatches');
  if (!container) return;
  container.innerHTML = '';
  PM_SWATCHES.forEach(sw => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pm-swatch' + (sw === pmSelectedSwatch ? ' is-selected' : '');
    btn.style.setProperty('--sw-color', sw.color);
    btn.title = sw.label;
    btn.addEventListener('click', () => {
      pmSelectedSwatch = sw;
      renderPresetSwatches();
    });
    container.appendChild(btn);
  });
}

function initPresetItemSearch() {
  const queryInput = document.getElementById('pm-item-query');
  const addBtn = document.getElementById('pm-item-add-btn');
  if (!queryInput || !addBtn) return;

  // Remove old listeners by replacing elements
  const newQuery = queryInput.cloneNode(true);
  queryInput.parentNode.replaceChild(newQuery, queryInput);
  const newAdd = addBtn.cloneNode(true);
  addBtn.parentNode.replaceChild(newAdd, addBtn);

  // True DOM portal — append to document.body to escape backdrop-filter containing block on .modal-card
  const oldPortal = document.getElementById('pm-suggestions-portal');
  if (oldPortal) oldPortal.remove();
  const portal = document.createElement('div');
  portal.id = 'pm-suggestions-portal';
  portal.className = 'pm-suggestions';
  document.body.appendChild(portal);

  function positionPortal() {
    const rect = newQuery.getBoundingClientRect();
    portal.style.left = rect.left + 'px';
    portal.style.top = (rect.bottom + 4) + 'px';
    portal.style.width = rect.width + 'px';
  }

  function clearPortal() { portal.innerHTML = ''; }

  let pmSearchDebounce = null;

  newQuery.addEventListener('input', () => {
    const q = newQuery.value.trim();
    clearPortal();
    clearTimeout(pmSearchDebounce);
    if (q.length < 2) return;
    positionPortal();
    pmSearchDebounce = setTimeout(async () => {
      let items = [];
      try {
        const params = new URLSearchParams({ q, limit: '15' });
        const res = await apiFetch(`/api/items/search?${params}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        }
      } catch (_) { /* silent */ }
      if (newQuery.value.trim() !== q) return; // stale
      clearPortal();
      positionPortal();
      items.slice(0, 15).forEach(item => {
        const div = document.createElement('div');
        div.className = 'pm-suggestion-item';
        const img = document.createElement('img');
        img.className = 'pm-suggestion-icon';
        img.src = item.icon_url ? escapeHtml(resolveAppUrl(item.icon_url)) : '';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.loading = 'lazy';
        if (!item.icon_url) img.style.visibility = 'hidden';
        const name = document.createElement('span');
        name.className = 'pm-suggestion-name';
        name.textContent = item.name;
        div.appendChild(img);
        div.appendChild(name);
        const selectItem = e => {
          e.preventDefault();
          newQuery.value = item.name;
          clearPortal();
        };
        div.addEventListener('mousedown', selectItem);
        div.addEventListener('touchstart', selectItem, { passive: false });
        portal.appendChild(div);
      });
    }, 220);
  });

  newQuery.addEventListener('focus', positionPortal);
  newQuery.addEventListener('blur', () => {
    // Delay longer than a touchstart so mobile tap-to-select fires before portal clears
    setTimeout(clearPortal, 220);
  });

  // Reposition when the modal body scrolls so the dropdown tracks the input
  const pmBody = document.querySelector('.pm-body');
  if (pmBody) pmBody.addEventListener('scroll', () => {
    if (portal.children.length) positionPortal();
  }, { passive: true });

  newAdd.addEventListener('click', () => {
    const itemId = newQuery.value.trim();
    if (!itemId) return;
    if (pmItemRows.length >= 40) { showToast('✗ Max 40 slots'); return; }
    const qtyInput = document.getElementById('pm-item-qty');
    const qty = Math.max(1, Math.min(99, parseInt(qtyInput?.value || '1', 10)));
    pmItemRows.push({ itemId, count: qty, uses: 0, flag0: 0, flag1: 0 });
    newQuery.value = '';
    if (qtyInput) qtyInput.value = '1';
    clearPortal();
    renderPresetItemList();
  });
}

function renderPresetItemList() {
  const container = document.getElementById('pm-item-list');
  if (!container) return;
  container.innerHTML = '';
  if (pmItemRows.length === 0) {
    container.innerHTML = '<span class="pm-empty">No items added yet</span>';
    return;
  }
  pmItemRows.forEach((row, i) => {
    const div = document.createElement('div');
    div.className = 'pm-item-row';
    div.innerHTML = `
      <span class="pm-item-name">${escapeHtml(row.itemId)}</span>
      <span class="pm-item-qty">×${row.count}</span>
      <button type="button" class="pm-item-remove" aria-label="Remove">✕</button>
    `;
    div.querySelector('.pm-item-remove').addEventListener('click', () => {
      pmItemRows.splice(i, 1);
      renderPresetItemList();
    });
    container.appendChild(div);
  });
}

function initPresetSaveBtn() {
  const saveBtn = document.getElementById('pm-save-btn');
  if (!saveBtn) return;
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  newSave.addEventListener('click', () => {
    const nameInput = document.getElementById('pm-new-name');
    const name = nameInput?.value.trim();
    if (!name) { showToast('✗ Enter a preset name'); return; }
    if (pmItemRows.length === 0) { showToast('✗ Add at least one item'); return; }
    const id = `cp_${Date.now()}`;
    state.customPresets.push({ id, name, swatch: pmSelectedSwatch, slots: [...pmItemRows] });
    saveCustomPresets();
    state.pinnedPresets.push(`custom:${id}`);
    savePinnedPresets();
    renderPresetBar();
    pmItemRows = [];
    pmSelectedSwatch = PM_SWATCHES[0];
    if (nameInput) nameInput.value = '';
    renderPresetManagerModal();
    renderPresetItemList();
    showToast(`✓ Preset "${escapeHtml(name)}" saved`);
  });
}

// ── End Preset Manager ──────────────────────────────────────────────────────

function bindEvents() {
  if (el.deployButton) el.deployButton.addEventListener('click', handleConnectBridgeClick);
  if (el.playerLoadBtn) el.playerLoadBtn.addEventListener('click', handlePlayerLoadClick);
  if (el.playerSaveBtn) el.playerSaveBtn.addEventListener('click', handlePlayerSaveClick);
  initPresetBar();
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
  if (el.logPanelResizeHandle) {
    el.logPanelResizeHandle.addEventListener('pointerdown', handleLogPanelResizeStart);
  }
  if (el.themeToggle) {
    el.themeToggle.addEventListener('click', toggleTheme);
  }
  if (el.reloadButton) {
    el.reloadButton.addEventListener('click', handleReloadClick);
  }
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

  if (el.refreshVillagersBtn) {
    el.refreshVillagersBtn.addEventListener('click', () => {
      refreshBridgeVillagers();
    });
  }

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
      const selectedTrack = getSelectedMusicTrack();
      if (tryPlayFallbackAudioSource(selectedTrack)) {
        return;
      }

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
  bindBackupEvents();

  if (el.pauseBridgeButton) {
    el.pauseBridgeButton.addEventListener('click', toggleBridgePoll);
  }

  // inv-quick-search: inline search input with direct slot assignment
  initInvQuickSearch();
  el.selectedItemArtbox.addEventListener('click', () => openItemModalForSelectedSlot());

  if (el.copySelectedButton) {
    el.copySelectedButton.addEventListener('click', handleSelectedClipboardButton);
  }
  if (el.pasteSelectedButton) {
    el.pasteSelectedButton.addEventListener('click', pasteCopiedSlotPayload);
  }

  el.modalSearchInput.addEventListener('input', (event) => {
    state.modalSearchQuery = event.target.value || '';
    state.modalSearchOpen = true;
    queueModalSearch();
  });

  el.modalSearchInput.addEventListener('focus', () => {
    state.modalSearchOpen = true;
    queueModalSearch(true);
  });

  bindVillagerCardEvents();

  if (el.modalSearchStack) {
    el.modalSearchStack.addEventListener('focusin', () => {
      state.modalSearchOpen = true;
      queueModalSearch(true);
    });

    // Note: intentionally do NOT collapse the results list on focusout.
    // On touch devices, dismissing the on-screen keyboard blurs the search
    // input, which previously auto-closed the list mid-scroll. The list now
    // stays open until an item is assigned, the modal closes, or ESC is
    // pressed on the search input.
    el.modalSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        state.modalSearchOpen = false;
        renderItemModalResults();
        el.modalSearchInput.blur();
      }
    });
  }

  [el.modalInputCount, el.modalInputUses, el.modalInputFlag0, el.modalInputFlag1].forEach((input) => {
    input.addEventListener('input', renderItemModalPayload);
    input.addEventListener('change', queueItemModalCommit);
    input.addEventListener('blur', queueItemModalCommit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        queueItemModalCommit();
      }
    });
  });

  el.modalSearchFocusButton.addEventListener('click', focusItemSearch);
  el.clearItemButton.addEventListener('click', clearSelectedSlot);

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
      const nextTab = button.dataset.tab;
      if (nextTab === state.activeTab) return;
      state.activeTab = nextTab;
      renderTabs();
      playTabEnterShimmer(nextTab);
      persistLocalState();
    });
  });

  if (el.bridgeToggle) {
    el.bridgeToggle.addEventListener('click', () => {
      refreshBridgeStatus('Bridge status refreshed');
    });
  }

  el.logRefreshButton.addEventListener('click', () => {
    refreshBridgeStatus('Status log refreshed');
  });

  if (el.testStateMenuButton) {
    el.testStateMenuButton.addEventListener('click', () => {
      toggleTestStateMenu();
    });
  }

  if (Array.isArray(el.testStateOptions)) {
    el.testStateOptions.forEach((optionButton) => {
      optionButton.addEventListener('click', async () => {
        const payloadKey = String(optionButton.getAttribute('data-test-payload-key') || '').trim();
        await selectTestStatePayload(payloadKey || DEFAULT_TEST_PAYLOAD_KEY, true);
        closeTestStateMenu();
      });
    });
  }

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId === 'villager-modal' && typeof closeVillagerModal === 'function') {
        closeVillagerModal();
      } else {
        const modal = document.getElementById(modalId);
        closeModal(modal);
      }
    });
  });

  // Backdrop close — only close when BOTH pointerdown and click originated
  // directly on the backdrop. Prevents accidental closes when the on-screen
  // keyboard dismisses (which can synthesize a click on the underlying node)
  // or when a drag/tap that started inside the card ends on the backdrop.
  [el.settingsModal, el.playerModal, el.itemModal, el.backupsModal, el.presetManagerModal].forEach((modal) => {
    if (!modal) return;
    let backdropPointerDown = false;
    modal.addEventListener('pointerdown', (event) => {
      backdropPointerDown = event.target === modal;
    });
    modal.addEventListener('click', (event) => {
      const wasBackdrop = backdropPointerDown;
      backdropPointerDown = false;
      if (wasBackdrop && event.target === modal) closeModal(modal);
    });
  });

  if (el.villagerModal) {
    el.villagerModal.addEventListener('click', (event) => {
      if (event.target === el.villagerModal && typeof closeVillagerModal === 'function') closeVillagerModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeTestStateMenu();
      closeModal(el.settingsModal);
      closeModal(el.playerModal);
      closeModal(el.itemModal);
      closeModal(el.backupsModal);
      closeModal(el.presetManagerModal);
      if (el.villagerModal && !el.villagerModal.classList.contains('hidden') && typeof closeVillagerModal === 'function') {
        closeVillagerModal();
      }
    }
  });

  document.addEventListener('pointerdown', (event) => {
    registerMusicInteraction();

    if (isTestStateMenuOpen() && el.testStateMenuWrap && !el.testStateMenuWrap.contains(event.target)) {
      closeTestStateMenu();
    }

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
  state.bridgePollIntervalId = window.setInterval(pollBridgeStatus, 4000);
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
  return [el.settingsModal, el.playerModal, el.itemModal, el.backupsModal, el.villagerModal, el.presetManagerModal].some((modal) => {
    return modal && !modal.classList.contains('hidden');
  });
}

// Interaction gate — returns true when a background refresh would clobber
// active user input (open modal, focused input/textarea/select).
// Consumed by pollBridgeStatus.
function isUserInteracting() {
  if (hasOpenModal()) return true;
  const active = document.activeElement;
  if (active && active !== document.body) {
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (active.isContentEditable) return true;
  }
  return false;
}

function bindVillagerCardEvents() {
  const cards = document.querySelectorAll('.villager-card');
  cards.forEach((card) => {
    card.addEventListener('click', handleVillagerCardClick);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleVillagerCardClick.call(card);
      }
    });
  });
}

function handleVillagerCardClick(event) {
  const slot = this.getAttribute('data-villager-slot');
  if (!slot) return;
  
  const slotIndex = parseInt(slot, 10);
  if (isNaN(slotIndex) || !Array.isArray(state.villagers) || slotIndex >= state.villagers.length) return;
  
  const villager = state.villagers[slotIndex];
  if (!villager || villager.empty) return;
  
  if (typeof openVillagerModal === 'function') {
    openVillagerModal(villager);
  }
}

// ── Inventory quick-search (inline assign, no modal) ──────────────────────
let _invQsDebounceId = null;
let _invQsBlurTimerId = null;

function initInvQuickSearch() {
  const input = el.invQuickSearch;
  const results = el.invQuickSearchResults;
  if (!input || !results) return;

  input.addEventListener('input', () => {
    clearTimeout(_invQsDebounceId);
    _invQsDebounceId = setTimeout(() => runInvQuickSearch(input.value), 200);
  });

  input.addEventListener('focus', () => {
    clearTimeout(_invQsBlurTimerId);
    if (input.value.trim()) {
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
  });

  input.addEventListener('blur', () => {
    _invQsBlurTimerId = setTimeout(() => {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }, 180);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.blur();
    }
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
    const itemsResponse = await apiFetch('/api/items', { cache: 'no-store' });
    if (itemsResponse.ok) {
      const items = await itemsResponse.json();
      state.items = normalizeCatalogItems(items);
      rememberCatalogItems(state.items);
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const catalogStatusResponse = await apiFetch('/api/catalog/status', { cache: 'no-store' });
    if (catalogStatusResponse.ok) {
      syncCatalogStatus(await catalogStatusResponse.json());
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const musicResponse = await apiFetch('/api/music/library', { cache: 'no-store' });
    if (musicResponse.ok) {
      syncMusicLibrary(await musicResponse.json());
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const statusResponse = await apiFetch('/api/status', { cache: 'no-store' });
    if (statusResponse.ok) {
      syncBridgeStatus(await statusResponse.json());
      if (state.bridge.connected) {
        await refreshBridgeInventory({ reason: 'Loaded inventory from bridge', force: true });
      }
    }
  } catch (error) {
    console.error(error);
  }
}

function seedInventory() {
  if (Array.isArray(state.inventory) && state.inventory.length === TOTAL_SLOTS) {
    return;
  }

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
  state.selectedSlotIndex = findFirstEmptySlotIndex(state.inventory);
}

function findFirstEmptySlotIndex(slots) {
  const list = Array.isArray(slots) ? slots : [];
  const emptyIndex = list.findIndex((entry) => !entry || !entry.item);

  if (emptyIndex >= 0) {
    return emptyIndex;
  }

  return 0;
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

function normalizeBridgeHex(value) {
  const raw = String(value || '').trim();
  if (!raw) return '00000000';

  if (/^0x[0-9a-f]+$/i.test(raw)) {
    const parsed = Number.parseInt(raw.slice(2), 16);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed.toString(16).toUpperCase().padStart(8, '0');
    }
  }

  if (/^[0-9a-f]{1,8}$/i.test(raw)) {
    return raw.toUpperCase().padStart(8, '0');
  }

  return '00000000';
}

function deriveHexFromItem(item) {
  if (!item) return '00000000';
  return normalizeBridgeHex(item.file_name || item.name);
}

function normalizeItemLookup(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPlayerDataHash() {
  return JSON.stringify([state.player.name, state.player.town, state.player.wallet, state.player.bank, state.player.miles]);
}

function getInventoryHash() {
  return JSON.stringify(state.inventory.map(slot => [slot.itemId, slot.count, slot.uses, slot.flag0, slot.flag1]));
}

function hasPlayerDataChanged() {
  const current = getPlayerDataHash();
  return current !== prevDataSnapshot.playerHash;
}

function hasInventoryChanged() {
  const current = getInventoryHash();
  return current !== prevDataSnapshot.inventoryHash;
}

function updateDataSnapshot() {
  prevDataSnapshot.playerHash = getPlayerDataHash();
  prevDataSnapshot.inventoryHash = getInventoryHash();
}

function applyUpdateFade(element) {
  if (!element) return;
  element.classList.remove('is-updating');
  void element.offsetWidth;
  element.classList.add('is-updating');
}

function renderAll() {
  renderLogPanelSize();
  renderThemeToggle();
  applyTestDataUiState();
  renderBridge();
  renderMusic();
  renderPlayer();
  renderBridgePollButton();
  renderQuickCheatButtons();
  renderShortcutButtons();
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderTabs();
  renderVillagers();
  renderDerivedPanels();
  renderItemModal();
}

function renderDerivedPanels() {
  renderWorkspacePanels();
  renderSettingsDebug();
}

function getDefaultTestPayload() {
  return JSON.parse(JSON.stringify(DEFAULT_TEST_PAYLOAD));
}

function getTestPayloadOption(payloadKey) {
  const key = String(payloadKey || DEFAULT_TEST_PAYLOAD_KEY).trim();
  return TEST_PAYLOAD_OPTION_DEFS[key] || TEST_PAYLOAD_OPTION_DEFS[DEFAULT_TEST_PAYLOAD_KEY];
}

function isTestStateMenuOpen() {
  return Boolean(el.testStateMenuWrap && el.testStateMenuWrap.classList.contains('is-open'));
}

function openTestStateMenu() {
  if (!el.testStateMenuWrap || !el.testStateMenu || !el.testStateMenuButton) return;
  el.testStateMenuWrap.classList.add('is-open');
  el.testStateMenu.setAttribute('aria-hidden', 'false');
  el.testStateMenuButton.setAttribute('aria-expanded', 'true');
}

function closeTestStateMenu() {
  if (!el.testStateMenuWrap || !el.testStateMenu || !el.testStateMenuButton) return;
  el.testStateMenuWrap.classList.remove('is-open');
  el.testStateMenu.setAttribute('aria-hidden', 'true');
  el.testStateMenuButton.setAttribute('aria-expanded', 'false');
}

function toggleTestStateMenu() {
  if (isTestStateMenuOpen()) {
    closeTestStateMenu();
    return;
  }
  openTestStateMenu();
}

function mergeTestPayloadPayload(payload) {
  const fallback = getDefaultTestPayload();
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const incomingMeta = payload.meta && typeof payload.meta === 'object' ? payload.meta : null;
  const incomingCatalog = payload.catalog && typeof payload.catalog === 'object' ? payload.catalog : null;
  const incomingBridge = payload.bridge && typeof payload.bridge === 'object' ? payload.bridge : null;

  return {
    meta: {
      ...fallback.meta,
      ...(incomingMeta || {})
    },
    catalog: {
      ...fallback.catalog,
      ...(incomingCatalog || {})
    },
    bridge: {
      ...fallback.bridge,
      ...(incomingBridge || {})
    }
  };
}

async function hydrateTestPayload(payloadKey) {
  const option = getTestPayloadOption(payloadKey);
  if (!option.path) {
    state.testPayload = null;
    state.testPayloadLoaded = false;
    return false;
  }

  try {
    const response = await fetch(option.path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to load test payload (${response.status})`);
    }

    const parsed = await response.json();
    state.testPayload = mergeTestPayloadPayload(parsed);
    state.testPayloadLoaded = true;
    return true;
  } catch (error) {
    console.warn(error);
    state.testPayload = getDefaultTestPayload();
    state.testPayloadLoaded = false;
    return false;
  }
}

function renderTestPayloadVersionStamp() {
  if (!el.logTestPayloadVersion) return;

  if (!state.testDataMode || !state.testPayload || !state.testPayload.meta) {
    el.logTestPayloadVersion.hidden = true;
    el.logTestPayloadVersion.textContent = 'TEST payload';
    return;
  }

  const payloadVersion = state.testPayload.meta.version || '?';
  const payloadName = String(state.testPayload.meta.name || state.testPayloadKey || 'payload').trim();
  el.logTestPayloadVersion.hidden = false;
  el.logTestPayloadVersion.textContent = `TEST ${payloadName} v${payloadVersion}`;
}

function renderTestStateMenuSelection() {
  if (!Array.isArray(el.testStateOptions)) return;

  el.testStateOptions.forEach((optionButton) => {
    const payloadKey = String(optionButton.getAttribute('data-test-payload-key') || '').trim();
    const isActive = state.testDataMode
      ? payloadKey === state.testPayloadKey
      : payloadKey === DEFAULT_TEST_PAYLOAD_KEY;
    optionButton.classList.toggle('is-active', isActive);
  });
}

function applyTestDataUiState() {
  if (document && document.body) {
    document.body.classList.toggle('is-test-data', state.testDataMode === true);
  }
  if (el.testStateMenuButton) {
    const option = getTestPayloadOption(state.testPayloadKey);
    const label = state.testDataMode ? option.label : 'OFF';
    el.testStateMenuButton.textContent = `TEST ${label}`;
    el.testStateMenuButton.setAttribute('aria-expanded', isTestStateMenuOpen() ? 'true' : 'false');
  }
  renderTestStateMenuSelection();
  renderTestPayloadVersionStamp();
}

function getActiveTestPayload() {
  if (!state.testDataMode) return null;
  if (state.testPayload && typeof state.testPayload === 'object') {
    return state.testPayload;
  }
  return getDefaultTestPayload();
}

function getEffectivePlayerData() {
  const payload = getActiveTestPayload();
  if (!payload || !payload.player || typeof payload.player !== 'object') {
    return state.player;
  }

  return {
    ...state.player,
    ...payload.player
  };
}

function getEffectiveInventorySlots() {
  const payload = getActiveTestPayload();
  if (!payload || !Array.isArray(payload.inventory) || payload.inventory.length === 0) {
    return state.inventory;
  }

  if (typeof normalizeBridgeInventorySlots === 'function' && typeof buildInventoryFromBridgeSlots === 'function') {
    const normalized = normalizeBridgeInventorySlots(payload.inventory);
    return buildInventoryFromBridgeSlots(normalized);
  }

  return state.inventory;
}

function getEffectiveVillagersData() {
  const payload = getActiveTestPayload();
  if (!payload || !Array.isArray(payload.villagers) || payload.villagers.length === 0) {
    return state.villagers;
  }

  return payload.villagers;
}

async function persistActiveTestPayload(actionText) {
  if (!state.testDataMode || state.testPayloadKey === DEFAULT_TEST_PAYLOAD_KEY || !state.testPayload) {
    return false;
  }

  try {
    const response = await apiFetch(`/api/test-payloads/${encodeURIComponent(state.testPayloadKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ payload: state.testPayload })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false || !body.payload || typeof body.payload !== 'object') {
      throw new Error(body.error || `Failed to persist test payload (${response.status})`);
    }

    state.testPayload = mergeTestPayloadPayload(body.payload);
    state.testPayloadLoaded = true;
    state.bridge.lastAction = actionText || 'Saved test payload file';
    return true;
  } catch (error) {
    state.bridge.lastError = error.message;
    state.bridge.lastAction = `Test payload save failed: ${error.message}`;
    return false;
  }
}

async function applyTestPlayerWrite(nextPlayer, actionText) {
  const payload = getActiveTestPayload() || getDefaultTestPayload();
  state.testPayload = {
    ...payload,
    player: {
      ...(payload.player || {}),
      ...nextPlayer
    }
  };

  const saved = await persistActiveTestPayload(actionText || 'Saved TEST player data');
  renderPlayer();
  renderBridge();
  renderDerivedPanels();
  return saved;
}

async function applyTestInventoryWrite(slotPayload, actionText) {
  const payload = getActiveTestPayload() || getDefaultTestPayload();
  const list = Array.isArray(payload.inventory) ? payload.inventory.slice() : [];
  const slotNumber = Number(slotPayload && slotPayload.slot);
  if (!Number.isInteger(slotNumber) || slotNumber < 1) {
    return false;
  }

  const nextEntry = {
    slot: slotNumber,
    itemId: slotPayload && slotPayload.itemId ? String(slotPayload.itemId) : null,
    count: Number(slotPayload && slotPayload.count || 0),
    uses: Number(slotPayload && slotPayload.uses || 0),
    flag0: Number(slotPayload && slotPayload.flag0 || 0),
    flag1: Number(slotPayload && slotPayload.flag1 || 0)
  };

  const existingIndex = list.findIndex((entry) => Number(entry && entry.slot) === slotNumber);
  if (!nextEntry.itemId) {
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    }
  } else if (existingIndex >= 0) {
    list[existingIndex] = nextEntry;
  } else {
    list.push(nextEntry);
  }

  state.testPayload = {
    ...payload,
    inventory: list.sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0))
  };

  const saved = await persistActiveTestPayload(actionText || `Saved TEST inventory slot ${slotNumber}`);
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderBridge();
  renderDerivedPanels();
  return saved;
}

async function applyTestVillagerWrite(slotNumber, edits, actionText) {
  const payload = getActiveTestPayload() || getDefaultTestPayload();
  const villagers = Array.isArray(payload.villagers) ? payload.villagers.slice() : [];
  const slot = Number(slotNumber);
  if (!Number.isInteger(slot) || slot < 1) {
    return false;
  }

  const idx = villagers.findIndex((entry) => Number(entry && entry.slot) === slot);
  const base = idx >= 0 ? (villagers[idx] || {}) : { slot, empty: false };
  const next = {
    ...base,
    ...edits,
    slot,
    empty: false
  };

  if (idx >= 0) {
    villagers[idx] = next;
  } else {
    villagers.push(next);
  }

  state.testPayload = {
    ...payload,
    villagers: villagers.sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0))
  };

  const saved = await persistActiveTestPayload(actionText || `Saved TEST villager slot ${slot}`);
  if (saved) {
    state.villagers = state.testPayload.villagers;
  }
  if (typeof renderVillagersPanel === 'function') {
    renderVillagersPanel(getEffectiveVillagersData());
  }
  renderBridge();
  return saved;
}

async function selectTestStatePayload(payloadKey, persist) {
  const nextKey = TEST_PAYLOAD_OPTION_DEFS[payloadKey] ? payloadKey : DEFAULT_TEST_PAYLOAD_KEY;
  const shouldEnable = nextKey !== DEFAULT_TEST_PAYLOAD_KEY;

  state.testPayloadKey = nextKey;
  state.testDataMode = shouldEnable;

  if (shouldEnable) {
    await hydrateTestPayload(nextKey);
  } else {
    state.testPayload = null;
    state.testPayloadLoaded = false;
  }

  applyTestDataUiState();
  renderBridge();

  if (persist && typeof persistLocalState === 'function') {
    persistLocalState();
  }
}

function renderBridge() {
  const testPayload = state.testPayload || getDefaultTestPayload();
  const selectedOption = getTestPayloadOption(state.testPayloadKey);
  const catalogView = state.testDataMode
    ? {
        ...state.catalog,
        ...(testPayload.catalog || {})
      }
    : state.catalog;
  const bridgeView = state.testDataMode
    ? {
        ...state.bridge,
        ...(testPayload.bridge || {})
      }
    : state.bridge;

  const catalogReady = catalogView.searchableCount > 0 || state.items.length > 0;
  const catalogGlyph = getCatalogIndicatorGlyph();

  el.catalogStatus.classList.toggle('is-ok', catalogView.connectionState === 'live');
  el.catalogStatus.classList.toggle('is-warn', catalogView.connectionState === 'syncing' || catalogView.connectionState === 'cached' || catalogView.connectionState === 'fallback');
  el.catalogStatus.classList.toggle('is-bad', catalogView.connectionState === 'offline');
  el.catalogStatus.title = catalogView.message || '';

  const catalogPillLabel = el.catalogStatus ? el.catalogStatus.querySelector('.status-pill-label') : null;
  if (catalogPillLabel) {
    catalogPillLabel.textContent = 'API';
  }

  if (el.catalogStatusLabel) {
    // Suppress label text when live — the green dot is sufficient
    const rawLabel = catalogView.label || 'Offline';
    const shownLabel = rawLabel === 'Live' ? '' : rawLabel;
    el.catalogStatusLabel.textContent = shownLabel;
    el.catalogStatusLabel.title = state.testDataMode ? `TEST MODE: ${catalogView.message || ''}` : (catalogView.message || '');
  }

  if (el.bridgeStatusInline) {
    el.bridgeStatusInline.textContent = bridgeView.connected ? '✓' : '✕';
    el.bridgeStatusInline.classList.toggle('is-ok', bridgeView.connected);
    el.bridgeStatusInline.classList.toggle('is-bad', !bridgeView.connected);
    el.bridgeStatusInline.classList.remove('is-warn');
  }

  if (el.ryujinxStatusChip) {
    let chipText = 'Ryujinx: Unknown';
    let chipTitle = 'Ryujinx status unknown';
    let chipClass = 'is-warn';

    if (!bridgeView.connected) {
      chipText = 'Ryujinx: Offline';
      chipTitle = 'Bridge is disconnected — Ryujinx status unknown';
      chipClass = 'is-bad';
    } else if (bridgeView.ryujinxRunning === true) {
      chipText = 'Ryujinx: Running';
      chipTitle = `Ryujinx process detected${bridgeView.ryujinxMatchCount ? ` (${bridgeView.ryujinxMatchCount})` : ''}`;
      chipClass = 'is-ok';
    } else if (bridgeView.ryujinxRunning === false) {
      chipText = 'Ryujinx: Stopped';
      chipTitle = 'Bridge connected, but no Ryujinx process match was found';
      chipClass = 'is-bad';
    }

    if (state.testDataMode) {
      chipTitle = `TEST MODE: ${chipTitle}`;
    }

    el.ryujinxStatusChip.title = chipTitle;
    const ryujinxLabel = el.ryujinxStatusChip.querySelector('.status-pill-label');
    if (ryujinxLabel) {
      ryujinxLabel.textContent = chipText;
    }
    el.ryujinxStatusChip.classList.toggle('is-ok', chipClass === 'is-ok');
    el.ryujinxStatusChip.classList.toggle('is-bad', chipClass === 'is-bad');
    el.ryujinxStatusChip.classList.toggle('is-warn', chipClass === 'is-warn');
  }

  if (el.acnhDataStatusChip) {
    let chipText = 'ACNH Data: Unknown';
    let chipTitle = 'ACNH data source unknown';
    let chipClass = 'is-warn';

    if (!bridgeView.connected) {
      chipText = 'ACNH Data: Offline';
      chipTitle = 'Bridge not connected — game data unavailable';
      chipClass = 'is-bad';
    } else if (
      bridgeView.gameDataSource === 'unavailable' ||
      bridgeView.gameDataSource === 'none' ||
      bridgeView.gameDataSource === 'bridge-fallback' ||
      bridgeView.gameDataSource === 'bridge-memory-tool' ||
      bridgeView.gameDataSource === 'adapter-memory'
    ) {
      chipText = 'ACNH Data: Unavailable';
      chipTitle = 'Live ACNH game-data is not available from the bridge';
      chipClass = 'is-warn';
    } else if (bridgeView.gameDataSource === 'error') {
      chipText = 'ACNH Data: Error';
      chipTitle = bridgeView.lastError || 'Data read error';
      chipClass = 'is-bad';
    } else if (bridgeView.gameDataSource) {
      chipText = 'ACNH Data: Live';
      chipTitle = `Reading ${bridgeView.gameDataSource}`;
      chipClass = 'is-ok';
    }

    if (state.testDataMode) {
      chipTitle = `TEST MODE: ${chipTitle}`;
    }

    el.acnhDataStatusChip.title = chipTitle;
    const acnhDataLabel = el.acnhDataStatusChip.querySelector('.status-pill-label');
    if (acnhDataLabel) {
      acnhDataLabel.textContent = chipText;
    }
    el.acnhDataStatusChip.classList.toggle('is-ok', chipClass === 'is-ok');
    el.acnhDataStatusChip.classList.toggle('is-bad', chipClass === 'is-bad');
    el.acnhDataStatusChip.classList.toggle('is-warn', chipClass === 'is-warn');
  }

  if (el.connectBridgeDot) {
    el.connectBridgeDot.classList.toggle('is-on', bridgeView.connected);
  }

  // Update deploy button label to reflect live connection state
  if (el.deployButton && !el.deployButton.disabled) {
    const lbl = document.getElementById('deploy-button-label');
    if (lbl) lbl.textContent = bridgeView.connected ? '⚡ Bridge' : 'Connect';
  }

  if (el.bridgeToggle) {
    el.bridgeToggle.classList.toggle('is-on', bridgeView.connected);
    el.bridgeToggle.setAttribute('aria-pressed', bridgeView.connected ? 'true' : 'false');
    el.bridgeToggle.title = bridgeView.connected
      ? 'Bridge connected'
      : (bridgeView.listening ? 'Bridge listener active' : 'Bridge listener offline');
  }

  if (el.ipDisplay) {
    el.ipDisplay.textContent = bridgeView.connected
      ? `Bridge: ${bridgeView.ip}`
      : `Listening: ${bridgeView.listenerIp || bridgeView.host}:${bridgeView.port}`;
  }

  if (el.logConnectionIndicator) {
    el.logConnectionIndicator.classList.toggle('is-online', bridgeView.connected);
    el.logConnectionIndicator.classList.toggle('is-offline', !bridgeView.connected);
    const connectionLabel = bridgeView.connected ? 'Bridge connected' : 'Bridge disconnected';
    el.logConnectionIndicator.setAttribute('aria-label', state.testDataMode ? `TEST ${connectionLabel}` : connectionLabel);
    el.logConnectionIndicator.title = state.testDataMode
      ? `TEST MODE: ${bridgeView.message || connectionLabel}`
      : (bridgeView.message || connectionLabel);
  }

  if (el.logConnectionIcon) {
    el.logConnectionIcon.src = bridgeView.connected
      ? CONSOLE_CONNECTED_ICON_PATH
      : CONSOLE_DISCONNECTED_ICON_PATH;
  }

  const selectedSlot = getSelectedSlot();
  const bridgeCapabilities = Array.isArray(bridgeView.capabilities)
    ? bridgeView.capabilities.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const supportsReadGameData = bridgeCapabilities.includes('read_game_data');
  const bridgeWarnings = [];

  if (bridgeView.connected && !supportsReadGameData) {
    bridgeWarnings.push('Deck bridge client missing read_game_data capability. Live ACNH data is unavailable. Restart bridge with updated script.');
  }

  if (state.testDataMode) {
    bridgeWarnings.push(`TEST mode enabled from ${selectedOption.path || 'inline fallback payload'}.`);
  }

  const block = {
    connected: bridgeView.connected,
    ip: bridgeView.ip,
    listenerIp: bridgeView.listenerIp,
    clientIp: bridgeView.clientIp,
    host: bridgeView.host,
    port: bridgeView.port,
    listening: bridgeView.listening,
    deviceName: bridgeView.deviceName,
    protocolVersion: bridgeView.protocolVersion,
    capabilities: bridgeView.capabilities,
    supportsReadGameData,
    bridgeWarnings,
    pendingRequests: bridgeView.pendingRequests,
    mode: bridgeView.mode,
    inventoryAdapter: bridgeView.inventoryAdapter,
    inventorySource: bridgeView.inventorySource,
    lastInventorySyncAt: bridgeView.lastInventorySyncAt,
    gameDataSource: bridgeView.gameDataSource,
    lastGameDataSyncAt: bridgeView.lastGameDataSyncAt,
    lastGameSaveAt: bridgeView.lastGameSaveAt,
    lastGameDataFilePath: bridgeView.lastGameDataFilePath,
    ryujinxRunning: bridgeView.ryujinxRunning,
    ryujinxMatchCount: bridgeView.ryujinxMatchCount,
    ryujinxMatches: bridgeView.ryujinxMatches,
    catalogReady,
    catalogState: catalogView.connectionState,
    catalogLabel: catalogView.label,
    itemCount: catalogView.searchableCount || state.items.length,
    quickCheats: getEnabledQuickCheatSummary(),
    ...buildSelectedSlotPayload(selectedSlot),
    message: bridgeView.message,
    lastError: bridgeView.lastError,
    lastCommand: bridgeView.lastCommand,
    lastResponse: bridgeView.lastResponse,
    remoteStatus: bridgeView.remoteStatus,
    lastAction: bridgeView.lastAction,
    testDataMode: state.testDataMode,
    testPayloadKey: state.testDataMode ? state.testPayloadKey : DEFAULT_TEST_PAYLOAD_KEY,
    testPayloadSource: state.testDataMode ? selectedOption.path : null,
    testPayloadLoaded: state.testPayloadLoaded,
    testPayloadMeta: state.testDataMode ? testPayload.meta : null
  };

  el.bridgeStatus.textContent = JSON.stringify(block, null, 2);
}

function renderVillagers() {
  if (!el.villagerRoster) return;

  // Delegate to the canonical panel renderer in app-workspaces.js so the DOM
  // is only ever written by one source. Prevents flashing between the simple
  // text view and the full card view when both pipelines fire.
  if (typeof renderVillagersPanel === 'function') {
    const villagers = Array.isArray(state.villagers) ? state.villagers : [];
    renderVillagersPanel(villagers);
    return;
  }

  const villagers = Array.isArray(state.villagers) ? state.villagers : [];

  if (el.villagerCountBadge) {
    el.villagerCountBadge.textContent = villagers.length > 0 ? `${villagers.length}` : '';
  }

  if (villagers.length === 0) {
    el.villagerRoster.innerHTML = '<p class="villager-placeholder">No villagers loaded. Connect bridge to read island residents.</p>';
    return;
  }

  let html = '';
  villagers.forEach((v, idx) => {
    if (!v || v.empty) return;
    
    const villagerName = (v.name || `Villager ${idx + 1}`).trim();
    const internalId = v.internalId || v.id || '';
    const species = v.species || 'Unknown';
    const furniture = Array.isArray(v.furniture) ? v.furniture.filter(f => f && !f.empty).length : 0;
    const clothes = Array.isArray(v.clothes) ? v.clothes.filter(c => c && !c.empty).length : 0;
    
    html += `
      <div class="villager-card" role="button" tabindex="0" data-villager-slot="${v.slot || idx}">
        <div class="villager-header">
          <h4>${villagerName}</h4>
          <span class="villager-species">${species}</span>
        </div>
        <div class="villager-details">
          <div class="villager-stat">
            <span class="stat-label">Furniture</span>
            <span class="stat-value">${furniture}</span>
          </div>
          <div class="villager-stat">
            <span class="stat-label">Clothes</span>
            <span class="stat-value">${clothes}</span>
          </div>
        </div>
      </div>
    `;
  });

  el.villagerRoster.innerHTML = html;
  bindVillagerCardEvents();
}

