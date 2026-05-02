// Pass-through service worker — no caching.
// This app requires a live LAN server; offline caching adds no value
// and causes stale-asset headaches on every deploy.

self.addEventListener('install', function () {
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  // Delete all old caches so previously cached stale files are gone.
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k) }))
    }).then(function () { return self.clients.claim() })
  )
})

// No fetch handler — browser fetches everything fresh from the network.
