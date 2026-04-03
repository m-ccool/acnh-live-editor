(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function ModalFilterButtons(props) {
    const filters = Array.isArray(props.filters) ? props.filters : [];
    const activeFilter = String(props.activeFilter || 'all');

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...filters.map((filter) => h('button', {
        key: filter.value,
        type: 'button',
        className: filter.value === activeFilter ? 'modal-filter-btn is-active' : 'modal-filter-btn',
        'data-modal-filter': filter.value,
        onClick() {
          props.onSelect(filter.value);
        }
      }, filter.label))
    );
  }

  registerComponent('ModalFilterButtons', ModalFilterButtons);
})();
