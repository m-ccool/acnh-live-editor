'use strict';

let itemModalAutoApplyTimeoutId = 0;
const MODAL_CLOSE_TRANSITION_MS = 240;
const INVENTORY_TOUCH_HOLD_MS = 320;
const INVENTORY_TOUCH_HOLD_MOVE_PX = 12;
let inventoryTouchHoldTimeoutId = 0;
const inventoryTouchHold = {
  index: -1,
  pointerId: null,
  startX: 0,
  startY: 0,
  activated: false
};

function pauseBridgePoll() {
  if (state.bridge.pollPaused) return;
  
  state.bridge.pollPaused = true;
  if (state.bridgePollIntervalId !== null) {
    window.clearInterval(state.bridgePollIntervalId);
    state.bridgePollIntervalId = null;
  }
  
  renderBridgePollButton();
  persistLocalState();
}

function resumeBridgePoll() {
  if (!state.bridge.pollPaused) return;
  
  state.bridge.pollPaused = false;
  state.bridgePollIntervalId = window.setInterval(pollBridgeStatus, 4000);
  
  renderBridgePollButton();
  persistLocalState();
}

function toggleBridgePoll() {
  if (state.bridge.pollPaused) {
    resumeBridgePoll();
  } else {
    pauseBridgePoll();
  }
}

function renderBridgePollButton() {
  if (!el.pauseBridgeButton) return;
  
  const isPaused = state.bridge.pollPaused;
  el.pauseBridgeButton.classList.toggle('is-active', isPaused);
  el.pauseBridgeButton.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
  el.pauseBridgeButton.title = isPaused ? 'Resume bridge read' : 'Pause bridge read';
}

async function writePlayerChanges(nextPlayer = state.player, actionText = 'Player values synced to game') {
  if (!state.bridge.connected) {
    state.bridge.lastAction = 'Bridge disconnected: player values were not written';
    renderBridge();
    return false;
  }

  try {
    const response = await apiFetch('/api/bridge/write-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player: nextPlayer
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      throw new Error(result.error || `Write failed with status ${response.status}`);
    }

    const payload = result && result.payload && typeof result.payload === 'object' ? result.payload : result;
    const player = payload && payload.player && typeof payload.player === 'object'
      ? payload.player
      : nextPlayer;

    state.player = {
      ...state.player,
      name: sanitizeText(player.name, state.player.name),
      town: sanitizeText(player.town, state.player.town),
      wallet: normalizeWholeNumber(player.wallet, state.player.wallet),
      bank: normalizeWholeNumber(player.bank, state.player.bank),
      miles: normalizeWholeNumber(player.miles, state.player.miles),
      avatar: sanitizeText(player.avatar, state.player.avatar)
    };

    state.bridge.lastAction = actionText;
    renderPlayer();
    hydratePlayerForm();
    renderBridge();
    renderDerivedPanels();
    persistLocalState();
    return true;
  } catch (error) {
    state.bridge.lastError = error.message;
    state.bridge.lastAction = `Player write failed: ${error.message}`;
    renderBridge();
    await refreshBridgeGameData();
    return false;
  }
}

function renderPlayer() {
  el.playerName.value = state.player.name || '';
  el.playerName.dataset.gameValue = state.player.name || '';
  el.townName.value = state.player.town || '';
  el.townName.dataset.gameValue = state.player.town || '';
  _updateNameTownIconState(el.playerName);
  _updateNameTownIconState(el.townName);
  el.walletValue.value = formatNumber(state.player.wallet);
  el.bankValue.value = formatNumber(state.player.bank);
  el.milesValue.value = formatNumber(state.player.miles);
  el.playerAvatar.src = state.player.avatar
    ? state.player.avatar
    : '/assets/icons/player-silhouette.svg';
  renderSaveLoadButtons();
}

function _hasPlayerSaveChanges() {
  const snap = state.playerSaveSnapshot;
  if (!snap) return false;
  const p = state.player;
  return (
    String(p.name || '') !== String(snap.name || '') ||
    String(p.town || '') !== String(snap.town || '') ||
    Number(p.wallet) !== Number(snap.wallet) ||
    Number(p.bank) !== Number(snap.bank) ||
    Number(p.miles) !== Number(snap.miles)
  );
}

function renderSaveLoadButtons() {
  if (!el.playerSaveBtn || !el.playerLoadBtn) return;
  const hasSnapshot = !!state.playerSaveSnapshot;
  const hasChanges = _hasPlayerSaveChanges();
  el.playerSaveBtn.disabled = !hasChanges || !hasSnapshot;
  el.playerLoadBtn.disabled = false;
}

async function handlePlayerLoadClick() {
  if (el.playerLoadBtn) {
    el.playerLoadBtn.disabled = true;
    el.playerLoadBtn.textContent = '⏳ Loading…';
  }
  try {
    await refreshBridgeGameData();
    renderBridge();
  } catch (e) {
    console.error(e);
  }
  if (el.playerLoadBtn) {
    el.playerLoadBtn.disabled = false;
    el.playerLoadBtn.textContent = 'Load';
  }
  renderSaveLoadButtons();
}

async function handlePlayerSaveClick() {
  if (!_hasPlayerSaveChanges() || !state.playerSaveSnapshot) return;
  if (el.playerSaveBtn) {
    el.playerSaveBtn.disabled = true;
    el.playerSaveBtn.textContent = '⏳ Saving…';
  }
  const ok = await writePlayerChanges(state.player, 'Player values saved');
  if (ok) {
    state.playerSaveSnapshot = { ...state.player };
  }
  if (el.playerSaveBtn) {
    el.playerSaveBtn.textContent = 'Save';
  }
  renderSaveLoadButtons();
}

// ─── Inventory Presets ────────────────────────────────────────────────────────

