(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function QuickCheatButton(props) {
    return h(
      'button',
      {
        type: 'button',
        className: props.active ? 'quick-cheat-btn is-active' : 'quick-cheat-btn',
        'data-quick-cheat': props.cheatId,
        title: props.tooltip,
        'aria-label': props.ariaLabel,
        'aria-pressed': props.active ? 'true' : 'false',
        onClick() {
          props.onToggle(props.cheatId);
        }
      },
      h('span', { className: 'quick-cheat-label' }, props.label)
    );
  }

  function QuickCheatButtons(props) {
    const cheats = Array.isArray(props.cheats) ? props.cheats : [];

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...cheats.map((cheat) => h(QuickCheatButton, {
        key: cheat.cheatId,
        ...cheat,
        onToggle: props.onToggle
      }))
    );
  }

  registerComponent('QuickCheatButtons', QuickCheatButtons);
})();
