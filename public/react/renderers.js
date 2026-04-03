(() => {
  'use strict';

  const SHORTCUT_BUTTONS = Object.freeze([
    { filter: 'Tool', label: 'tools' },
    { filter: 'Material', label: 'material' },
    { filter: 'Sea creature', label: 'sea' }
  ]);

  const QUICK_CHEAT_BUTTONS = Object.freeze([
    {
      cheatId: 'halfSpeed',
      tooltip: 'Slow the island clock to 0.5x for relaxed testing.',
      ariaLabel: 'Toggle half-speed cheat',
      iconSrc: '/assets/icons/material-symbols--speed-0-5x.svg',
      iconAlt: '.5x',
      fallbackText: '.5X'
    },
    {
      cheatId: 'doubleSpeed',
      tooltip: 'Run the island clock at 2x to fast-forward routines.',
      ariaLabel: 'Toggle double-speed cheat',
      iconSrc: '/assets/icons/material-symbols--speed-2x.svg',
      iconAlt: '2x',
      fallbackText: '2X'
    },
    {
      cheatId: 'wallWalk',
      tooltip: 'Phase through collision edges for movement testing.',
      ariaLabel: 'Toggle wall walk cheat',
      iconSrc: '/assets/icons/line-md--map-marker-radius.svg',
      iconAlt: 'Wall walk',
      fallbackText: 'Wall walk'
    }
  ]);

  const MODAL_FILTER_BUTTONS = Object.freeze([
    { value: 'Tool', label: 'tools' },
    { value: 'Material', label: 'materials' },
    { value: 'Sea creature', label: 'aquatic' },
    { value: 'Bug', label: 'bugs' },
    { value: 'Fossil', label: 'fossils' },
    { value: 'Flora', label: 'flora' },
    { value: 'Furniture', label: 'furniture' },
    { value: 'Clothing', label: 'clothes' }
  ]);

  function renderInventoryGrid(container, props) {
    window.ACNHReactRuntime.renderComponent('InventoryGrid', container, props);
  }

  function renderShortcutButtons(container, props) {
    window.ACNHReactRuntime.renderComponent('ShortcutButtons', container, {
      ...props,
      buttons: SHORTCUT_BUTTONS
    });
  }

  function renderQuickCheatButtons(container, props) {
    const cheats = QUICK_CHEAT_BUTTONS.map((cheat) => ({
      ...cheat,
      active: Boolean(props.activeCheatIds && props.activeCheatIds.includes(cheat.cheatId))
    }));

    window.ACNHReactRuntime.renderComponent('QuickCheatButtons', container, {
      onToggle: props.onToggle,
      cheats
    });
  }

  function renderCategoryList(container, props) {
    window.ACNHReactRuntime.renderComponent('CategoryList', container, props);
  }

  function renderModalFilterButtons(container, props) {
    window.ACNHReactRuntime.renderComponent('ModalFilterButtons', container, {
      ...props,
      filters: MODAL_FILTER_BUTTONS
    });
  }

  function renderModalResultsList(container, props) {
    window.ACNHReactRuntime.renderComponent('ModalResultsList', container, props);
  }

  function renderMusicLibraryOptions(container, props) {
    window.ACNHReactRuntime.renderComponent('MusicLibraryOptions', container, props);
  }

  window.ACNHReactUI = {
    renderInventoryGrid,
    renderShortcutButtons,
    renderQuickCheatButtons,
    renderCategoryList,
    renderModalFilterButtons,
    renderModalResultsList,
    renderMusicLibraryOptions
  };
})();
