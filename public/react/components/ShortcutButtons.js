(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function ShortcutButtons(props) {
    const buttons = Array.isArray(props.buttons) ? props.buttons : [];
    const activeFilter = String(props.activeFilter || 'all');

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...buttons.map((button) => h('button', {
        key: button.filter,
        type: 'button',
        className: button.filter === activeFilter ? 'shortcut-btn is-active' : 'shortcut-btn',
        'data-filter': button.filter,
        onClick() {
          props.onPress(button.filter);
        }
      }, button.label))
    );
  }

  registerComponent('ShortcutButtons', ShortcutButtons);
})();
