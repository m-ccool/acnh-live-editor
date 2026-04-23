'use strict';

let itemModalAutoApplyTimeoutId = 0;
const MODAL_CLOSE_TRANSITION_MS = 280;
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
    const response = await fetch('/api/bridge/write-player', {
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
  el.townName.value = state.player.town || '';
  el.walletValue.value = formatNumber(state.player.wallet);
  el.bankValue.value = formatNumber(state.player.bank);
  el.milesValue.value = formatNumber(state.player.miles);
  el.playerAvatar.src = (!state.bridge.connected || !state.player.avatar)
    ? '/assets/items/Bob_NH.png'
    : state.player.avatar;
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

  el.tabPlayerSummaryName.textContent = state.player.name;
  el.tabPlayerSummaryTown.textContent = state.player.town;
  el.tabPlayerSummaryWallet.textContent = formatNumber(state.player.wallet);
  el.tabPlayerSummaryMiles.textContent = formatNumber(state.player.miles);

  if (!state.bridge.connected) {
    el.tabBridgeState.textContent = 'Offline';
  } else if (state.bridge.ryujinxRunning === true) {
    el.tabBridgeState.textContent = 'Connected (Ryujinx running)';
  } else if (state.bridge.ryujinxRunning === false) {
    el.tabBridgeState.textContent = 'Connected (Ryujinx not running)';
  } else {
    el.tabBridgeState.textContent = 'Connected (Ryujinx unknown)';
  }

  el.tabBridgeMode.textContent = state.bridge.inventoryAdapter
    ? `${state.bridge.mode} / ${state.bridge.inventoryAdapter}`
    : state.bridge.mode;
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

  const numericChanged =
    nextPlayer.wallet !== state.player.wallet ||
    nextPlayer.bank !== state.player.bank ||
    nextPlayer.miles !== state.player.miles;

  if (!numericChanged) {
    state.bridge.lastAction = 'Live player writes currently support wallet, bank, and miles only';
    renderBridge();
    renderPlayer();
    hydratePlayerForm();
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

