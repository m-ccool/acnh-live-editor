'use strict';

let bridgeInventorySyncInFlight = false;

function clearLiveGameDataDisplay() {
  state.player = {
    ...state.player,
    name: '',
    town: '',
    wallet: 0,
    bank: 0,
    miles: 0,
    avatar: '/assets/items/Bob_NH.png'
  };
  state.inventory = buildInventoryFromBridgeSlots([]);
  state.hasUserSelectedSlot = false;
  state.selectedSlotIndex = findFirstEmptySlotIndex(state.inventory);
  renderPlayer();
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderItemModal();
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
  let syncedFromBridge = false;

  try {
    const statusResponse = await fetch('/api/status', { cache: 'no-store' });
    if (statusResponse.ok) {
      syncBridgeStatus(await statusResponse.json());
      syncedFromBridge = await refreshBridgeInventory({ reason: lastAction, force: true });
      await refreshBridgeGameData();
    }
  } catch (error) {
    console.error(error);
  }

  await refreshCatalogStatus();
  refreshCatalogDiagnostics();

  if (!syncedFromBridge) {
    state.bridge.lastAction = lastAction;
  }
  renderBridge();
  renderDerivedPanels();
  persistLocalState();
}

async function pollBridgeStatus() {
  try {
    const statusResponse = await fetch('/api/status', { cache: 'no-store' });
    if (statusResponse.ok) {
      syncBridgeStatus(await statusResponse.json());
      await refreshBridgeInventory({ reason: 'Background inventory sync' });
      await refreshBridgeGameData();
      
      const playerChanged = hasPlayerDataChanged();
      const inventoryChanged = hasInventoryChanged();
      
      renderBridge();
      renderDerivedPanels();
      
      if (playerChanged) {
        const playerCard = document.querySelector('.player-panel');
        if (playerCard) applyUpdateFade(playerCard);
      }
      if (inventoryChanged) {
        const inventoryCard = document.querySelector('.inventory-area');
        if (inventoryCard) applyUpdateFade(inventoryCard);
      }
      
      updateDataSnapshot();
    }
  } catch (error) {
    console.error(error);
  }
}

