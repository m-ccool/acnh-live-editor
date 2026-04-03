(() => {
  'use strict';

  const { h, registerComponent } = window.ACNHReactRuntime;

  function CategoryList(props) {
    const categories = Array.isArray(props.categories) ? props.categories : [];

    if (!categories.length) {
      return h('div', { className: 'tab-empty-state' }, 'No catalog items are assigned to pockets yet.');
    }

    return h(
      window.ACNHReactRuntime.Fragment,
      null,
      ...categories.slice(0, 5).map((entry) => h(
        'div',
        {
          key: `${entry.category}-${entry.count}`,
          className: 'tab-list-row'
        },
        h('span', null, entry.category),
        h('strong', null, String(entry.count))
      ))
    );
  }

  registerComponent('CategoryList', CategoryList);
})();
