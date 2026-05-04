(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;
  const { useState, useEffect, useCallback, useRef, useTransition } = window.React;

  // ── constants ────────────────────────────────────────────────────────────

  const PERSONALITY_COLORS = {
    Cranky: '#e84040',
    Jock:   '#2c8ee0',
    Lazy:   '#7dcf55',
    Normal: '#e87820',
    Peppy:  '#f050a0',
    Smug:   '#8050d8',
    Snooty: '#50c8c0',
    Uchi:   '#e8904a',
  };

  const VILLAGER_FLAGS = [
    { index: 0,  name: 'NnpcHouseLoan' },
    { index: 1,  name: 'NnpcHouseBuildOk' },
    { index: 2,  name: 'NnpcHouseBuilt' },
    { index: 3,  name: 'CoordinateUpdate' },
    { index: 4,  name: 'Is3rdNpc' },
    { index: 5,  name: 'MoveInCompletion' },
    { index: 6,  name: 'LastFtrNum' },
    { index: 7,  name: 'MoveRoomIndex' },
    { index: 8,  name: 'PlayerNamePhrase' },
    { index: 9,  name: 'AbandonedHouse' },
    { index: 10, name: 'InputPhrase' },
    { index: 11, name: '???' },
    { index: 12, name: 'TalkLifeStart1P1st' },
    { index: 13, name: '???' },
    { index: 14, name: 'FromSettlerQuest' },
    { index: 15, name: 'ChangeFirstWall' },
    { index: 16, name: 'ChangeFirstFloor' },
    { index: 17, name: '???' },
    { index: 18, name: 'GetFirstVillagerWallFtr1' },
    { index: 19, name: 'GetFirstVillagerWallFtr2' },
    { index: 20, name: 'UseAudioType' },
    { index: 21, name: 'TalkTransitionTimes' },
    { index: 22, name: 'FinishTalkTransition' },
    { index: 23, name: 'OutdoorCatnap' },
    { index: 24, name: 'ForceMoveOut' },
    { index: 25, name: 'EarlyOrLate' },
    { index: 26, name: 'ContinuousNormalDay' },
    { index: 27, name: 'React1stNpcPresent' },
    { index: 28, name: 'IsReFabricSmartPhone' },
    { index: 29, name: 'MarketBuildingSupport' },
    { index: 30, name: '???' },
    { index: 31, name: '???' },
    { index: 32, name: 'NnpcHouseBuiltToday' },
    { index: 33, name: '???' },
    { index: 34, name: '???' },
    { index: 35, name: 'AppE_Happen1st' },
    { index: 36, name: 'AppE_GetItem1st' },
    { index: 37, name: 'AppE_Rep_HappenToday' },
    { index: 38, name: 'AppE_WelcomoMigrants' },
    { index: 39, name: '???' },
    { index: 40, name: 'AppE_WelcomeMigrantsToday' },
    { index: 41, name: 'MoveInOrder' },
    { index: 42, name: 'EquipEasterWear' },
    { index: 43, name: 'ForceMoveOutVillagerIndex' },
    { index: 44, name: 'DisplayJuneBridePresent' },
    { index: 45, name: 'ProgressDaysJuneBrideParty' },
    { index: 46, name: '???' },
    { index: 47, name: '???' },
    { index: 48, name: '???' },
    { index: 49, name: 'EnableConvTalkDaysCount' },
    { index: 50, name: 'WantIngredients' },
    { index: 51, name: 'BeforeGiveIngredients' },
    { index: 52, name: 'BeforeWantIngredients' },
    { index: 53, name: '???' },
    { index: 54, name: 'XmasEveWakeUpMinute' },
    { index: 55, name: 'EquipChristmasWear' },
    { index: 56, name: 'HarvestGiveHint1' },
    { index: 57, name: 'HarvestGiveHint2' },
    { index: 58, name: 'HarvestGiveHint3' },
    { index: 59, name: 'HarvestGiveHint4' },
    { index: 60, name: '???' },
    { index: 61, name: 'CarnivalFeatherColor' },
    { index: 62, name: 'DisplayValentinePresent' },
    { index: 63, name: '???' },
    { index: 64, name: 'HarvestDemoEndWait' },
    { index: 65, name: 'WoreNewYearHat' },
    { index: 66, name: 'HarvestDemoStateNow' },
    { index: 67, name: '???' },
    { index: 68, name: '???' },
    { index: 69, name: 'CoordinateDIYStatus' },
    { index: 70, name: 'WearItemLayer1LayoutLimit' },
    { index: 71, name: 'CookingInDIYSchedule' },
    { index: 72, name: 'MuseumCafeExitTime' },
    { index: 73, name: 'HouseReset' },
    { index: 74, name: 'ReserveDIYStatus' },
    { index: 75, name: 'AudioShuffleState' },
    { index: 76, name: 'IslandKitchenStandPos' },
    { index: 77, name: 'WeddingDishEventSet' },
    { index: 78, name: 'RoseBouquetEventSet' },
    { index: 79, name: 'MarketBuildingSupportToday' },
    { index: 80, name: 'MileTourTicketSupport' },
  ];

  const HOUSE_FIELDS = [
    { key: 'extension',         label: 'Extension',         type: 'text',   def: 'nhvh' },
    { key: 'houseLevel',        label: 'HouseLevel',        type: 'number', def: 0 },
    { key: 'houseStatus',       label: 'HouseStatus',       type: 'number', def: 0 },
    { key: 'wallUniqueId',      label: 'WallUniqueID',      type: 'text',   def: '' },
    { key: 'roofUniqueId',      label: 'RoofUniqueID',      type: 'text',   def: '' },
    { key: 'doorUniqueId',      label: 'DoorUniqueID',      type: 'text',   def: '' },
    { key: 'orderWallUniqueId', label: 'OrderWallUniqueID', type: 'text',   def: '' },
    { key: 'orderRoofUniqueId', label: 'OrderRoofUniqueID', type: 'text',   def: '' },
    { key: 'orderDoorUniqueId', label: 'OrderDoorUniqueID', type: 'text',   def: '' },
    { key: 'doorDecoItemName',  label: 'DoorDecoItemName',  type: 'text',   def: '0x0000:0x0000' },
    { key: 'npc1',              label: 'NPC1',              type: 'number', def: 0 },
    { key: 'npc2',              label: 'NPC2',              type: 'number', def: -1 },
    { key: 'buildPlayer',       label: 'BuildPlayer',       type: 'number', def: -1 },
  ];

  const EDIT_TABS = ['all', 'furniture', 'clothes', 'room', 'designs', 'memories', 'DIY timer'];

  // ── helpers ───────────────────────────────────────────────────────────────

  async function backupVillager(v) {
    try {
      const res = await fetch('/api/villager/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ villager: v }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        console.log('[villager] backup saved:', data.filename);
      } else {
        console.warn('[villager] backup failed:', data.error);
      }
    } catch (e) {
      console.error('[villager] backup error:', e);
    }
  }

  async function openBackupsFolder() {
    try {
      await fetch('/api/villager/open-backups', { method: 'POST' });
    } catch (e) {
      console.warn('[villager] open-backups error:', e);
    }
  }

  function dumpData(name, type, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'villager'}_${type}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── VillagerSkeleton ──────────────────────────────────────────────────────
  // Shown while usePending state === 'loading' (route-transition skeleton).
  function VillagerSkeleton() {
    return h('div', { className: 'vmod-skeleton' },
      h('div', { className: 'vmod-skeleton-aside' },
        h('div', { className: 'skeleton-block vmod-skeleton-art' })
      ),
      h('div', { className: 'vmod-skeleton-info' },
        h('div', { className: 'skeleton-line vmod-skeleton-name' }),
        h('div', { className: 'vmod-skeleton-btns' },
          ...[0, 1, 2, 3, 4].map(i =>
            h('div', { key: i, className: 'skeleton-line vmod-skeleton-btn', style: { animationDelay: `${i * 0.07}s` } })
          )
        ),
        ...[0, 1, 2, 3, 4].map(i =>
          h('div', { key: i, className: 'skeleton-line vmod-skeleton-row', style: { animationDelay: `${(i + 5) * 0.07}s` } })
        )
      )
    );
  }

  // ── ArtPanel ──────────────────────────────────────────────────────────────

  function ArtPanel({ artUrl, name }) {
    const [failed, setFailed] = useState(false);
    const [loaded, setLoaded] = useState(false);
    return h('aside', { className: 'villager-modal-aside' },
      h('div', { className: 'villager-modal-art-frame' },
        artUrl && !failed
          ? h('img', {
              className: `villager-modal-art${loaded ? '' : ' art-pending'}`,
              src: artUrl,
              alt: name || 'Villager',
              onLoad() { setLoaded(true); },
              onError() { setFailed(true); },
            })
          : h('div', { className: 'villager-modal-art-placeholder' }, '🐾'),
        artUrl && !failed && !loaded
          ? h('div', { className: 'skeleton-block villager-modal-art-shimmer' })
          : null
      )
    );
  }

  // ── SubviewFooter ─────────────────────────────────────────────────────────

  function SubviewFooter({ name, type, dumpData: data, onBack }) {
    return h('div', { className: 'villager-modal-footer vmod-subview-footer' },
      h('div', { className: 'vmod-footer-left' },
        h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: () => dumpData(name, type, data) }, 'Dump'),
        h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: openBackupsFolder }, 'Load'),
        h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: onBack }, 'Cancel'),
      ),
      h('button', {
        type: 'button',
        className: 'action-btn action-btn-solid vmod-btn-sm',
        onClick: () => { console.log(`[${type}-save]`, data); onBack(); },
      }, 'Save')
    );
  }

  // ── MainView ──────────────────────────────────────────────────────────────

  function MainView({ v, catchphrase, setCatchphrase, movingOut, setMovingOut, onViewChange, onSave }) {
    const pColor = PERSONALITY_COLORS[v.personalityName] || 'rgba(255,255,255,0.2)';
    const friendshipVal = v.friendship || 0;
    const friendshipPct = Math.round((friendshipVal / 255) * 100);

    return h('div', { className: 'vmod-main-view' },
      h('div', { className: 'villager-modal-name-row' },
        h('span', { className: 'villager-modal-name' }, v.name || 'Unknown'),
        h('span', { className: 'villager-modal-gender-label' }, v.gender === 'F' ? 'Female' : 'Male')
      ),

      h('div', { className: 'vmod-action-bar' },
        h('button', { type: 'button', className: 'action-btn vmod-action-btn', onClick: () => backupVillager(v) }, 'Backup'),
        h('button', { type: 'button', className: 'action-btn vmod-action-btn', onClick: openBackupsFolder }, 'Load'),
        h('button', { type: 'button', className: 'action-btn vmod-action-btn', onClick: () => onViewChange('house') }, 'House'),
        h('button', { type: 'button', className: 'action-btn vmod-action-btn', onClick: () => onViewChange('flags') }, 'Flags'),
        h('button', { type: 'button', className: 'action-btn vmod-action-btn', onClick: () => onViewChange('edit') }, 'Edit'),
      ),

      h('div', { className: 'vmod-fields' },
        h('div', { className: 'vmod-field-row' },
          h('span', { className: 'vmod-label' }, 'Species'),
          h('span', { className: 'vmod-value vmod-id-pair' },
            h('span', { className: 'vmod-num' }, v.species != null ? String(v.species) : '—'),
            h('span', { className: 'vmod-name' }, v.speciesName || '')
          )
        ),
        h('div', { className: 'vmod-field-row' },
          h('span', { className: 'vmod-label' }, 'Variant'),
          h('span', { className: 'vmod-value vmod-id-pair' },
            h('span', { className: 'vmod-num' }, v.variant != null ? String(v.variant) : '—'),
            h('span', { className: 'vmod-name' }, v.internalId || '')
          )
        ),
        h('div', { className: 'vmod-field-row' },
          h('span', { className: 'vmod-label' }, 'Personality'),
          h('span', { className: 'vmod-value' },
            h('span', { className: 'villager-personality-badge', style: { background: pColor } }, v.personalityName || '')
          )
        ),
        h('div', { className: 'vmod-field-row vmod-field-catchphrase' },
          h('span', { className: 'vmod-label' }, 'Catchphrase'),
          h('span', { className: 'vmod-value vmod-catchphrase-wrap' },
            h('input', {
              className: 'vmod-input',
              type: 'text',
              maxLength: 12,
              value: catchphrase,
              onChange: (e) => setCatchphrase(e.target.value),
            }),
            h('button', {
              type: 'button',
              className: 'action-btn vmod-btn-sm',
              onClick: () => setCatchphrase(v.catchphrase || ''),
            }, 'Original')
          )
        ),
        h('div', { className: 'vmod-field-row' },
          h('span', { className: 'vmod-label' }, 'Moving Out'),
          h('span', { className: 'vmod-value' },
            h('label', { className: 'vmod-checkbox-label' },
              h('input', {
                type: 'checkbox',
                checked: movingOut,
                onChange: (e) => setMovingOut(e.target.checked),
              })
            )
          )
        )
      ),

      h('div', { className: 'villager-modal-friendship' },
        h('div', { className: 'villager-modal-friendship-label' },
          h('span', null, 'Friendship'),
          h('span', { className: 'vmod-friendship-value' }, `${friendshipVal} / 255`),
          h('span', { className: 'villager-friendship-tier' }, v.friendshipTier || 'Stranger')
        ),
        h('div', { className: 'villager-friendship-bar-track' },
          h('div', { className: 'villager-friendship-bar-fill', style: { width: `${friendshipPct}%` } })
        )
      ),

      v.slot != null ? h('div', { className: 'villager-modal-slot' }, `Island slot ${v.slot}`) : null,

      h('div', { className: 'villager-modal-footer' },
        h('button', {
          type: 'button',
          className: 'action-btn action-btn-solid',
          onClick: () => onSave({ catchphrase, movingOut }),
        }, 'Save')
      )
    );
  }

  // ── HouseView ─────────────────────────────────────────────────────────────

  function HouseView({ v, onBack }) {
    const house = v.house || {};
    const initFields = {};
    HOUSE_FIELDS.forEach(f => { initFields[f.key] = house[f.key] != null ? house[f.key] : f.def; });
    const [fields, setFields] = useState(initFields);
    const iconUrl = `/api/villager-icon/${v.name}?v=2`;

    const setField = useCallback((key, val) => {
      setFields(prev => ({ ...prev, [key]: val }));
    }, []);

    return h('div', { className: 'vmod-house-view' },
      h('div', { className: 'vmod-subview-title vmod-edit-title' },
        h('img', { className: 'vmod-edit-icon', src: iconUrl, alt: v.name, onError(e) { e.target.style.display = 'none'; } }),
        h('span', null, `House — ${v.name || 'Villager'}`)
      ),
      h('div', { className: 'vmod-house-fields' },
        HOUSE_FIELDS.map(f =>
          h('div', { className: 'vmod-field-row', key: f.key },
            h('span', { className: 'vmod-label' }, f.label),
            h('span', { className: 'vmod-value' },
              h('input', {
                className: 'vmod-input vmod-house-input',
                type: f.type,
                value: String(fields[f.key] != null ? fields[f.key] : ''),
                onChange: (e) => setField(
                  f.key,
                  f.type === 'number' ? (parseInt(e.target.value, 10) || 0) : e.target.value
                ),
              })
            )
          )
        )
      ),
      h(SubviewFooter, { name: v.name, type: 'house', dumpData: fields, onBack })
    );
  }

  // ── FlagsView ─────────────────────────────────────────────────────────────

  function FlagsView({ v, onBack }) {
    const rawFlags = Array.isArray(v.flags) ? v.flags : [];
    const initValues = {};
    VILLAGER_FLAGS.forEach(f => { initValues[f.index] = rawFlags[f.index] != null ? rawFlags[f.index] : 0; });
    const [flagValues, setFlagValues] = useState(initValues);
    const [selectedIdx, setSelectedIdx] = useState(0);

    const selected = VILLAGER_FLAGS[selectedIdx];
    const selectedValue = flagValues[selectedIdx] != null ? flagValues[selectedIdx] : 0;

    const iconUrl = `/api/villager-icon/${v.name}?v=2`;

    return h('div', { className: 'vmod-flags-view' },
      h('div', { className: 'vmod-subview-title vmod-edit-title' },
        h('img', { className: 'vmod-edit-icon', src: iconUrl, alt: v.name, onError(e) { e.target.style.display = 'none'; } }),
        h('span', null, `Flags — ${v.name || 'Villager'}`)
      ),
      h('div', { className: 'vmod-flags-shell' },
        h('div', { className: 'vmod-flags-list', role: 'listbox', 'aria-label': 'Villager flags' },
          VILLAGER_FLAGS.filter(f => f.name !== '???').map(f =>
            h('div', {
              key: f.index,
              className: `vmod-flag-item${selectedIdx === f.index ? ' is-selected' : ''}`,
              role: 'option',
              'aria-selected': selectedIdx === f.index,
              onClick: () => setSelectedIdx(f.index),
            },
              `${String(f.index).padStart(2, '0')} - ${f.name} = ${flagValues[f.index] != null ? flagValues[f.index] : 0}`
            )
          )
        ),
        h('div', { className: 'vmod-flags-editor' },
          h('div', { className: 'vmod-flags-selected-name' }, selected ? selected.name : ''),
          h('label', { className: 'vmod-flags-value-label' }, 'Value:'),
          h('input', {
            className: 'vmod-input vmod-flags-value-input',
            type: 'number',
            value: String(selectedValue),
            onChange: (e) => setFlagValues(prev => ({
              ...prev,
              [selectedIdx]: parseInt(e.target.value, 10) || 0,
            })),
          }),
          h('button', {
            type: 'button',
            className: 'action-btn vmod-btn-sm',
            style: { marginTop: '8px', width: '100%' },
            onClick: () => {
              const orig = Array.isArray(v.flags) && v.flags[selectedIdx] != null ? v.flags[selectedIdx] : 0;
              setFlagValues(prev => ({ ...prev, [selectedIdx]: orig }));
            },
          }, 'Original')
        )
      ),
      h(SubviewFooter, { name: v.name, type: 'flags', dumpData: flagValues, onBack })
    );
  }

  // ── EditView ──────────────────────────────────────────────────────────────

  function EditView({ v, onBack }) {
    const [activeTab, setActiveTab] = useState('all');
    const iconUrl = `/api/villager-icon/${v.name}?v=2`;
    const friendshipVal = v.friendship || 0;
    const friendshipPct = Math.round((friendshipVal / 255) * 100);

    return h('div', { className: 'vmod-edit-view' },
      h('div', { className: 'vmod-subview-title vmod-edit-title' },
        h('img', { className: 'vmod-edit-icon', src: iconUrl, alt: v.name, onError(e) { e.target.style.display = 'none'; } }),
        h('span', null, `Edit — ${v.name || 'Villager'}`)
      ),
      h('div', { className: 'villager-modal-friendship' },
        h('div', { className: 'villager-modal-friendship-label' },
          h('span', null, 'Friendship'),
          h('span', { className: 'vmod-friendship-value' }, `${friendshipVal} / 255`),
          h('span', { className: 'villager-friendship-tier' }, v.friendshipTier || 'Stranger')
        ),
        h('div', { className: 'villager-friendship-bar-track' },
          h('div', { className: 'villager-friendship-bar-fill', style: { width: `${friendshipPct}%` } })
        )
      ),
      h('div', { className: 'vmod-edit-wrapper' },
        h('div', { className: 'vmod-edit-tabs tab-bar', role: 'tablist' },
          EDIT_TABS.map(tab =>
            h('button', {
              key: tab,
              type: 'button',
              className: `tab-btn vmod-edit-tab-btn${activeTab === tab ? ' is-active' : ''}`,
              role: 'tab',
              'aria-selected': activeTab === tab,
              onClick: () => setActiveTab(tab),
            }, tab)
          )
        ),
        h('div', { className: 'vmod-edit-panel' },
          h('p', { className: 'vmod-edit-stub' },
            `${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} editing — coming soon`
          )
        )
      ),
      h('div', { className: 'villager-modal-footer vmod-subview-footer' },
        h('div', { className: 'vmod-footer-left' },
          h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: onBack }, 'Back'),
        ),
        h('button', { type: 'button', className: 'action-btn action-btn-solid vmod-btn-sm', onClick: onBack }, 'Save')
      )
    );
  }

  // ── VillagerModal (root) ───────────────────────────────────────────────────

  function VillagerModal({ villager: v, artUrl, onSave }) {
    const villagerKey = v ? `${v.slot || ''}-${v.name || ''}` : '';
    const [view, setView] = useState('main');
    const [catchphrase, setCatchphrase] = useState(v ? (v.catchphrase || '') : '');
    const [movingOut, setMovingOut] = useState(v ? !!v.movingOut : false);
    const [isPending, startTransition] = useTransition();

    // Reset local state whenever the villager changes — wrapped in startTransition
    // (React 18 concurrent: marks updates as non-urgent, shows skeleton during transition).
    useEffect(() => {
      startTransition(() => {
        setCatchphrase(v ? (v.catchphrase || '') : '');
        setMovingOut(v ? !!v.movingOut : false);
        setView('main');
      });
    }, [villagerKey]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!v) return null;

    const handleSave = useCallback((edits) => {
      if (onSave) onSave(edits);
    }, [onSave]);

    const showArt = view === 'main';

    // Pending UI: show shimmer skeleton while transitioning between villagers
    if (isPending) {
      return h('div', { className: 'villager-modal-body-inner' },
        h('div', { className: 'villager-modal-shell' },
          h(VillagerSkeleton)
        )
      );
    }

    return h('div', { className: 'villager-modal-body-inner' },
      h('div', { className: `villager-modal-shell${showArt ? '' : ' vmod-fullwidth'}` },
        showArt ? h(ArtPanel, { artUrl, name: v.name }) : null,
        h('div', { className: 'villager-modal-info' },
          view === 'main'
            ? h(MainView, { v, catchphrase, setCatchphrase, movingOut, setMovingOut, onViewChange: setView, onSave: handleSave })
            : view === 'house'
              ? h(HouseView, { v, onBack: () => setView('main') })
              : view === 'flags'
                ? h(FlagsView, { v, onBack: () => setView('main') })
                : view === 'edit'
                  ? h(EditView, { v, onBack: () => setView('main') })
                  : null
        )
      )
    );
  }

  registerComponent('VillagerModal', VillagerModal);
})();
