(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function ModalResultsList(props) {
    if (!props.isOpen) {
      return null;
    }

    const results = Array.isArray(props.results) ? props.results : [];

    if (props.loading && !results.length) {
      return h('div', { className: 'modal-result-row is-empty' }, 'Searching catalog...');
    }

    if (!results.length) {
      return h('div', { className: 'modal-result-row is-empty' }, props.emptyText);
    }

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...results.map((item) => {
        const isSelected = props.activeItemLookup &&
          props.activeItemLookup(item) === props.selectedItemLookup;

        return h('button', {
          key: props.activeItemLookup(item),
          type: 'button',
          className: isSelected ? 'modal-result-row is-selected' : 'modal-result-row',
          onPointerDown(event) {
            event.preventDefault();
            props.onAssignItem(item);
          },
          onClick(event) {
            event.preventDefault();
            props.onAssignItem(item);
          }
        }, item.name);
      })
    );
  }

  registerComponent('ModalResultsList', ModalResultsList);
})();