async function refreshBridgeGameData() {
  if (!state.bridge.connected) {
    state.bridge.gameDataSource = 'none';
    state.bridge.lastGameSaveAt = null;
    state.bridge.lastGameDataFilePath = null;
    clearLiveGameDataDisplay();
    return false;
  }

  try {
    const response = await fetch('/api/bridge/read-game-data', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.ok === false) {
      const message = body && body.error ? String(body.error) : `Bridge game-data read failed with ${response.status}`;
      throw new Error(message);
    }

    const payload = body && body.payload && typeof body.payload === 'object' ? body.payload : body;
    const payloadSource = payload && payload.source
      ? String(payload.source)
      : 'bridge-read';
    const hasPlayerPayload = Boolean(payload && payload.player && typeof payload.player === 'object');
    const hasSlotsPayload = Array.isArray(payload && payload.slots) && payload.slots.length > 0;
    const hasUnavailableGameData = (
      payload && payload.unavailable === true
    ) || (
      payloadSource === 'unavailable' ||
      payloadSource === 'none' ||
      payloadSource === 'bridge-fallback'
    ) || (
      (payloadSource === 'bridge-memory-tool' || payloadSource === 'adapter-memory') &&
      !hasPlayerPayload &&
      !hasSlotsPayload
    );

    state.bridge.gameDataSource = hasUnavailableGameData
      ? 'unavailable'
      : payloadSource;
    state.bridge.lastGameDataSyncAt = new Date().toISOString();
    state.bridge.lastGameSaveAt = payload && payload.lastGameSaveAt
      ? String(payload.lastGameSaveAt)
      : null;
    state.bridge.lastGameDataFilePath = payload && payload.lastGameDataFilePath
      ? String(payload.lastGameDataFilePath)
      : null;

    if (hasUnavailableGameData) {
      clearLiveGameDataDisplay();
      persistLocalState();
      return false;
    }

    if (payload && payload.player && typeof payload.player === 'object') {
      state.player = {
        ...state.player,
        name: sanitizeText(payload.player.name, state.player.name),
        town: sanitizeText(payload.player.town, state.player.town),
        wallet: normalizeWholeNumber(payload.player.wallet, state.player.wallet),
        bank: normalizeWholeNumber(payload.player.bank, state.player.bank),
        miles: normalizeWholeNumber(payload.player.miles, state.player.miles),
        avatar: sanitizeText(payload.player.avatar, state.player.avatar)
      };
      renderPlayer();
    }

    if (Array.isArray(payload && payload.slots)) {
      const bridgeSlots = normalizeBridgeInventorySlots(payload.slots);
      await hydrateBridgeCatalogItems(bridgeSlots);
      state.inventory = buildInventoryFromBridgeSlots(bridgeSlots);

      if (!state.hasUserSelectedSlot) {
        state.selectedSlotIndex = findFirstEmptySlotIndex(state.inventory);
      }

      renderInventory();
      renderSelectedPreview();
      renderClipboardState();
      renderItemModal();
    }

    persistLocalState();

    return true;
  } catch (error) {
    state.bridge.lastError = error.message;
    state.bridge.gameDataSource = 'error';
    return false;
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
  state.bridge.listenerIp = status && status.listenerIp ? String(status.listenerIp) : null;
  state.bridge.clientIp = status && status.clientIp ? String(status.clientIp) : null;
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
  state.bridge.inventoryAdapter = state.bridge.remoteStatus && state.bridge.remoteStatus.inventoryAdapter
    ? String(state.bridge.remoteStatus.inventoryAdapter)
    : null;
  state.bridge.ryujinxRunning = state.bridge.remoteStatus && state.bridge.remoteStatus.ryujinx
    ? Boolean(state.bridge.remoteStatus.ryujinx.running)
    : null;
  state.bridge.ryujinxMatchCount = state.bridge.remoteStatus && state.bridge.remoteStatus.ryujinx
    ? Number(state.bridge.remoteStatus.ryujinx.matchCount || 0)
    : 0;
  state.bridge.ryujinxMatches = state.bridge.remoteStatus && state.bridge.remoteStatus.ryujinx && Array.isArray(state.bridge.remoteStatus.ryujinx.matches)
    ? state.bridge.remoteStatus.ryujinx.matches.slice(0, 3)
    : [];
  state.bridge.lastError = status && status.lastError ? String(status.lastError) : null;
  state.bridge.message = status && status.message
    ? String(status.message)
    : (state.bridge.connected
      ? `Bridge ${state.bridge.mode} and ready for sync.`
      : `Bridge ${state.bridge.mode}. Read/write disabled.`);
}

async function refreshBridgeInventory(options = {}) {
  const reason = typeof options.reason === 'string' ? options.reason : '';
  const force = options.force === true;

  if (!state.bridge.connected) {
    state.bridge.inventorySource = 'local-cache';
    return false;
  }

  if (bridgeInventorySyncInFlight && !force) {
    return false;
  }

  bridgeInventorySyncInFlight = true;

  try {
    const response = await fetch('/api/bridge/read-inventory', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.ok === false) {
      const message = body && body.error ? String(body.error) : `Bridge read failed with ${response.status}`;
      throw new Error(message);
    }

    const payload = body && body.payload && typeof body.payload === 'object' ? body.payload : body;
    const bridgeSlots = normalizeBridgeInventorySlots(payload && payload.slots);
    await hydrateBridgeCatalogItems(bridgeSlots);
    state.inventory = buildInventoryFromBridgeSlots(bridgeSlots);

    if (!state.hasUserSelectedSlot) {
      state.selectedSlotIndex = findFirstEmptySlotIndex(state.inventory);
    }

    state.bridge.inventorySource = 'bridge-read';
    state.bridge.lastInventorySyncAt = new Date().toISOString();

    if (payload && payload.adapter) {
      state.bridge.inventoryAdapter = String(payload.adapter);
    }

    if (reason) {
      state.bridge.lastAction = reason;
    }

    state.bridge.lastError = null;
    renderInventory();
    renderSelectedPreview();
    renderClipboardState();
    renderDerivedPanels();
    renderItemModal();
    persistLocalState();
    return true;
  } catch (error) {
    state.bridge.lastError = error.message;
    state.bridge.inventorySource = 'local-cache';
    return false;
  } finally {
    bridgeInventorySyncInFlight = false;
  }
}

async function hydrateBridgeCatalogItems(bridgeSlots) {
  const missingNames = Array.from(new Set(
    (Array.isArray(bridgeSlots) ? bridgeSlots : [])
      .map((entry) => entry && entry.itemId ? String(entry.itemId).trim() : '')
      .filter(Boolean)
      .filter((itemId) => !findItemByLookup(itemId, itemId))
  ));

  if (!missingNames.length) {
    return;
  }

  try {
    const response = await fetch('/api/items/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ names: missingNames })
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (Array.isArray(payload && payload.items) && payload.items.length) {
      rememberCatalogItems(payload.items);
    }
  } catch (error) {
    console.error(error);
  }
}

function normalizeBridgeInventorySlots(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const slot = Number(entry && entry.slot);
    if (!Number.isInteger(slot) || slot < 1) {
      return null;
    }

    return {
      slot,
      itemId: entry && entry.itemId ? String(entry.itemId) : null,
      count: normalizeWholeNumber(entry && entry.count, 0),
      uses: normalizeWholeNumber(entry && entry.uses, 0),
      flag0: normalizeWholeNumber(entry && entry.flag0, 0),
      flag1: normalizeWholeNumber(entry && entry.flag1, 0)
    };
  }).filter(Boolean);
}