const INVENTORY_PRESETS = {
  tools: [
    { itemId: 'Golden Axe',          count: 1, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Golden Net',          count: 1, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Golden Rod',          count: 1, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Golden Shovel',       count: 1, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Golden Slingshot',    count: 1, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Golden Watering Can', count: 1, uses: 0, flag0: 0, flag1: 0 },
  ],
  gold: Array.from({ length: 10 }, () => ({ itemId: '99k Bells', count: 1, uses: 0, flag0: 0, flag1: 0 })),
  materials: [
    { itemId: 'Wood',        count: 30, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Softwood',    count: 30, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Hardwood',    count: 30, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Clay',        count: 30, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Iron Nugget', count: 30, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Gold Nugget', count: 30, uses: 0, flag0: 0, flag1: 0 },
  ],
  dye: [
    { itemId: 'Red dye',    count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Orange dye', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Yellow dye', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Green dye',  count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Blue dye',   count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Purple dye', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Pink dye',   count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Black dye',  count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'White dye',  count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Brown dye',  count: 5, uses: 0, flag0: 0, flag1: 0 },
  ],
  trees: [
    { itemId: 'Sapling',       count: 10, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Cedar sapling', count: 10, uses: 0, flag0: 0, flag1: 0 },
  ],
  bushes: [
    { itemId: 'Azalea starts',           count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Camellia starts',         count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Hibiscus starts',         count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Holly starts',            count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Hydrangea starts',        count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Sweet olive starts',      count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Tea olive starts',        count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Osmanthus starts',        count: 5, uses: 0, flag0: 0, flag1: 0 },
  ],
  roses: [
    { itemId: 'Red-rose bag',    count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'White-rose bag',  count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Yellow-rose bag', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Pink-rose bag',   count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Orange-rose bag', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Purple-rose bag', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Black-rose bag',  count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Blue-rose bag',   count: 5, uses: 0, flag0: 0, flag1: 0 },
  ],
  tulips: [
    { itemId: 'Red-tulip bag',    count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'White-tulip bag',  count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Yellow-tulip bag', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Pink-tulip bag',   count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Orange-tulip bag', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Purple-tulip bag', count: 5, uses: 0, flag0: 0, flag1: 0 },
    { itemId: 'Black-tulip bag',  count: 5, uses: 0, flag0: 0, flag1: 0 },
  ],
};

async function applyInventoryPreset(presetKey) {
  let preset = INVENTORY_PRESETS[presetKey];
  let label = presetKey;
  if (!preset && presetKey.startsWith('custom:')) {
    const cp = state.customPresets.find(p => p.id === presetKey.slice(7));
    if (cp) { preset = cp.slots; label = cp.name; }
  }
  if (!preset) return;
  const btn = document.getElementById(`preset-${presetKey}-btn`);
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  let ok = true;
  try {
    for (let i = 0; i < preset.length; i++) {
      const slot = { slot: i + 1, ...preset[i] };
      const wrote = await writeSlotToBridge(slot, `Preset: ${label} slot ${i + 1}`);
      if (!wrote) ok = false;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText || label; }
    showToast(ok ? `✓ "${label}" preset applied` : `✗ "${label}" preset — some slots failed`);
  }
}

function renderSelectedPreview() {
  const rawPreviewItem = getSelectedPreviewItem();
  const previewItem = rawPreviewItem
    ? (findItemByLookup(rawPreviewItem.file_name || rawPreviewItem.name, rawPreviewItem.name) || rawPreviewItem)
    : null;

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
  if (el.pasteSelectedButton) {
    el.pasteSelectedButton.disabled = !canPaste;
    el.pasteSelectedButton.classList.toggle('is-ready', canPaste);
    el.pasteSelectedButton.setAttribute('aria-disabled', canPaste ? 'false' : 'true');
    el.pasteSelectedButton.title = canPaste
      ? `Paste ${state.copiedSlotPayload.selectedItem || 'empty slot'} into selected slot`
      : 'Hold an item first';
  }

  if (el.copySelectedButton) {
    el.copySelectedButton.classList.toggle('is-armed', canPaste);
    el.copySelectedButton.setAttribute('aria-label', canPaste ? 'Clear copied item' : 'Copy selected item');
    el.copySelectedButton.title = canPaste ? 'Clear copied item' : 'Copy selected item';
  }

  if (el.copySelectedIcon) {
    el.copySelectedIcon.src = canPaste
      ? '/assets/icons/line-md--clipboard-remove.svg'
      : '/assets/icons/line-md--clipboard.svg';
  }

  if (el.selectedItemArtbox) {
    el.selectedItemArtbox.classList.toggle('is-holding-slot', canPaste);
    el.selectedItemArtbox.title = canPaste
      ? `Holding ${state.copiedSlotPayload.selectedItem || 'empty slot'} - tap a pocket slot to place it`
      : 'Edit selected item';
    el.selectedItemArtbox.setAttribute('aria-label', canPaste
      ? `Holding ${state.copiedSlotPayload.selectedItem || 'empty slot'}`
      : 'Edit selected item');
  }
}

function clearInventoryTouchHoldState() {
  if (inventoryTouchHoldTimeoutId) {
    window.clearTimeout(inventoryTouchHoldTimeoutId);
    inventoryTouchHoldTimeoutId = 0;
  }

  inventoryTouchHold.index = -1;
  inventoryTouchHold.pointerId = null;
  inventoryTouchHold.startX = 0;
  inventoryTouchHold.startY = 0;
  inventoryTouchHold.activated = false;
}

function armHeldSlot(index, options = {}) {
  const slot = state.inventory[index];
  if (!slot || !slot.item) {
    return false;
  }

  state.copiedSlotPayload = buildClipboardPayload(slot);
  state.copiedSlotSourceIndex = index;
  clearOverwriteGuard();
  state.bridge.lastAction = options.actionText || `Holding slot ${slot.slot}: ${slot.item.name}`;
  renderBridge();
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderDerivedPanels();
  renderItemModal();
  return true;
}

async function handleHeldSlotTarget(index) {
  const payload = await resolveCopiedSlotPayload();
  if (!payload) {
    return false;
  }

  state.copiedSlotPayload = payload;
  const sourceIndex = Number.isInteger(state.copiedSlotSourceIndex) ? state.copiedSlotSourceIndex : null;

  if (sourceIndex === index) {
    clearCopiedSlotPayload();
    return true;
  }

  const slot = state.inventory[index];
  if (!slot) {
    return false;
  }

  if (!slot.item) {
    clearOverwriteGuard();
    if (sourceIndex !== null) {
      return moveOrSwapHeldSlot(sourceIndex, index);
    }

    return applyCopiedPayloadToSlot(index, payload, false);
  }

  const nextStep = getNextOverwriteStep(index);
  state.overwriteGuard = {
    slotIndex: index,
    step: nextStep
  };

  if (nextStep >= 2) {
    clearOverwriteGuard();
    if (sourceIndex !== null) {
      return moveOrSwapHeldSlot(sourceIndex, index);
    }

    return applyCopiedPayloadToSlot(index, payload, true);
  }

  state.bridge.lastAction = sourceIndex !== null
    ? `Tap slot ${slot.slot} again to swap with held slot`
    : `Tap slot ${slot.slot} again to overwrite with clipboard`;
  renderBridge();
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderDerivedPanels();
  renderItemModal();
  return true;
}

function clearItemModalAutoApplyTimer() {
  if (itemModalAutoApplyTimeoutId) {
    window.clearTimeout(itemModalAutoApplyTimeoutId);
    itemModalAutoApplyTimeoutId = 0;
  }
}

function scheduleItemModalAutoApply(immediate = false) {
  if (!el.itemModal || el.itemModal.classList.contains('hidden')) {
    return;
  }

  clearItemModalAutoApplyTimer();

  const delay = immediate ? 0 : 320;
  itemModalAutoApplyTimeoutId = window.setTimeout(() => {
    itemModalAutoApplyTimeoutId = 0;
    applyItemEdits({ closeModalAfterWrite: false });
  }, delay);
}

function clearOverwriteGuard() {
  state.overwriteGuard = null;
}

function getNextOverwriteStep(index) {
  if (!state.overwriteGuard || state.overwriteGuard.slotIndex !== index) {
    return 1;
  }

  return Math.min(state.overwriteGuard.step + 1, 2);
}

function renderShortcutButtons() {
  if (!el.shortcutColumn) {
    return;
  }

  window.ACNHReactUI.renderShortcutButtons(el.shortcutColumn, {
    activeFilter: state.activeFilter,
    onPress: handleShortcutFilterPress
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
  if (!el.quickCheatControls) {
    return;
  }

  window.ACNHReactUI.renderQuickCheatButtons(el.quickCheatControls, {
    activeCheatIds: Object.keys(DEFAULT_QUICK_CHEATS).filter((cheatId) => state.quickCheats[cheatId]),
    onToggle: toggleQuickCheat
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
  const active = isQuickCheatActive(cheatId);
  showToast(`${active ? '✓' : '◎'} ${getQuickCheatLabel(cheatId)} ${active ? 'enabled' : 'disabled'}`, 2500);
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
  if (!el.inventoryGrid) {
    return;
  }

  window.ACNHReactUI.renderInventoryGrid(el.inventoryGrid, {
    slots: state.inventory,
    selectedSlotIndex: state.selectedSlotIndex,
    clipboardSourceSlotIndex: state.copiedSlotSourceIndex,
    overwriteGuard: state.overwriteGuard,
    pendingSlot: state.pendingInventorySlot,
    activeFilter: state.activeFilter,
    normalizeCategory,
    async onSelectSlot(index) {
      if (state.overwriteGuard && state.overwriteGuard.slotIndex !== index) {
        clearOverwriteGuard();
      }

      state.hasUserSelectedSlot = true;
      state.selectedSlotIndex = index;
      state.modalSearchQuery = '';
      if (el.modalSearchInput) {
        el.modalSearchInput.value = '';
      }

       if (state.copiedSlotPayload) {
         const handled = await handleHeldSlotTarget(index);
         if (handled) {
           return;
         }
       }

      renderBridge();
      renderInventory();
      renderSelectedPreview();
      renderClipboardState();
      renderItemModal();
      openItemModalForSelectedSlot();
    },
    onPointerDown(index, event) {
      if (event.pointerType !== 'touch') {
        return;
      }

      const slot = state.inventory[index];
      if (!slot || !slot.item) {
        clearInventoryTouchHoldState();
        return;
      }

      clearInventoryTouchHoldState();
      inventoryTouchHold.index = index;
      inventoryTouchHold.pointerId = event.pointerId;
      inventoryTouchHold.startX = Number(event.clientX || 0);
      inventoryTouchHold.startY = Number(event.clientY || 0);
      inventoryTouchHoldTimeoutId = window.setTimeout(() => {
        inventoryTouchHoldTimeoutId = 0;
        inventoryTouchHold.activated = armHeldSlot(index);
      }, INVENTORY_TOUCH_HOLD_MS);
    },
    onPointerMove(index, event) {
      if (event.pointerType !== 'touch' || inventoryTouchHold.pointerId !== event.pointerId) {
        return;
      }

      const dx = Math.abs(Number(event.clientX || 0) - inventoryTouchHold.startX);
      const dy = Math.abs(Number(event.clientY || 0) - inventoryTouchHold.startY);
      if (dx > INVENTORY_TOUCH_HOLD_MOVE_PX || dy > INVENTORY_TOUCH_HOLD_MOVE_PX) {
        clearInventoryTouchHoldState();
      }
    },
    async onPointerUp(index, event) {
      if (event.pointerType !== 'touch') {
        return;
      }

      const holdWasActive = inventoryTouchHold.activated;
      clearInventoryTouchHoldState();
      if (holdWasActive) {
        return;
      }

      const now = Date.now();
      const isDoubleTap = inventoryTouchTap.index === index && now - inventoryTouchTap.at < 320;
      inventoryTouchTap.index = index;
      inventoryTouchTap.at = now;

      if (!isDoubleTap) {
        return;
      }

      state.hasUserSelectedSlot = true;
      state.selectedSlotIndex = index;
      await handleInventorySlotDoubleClick(index);
    },
    async onDoubleClick(index) {
      state.hasUserSelectedSlot = true;
      state.selectedSlotIndex = index;
      await handleInventorySlotDoubleClick(index);
    },
    onPointerCancel() {
      clearInventoryTouchHoldState();
    },
    onDragStart(index, event) {
      const slot = state.inventory[index];
      if (!slot || !slot.item) {
        event.preventDefault();
        return;
      }

      armHeldSlot(index, { actionText: `Dragging slot ${slot.slot}: ${slot.item.name}` });
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(slot.slot));
      }
    },
    onDragOver(index, event) {
      if (!Number.isInteger(state.copiedSlotSourceIndex)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    },
    async onDrop(index, event) {
      event.preventDefault();
      if (!Number.isInteger(state.copiedSlotSourceIndex) || state.copiedSlotSourceIndex === index) {
        return;
      }

      state.hasUserSelectedSlot = true;
      state.selectedSlotIndex = index;
      clearOverwriteGuard();
      await moveOrSwapHeldSlot(state.copiedSlotSourceIndex, index);
    },
    onDragEnd() {
      clearInventoryTouchHoldState();
    }
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
  if (!state.copiedSlotPayload) {
    clearOverwriteGuard();
    openItemModalForSelectedSlot();
    return;
  }

  await handleHeldSlotTarget(index);
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
  const selectedLabel = slot.item ? slot.item.name : (slot.itemId || 'Empty slot');
  const selectedSource = slot.item
    ? getItemSourceLabel(slot.item)
    : (slot.itemId ? 'Bridge raw item id' : 'No source');

  el.tabFilledSlots.textContent = `${filledSlots} / ${TOTAL_SLOTS}`;
  el.tabStackTotal.textContent = formatNumber(stackTotal);
  el.tabActiveCategory.textContent = slot.item ? slot.item.category || 'Unsorted' : 'Empty';

  if (el.tabCategoryList) {
    window.ACNHReactUI.renderCategoryList(el.tabCategoryList, { categories });
  }

  el.tabSelectionName.textContent = selectedLabel;
  el.tabSelectionHex.textContent = slot.hex || '00000000';
  el.tabSelectionSource.textContent = selectedSource;

  if (el.tabPlayerSummaryName) el.tabPlayerSummaryName.textContent = state.player.name;
  if (el.tabPlayerSummaryTown) el.tabPlayerSummaryTown.textContent = state.player.town;
  if (el.tabPlayerSummaryWallet) el.tabPlayerSummaryWallet.textContent = formatNumber(state.player.wallet);
  if (el.tabPlayerSummaryMiles) el.tabPlayerSummaryMiles.textContent = formatNumber(state.player.miles);

  if (!state.bridge.connected) {
    el.tabBridgeState.textContent = 'Offline';
  } else if (state.bridge.ryujinxRunning === true) {
    el.tabBridgeState.textContent = 'Connected (Ryujinx running)';
  } else if (state.bridge.ryujinxRunning === false) {
    el.tabBridgeState.textContent = 'Connected (Ryujinx not running)';
  } else {
    el.tabBridgeState.textContent = 'Connected (Ryujinx unknown)';
  }

  el.tabBridgeMode.textContent = state.bridge.connected
    ? (state.bridge.inventoryAdapter
      ? `${state.bridge.mode} / ${state.bridge.inventoryAdapter}`
      : state.bridge.mode)
    : 'offline';
  el.tabStorageState.textContent = isLocalStorageAvailable() ? 'Saved locally' : 'Unavailable';
  el.tabSessionJson.textContent = JSON.stringify(buildSelectedSlotPayload(slot), null, 2);
}

function renderSettingsDebug() {
  if (!el.settingsDebugOutput) return;

  const slot = getSelectedSlot();
  const ryujinxState = state.bridge.ryujinxRunning === true
    ? 'running'
    : (state.bridge.ryujinxRunning === false ? 'not running' : 'unknown');
  const summary = [
    state.bridge.connected ? 'Bridge online' : 'Bridge offline',
    `${state.bridge.mode} (${state.bridge.inventoryAdapter || 'adapter unknown'})`,
    `Ryujinx ${ryujinxState}`,
    `Inventory ${state.bridge.inventorySource || 'local-cache'}`,
    `GameData ${state.bridge.gameDataSource || 'none'}`,
    `Last save ${state.bridge.lastGameSaveAt || 'unknown'}`,
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
  const baseItem = state.modalPendingItem || slot.item;
  const item = baseItem
    ? (findItemByLookup(baseItem.file_name || slot.itemId || baseItem.name, baseItem.name) || baseItem)
    : null;
  const modalLabel = item ? item.name : (slot.itemId || 'Empty slot');

  if (!state.modalPendingItem && item && slot.item !== item) {
    slot.item = item;
  }

  el.modalPocketTitle.textContent = `Pocket ${slot.slot} · ${modalLabel}`;
  el.modalItemName.textContent = modalLabel;
  el.modalInputCount.value = String(slot.count);
  el.modalInputUses.value = String(slot.uses);
  el.modalInputFlag0.value = String(slot.flag0);
  el.modalInputFlag1.value = String(slot.flag1);
  el.modalHex.textContent = slot.hex || deriveHexFromItem(item) || '00000000';

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

  const results = state.catalog.modalResults.slice(0, MODAL_SEARCH_LIMIT);
  const activeItem = state.modalPendingItem || getSelectedSlot().item;

  window.ACNHReactUI.renderModalResultsList(el.modalResultsList, {
    isOpen: state.modalSearchOpen,
    loading: state.catalog.modalLoading,
    results,
    emptyText: getModalSearchEmptyStateText(),
    selectedItemLookup: activeItem
      ? normalizeItemLookup(activeItem.file_name || activeItem.name)
      : '',
    activeItemLookup(item) {
      return normalizeItemLookup(item.file_name || item.name);
    },
    onAssignItem: assignItemToSelectedSlot
  });
}

function assignItemToSelectedSlot(item) {
  const resolvedItem = findItemByLookup(item && item.file_name, item && item.name) || item;
  rememberCatalogItems([resolvedItem]);
  state.modalPendingItem = resolvedItem;
  state.modalSearchQuery = resolvedItem.name;
  if (el.modalSearchInput) {
    el.modalSearchInput.value = resolvedItem.name;
  }
  state.modalSearchOpen = false;
  renderItemModal();
  scheduleItemModalAutoApply(true);
}

async function clearSelectedSlot() {
  clearItemModalAutoApplyTimer();
  const slot = getSelectedSlot();
  state.modalPendingItem = null;

  const actionText = `Cleared slot ${slot.slot}`;
  state.bridge.lastAction = actionText;
  const wrote = await writeSlotToBridge({
    slot: slot.slot,
    itemId: null,
    count: 0,
    uses: 0,
    flag0: 0,
    flag1: 0
  }, actionText);
  if (!wrote) {
    renderBridge();
    renderItemModal();
    return;
  }

  clearOverwriteGuard();
  closeModal(el.itemModal);
  renderBridge();
  renderInventory();
  renderSelectedPreview();
  renderClipboardState();
  renderDerivedPanels();
  renderItemModal();
  persistLocalState();
}

function openItemModalForSelectedSlot() {
  clearItemModalAutoApplyTimer();
  state.modalPendingItem = getSelectedSlot().item || null;
  state.modalSearchQuery = '';
  state.modalSearchFilter = 'all';
  state.modalSearchOpen = true;
  state.catalog.modalResults = [];
  el.modalSearchInput.value = '';
  renderItemModal();
  openModal(el.itemModal);
  queueModalSearch(true);
  focusItemSearch();
}

async function applyItemEdits(options = {}) {
  clearItemModalAutoApplyTimer();
  const slot = getSelectedSlot();
  const item = state.modalPendingItem
    ? (findItemByLookup(state.modalPendingItem.file_name || state.modalPendingItem.name, state.modalPendingItem.name) || state.modalPendingItem)
    : null;
  const closeModalAfterWrite = options.closeModalAfterWrite !== false;
  const payload = {
    slot: slot.slot,
    itemId: item ? (item.file_name || item.name) : null,
    internalId: item && typeof item.internal_id === 'number' ? item.internal_id : null,
    itemName: item ? item.name : null,
    count: normalizeWholeNumber(el.modalInputCount.value, slot.count),
    uses: normalizeWholeNumber(el.modalInputUses.value, slot.uses),
    flag0: normalizeWholeNumber(el.modalInputFlag0.value, slot.flag0),
    flag1: normalizeWholeNumber(el.modalInputFlag1.value, slot.flag1)
  };

  const actionText = item
    ? `Updated slot ${slot.slot} to "${item.name}"`
    : `Cleared slot ${slot.slot}`;
  state.bridge.lastAction = actionText;
  const wrote = await writeSlotToBridge(payload, actionText);
  if (!wrote) {
    renderBridge();
    renderItemModal();
    return;
  }

  if (item) {
    rememberCatalogItems([item]);
  }

  state.modalPendingItem = null;
  clearOverwriteGuard();
  if (closeModalAfterWrite) {
    closeModal(el.itemModal);
  }
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
    selectedItem: item ? item.name : (slot.itemId || null),
    itemId: item ? (item.file_name || item.name) : (slot.itemId || null),
    internalId: item ? (item.internal_id || null) : null,
    hex: slot.hex || deriveHexFromItem(item) || '00000000',
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
  state.copiedSlotSourceIndex = null;

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
  state.copiedSlotSourceIndex = null;
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
  await handleHeldSlotTarget(state.selectedSlotIndex);
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
  if (!el.modalFilterButtons) {
    return;
  }

  window.ACNHReactUI.renderModalFilterButtons(el.modalFilterButtons, {
    activeFilter: state.modalSearchFilter,
    onSelect(nextFilter) {
      state.modalSearchFilter = state.modalSearchFilter === nextFilter ? 'all' : nextFilter;
      state.modalSearchOpen = true;
      queueModalSearch(true);
    }
  });
}

function openEditPlayerModal() {
  state.playerModalSection = 'player';
  state.playerFlagsTab = 'recipes';
  hydratePlayerForm();
  openModal(el.playerModal);
}

async function applyPlayerEdits() {
  await commitPlayerState({
    name: sanitizeText(el.playerInputName.value, state.player.name),
    town: sanitizeText(el.playerInputTown.value, state.player.town),
    wallet: normalizeLooseNumber(el.playerInputWallet.value, state.player.wallet),
    bank: normalizeLooseNumber(el.playerInputBank.value, state.player.bank),
    miles: normalizeLooseNumber(el.playerInputMiles.value, state.player.miles)
  }, 'Player values synced to game');

  closeModal(el.playerModal);
}

function setPlayerModalSection(section) {
  const nextSection = ['player', 'storage', 'flags'].includes(section) ? section : 'player';
  state.playerModalSection = nextSection;
  renderPlayerModal();
}

function _updateNameTownIconState(inputEl) {
  const hint = inputEl && inputEl.nextElementSibling;
  if (!hint || !hint.classList.contains('reload-required-hint')) return;
  const isPending = inputEl.value !== (inputEl.dataset.gameValue || '');
  hint.classList.toggle('has-pending', isPending);
}

function bindInjectMaxButtons() {
  const MAX_WALLET = 99999;
  const MAX_BANK   = 999999999;
  const MAX_MILES  = 999999999;

  async function injectMax(field, value, label) {
    if (!state.bridge.connected) { showToast('✗ Bridge not connected'); return; }
    const btn = el[field];
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    const playerKey = field === 'injectMaxWallet' ? 'wallet' : field === 'injectMaxBank' ? 'bank' : 'miles';
    const nextPlayer = { ...state.player, [playerKey]: value };
    const ok = await writePlayerChanges(nextPlayer, `Injected max ${label}`);
    if (btn) { btn.disabled = false; btn.textContent = label; }
    if (ok) showToast(`✓ ${label} → ${value.toLocaleString()}`);
  }

  if (el.injectMaxWallet) el.injectMaxWallet.addEventListener('click', () => injectMax('injectMaxWallet', MAX_WALLET, '💰 Wallet'));
  if (el.injectMaxBank)   el.injectMaxBank.addEventListener('click',   () => injectMax('injectMaxBank',   MAX_BANK,   '🏦 Bank'));
  if (el.injectMaxMiles)  el.injectMaxMiles.addEventListener('click',  () => injectMax('injectMaxMiles',  MAX_MILES,  '🎫 Miles'));
}

function bindInlinePlayerFieldEvents() {
  [el.playerName, el.townName].filter(Boolean).forEach((field) => {
    field.addEventListener('input', () => _updateNameTownIconState(field));
  });

  const inlineFields = [
    el.playerName,
    el.townName,
    el.walletValue,
    el.bankValue,
    el.milesValue
  ].filter(Boolean);

  inlineFields.forEach((field) => {
    field.addEventListener('focus', () => {
      pauseBridgePoll();
      
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

async function applyInlinePlayerEdits() {
  await commitPlayerState({
    name: sanitizeText(el.playerName.value, state.player.name),
    town: sanitizeText(el.townName.value, state.player.town),
    wallet: normalizeLooseNumber(el.walletValue.value, state.player.wallet),
    bank: normalizeLooseNumber(el.bankValue.value, state.player.bank),
    miles: normalizeLooseNumber(el.milesValue.value, state.player.miles)
  }, 'Player values synced to game');
}

async function commitPlayerState(nextPlayer, actionText) {
  const changed =
    nextPlayer.name !== state.player.name ||
    nextPlayer.town !== state.player.town ||
    nextPlayer.wallet !== state.player.wallet ||
    nextPlayer.bank !== state.player.bank ||
    nextPlayer.miles !== state.player.miles;

  if (!changed) {
    return;
  }

  await writePlayerChanges(nextPlayer, actionText);

  renderDerivedPanels();
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

    // Do not restore cached player values; current bridge reads are authoritative.

    // Keep startup selection driven by live/current inventory state.

    if (typeof saved.activeTab === 'string' && el.tabButtons.some((button) => button.dataset.tab === saved.activeTab)) {
      state.activeTab = saved.activeTab;
    }

    if (typeof saved.activeFilter === 'string') {
      const hasFilter = ['all', 'Tool', 'Material', 'Sea creature'].includes(saved.activeFilter);
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

    // Do not restore cached inventory; current bridge reads are authoritative.
  } catch (error) {
    console.error(error);
  }
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.remove('is-closing');
  void modal.offsetWidth;
  modal.classList.add('is-visible');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  syncModalState();
}

function closeModal(modal) {
  if (!modal) return;
  if (modal.classList.contains('hidden')) return;

  modal.classList.remove('is-visible');
  modal.classList.add('is-closing');
  modal.setAttribute('aria-hidden', 'true');

  if (modal === el.itemModal) {
    state.modalSearchOpen = false;
    state.modalPendingItem = null;
  }

  window.setTimeout(() => {
    if (!modal.classList.contains('is-closing')) {
      return;
    }

    modal.classList.remove('is-closing');
    modal.classList.add('hidden');
    syncModalState();
  }, MODAL_CLOSE_TRANSITION_MS);

  syncModalState();
}

function syncModalState() {
  document.body.classList.toggle('modal-open', hasOpenModal());
}

// ─── Backups ──────────────────────────────────────────────────────────────────

function bindBackupEvents() {
  if (el.openBackupsBtn) {
    el.openBackupsBtn.addEventListener('click', () => {
      openModal(el.backupsModal);
      loadBackupsList();
    });
  }

  if (el.backupsCreateBtn) {
    el.backupsCreateBtn.addEventListener('click', handleCreateBackup);
  }
}

async function loadBackupsList() {
  if (!el.backupsList) return;
  el.backupsList.innerHTML = '<div class="backups-loading">Loading\u2026</div>';
  setBackupsStatus('');

  try {
    const res = await apiFetch('/api/backups');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderBackupsList(Array.isArray(data.backups) ? data.backups : []);
  } catch (err) {
    el.backupsList.innerHTML = `<div class="backups-error">Failed to load backups: ${escapeHtml(err.message)}</div>`;
  }
}

function renderBackupsList(backups) {
  if (!el.backupsList) return;

  if (backups.length === 0) {
    el.backupsList.innerHTML = '<div class="backups-empty">No backups yet. Click <strong>New Backup</strong> to create one.</div>';
    return;
  }

  el.backupsList.innerHTML = '';

  backups.slice().reverse().forEach((backup) => {
    const row = document.createElement('div');
    row.className = 'backups-row';
    row.dataset.id = backup.id;

    const saveDate = backup.saveDateHint ? formatBackupDate(backup.saveDateHint) : '—';
    const createdAt = backup.createdAt ? formatBackupDate(backup.createdAt) : '—';
    const sizeStr = backup.sizeBytes ? formatBackupSize(backup.sizeBytes) : '—';
    const label = backup.label || '';

    row.innerHTML = `
      <span class="backups-col-label">
        <input
          class="backup-label-input"
          type="text"
          value="${escapeHtml(label)}"
          placeholder="Add label\u2026"
          maxlength="80"
          aria-label="Backup label"
          data-id="${escapeHtml(backup.id)}"
        />
        <span class="backup-path-hint" title="Backup location on Steam Deck">~/acnh-live-editor/data/save-backups/${escapeHtml(backup.id)}/</span>
      </span>
      <span class="backups-col-date" title="${escapeHtml(backup.saveDateHint || '')}">${escapeHtml(saveDate)}</span>
      <span class="backups-col-created" title="${escapeHtml(backup.createdAt || '')}">${escapeHtml(createdAt)}</span>
      <span class="backups-col-size">${escapeHtml(sizeStr)}</span>
      <span class="backups-col-actions">
        <button class="backup-restore-btn" type="button" data-id="${escapeHtml(backup.id)}" title="Restore this backup">Restore</button>
        <button class="backup-delete-btn" type="button" data-id="${escapeHtml(backup.id)}" title="Delete this backup" aria-label="Delete backup">×</button>
      </span>
    `;

    el.backupsList.appendChild(row);
  });

  el.backupsList.querySelectorAll('.backup-restore-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleRestoreBackup(btn.dataset.id));
  });

  el.backupsList.querySelectorAll('.backup-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteBackup(btn.dataset.id));
  });

  el.backupsList.querySelectorAll('.backup-label-input').forEach((input) => {
    input.addEventListener('blur', () => handleUpdateLabel(input.dataset.id, input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });

  el.backupsList.querySelectorAll('.backup-path-hint').forEach((hint) => {
    let pressTimer = null;
    const LONG_PRESS_MS = 600;

    const startPress = () => {
      hint.classList.add('long-press-active');
      pressTimer = setTimeout(async () => {
        pressTimer = null;
        const path = hint.textContent;
        try {
          await navigator.clipboard.writeText(path);
        } catch (_) {
          // clipboard unavailable — show tip anyway for UX consistency
        }
        hint.classList.remove('long-press-active');
        const tip = document.createElement('span');
        tip.className = 'backup-copied-tip';
        tip.textContent = 'Copied!';
        hint.appendChild(tip);
        tip.addEventListener('animationend', () => tip.remove());
      }, LONG_PRESS_MS);
    };

    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      hint.classList.remove('long-press-active');
    };

    hint.addEventListener('pointerdown', startPress);
    hint.addEventListener('pointerup', cancelPress);
    hint.addEventListener('pointercancel', cancelPress);
    hint.addEventListener('pointermove', cancelPress);
    hint.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

async function handleCreateBackup() {
  if (!el.backupsCreateBtn) return;
  el.backupsCreateBtn.disabled = true;
  setBackupsStatus('Creating backup\u2026');

  try {
    const res = await apiFetch('/api/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '' })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const newId = data.backup && data.backup.id;
    setBackupsStatus(`Created: ~/acnh-live-editor/data/save-backups/${newId || '???'}/`);
    await loadBackupsList();
  } catch (err) {
    setBackupsStatus(`Error: ${err.message}`);
  } finally {
    if (el.backupsCreateBtn) el.backupsCreateBtn.disabled = false;
  }
}

async function handleUpdateLabel(id, label) {
  if (!id) return;
  const input = el.backupsList && el.backupsList.querySelector(`.backup-label-input[data-id="${CSS.escape(id)}"]`);
  try {
    const res = await apiFetch(`/api/backups/${encodeURIComponent(id)}/label`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: String(label).slice(0, 80) })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (input) {
      input.classList.remove('backup-label-saved');
      void input.offsetWidth; // reflow to restart animation
      input.classList.add('backup-label-saved');
    }
    setBackupsStatus('Label saved.');
  } catch (err) {
    setBackupsStatus(`Label error: ${err.message}`);
  }
}

async function handleRestoreBackup(id) {
  if (!id) return;
  const confirmed = window.confirm(
    'Restore this backup?\n\nClose the game before restoring. This will overwrite your current save files.'
  );
  if (!confirmed) return;
  setBackupsStatus('Restoring\u2026');

  const row = el.backupsList && el.backupsList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const restoreBtn = row && row.querySelector('.backup-restore-btn');
  if (restoreBtn) restoreBtn.disabled = true;

  try {
    const res = await apiFetch(`/api/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setBackupsStatus('Restored. Restart the game to load the restored save.');
  } catch (err) {
    setBackupsStatus(`Restore error: ${err.message}`);
    if (restoreBtn) restoreBtn.disabled = false;
  }
}

async function handleDeleteBackup(id) {
  if (!id) return;
  setBackupsStatus('Deleting\u2026');

  try {
    const res = await apiFetch(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    setBackupsStatus(`Deleted.`);
    await loadBackupsList();
  } catch (err) {
    setBackupsStatus(`Delete error: ${err.message}`);
  }
}

function setBackupsStatus(msg) {
  if (el.backupsStatusMsg) el.backupsStatusMsg.textContent = msg;
}

function formatBackupDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return iso;
  }
}

function formatBackupSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Villager Roster ─────────────────────────────────────────────────────────

const PERSONALITY_COLORS = {
  Lazy:   '#74c97a',
  Jock:   '#6ba3e8',
  Cranky: '#e87070',
  Smug:   '#a07ed4',
  Normal: '#e8a0c0',
  Peppy:  '#f0d060',
  Snooty: '#50c8c0',
  Uchi:   '#e8904a',
};

// Derive head-icon URL from villager's name for the list view (acnhcdn.com NpcIcon).
// ?v=2 busts any browser cache entry from when the endpoint used max-age=86400.
function villagerImageUrl(v) {
  if (!v || !v.name) return null;
  const name = v.name.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
  return apiUrl(`/api/villager-icon/${encodeURIComponent(name)}?v=4`);
}

// Derive full-body art URL from villager's name for the edit modal (Nookipedia).
function villagerArtUrl(v) {
  if (!v || !v.name) return null;
  const name = v.name.trim().replace(/[^a-zA-Z0-9 _'\-]/g, '');
  return apiUrl(`/api/villager-art/${encodeURIComponent(name)}`);
}

function openVillagerModal(v) {
  if (!el.villagerModal) { console.error('[villager-modal] #villager-modal not found'); return; }
  if (!window.ACNHReactRuntime) { console.error('[villager-modal] ACNHReactRuntime not loaded'); return; }

  // Pause live bridge reads while editing
  pauseBridgePoll();
  el.villagerModal._villagerData = v;

  const body = el.villagerModal.querySelector('#villager-modal-body');
  if (!body) { console.error('[villager-modal] #villager-modal-body not found'); return; }

  window.ACNHReactRuntime.renderComponent('VillagerModal', body, {
    villager: v,
    artUrl: villagerArtUrl(v),
    onSave(edits) {
      console.log('[villager-save] edits staged:', edits);
      if (state && state.bridge) {
        state.bridge.lastAction = 'Villager edits staged — write pending bridge support';
        renderBridge();
      }
    },
  });

  const titleEl = el.villagerModal.querySelector('.villager-modal-title');
  if (titleEl) titleEl.textContent = v.name || 'Villager';

  openModal(el.villagerModal);
}

function closeVillagerModal() {
  resumeBridgePoll();
  closeModal(el.villagerModal);
}

function renderVillagersPanel(villagers) {
  const roster = document.getElementById('villager-roster');
  const badge  = document.getElementById('villager-count-badge');
  if (!roster) return;

  if (!Array.isArray(villagers) || villagers.length === 0) {
    roster.innerHTML = '<p class="villager-placeholder">No villager data returned.</p>';
    if (badge) badge.textContent = '';
    return;
  }

  // Detect false-positive scan results: if all occupied slots share the same name
  // the scanner found a repeated-data region, not the real villager array.
  const occupied = villagers.filter(v => v && !v.empty && v.name);
  const uniqueNames = new Set(occupied.map(v => v.name));
  if (occupied.length > 1 && uniqueNames.size === 1) {
    roster.innerHTML = '<p class="villager-placeholder">Villager scan is calibrating — tap Refresh Villagers to retry.</p>';
    if (badge) badge.textContent = '';
    return;
  }

  if (badge) badge.textContent = `${occupied.length} / 10`;

  roster.innerHTML = '';

  villagers.forEach((v) => {
    const card = document.createElement('article');
    card.className = 'villager-card' + (v.empty ? ' is-empty' : '') + (v.movingOut ? ' is-moving-out' : '');

    if (v.empty) {
      card.innerHTML = `<span style="color:rgba(255,255,255,0.3);font-size:0.9rem">Slot ${v.slot || '?'} — Empty</span>`;
      roster.appendChild(card);
      return;
    }

    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openVillagerModal(v));

    const imgUrl = villagerImageUrl(v);
    const imgHtml = imgUrl
      ? `<img class="villager-avatar" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(v.name || '')}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<div class="villager-avatar-placeholder" style="display:none">🐾</div>`
      : `<div class="villager-avatar-placeholder">🐾</div>`;

    const pColor = PERSONALITY_COLORS[v.personalityName] || 'rgba(255,255,255,0.2)';
    const genderIcon = v.gender === 'F' ? '♀' : '♂';

    const friendshipPct = Math.round(((v.friendship || 0) / 255) * 100);
    const tier = escapeHtml(v.friendshipTier || 'Stranger');
    const catchphrase = v.catchphrase ? `"${escapeHtml(v.catchphrase)}"` : '';

    const movingOutHtml = v.movingOut
      ? `<span class="villager-moving-out-badge">Moving Out</span>`
      : '';

    card.innerHTML = `
      ${movingOutHtml}
      ${imgHtml}
      <div class="villager-body">
        <div class="villager-name-row">
          <span class="villager-name">${escapeHtml(v.name || 'Unknown')}</span>
          <span class="villager-gender">${genderIcon}</span>
          <span class="villager-personality-badge" style="background:${pColor}">${escapeHtml(v.personalityName || '')}</span>
        </div>
        <div class="villager-species">${escapeHtml(v.speciesName || '')}</div>
        ${catchphrase ? `<div class="villager-catchphrase">${catchphrase}</div>` : ''}
        <div class="villager-friendship-row">
          <div class="villager-friendship-bar-track">
            <div class="villager-friendship-bar-fill" style="width:${friendshipPct}%"></div>
          </div>
          <span class="villager-friendship-tier">${tier}</span>
        </div>
      </div>
    `;
    roster.appendChild(card);
  });
}

async function loadVillagersFromBridge() {
  const roster = document.getElementById('villager-roster');
  const isFirstLoad = !state.villagers || state.villagers.length === 0;

  // Start the fetch immediately so network time runs in parallel with skeleton display
  const fetchPromise = apiFetch('/api/bridge/read-villagers');

  if (isFirstLoad && roster) {
    // Show shimmer skeleton cards while data is in flight.
    // Promise.all with a 500ms minimum ensures the skeleton is visible long
    // enough for the browser to paint and the user to see it.
    roster.innerHTML = Array.from({ length: 10 }, () =>
      '<article class="villager-card villager-card-skeleton"><div class="villager-skel-avatar skeleton-block"></div><div class="villager-skel-body"><div class="villager-skel-name skeleton-block"></div><div class="villager-skel-line skeleton-block"></div><div class="villager-skel-line skeleton-block"></div></div></article>'
    ).join('');
    await Promise.all([
      new Promise(r => setTimeout(r, 500)),
      fetchPromise.catch(() => null), // suppress rejection; handled below
    ]);
  }

  // On background refresh, keep existing cards visible — no DOM wipe
  try {
    const res = await fetchPromise;
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const villagers = (data.payload && data.payload.villagers) ? data.payload.villagers : (data.villagers || []);
    state.villagers = villagers;
    renderVillagersPanel(villagers);
  } catch (err) {
    // Fall back to last known villager data so data persists while offline
    if (state.villagers && state.villagers.length > 0) {
      renderVillagersPanel(state.villagers);
    } else {
      if (roster) roster.innerHTML = `<p class="villager-placeholder" style="color:rgba(255,120,80,0.8)">Error: ${escapeHtml(err.message)}</p>`;
    }
  }
}

const VILLAGER_REFRESH_KEY = 'acnh-villager-refresh-ms';
function getVillagerRefreshMs() {
  const v = parseInt(localStorage.getItem(VILLAGER_REFRESH_KEY) || '30000', 10);
  return isNaN(v) || v < 0 ? 30000 : v;
}

let _villagerRefreshTimer = null;
function scheduleVillagerRefresh() {
  clearInterval(_villagerRefreshTimer);
  const ms = getVillagerRefreshMs();
  if (ms > 0) {
    _villagerRefreshTimer = setInterval(() => {
      if (state.activeTab === 'villagers' && !hasOpenModal()) loadVillagersFromBridge();
    }, ms);
  }
}

function initVillagersTab() {
  const btn = document.getElementById('refresh-villagers-btn');
  if (btn) {
    btn.addEventListener('click', loadVillagersFromBridge);
    btn.style.display = 'none';
  }

  // Restore saved interval preference into the settings select
  const refreshSelect = document.getElementById('settings-villager-refresh');
  if (refreshSelect) {
    const saved = localStorage.getItem(VILLAGER_REFRESH_KEY);
    if (saved && refreshSelect.querySelector(`option[value="${saved}"]`)) {
      refreshSelect.value = saved;
    }
    refreshSelect.addEventListener('change', () => {
      localStorage.setItem(VILLAGER_REFRESH_KEY, refreshSelect.value);
      scheduleVillagerRefresh();
    });
  }

  loadVillagersFromBridge();
  scheduleVillagerRefresh();
  setInterval(() => {
    if (state.activeTab === 'village') refreshBridgeGameData();
  }, 30000);
  setInterval(() => {
    if (state.activeTab === 'map') refreshBridgeStatus('Map tab auto-refresh');
  }, 30000);
}
