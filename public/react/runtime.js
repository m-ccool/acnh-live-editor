(() => {
  'use strict';

  const rootRegistry = new WeakMap();
  const componentRegistry = {};

  function createRootInstance(container) {
    if (window.ReactDOM && typeof window.ReactDOM.createRoot === 'function') {
      return window.ReactDOM.createRoot(container);
    }

    return {
      render(element) {
        window.ReactDOM.render(element, container);
      }
    };
  }

  function getRoot(container) {
    if (!container) {
      return null;
    }

    let root = rootRegistry.get(container);
    if (!root) {
      root = createRootInstance(container);
      rootRegistry.set(container, root);
    }

    return root;
  }

  function registerComponent(name, component) {
    componentRegistry[name] = component;
  }

  function getComponent(name) {
    return componentRegistry[name] || null;
  }

  function renderComponent(name, container, props) {
    const Component = getComponent(name);
    const root = getRoot(container);

    if (!Component || !root) {
      return;
    }

    root.render(window.React.createElement(Component, props));
  }

  window.ACNHReactRuntime = {
    h: window.React.createElement.bind(window.React),
    Fragment: window.React.Fragment,
    registerComponent,
    renderComponent
  };
})();
