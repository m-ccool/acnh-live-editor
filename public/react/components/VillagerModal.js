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

  const EDIT_TABS = ['furniture', 'clothes', 'room', 'designs', 'memories', 'DIY timer'];

  const VILLAGER_TABS = [
    { key: 'profile',     label: 'Profile' },
    { key: 'savemanager', label: 'Save' },
    { key: 'house',       label: 'House' },
    { key: 'flags',       label: 'Flags' },
    { key: 'edit',        label: 'Edit' },
  ];

  const ROOM_FIELDS = [
    { label: 'Accent Wall', designKey: 'accentWallDesignId', extraKey: 'accentWallDirection', extraLabel: 'Direction' },
    { label: 'Wall',        designKey: 'wallDesignId',       extraKey: 'wallInfoBit',          extraLabel: 'InfoBit'   },
    { label: 'Floor',       designKey: 'floorDesignId',      extraKey: 'floorDirection',       extraLabel: 'Direction' },
  ];

  const PLAYER_MEM_FLAGS = [
    { index: 0,  name: 'TalkFreeMultiDayEventNow' },
    { index: 1,  name: 'ContinuousTalkDays' },
    { index: 2,  name: 'SameLand' },
    { index: 3,  name: 'SetGreeting' },
    { index: 4,  name: 'EasterGetRecipeFlag' },
    { index: 5,  name: 'TalkProgressMuseumBuilt2' },
    { index: 6,  name: 'NextMoveOutTalk' },
    { index: 7,  name: 'TalkMoveOut' },
    { index: 8,  name: 'VisitCount' },
    { index: 9,  name: 'VisitedCount' },
    { index: 10, name: 'Friendship' },
    { index: 11, name: 'TalkCountToday' },
    { index: 12, name: 'TalkCountInNpcHouseToday' },
    { index: 13, name: 'HasAcquaintanceship' },
    { index: 14, name: 'SitBenchFlag' },
    { index: 15, name: 'TalkInDream' },
    { index: 16, name: 'HalloweenGiveCandyCount' },
    { index: 17, name: 'PastCountFromLastVisitPlayerHouse' },
    { index: 18, name: 'TalkedAsSameVillageResident' },
  ];

  const INV_COLS = 8;
  const INV_ROWS = 3;

  // ── helpers ───────────────────────────────────────────────────────────────

  async function backupVillager(v) {
    try {
      const res = await apiFetch('/api/villager/backup', {
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
      await apiFetch('/api/villager/open-backups', { method: 'POST' });
    } catch (e) {
      console.warn('[villager] open-backups error:', e);
    }
  }

  function formatBackupDate(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
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

  function SubviewFooter({ name, type, dumpData: data, onBack, onSave }) {
    const [saveState, setSaveState] = useState('idle'); // idle | saving | ok | error
    const handleSave = async () => {
      if (onSave) {
        setSaveState('saving');
        try {
          await onSave();
          setSaveState('ok');
          setTimeout(onBack, 700);
        } catch (e) {
          setSaveState('error');
          setTimeout(() => setSaveState('idle'), 2500);
        }
      } else {
        onBack();
      }
    };
    const saveDot = saveState !== 'idle'
      ? h('span', { className: `vmod-save-dot vmod-save-dot--${saveState}`, 'aria-hidden': 'true' })
      : null;
    return h('div', { className: 'villager-modal-footer vmod-subview-footer' },
      h('div', { className: 'vmod-footer-left' },
        h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: () => dumpData(name, type, data) }, 'Dump'),
        h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: onBack, disabled: saveState === 'saving' }, 'Cancel'),
      ),
      h('button', {
        type: 'button',
        className: 'action-btn action-btn-solid vmod-btn-sm vmod-save-btn',
        onClick: handleSave,
        disabled: saveState === 'saving' || saveState === 'ok',
      }, 'Save', saveDot)
    );
  }

  // ── MainView ──────────────────────────────────────────────────────────────

  function ProfileView({ v, catchphrase, setCatchphrase, movingOut, setMovingOut, onSave }) {
    const pColor = PERSONALITY_COLORS[v.personalityName] || 'rgba(255,255,255,0.2)';
    const friendshipVal = v.friendship || 0;
    const friendshipPct = Math.round((friendshipVal / 255) * 100);

    return h('div', { className: 'vmod-main-view' },
      h('div', { className: 'villager-modal-name-row' },
        h('span', { className: 'villager-modal-name' }, v.name || 'Unknown'),
        h('span', { className: 'villager-modal-gender-label' }, v.gender === 'F' ? 'Female' : 'Male')
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
          h('div', { className: 'villager-friendship-bar-fill', style: { width: `${friendshipVal === 0 ? 5 : friendshipPct}%`, opacity: friendshipVal === 0 ? 0.4 : 1 } })
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

  // ── SaveManagerView ──────────────────────────────────────────────────────

  function SaveManagerView({ v, onLoadBackup }) {
    const [backups, setBackups] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [backupState, setBackupState] = useState('idle');
    const [backupFilename, setBackupFilename] = useState('');

    const refreshList = useCallback(() => {
      apiFetch(`/api/villager/backups/${encodeURIComponent(v.name || '')}`)
        .then(r => r.json())
        .then(data => setBackups(Array.isArray(data.backups) ? data.backups : []))
        .catch(() => setLoadError('Failed to load backups'));
    }, [v.name]);

    useEffect(() => {
      let cancelled = false;
      apiFetch(`/api/villager/backups/${encodeURIComponent(v.name || '')}`)
        .then(r => r.json())
        .then(data => { if (!cancelled) setBackups(Array.isArray(data.backups) ? data.backups : []); })
        .catch(() => { if (!cancelled) setLoadError('Failed to load backups'); });
      return () => { cancelled = true; };
    }, [v.name]);

    const handleCreateBackup = useCallback(async () => {
      setBackupState('saving');
      try {
        const res = await apiFetch('/api/villager/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ villager: v }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Backup failed');
        setBackupFilename(data.filename || '');
        setBackupState('ok');
        refreshList();
        setTimeout(() => setBackupState('idle'), 3000);
      } catch {
        setBackupState('error');
        setTimeout(() => setBackupState('idle'), 2500);
      }
    }, [v, refreshList]);

    const backupLabel = backupState === 'saving' ? 'Saving…'
      : backupState === 'ok'    ? '✓ Saved'
      : backupState === 'error' ? '✗ Failed'
      : 'Create Backup';

    return h('div', { className: 'vmod-save-manager' },
      h('div', { className: 'vmod-save-manager-section' },
        h('div', { className: 'vmod-save-manager-heading' }, 'Create Backup'),
        h('p', { className: 'vmod-save-manager-hint' },
          'Snapshots all data (catchphrase, house, flags, furniture) to a local .nhv file.'
        ),
        h('div', { className: 'vmod-save-manager-actions' },
          h('button', {
            type: 'button',
            className: 'action-btn action-btn-solid vmod-btn-sm',
            onClick: handleCreateBackup,
            disabled: backupState === 'saving' || backupState === 'ok',
          }, backupLabel),
          backupFilename
            ? h('span', { className: 'vmod-save-manager-filename' }, backupFilename)
            : null
        )
      ),
      h('div', { className: 'vmod-save-manager-section' },
        h('div', { className: 'vmod-save-manager-heading' }, 'Load from Backup'),
        h('p', { className: 'vmod-save-manager-hint' },
          'Loads catchphrase & moving-out state into the form. Click Save to write to game.'
        ),
        backups === null
          ? h('div', { className: 'vmod-save-manager-loading' }, 'Loading…')
          : loadError
            ? h('div', { className: 'vmod-save-manager-error' }, loadError)
            : backups.length === 0
              ? h('div', { className: 'vmod-save-manager-empty' }, `No backups found for ${v.name || 'this villager'}.`)
              : h('div', { className: 'vmod-backup-list' },
                  backups.map((b, i) =>
                    h('div', { key: b.filename || i, className: 'vmod-backup-row' },
                      h('div', { className: 'vmod-backup-row-info' },
                        h('span', { className: 'vmod-backup-row-date' }, formatBackupDate(b.timestamp)),
                        h('span', { className: 'vmod-backup-row-size' }, `${b.sizeKb} KB`)
                      ),
                      h('button', {
                        type: 'button',
                        className: 'action-btn vmod-btn-sm',
                        onClick: () => onLoadBackup(b),
                      }, 'Load')
                    )
                  )
                )
      )
    );
  }

  // ── HouseView ─────────────────────────────────────────────────────────────

  function HouseView({ v, onBack }) {
    const house = v.house || {};
    const initFields = {};
    HOUSE_FIELDS.forEach(f => { initFields[f.key] = house[f.key] != null ? house[f.key] : f.def; });
    const [fields, setFields] = useState(initFields);
    const iconUrl = apiUrl(`/api/villager-icon/${encodeURIComponent(v.name || "")}?v=4`);
    const setField = useCallback((key, val) => {
      setFields(prev => ({ ...prev, [key]: val }));
    }, []);

    const handleSave = useCallback(async () => {
      const villagerWithHouse = { ...v, house: { ...(v.house || {}), ...fields } };
      const res = await apiFetch('/api/villager/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ villager: villagerWithHouse }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Backup failed');
    }, [v, fields]);

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
      h(SubviewFooter, { name: v.name, type: 'house', dumpData: fields, onBack, onSave: handleSave })
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

    const iconUrl = apiUrl(`/api/villager-icon/${encodeURIComponent(v.name || "")}?v=4`);

    const handleSave = useCallback(async () => {
      const allFlags = Array.isArray(v.flags) ? [...v.flags] : [];
      Object.entries(flagValues).forEach(([idx, val]) => { allFlags[Number(idx)] = val; });
      const villagerWithFlags = { ...v, flags: allFlags };
      const res = await apiFetch('/api/villager/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ villager: villagerWithFlags }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Backup failed');
    }, [v, flagValues]);

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
      h(SubviewFooter, { name: v.name, type: 'flags', dumpData: flagValues, onBack, onSave: handleSave })
    );
  }

  // ── InventoryPanel ────────────────────────────────────────────────────────

  function InventoryPanel({ furniture }) {
    const slots = Array.from({ length: INV_COLS * INV_ROWS }, (_, i) =>
      (furniture && furniture[i]) ? furniture[i] : null
    );
    const [selectedSlot, setSelectedSlot] = useState(0);
    const sel = slots[selectedSlot];
    const selIsEmpty = !sel || sel.itemId === '0xFFFE' || sel.itemId === '0xFFFF';
    const [count, setCount]   = useState(sel ? (sel.count  || 0) : 0);
    const [uses,  setUses]    = useState(sel ? (sel.uses   || 0) : 0);
    const [flag0, setFlag0]   = useState(sel ? (sel.flag0  || 0) : 0);
    const [flag1, setFlag1]   = useState(sel ? (sel.flag1  || 0) : 0);

    return h('div', { className: 'vedit-inv-shell' },
      h('div', { className: 'vedit-inv-left' },
        h('div', {
          className: 'vedit-inv-grid',
          style: { gridTemplateColumns: `repeat(${INV_COLS}, minmax(0, 1fr))` },
        },
          slots.map((slot, i) => {
            const isEmpty = !slot || slot.itemId === '0xFFFE' || slot.itemId === '0xFFFF';
            return h('div', {
              key: i,
              className: `vedit-inv-slot${selectedSlot === i ? ' is-selected' : ''}${isEmpty ? ' is-empty-slot' : ''}`,
              onClick: () => setSelectedSlot(i),
            },
              slot && !isEmpty && (slot.count > 1) ? h('span', { className: 'vedit-inv-count' }, String(slot.count)) : null,
              slot && !isEmpty && slot.imageUrl
                ? h('img', { className: 'vedit-inv-img', src: slot.imageUrl, alt: slot.name || '', onLoad(e) { e.target.classList.add('is-loaded'); }, onError(e) { e.target.classList.add('is-loaded'); } })
                : slot && !isEmpty
                  ? h('span', { className: 'vedit-inv-slot-label' }, slot.name || slot.itemId || '')
                  : null
            );
          })
        ),
        h('div', { className: 'vedit-inv-left-actions' },
          h('button', { type: 'button', className: 'action-btn vmod-btn-sm' }, 'Clear'),
          h('button', { type: 'button', className: 'action-btn vmod-btn-sm' }, 'Sort'),
        )
      ),
      h('div', { className: 'vedit-inv-detail' },
        h('div', { className: 'vedit-inv-preview' },
          sel && !selIsEmpty && sel.imageUrl
            ? h('img', { className: 'vedit-inv-preview-img', src: sel.imageUrl, alt: sel.name || '', onLoad(e) { e.target.classList.add('is-loaded'); }, onError(e) { e.target.classList.add('is-loaded'); } })
            : null
        ),
        h('div', { className: 'vedit-inv-name-row' },
          h('span', { className: 'vedit-inv-name-text' }, sel && !selIsEmpty ? (sel.name || sel.itemId || '(None)') : '(None)')
        ),
        [['Count', count, setCount], ['Uses', uses, setUses], ['Flag0', flag0, setFlag0], ['Flag1', flag1, setFlag1]].map(([label, val, setter]) =>
          h('div', { key: label, className: 'vedit-inv-field-row' },
            h('span', { className: 'vmod-label vedit-inv-field-label' }, `${label}:`),
            h('input', {
              className: 'vmod-input vedit-inv-field-input',
              type: 'number',
              min: 0,
              value: String(val),
              onChange: e => setter(parseInt(e.target.value, 10) || 0),
            })
          )
        )
      )
    );
  }

  // ── ClothesPanel ──────────────────────────────────────────────────────────

  const CLOTHES_COUNT = 24;
  const CLOTHES_COLS  = 8;

  function ClothesPanel({ clothes }) {
    const slots = Array.from({ length: CLOTHES_COUNT }, (_, i) =>
      (clothes && clothes[i]) ? clothes[i] : null
    );
    const [selectedSlot, setSelectedSlot] = useState(0);
    const sel = slots[selectedSlot];
    const selIsEmpty = !sel || sel.itemId === '0xFFFE' || sel.itemId === '0xFFFF';
    const allEmpty = slots.every(s => !s || s.itemId === '0xFFFE' || s.itemId === '0xFFFF');
    const [flag0, setFlag0] = useState(sel ? (sel.flag0 || 0) : 0);
    const [flag1, setFlag1] = useState(sel ? (sel.flag1 || 0) : 0);

    return h('div', { className: 'vedit-inv-shell' },
      h('div', { className: 'vedit-inv-left' },
        allEmpty
          ? h('div', { className: 'vedit-inv-empty-state' }, 'Wardrobe is empty — gift clothing items to this villager to populate their wardrobe.')
          : h('div', {
              className: 'vedit-inv-grid',
              style: { gridTemplateColumns: `repeat(${CLOTHES_COLS}, minmax(0, 1fr))` },
            },
              slots.map((slot, i) => {
                const isEmpty = !slot || slot.itemId === '0xFFFE' || slot.itemId === '0xFFFF';
                return h('div', {
                  key: i,
                  className: `vedit-inv-slot${selectedSlot === i ? ' is-selected' : ''}${isEmpty ? ' is-empty-slot' : ''}`,
                  onClick: () => setSelectedSlot(i),
                },
                  slot && !isEmpty && slot.imageUrl
                    ? h('img', { className: 'vedit-inv-img', src: slot.imageUrl, alt: slot.name || '', onLoad(e) { e.target.classList.add('is-loaded'); }, onError(e) { e.target.classList.add('is-loaded'); } })
                    : slot && !isEmpty
                      ? h('span', { className: 'vedit-inv-slot-label' }, slot.name || slot.itemId || '')
                      : null
                );
              })
            )
      ),
      h('div', { className: 'vedit-inv-detail' },
        h('div', { className: 'vedit-inv-preview' },
          sel && !selIsEmpty && sel.imageUrl
            ? h('img', { className: 'vedit-inv-preview-img', src: sel.imageUrl, alt: sel.name || '', onLoad(e) { e.target.classList.add('is-loaded'); }, onError(e) { e.target.classList.add('is-loaded'); } })
            : null
        ),
        h('div', { className: 'vedit-inv-name-row' },
          h('span', { className: 'vedit-inv-name-text' }, sel && !selIsEmpty ? (sel.name || sel.itemId || '(None)') : '(None)')
        ),
        [['Flag0', flag0, setFlag0], ['Flag1', flag1, setFlag1]].map(([label, val, setter]) =>
          h('div', { key: label, className: 'vedit-inv-field-row' },
            h('span', { className: 'vmod-label vedit-inv-field-label' }, `${label}:`),
            h('input', {
              className: 'vmod-input vedit-inv-field-input',
              type: 'number',
              min: 0,
              value: String(val),
              onChange: e => setter(parseInt(e.target.value, 10) || 0),
            })
          )
        )
      )
    );
  }

  // ── RoomPanel ────────────────────────────────────────────────────────────

  function RoomPanel({ room }) {
    const init = {};
    ROOM_FIELDS.forEach(f => {
      init[f.designKey] = (room && room[f.designKey]) != null ? room[f.designKey] : 0;
      init[f.extraKey]  = (room && room[f.extraKey])  != null ? room[f.extraKey]  : 0;
    });
    const [fields, setFields] = useState(init);
    const set = (key, val) => setFields(prev => ({ ...prev, [key]: val }));

    return h('div', { className: 'vedit-room-shell' },
      h('div', { className: 'vedit-room-table' },
        h('div', { className: 'vedit-room-thead' },
          h('div', { className: 'vedit-room-th vedit-room-th-label' }, 'Surface'),
          h('div', { className: 'vedit-room-th' }, 'Design ID'),
          h('div', { className: 'vedit-room-th' }, 'Extra'),
        ),
        ROOM_FIELDS.map(f =>
          h('div', { key: f.label, className: 'vedit-room-row' },
            h('div', { className: 'vedit-room-cell vedit-room-cell-label' },
              h('button', { type: 'button', className: 'action-btn vmod-btn-sm vedit-room-label-btn' }, f.label)
            ),
            h('div', { className: 'vedit-room-cell' },
              h('input', {
                className: 'vmod-input vedit-room-input',
                type: 'number',
                value: String(fields[f.designKey]),
                onChange: e => set(f.designKey, parseInt(e.target.value, 10) || 0),
              })
            ),
            h('div', { className: 'vedit-room-cell vedit-room-cell-extra' },
              h('span', { className: 'vedit-room-extra-label vmod-label' }, f.extraLabel),
              h('input', {
                className: 'vmod-input vedit-room-input',
                type: 'number',
                value: String(fields[f.extraKey]),
                onChange: e => set(f.extraKey, parseInt(e.target.value, 10) || 0),
              })
            )
          )
        )
      )
    );
  }

  // ── DIYTimerPanel ─────────────────────────────────────────────────────────

  function DIYTimerPanel({ diy }) {
    const [isCrafting, setIsCrafting] = useState(!!(diy && diy.isCrafting));
    const [craftingUntil, setCraftingUntil] = useState(
      (diy && diy.craftingUntil) ? diy.craftingUntil : ''
    );
    const [recipe, setRecipe] = useState(
      (diy && diy.recipe != null) ? String(diy.recipe) : ''
    );
    const recipes = Array.isArray(diy && diy.recipeList) ? diy.recipeList : [];

    return h('div', { className: 'vedit-diy-shell' },
      h('div', { className: 'vedit-diy-form' },
        h('div', { className: 'vedit-diy-row' },
          h('label', { className: 'vedit-diy-label' }, 'Is crafting?'),
          h('input', {
            type: 'checkbox',
            className: 'vedit-diy-checkbox',
            checked: isCrafting,
            onChange: e => {
              const checked = e.target.checked;
              setIsCrafting(checked);
              if (checked && !craftingUntil) {
                const d = new Date(Date.now() + 60 * 60 * 1000);
                setCraftingUntil(
                  `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
                );
              }
            },
          })
        ),
        h('div', { className: 'vedit-diy-row' },
          h('label', { className: 'vedit-diy-label' }, 'Crafting until:'),
          h('input', {
            type: 'time',
            step: '1',
            className: 'vmod-input vedit-diy-time',
            value: craftingUntil,
            onChange: e => setCraftingUntil(e.target.value),
            disabled: !isCrafting,
          })
        ),
        h('div', { className: 'vedit-diy-row' },
          h('label', { className: 'vedit-diy-label' }, 'Recipe:'),
          h('select', {
            className: 'vmod-input vedit-diy-select',
            value: recipe,
            onChange: e => setRecipe(e.target.value),
            disabled: !isCrafting,
          },
            h('option', { value: '' }, '— none —'),
            recipes.length > 0
              ? recipes.map((r, i) =>
                  h('option', { key: i, value: String(r.id ?? i) }, r.name || `Recipe ${i}`)
                )
              : recipe
                ? h('option', { value: recipe }, `Recipe #${recipe}`)
                : null
          )
        )
      )
    );
  }

  // ── DesignsPanel ─────────────────────────────────────────────────────────

  function DesignsPanel({ designs }) {
    const items = Array.isArray(designs) ? designs : [];
    const [selectedIdx, setSelectedIdx] = useState(0);

    return h('div', { className: 'vedit-designs-shell' },
      h('div', { className: 'vedit-designs-list' },
        items.length === 0
          ? h('div', { className: 'vedit-designs-empty' }, '—')
          : items.map((d, i) =>
              h('div', {
                key: i,
                className: `vedit-designs-item${selectedIdx === i ? ' is-selected' : ''}`,
                onClick: () => setSelectedIdx(i),
              }, d.name || `Design ${i + 1}`)
            )
      ),
      h('div', { className: 'vedit-designs-center' },
        h('div', { className: 'vedit-designs-canvas' }),
        h('button', { type: 'button', className: 'action-btn vmod-btn-sm vedit-designs-dump' }, 'Dump/Import')
      )
    );
  }

  // ── PlayerPanel ──────────────────────────────────────────────────────────

  function PlayerPanel({ playerMemory }) {
    const players = Array.isArray(playerMemory) && playerMemory.length > 0
      ? playerMemory
      : Array.from({ length: 8 }, (_, i) => ({ index: i, name: '', island: '', flags: [], nickname: '', greetDate: '', greeting: '', greetings: [] }));
    const [selectedPlayer, setSelectedPlayer] = useState(0);
    const [activeTab, setActiveTab] = useState('Flags');
    const [flagSelectedIdx, setFlagSelectedIdx] = useState(0);
    const player = players[selectedPlayer] || {};
    const [flagValues, setFlagValues] = useState(() => {
      const fv = {};
      PLAYER_MEM_FLAGS.forEach(f => { fv[f.index] = (player.flags && player.flags[f.index]) || 0; });
      return fv;
    });

    return h('div', { className: 'vedit-player-shell' },
      h('div', { className: 'vedit-player-left' },
        h('div', { className: 'vedit-player-list' },
          players.map((p, i) =>
            h('div', {
              key: i,
              className: `vedit-player-item${selectedPlayer === i ? ' is-selected' : ''}`,
              onClick: () => setSelectedPlayer(i),
            }, `${i} - ${p.name || '0'}${p.island ? ` (${p.island})` : ''}`)
          )
        ),
        h('div', { className: 'vedit-player-left-actions' },
          h('button', { type: 'button', className: 'action-btn vmod-btn-sm' }, 'Dump'),
          h('button', { type: 'button', className: 'action-btn vmod-btn-sm' }, 'Load'),
        ),
        h('div', { className: 'vedit-player-meta' },
          h('div', { className: 'vedit-player-meta-row' },
            h('span', { className: 'vmod-label' }, 'Name:'),
            h('input', { className: 'vmod-input', type: 'text', value: player.name || '', readOnly: true })
          ),
          h('div', { className: 'vedit-player-meta-row' },
            h('span', { className: 'vmod-label' }, 'Island:'),
            h('input', { className: 'vmod-input', type: 'text', value: player.island || '', readOnly: true })
          )
        )
      ),
      h('div', { className: 'vedit-player-right' },
        h('div', { className: 'vmod-edit-tabs tab-bar', role: 'tablist' },
          ['Flags', 'Misc', 'Greet'].map(tab =>
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
        activeTab === 'Flags'
          ? h('div', { className: 'vedit-player-flags-panel' },
              h('div', { className: 'vedit-player-value-row' },
                h('span', { className: 'vmod-label' }, 'Value:'),
                h('input', {
                  className: 'vmod-input vedit-player-value-input',
                  type: 'number',
                  value: String(flagValues[flagSelectedIdx] || 0),
                  onChange: e => setFlagValues(prev => ({ ...prev, [flagSelectedIdx]: parseInt(e.target.value, 10) || 0 })),
                })
              ),
              h('div', { className: 'vmod-flags-list', role: 'listbox' },
                PLAYER_MEM_FLAGS.map(f =>
                  h('div', {
                    key: f.index,
                    className: `vmod-flag-item${flagSelectedIdx === f.index ? ' is-selected' : ''}`,
                    onClick: () => setFlagSelectedIdx(f.index),
                  }, `${String(f.index).padStart(2, '0')} - ${f.name} = ${flagValues[f.index] || 0}`)
                )
              )
            )
          : activeTab === 'Misc'
            ? h('div', { className: 'vedit-player-misc-panel' },
                h('div', { className: 'vedit-player-meta-row' },
                  h('span', { className: 'vmod-label' }, 'Nickname:'),
                  h('input', { className: 'vmod-input', type: 'text', value: player.nickname || '', readOnly: true })
                )
              )
            : h('div', { className: 'vedit-player-greet-panel' },
                h('div', { className: 'vedit-player-greet-date' }, player.greetDate || 'No date'),
                h('div', { className: 'vedit-player-meta-row' },
                  h('span', { className: 'vmod-label' }, 'Greeting:'),
                  h('input', { className: 'vmod-input', type: 'text', value: player.greeting || '', readOnly: true })
                ),
                Array.from({ length: 10 }, (_, i) =>
                  h('div', { key: i, className: 'vedit-player-meta-row' },
                    h('span', { className: 'vmod-label' }, `Greeting ${i + 1}:`),
                    h('input', { className: 'vmod-input', type: 'text', value: (player.greetings && player.greetings[i]) || '', readOnly: true })
                  )
                )
              )
      )
    );
  }

  // ── EditView ──────────────────────────────────────────────────────────────

  function EditView({ v, onBack }) {
    const [activeTab, setActiveTab] = useState('furniture');
    const [saveState, setSaveState] = useState('idle'); // idle | saving | ok | error
    const iconUrl = apiUrl(`/api/villager-icon/${encodeURIComponent(v.name || "")}?v=4`);
    const friendshipVal = v.friendship || 0;
    const friendshipBarPct = friendshipVal === 0 ? 5 : Math.round((friendshipVal / 255) * 100);

    const handleSave = useCallback(async () => {
      setSaveState('saving');
      try {
        const res = await apiFetch('/api/villager/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ villager: v }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Backup failed');
        setSaveState('ok');
        setTimeout(onBack, 700);
      } catch (e) {
        setSaveState('error');
        setTimeout(() => setSaveState('idle'), 2500);
      }
    }, [v, onBack]);

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
          h('div', { className: 'villager-friendship-bar-fill', style: { width: `${friendshipBarPct}%`, opacity: friendshipVal === 0 ? 0.4 : 1 } })
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
        h('div', { className: 'vmod-edit-panel vedit-panel' },
          activeTab === 'furniture' ? h(InventoryPanel, { furniture: v.furniture }) :
          activeTab === 'clothes'   ? h(ClothesPanel,   { clothes:   v.clothes   }) :
          activeTab === 'room'      ? h(RoomPanel,      { room:      v.room      }) :
          activeTab === 'designs'   ? h(DesignsPanel,   { designs:   v.designs   }) :
          activeTab === 'memories'  ? h(PlayerPanel,    { playerMemory: v.playerMemory }) :
          activeTab === 'DIY timer' ? h(DIYTimerPanel,  { diy:       v.diy       }) :
          null
        )
      ),
      h('div', { className: 'villager-modal-footer vmod-subview-footer' },
        h('div', { className: 'vmod-footer-left' },
          h('button', { type: 'button', className: 'action-btn vmod-btn-sm', onClick: onBack, disabled: saveState === 'saving' }, 'Back'),
        ),
        h('button', {
          type: 'button',
          className: 'action-btn action-btn-solid vmod-btn-sm vmod-save-btn',
          onClick: handleSave,
          disabled: saveState === 'saving' || saveState === 'ok',
        },
          'Save',
          saveState !== 'idle' ? h('span', { className: `vmod-save-dot vmod-save-dot--${saveState}`, 'aria-hidden': 'true' }) : null
        )
      )
    );
  }

  // ── VillagerModal (root) ───────────────────────────────────────────────────

  function VillagerModal({ villager: v, artUrl, onSave }) {
    const villagerKey = v ? `${v.slot || ''}-${v.name || ''}` : '';
    const [view, setView] = useState('profile');
    const [catchphrase, setCatchphrase] = useState(v ? (v.catchphrase || '') : '');
    const [movingOut, setMovingOut] = useState(v ? !!v.movingOut : false);
    const [isPending, startTransition] = useTransition();

    // Reset local state whenever the villager changes — wrapped in startTransition
    // (React 18 concurrent: marks updates as non-urgent, shows skeleton during transition).
    useEffect(() => {
      startTransition(() => {
        setCatchphrase(v ? (v.catchphrase || '') : '');
        setMovingOut(v ? !!v.movingOut : false);
        setView('profile');
      });
    }, [villagerKey]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!v) return null;

    const handleSave = useCallback((edits) => {
      if (onSave) onSave(edits);
    }, [onSave]);

    const handleLoadBackup = useCallback((backup) => {
      if (backup.catchphrase != null) setCatchphrase(backup.catchphrase);
      if (backup.movingOut   != null) setMovingOut(!!backup.movingOut);
      setView('profile');
    }, []);

    const showArt = view === 'profile' || view === 'savemanager';

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
          h('div', { className: 'vmod-tab-bar', role: 'tablist' },
            VILLAGER_TABS.map(tab =>
              h('button', {
                key: tab.key,
                type: 'button',
                className: `tab-btn vmod-tab-btn${view === tab.key ? ' is-active' : ''}`,
                role: 'tab',
                'aria-selected': view === tab.key,
                onClick: () => setView(tab.key),
              }, tab.label)
            )
          ),
          view === 'profile'
            ? h(ProfileView, { v, catchphrase, setCatchphrase, movingOut, setMovingOut, onSave: handleSave })
            : view === 'savemanager'
              ? h(SaveManagerView, { v, onLoadBackup: handleLoadBackup })
              : view === 'house'
                ? h(HouseView, { v, onBack: () => setView('profile') })
                : view === 'flags'
                  ? h(FlagsView, { v, onBack: () => setView('profile') })
                  : view === 'edit'
                    ? h(EditView, { v, onBack: () => setView('profile') })
                    : null
        )
      )
    );
  }

  registerComponent('VillagerModal', VillagerModal);
})();
