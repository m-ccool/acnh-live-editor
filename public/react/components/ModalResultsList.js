(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function ModalResultsList(props) {
    if (!props.isOpen) {
      return null;
    }

    const results = Array.isArray(props.results) ? props.results : [];

    if (props.loading && !results.length) {
      return h('div', { className: 'inv-qsr-empty' }, 'Searching catalog...');
    }

    if (!results.length) {
      return h('div', { className: 'inv-qsr-empty' }, props.emptyText);
    }

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...results.map((item) => {
        const isSelected = props.activeItemLookup &&
          props.activeItemLookup(item) === props.selectedItemLookup;

        const accent = window.getCategoryAccentColor ? window.getCategoryAccentColor(item.category) : '';
        const imgSrc = window.getPreferredItemPreviewUrl ? window.getPreferredItemPreviewUrl(item) : (item.preview_url || item.image_url || item.icon_url || '');

        return h('button', {
          key: props.activeItemLookup(item),
          type: 'button',
          className: isSelected ? 'inv-qsr-row modal-result-row is-selected' : 'inv-qsr-row modal-result-row',
          onClick(event) {
            event.preventDefault();
            props.onAssignItem(item);
          }
        },
          h('span', { className: 'qsr-cat-dot', 'aria-hidden': 'true', style: { '--dot-color': accent } }),
          h('img', { className: 'inv-qsr-img', src: imgSrc, alt: '', loading: 'lazy' }),
          h('span', { className: 'inv-qsr-name' }, item.name),
          h('span', { className: 'inv-qsr-cat' }, item.category || '')
        );
      })
    );
  }

  registerComponent('ModalResultsList', ModalResultsList);
})();
