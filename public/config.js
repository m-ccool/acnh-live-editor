'use strict';

// Auto-detect environment and set API base URL.
// When running on GitHub Pages, all API calls route to the Render.com demo server.
// When running locally or on the Render.com server itself, relative paths are used.
(function () {
  var hostname = location.hostname;
  if (hostname.endsWith('github.io') || hostname.endsWith('github.io.')) {
    window.API_BASE = 'https://acnh-live-editor-demo.onrender.com';
  } else {
    window.API_BASE = '';
  }

  // apiFetch — drop-in replacement for fetch() using resolved base URL
  window.apiFetch = function apiFetch(path, opts) {
    return fetch(window.API_BASE + path, opts);
  };

  // apiUrl — resolve a path to an absolute URL for use in img.src etc.
  window.apiUrl = function apiUrl(path) {
    return window.API_BASE + path;
  };
})();
