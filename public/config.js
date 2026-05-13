'use strict';

// Auto-detect environment and set API base URL.
// When running on GitHub Pages, all API calls route to the Render.com demo server.
// When running locally or on the Render.com server itself, relative paths are used.
(function () {
  var hostname = location.hostname;
  if (hostname.endsWith('github.io') || hostname.endsWith('github.io.')) {
    window.API_BASE = 'https://acnh-live-editor.onrender.com';
  } else {
    window.API_BASE = '';
  }

  // apiFetch — drop-in replacement for fetch() using resolved base URL
  window.apiFetch = function apiFetch(path, opts) {
    return fetch(window.API_BASE + path, opts);
  };

  function isAbsoluteUrl(value) {
    return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value);
  }

  // resolveAppUrl — resolve a path to an absolute URL for use in img.src etc.
  window.resolveAppUrl = function resolveAppUrl(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    if (isAbsoluteUrl(value)) return value;
    return window.API_BASE + value;
  };

  // apiUrl — preserve the existing API helper name.
  window.apiUrl = function apiUrl(path) {
    return window.resolveAppUrl(path);
  };
})();
