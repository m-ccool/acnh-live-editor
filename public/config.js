'use strict';

// Auto-detect environment.
// On GitHub Pages (github.io): static deploy mode — API calls are intercepted client-side.
// Locally or on direct server: standard relative API paths with no interception.
(function () {
  var hostname = location.hostname;
  var IS_STATIC = hostname.endsWith('github.io') || hostname.endsWith('github.io.');
  window.IS_STATIC_DEPLOY = IS_STATIC;
  window.API_BASE = '';

  // apiFetch — drop-in replacement for fetch() using resolved base URL.
  // On static deploy, known API paths are intercepted and served without a backend.
  window.apiFetch = IS_STATIC ? staticApiFetch : function (path, opts) {
    return fetch(path, opts);
  };

  // ─── Static deploy intercept ────────────────────────────────────────────────

  function staticApiFetch(path, opts) {
    var method = (opts && opts.method) ? opts.method.toUpperCase() : 'GET';
    var apiKey = window.NOOKIPEDIA_API_KEY || '';

    // Starter items — copied from data/items.json by CI
    if (path === '/api/items') {
      return fetch('./items.json');
    }

    // Item search — live Nookipedia API call per query
    if (path.startsWith('/api/items/search')) {
      if (method !== 'GET') return noopResponse();
      var qs = path.indexOf('?') !== -1 ? path.slice(path.indexOf('?') + 1) : '';
      var params = new URLSearchParams(qs);
      var query = params.get('q') || '';
      var filter = params.get('filter') || 'all';
      var limit = Math.min(parseInt(params.get('limit') || '12', 10) || 12, 50);
      return searchNookipedia(query, filter, limit, apiKey)
        .then(function (result) { return jsonResponse(result); });
    }

    // Catalog status
    if (path === '/api/catalog/status') {
      return jsonResponse({
        configured: Boolean(apiKey),
        connectionState: apiKey ? 'live' : 'offline',
        label: apiKey ? 'Live' : 'Offline',
        message: apiKey ? 'Nookipedia — live API' : 'No API key configured',
        liveConnected: Boolean(apiKey),
        hasActiveRefresh: false,
        searchableCount: null,
        localCount: 0,
        cachedCount: 0
      });
    }

    // Catalog diagnostics — not available without a backend
    if (path === '/api/catalog/diagnostics') {
      return jsonResponse({ available: false, message: 'Diagnostics not available in static deploy' });
    }

    // Bridge status — always disconnected on Pages
    if (path === '/api/status') {
      return jsonResponse({
        connected: false,
        bridge: 'unavailable',
        listening: false,
        message: 'Bridge not available in static deploy'
      });
    }

    // Bridge connect — no-op
    if (path === '/api/connect-bridge') {
      return jsonResponse({ ok: false, message: 'Not available in static deploy' });
    }

    // Music library — empty
    if (path === '/api/music/library') {
      return jsonResponse({ songs: [] });
    }

    // All write operations — graceful no-op
    if (method === 'POST' || method === 'DELETE' || method === 'PATCH') {
      return jsonResponse({ ok: false, message: 'Write operations not available in static deploy' }, 503);
    }

    // Fallback
    return jsonResponse({ ok: false, message: 'Not available in static deploy' }, 503);
  }

  // ─── Nookipedia live search ──────────────────────────────────────────────────

  var ENDPOINT_MAP = {
    'furniture':    '/nh/furniture',
    'clothing':     '/nh/clothing',
    'tool':         '/nh/tools',
    'fish':         '/nh/fish',
    'bug':          '/nh/bugs',
    'sea creature': '/nh/sea',
    'art':          '/nh/art',
    'recipe':       '/nh/recipes',
    'interior':     '/nh/interior',
    'wallpaper':    '/nh/items',
    'flooring':     '/nh/items'
  };

  var UNFILTERED_ENDPOINTS = [
    '/nh/furniture',
    '/nh/clothing',
    '/nh/items',
    '/nh/tools',
    '/nh/recipes'
  ];

  function searchNookipedia(query, filter, limit, apiKey) {
    var filterKey = (filter || 'all').toLowerCase().trim();
    var endpoints = ENDPOINT_MAP[filterKey]
      ? [ENDPOINT_MAP[filterKey]]
      : UNFILTERED_ENDPOINTS;

    var fetchOpts = {
      headers: {
        'X-API-KEY': apiKey,
        'Accept-Version': '1.7.0'
      }
    };

    var promises = endpoints.map(function (ep) {
      var url = 'https://api.nookipedia.com' + ep + '?thumbsize=64';
      if (query) url += '&name=' + encodeURIComponent(query);
      return fetch(url, fetchOpts)
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    });

    return Promise.all(promises).then(function (results) {
      var items = [];
      results.forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (entry) {
          var name = (entry.name || '').trim();
          if (!name) return;
          // Client-side filter as fallback if Nookipedia name param returned unfiltered results
          if (query && name.toLowerCase().indexOf(query.toLowerCase()) === -1) return;
          // Image: top-level first, then first variation, then render_url fallback
          var imageUrl = entry.image_url || '';
          if (!imageUrl && Array.isArray(entry.variations) && entry.variations.length) {
            imageUrl = (entry.variations[0] && entry.variations[0].image_url) || '';
          }
          if (!imageUrl) imageUrl = entry.render_url || '';
          if (!imageUrl) return; // skip items with no image, matching server behaviour
          items.push({
            name: name,
            category: entry.category || '',
            icon_url: imageUrl,
            image_url: imageUrl
          });
        });
      });
      return { items: items.slice(0, limit), source: 'nookipedia-live' };
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function jsonResponse(data, status) {
    return Promise.resolve(new Response(
      JSON.stringify(data),
      { status: status || 200, headers: { 'Content-Type': 'application/json' } }
    ));
  }

  function noopResponse() {
    return jsonResponse({ ok: false, message: 'Not available' }, 503);
  }

  function isAbsoluteUrl(value) {
    return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value);
  }

  window.resolveAppUrl = function resolveAppUrl(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    if (isAbsoluteUrl(value)) return value;
    return value;
  };

  window.apiUrl = function apiUrl(path) {
    return window.resolveAppUrl(path);
  };
})();
