(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function QuickCheatButton(props) {
    return h(
      'button',
      {
        type: 'button',
        className: props.active ? 'toolbar-icon-btn quick-cheat-btn is-active' : 'toolbar-icon-btn quick-cheat-btn',
        'data-quick-cheat': props.cheatId,
        'data-tooltip': props.tooltip,
        'aria-label': props.ariaLabel,
        'aria-pressed': props.active ? 'true' : 'false',
        onClick() {
          props.onToggle(props.cheatId);
        }
      },
      h('img', {
        src: props.iconSrc,
        alt: props.iconAlt,
        className: 'icon-img icon-white',
        onError(event) {
          event.currentTarget.style.display = 'none';
          const fallback = event.currentTarget.nextSibling;
          if (fallback && fallback.style) {
            fallback.style.display = 'inline';
          }
        }
      }),
      h('span', {
        style: { display: 'none' },
        'aria-hidden': 'true'
      }, props.fallbackText)
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