function buildInventoryFromBridgeSlots(bridgeSlots) {
  const nextSlots = [];

  for (let index = 1; index <= TOTAL_SLOTS; index += 1) {
    nextSlots.push(emptySlot(index));
  }

  bridgeSlots.forEach((entry) => {
    if (entry.slot < 1 || entry.slot > TOTAL_SLOTS) {
      return;
    }

    let item = null;
    if (entry.itemId) {
      item = findItemByLookup(entry.itemId, entry.itemId);
      if (!item) {
        item = createBridgePlaceholderItem(entry.itemId);
        rememberCatalogItems([item]);
      }
    }

    const slot = buildSlot(entry.slot, item, entry.count, entry.uses, entry.flag0, entry.flag1);
    if (entry.itemId) {
      slot.itemId = entry.itemId;
    }

    nextSlots[entry.slot - 1] = slot;
  });

  return nextSlots;
}

function createBridgePlaceholderItem(itemId) {
  const safeName = String(itemId || 'Unknown item').replace(/[_-]+/g, ' ').trim();

  return {
    name: safeName || 'Unknown item',
    category: 'Bridge',
    icon_url: null,
    image_url: null,
    preview_url: null,
    internal_id: null,
    file_name: String(itemId || safeName || 'unknown-item'),
    source_files: ['bridge-adapter']
  };
}

async function writeSlotToBridge(slot, actionText) {
  if (!state.bridge.connected || !slot) {
    return false;
  }

  try {
    const response = await fetch('/api/bridge/write-inventory-slot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        slot: slot.slot,
        itemId: slot.itemId,
        count: normalizeWholeNumber(slot.count, 0),
        uses: normalizeWholeNumber(slot.uses, 0),
        flag0: normalizeWholeNumber(slot.flag0, 0),
        flag1: normalizeWholeNumber(slot.flag1, 0)
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      const message = body && body.error ? String(body.error) : `Bridge write failed with ${response.status}`;
      throw new Error(message);
    }

    const payload = body && body.payload && typeof body.payload === 'object' ? body.payload : body;
    if (payload && payload.adapter) {
      state.bridge.inventoryAdapter = String(payload.adapter);
    }

    await refreshBridgeInventory({
      reason: actionText || `Synced slot ${slot.slot} from bridge`,
      force: true
    });

    return true;
  } catch (error) {
    state.bridge.lastError = error.message;
    state.bridge.lastAction = `Bridge write failed on slot ${slot.slot}: ${error.message}`;
    return false;
  }
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
  const listenerIp = status && typeof status.listenerIp === 'string' ? status.listenerIp.trim() : '';
  if (listenerIp) return listenerIp;

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

async function applyCopiedPayloadToSlot(index, payload, overwroteExistingItem) {
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

  await writeSlotToBridge(slot, state.bridge.lastAction);

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
  const baseLookups = [itemId, itemName]
    .map((value) => normalizeItemLookup(value))
    .filter(Boolean);
  const fallbackLookups = [itemId, itemName]
    .map(stripVariationSuffix)
    .concat([resolveBellBagAlias(itemId), resolveBellBagAlias(itemName)])
    .map((value) => normalizeItemLookup(value))
    .filter(Boolean);
  const allLookups = Array.from(new Set(baseLookups.concat(fallbackLookups)));

  return getKnownCatalogItems().find((item) => {
    const itemFileName = normalizeItemLookup(item.file_name);
    const itemNameLookup = normalizeItemLookup(item.name);
    return allLookups.some((lookup) => lookup === itemFileName || lookup === itemNameLookup);
  }) || null;
}

function stripVariationSuffix(value) {
  return String(value || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function resolveBellBagAlias(value) {
  const match = String(value || '').trim().match(/^(\d{1,3}(?:,\d{3})*)\s+bells$/i);
  if (!match) {
    return '';
  }

  const amount = Number(String(match[1]).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) {
    return '';
  }

  return amount >= 99000 ? '99k Bells' : '30,000 Bells';
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
