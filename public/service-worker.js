const CACHE_NAME = 'acnh-live-editor-v47'
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/styles/base.css',
  '/styles/music.css',
  '/styles/workspace.css',
  '/styles/responsive.css',
  '/app-core.js',
  '/app-music.js',
  '/app-workspaces.js',
  '/app.js',
  '/manifest.webmanifest',
  '/vendor/react/react.production.min.js',
  '/vendor/react-dom/react-dom.production.min.js',
  '/react/runtime.js',
  '/react/components/InventoryGrid.js',
  '/react/components/ShortcutButtons.js',
  '/react/components/QuickCheatButtons.js',
  '/react/components/CategoryList.js',
  '/react/components/ModalFilterButtons.js',
  '/react/components/ModalResultsList.js',
  '/react/components/MusicLibraryOptions.js',
  '/react/renderers.js',
  '/assets/icons/fa7-solid--bugs.svg',
  '/assets/icons/codicon--debug-connect.svg',
  '/assets/icons/codicon--debug-disconnect.svg',
  '/assets/icons/line-md--downloading-loop.svg',
  '/assets/icons/line-md--pause-to-play-filled-transition.svg',
  '/assets/icons/line-md--pause.svg'
]

const SHELL_PATHS = new Set(ASSETS)

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS)
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key)
          }
        })
      )
    })
  )
  self.clients.claim()
})

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)
  const isSameOrigin = requestUrl.origin === self.location.origin
  const isApiRequest = isSameOrigin && requestUrl.pathname.startsWith('/api/')
  const isShellAsset = isSameOrigin && SHELL_PATHS.has(requestUrl.pathname)

  if (isApiRequest) {
    event.respondWith(fetch(event.request))
    return
  }

  if (isShellAsset) {
    const cacheKey = requestUrl.pathname
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(cacheKey, responseClone)
          })
          return response
        })
        .catch(function () {
          return caches.match(cacheKey)
        })
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then(function (response) {
      return response || fetch(event.request)
    })
  )
})
