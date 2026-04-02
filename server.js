require('dotenv').config({ quiet: true })

const { execSync } = require('child_process')
const express = require('express')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')

const {
  getCachedCatalogItems,
  getCatalogDiagnostics,
  getCatalogSyncState,
  hasNookipediaApiKey,
  refreshCatalogInBackground
} = require('./modules/nookipediaCatalog')
const bridgeService = require('./modules/bridgeService')
const {
  BRIDGE_HOST,
  BRIDGE_PORT
} = require('./modules/bridgeService')

const app = express()
const PORT = process.env.PORT || 3000

const publicDir = path.join(__dirname, 'public')
const itemsAssetDir = path.join(publicDir, 'assets', 'items')
const dataPath = path.join(__dirname, 'data', 'items.json')
const NOOKIPEDIA_KK_SONGS_URL = 'https://nookipedia.com/wiki/K.K._Slider_songs'
const NOOKIPEDIA_SUNRISE_SOUNDTRACK_URL = 'https://nookipedia.com/wiki/Animal_Crossing:_Your_Favourite_Songs_-_Original_Soundtrack'
const NOOKIPEDIA_MEDIAWIKI_API_URL = 'https://nookipedia.com/w/api.php'
const NOOKIPEDIA_API_DOCS_URL = 'https://api.nookipedia.com/doc'
const NOOKIPEDIA_RAINY_4AM_COVER_TITLE = 'File:Nintendo Music ACNH 4 00 AM - Rainy.jpg'
const FANDOM_MEDIAWIKI_API_URL = 'https://animalcrossing.fandom.com/api.php'
const FANDOM_CITY_FOLK_TITLE_THEME_FILE_TITLE = 'File:ACCF Main Theme.ogg'
const MUSIC_LIBRARY_CACHE_TTL_MS = 1000 * 60 * 60 * 12
const MUSIC_LIBRARY_FALLBACK_ART = '/assets/icons/Aircheck_NH_Inv_Icon.png'
const MUSIC_REQUEST_TIMEOUT_MS = 8000
const localIpCache = {
  value: null,
  expiresAt: 0
}
const musicLibraryCache = {
  value: null,
  expiresAt: 0,
  promise: null
}

app.use(express.static(publicDir))
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'acnh-live-editor'
  })
})

app.get('/api/status', (req, res) => {
  const bridgeStatus = bridgeService.getStatus()
  res.json({
    ...bridgeStatus,
    ip: bridgeStatus.ip || getPreferredLocalIp(req),
    bridgeHost: bridgeStatus.bridgeHost || BRIDGE_HOST,
    bridgePort: bridgeStatus.bridgePort || BRIDGE_PORT
  })
})

app.get('/api/bridge/read-status', async (req, res) => {
  try {
    res.json(await bridgeService.readStatus())
  } catch (error) {
    res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
  }
})

app.get('/api/bridge/read-inventory', async (req, res) => {
  try {
    res.json(await bridgeService.readInventory())
  } catch (error) {
    res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
  }
})

app.post('/api/bridge/write-inventory-slot', async (req, res) => {
  const slot = Number(req.body && req.body.slot)

  if (!Number.isInteger(slot) || slot < 1) {
    res.status(400).json({ error: 'slot must be a positive integer' })
    return
  }

  try {
    res.json(await bridgeService.writeInventorySlot({
      slot,
      itemId: req.body && req.body.itemId ? String(req.body.itemId) : null,
      count: Number(req.body && req.body.count || 0),
      uses: Number(req.body && req.body.uses || 0),
      flag0: Number(req.body && req.body.flag0 || 0),
      flag1: Number(req.body && req.body.flag1 || 0)
    }))
  } catch (error) {
    res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
  }
})

app.get('/api/items', async (req, res) => {
  try {
    const items = readStarterItems()
    const assetNames = getItemAssetNames()

    res.json(items.map((item) => {
      const previewFile = findBestPreviewAsset(item, assetNames)
      return {
        ...item,
        preview_url: previewFile ? `/assets/items/${encodeURIComponent(previewFile)}` : item.image_url || item.icon_url || null
      }
    }))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load items' })
  }
})

app.get('/api/items/search', (req, res) => {
  try {
    const query = String(req.query.q || '')
    const filter = String(req.query.filter || 'all')
    const requestedLimit = Number(req.query.limit || 12)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50) : 12
    const payload = searchCatalogItems({ query, filter, limit })

    res.json(payload)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to search catalog' })
  }
})

app.get('/api/music/library', async (req, res) => {
  try {
    res.json(await getMusicLibrary())
  } catch (error) {
    console.warn(`Music library fallback: ${error.message}`)
    res.json(getFallbackMusicLibrary(error.message))
  }
})

app.get('/api/catalog/status', (req, res) => {
  res.json(buildCatalogStatusResponse())
})

app.get('/api/catalog/diagnostics', async (req, res) => {
  try {
    res.json(await getCatalogDiagnostics())
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to probe catalog connection' })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.listen(PORT, async () => {
  try {
    await bridgeService.start()
  } catch (error) {
    console.error(`Failed to start bridge listener: ${error.message}`)
  }

  const localIp = getPreferredLocalIp()
  console.log(`Running http://localhost:${PORT}`)

  if (localIp) {
    console.log(`LAN http://${localIp}:${PORT}`)
  }

  console.log(`Bridge listener ${BRIDGE_HOST}:${BRIDGE_PORT}`)

  refreshCatalogInBackground()
})

function getPreferredLocalIp(req) {
  const requestHostIp = getRequestHostIp(req)
  if (requestHostIp) {
    return requestHostIp
  }

  const now = Date.now()
  if (localIpCache.value && localIpCache.expiresAt > now) {
    return localIpCache.value
  }

  const detectedIp = getWindowsDefaultRouteInterfaceIp() || getBestInterfaceIp()
  localIpCache.value = detectedIp
  localIpCache.expiresAt = now + 15000
  return detectedIp
}

function getRequestHostIp(req) {
  if (!req) {
    return null
  }

  const rawHost =
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    req.hostname

  if (!rawHost) {
    return null
  }

  const hostValue = Array.isArray(rawHost) ? rawHost[0] : String(rawHost)
  const firstHost = hostValue.split(',')[0].trim()
  const normalizedHost = normalizeHost(firstHost)

  if (!normalizedHost || isLocalHost(normalizedHost)) {
    return null
  }

  return isIpv4Address(normalizedHost) ? normalizedHost : null
}

function normalizeHost(host) {
  if (!host) {
    return ''
  }

  const value = String(host).trim()
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')
    return closingBracket > 1 ? value.slice(1, closingBracket) : value
  }

  const colonIndex = value.indexOf(':')
  return colonIndex >= 0 ? value.slice(0, colonIndex) : value
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isIpv4Address(value) {
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(value)
}

function getBestInterfaceIp() {
  const candidates = getInterfaceCandidates()
  if (!candidates.length) {
    return null
  }

  candidates.sort((a, b) => scoreInterface(b) - scoreInterface(a))
  return candidates[0].address
}

function getInterfaceCandidates() {
  const interfaces = os.networkInterfaces()
  const candidates = []

  Object.entries(interfaces).forEach(([name, addresses]) => {
    if (!Array.isArray(addresses)) return

    addresses.forEach((address) => {
      const family = typeof address.family === 'string' ? address.family : String(address.family)
      if (family !== 'IPv4' || address.internal || !isIpv4Address(address.address)) return

      candidates.push({
        name: name.toLowerCase(),
        address: address.address
      })
    })
  })

  return candidates
}

function getWindowsDefaultRouteInterfaceIp() {
  if (process.platform !== 'win32') {
    return null
  }

  try {
    const output = execSync('route print -4', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const interfaceScoreByIp = new Map(
      getInterfaceCandidates().map((candidate) => [candidate.address, scoreInterface(candidate)])
    )

    const defaultRoutes = parseWindowsDefaultRoutes(output)
    if (!defaultRoutes.length) {
      return null
    }

    defaultRoutes.sort((a, b) => {
      const metricDelta = a.metric - b.metric
      if (metricDelta !== 0) {
        return metricDelta
      }

      return (interfaceScoreByIp.get(b.iface) || 0) - (interfaceScoreByIp.get(a.iface) || 0)
    })

    return defaultRoutes[0].iface
  } catch (error) {
    return null
  }
}

function parseWindowsDefaultRoutes(output) {
  const routes = []
  let inActiveRoutes = false

  String(output || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim()

      if (trimmed === 'Active Routes:') {
        inActiveRoutes = true
        return
      }

      if (trimmed === 'Persistent Routes:') {
        inActiveRoutes = false
        return
      }

      if (!inActiveRoutes || !trimmed || trimmed.startsWith('Network Destination')) {
        return
      }

      const parts = trimmed.split(/\s+/)
      if (parts.length < 5) {
        return
      }

      const [destination, netmask, gateway, iface, metricValue] = parts
      if (destination !== '0.0.0.0' || netmask !== '0.0.0.0' || !isIpv4Address(iface)) {
        return
      }

      routes.push({
        gateway,
        iface,
        metric: Number(metricValue) || Number.MAX_SAFE_INTEGER
      })
    })

  return routes
}

function scoreInterface(candidate) {
  let score = 0

  if (candidate.name.includes('wi-fi') || candidate.name.includes('wifi') || candidate.name.includes('wlan')) {
    score += 40
  }

  if (candidate.name.includes('ethernet') || candidate.name.includes('en')) {
    score += 30
  }

  if (candidate.name.includes('loopback') || candidate.name.includes('virtual') || candidate.name.includes('vmware')) {
    score -= 100
  }

  if (candidate.address.startsWith('10.') || candidate.address.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(candidate.address)) {
    score += 20
  }

  return score
}

function getItemAssetNames() {
  if (!fs.existsSync(itemsAssetDir)) {
    return []
  }

  return fs.readdirSync(itemsAssetDir).filter((name) => name.toLowerCase().endsWith('.png'))
}

function readStarterItems() {
  if (hasNookipediaApiKey()) {
    refreshCatalogInBackground()
  }

  return readLocalItems()
}

function readLocalItems() {
  if (!fs.existsSync(dataPath)) {
    return []
  }

  const raw = fs.readFileSync(dataPath, 'utf8')
  const items = JSON.parse(raw)
  return Array.isArray(items) ? items : []
}

function searchCatalogItems(options = {}) {
  const query = String(options.query || '').trim()
  const filter = String(options.filter || 'all')
  const limit = Number(options.limit || 12)
  const localItems = readLocalItems()
  const cachedItems = getCachedCatalogItems()
  const useExpandedCatalog = query.length >= 2
  const searchItems = useExpandedCatalog
    ? mergeCatalogItems(cachedItems, localItems)
    : localItems

  if (hasNookipediaApiKey()) {
    refreshCatalogInBackground()
  }

  const matched = searchItems
    .filter((item) => matchesSearchFilter(item, filter))
    .filter((item) => matchesSearchQuery(item, query))
    .sort((left, right) => scoreSearchResult(left, query) - scoreSearchResult(right, query) || left.name.localeCompare(right.name))
    .slice(0, limit)

  return {
    items: matched,
    source: useExpandedCatalog && cachedItems.length ? 'nookipedia-cache' : 'local',
    status: buildCatalogStatusResponse(localItems, cachedItems)
  }
}

function buildCatalogStatusResponse(localItems = readLocalItems(), cachedItems = getCachedCatalogItems()) {
  const syncState = getCatalogSyncState()
  const hasWarmMemory = syncState.inMemoryCount > 0 && syncState.memorySource === 'api'
  const hasDiskCache = syncState.diskCount > 0
  const hasLiveCache = hasWarmMemory || hasDiskCache
  const connectionState = hasWarmMemory
    ? 'live'
    : syncState.hasActiveRefresh
      ? 'syncing'
      : hasDiskCache
        ? 'cached'
        : syncState.configured
          ? 'fallback'
          : 'offline'
  const labelByState = {
    live: 'Live',
    syncing: 'Syncing',
    cached: 'Cached',
    fallback: 'Local',
    offline: 'Offline'
  }
  const messageByState = {
    live: 'Nookipedia catalog is cached and ready.',
    syncing: 'Connecting to Nookipedia live catalog.',
    cached: 'Using cached Nookipedia catalog.',
    fallback: syncState.lastSyncError || 'Using local starter catalog.',
    offline: 'Nookipedia API key is not configured. Set NOOKIPEDIA_API_KEY in .env and restart the server.'
  }

  return {
    ...syncState,
    connectionState,
    label: labelByState[connectionState] || 'Offline',
    message: messageByState[connectionState] || 'Catalog status unavailable.',
    liveConnected: connectionState === 'live',
    searchableCount: mergeCatalogItems(cachedItems, localItems).length,
    localCount: localItems.length,
    cachedCount: cachedItems.length
  }
}

function matchesSearchFilter(item, filter) {
  const normalizedFilter = normalizeCategoryLabel(filter)
  if (!normalizedFilter || normalizedFilter === 'all') {
    return true
  }

  const category = normalizeCategoryLabel(item && item.category)
  const endpoint = normalizeCategoryLabel(item && item.source && item.source.endpoint)

  if (normalizedFilter === 'tool') {
    return category === 'tool' || endpoint === '/nh/tools'
  }

  if (normalizedFilter === 'material') {
    return ['material', 'food', 'fence'].includes(category) || endpoint === '/nh/items'
  }

  if (normalizedFilter === 'sea creature') {
    return category === 'sea creature' || endpoint === '/nh/sea'
  }

  if (normalizedFilter === 'bug') {
    return category === 'bug' || endpoint === '/nh/bugs'
  }

  if (normalizedFilter === 'fossil') {
    return category === 'fossil' || endpoint === '/nh/fossils/all'
  }

  if (normalizedFilter === 'flora') {
    return ['plant', 'food'].includes(category)
  }

  if (normalizedFilter === 'furniture') {
    return (
      ['furniture', 'housewares', 'miscellaneous', 'wall-mounted', 'ceiling decor', 'wallpaper', 'floors', 'rugs', 'art', 'gyroid', 'photo', 'photos', 'painting', 'sculpture'].includes(category) ||
      ['/nh/furniture', '/nh/interior', '/nh/art', '/nh/gyroids'].includes(endpoint)
    )
  }

  if (normalizedFilter === 'clothing') {
    return (
      ['clothing', 'accessories', 'tops', 'bottoms', 'dress-up', 'headwear', 'socks', 'shoes', 'bags', 'umbrellas'].includes(category) ||
      endpoint === '/nh/clothing'
    )
  }

  return category === normalizedFilter
}

function matchesSearchQuery(item, query) {
  const normalizedQuery = normalizeCategoryLabel(query)
  if (!normalizedQuery) {
    return true
  }

  const haystack = [
    item && item.name,
    item && item.category,
    item && item.file_name,
    ...(Array.isArray(item && item.source_files) ? item.source_files : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(normalizedQuery)
}

function scoreSearchResult(item, query) {
  const normalizedQuery = normalizeCategoryLabel(query)
  if (!normalizedQuery) {
    return 10
  }

  const name = String(item && item.name || '').trim().toLowerCase()
  const fileName = String(item && item.file_name || '').trim().toLowerCase()

  if (name === normalizedQuery || fileName === normalizedQuery) return 0
  if (name.startsWith(normalizedQuery)) return 1
  if (fileName.startsWith(normalizedQuery)) return 2
  if (name.includes(normalizedQuery)) return 3
  if (fileName.includes(normalizedQuery)) return 4
  return 5
}

function normalizeCategoryLabel(value) {
  return String(value || '').trim().toLowerCase()
}

function mergeCatalogItems(primaryItems, fallbackItems) {
  const merged = []
  const seen = new Set()

  ;[primaryItems, fallbackItems].forEach((list) => {
    ;(Array.isArray(list) ? list : []).forEach((item) => {
      const key = getCatalogItemLookupKey(item)
      if (!key || seen.has(key)) {
        return
      }

      seen.add(key)
      merged.push(item)
    })
  })

  return merged
}

function getCatalogItemLookupKey(item) {
  if (!item || typeof item !== 'object') {
    return ''
  }

  const name = String(item.name || '').trim().toLowerCase()
  if (name) {
    return `name:${name}`
  }

  const fileName = String(item.file_name || '').trim().toLowerCase()
  if (fileName) {
    return `file:${fileName}`
  }

  return ''
}

function findBestPreviewAsset(item, assetNames) {
  if (!item || !Array.isArray(assetNames) || assetNames.length === 0) {
    return null
  }

  const fileName = String(item.file_name || '').trim()
  const name = String(item.name || '').trim()
  const sourceFiles = Array.isArray(item.source_files) ? item.source_files : []

  const exactCandidates = [
    ...sourceFiles,
    `${fileName}_NH_Inv_Icon.png`,
    `120px-${fileName}_NH_Inv_Icon.png`
  ].filter(Boolean)

  for (const candidate of exactCandidates) {
    const matched = findAsset(assetNames, candidate)
    if (matched && /Inv_Icon/i.test(matched)) {
      return matched
    }
  }

  const aliasBases = derivePreviewAliases(fileName, name)
  for (const base of aliasBases) {
    const candidates = [
      `${base}_NH_Inv_Icon.png`,
      `120px-${base}_NH_Inv_Icon.png`
    ]

    for (const candidate of candidates) {
      const matched = findAsset(assetNames, candidate)
      if (matched) {
        return matched
      }
    }
  }

  return null
}

function derivePreviewAliases(fileName, name) {
  const aliases = new Set()
  const normalizedFileName = String(fileName || '').trim()
  const normalizedName = String(name || '').trim()

  if (normalizedFileName) {
    aliases.add(normalizedFileName)
  }

  if (normalizedName) {
    aliases.add(normalizedName.replace(/\s+/g, '_'))
  }

  const compact = normalizedFileName
    .replace(/\(.*?\)/g, '')
    .replace(/_+/g, '_')
    .replace(/^64px-/, '')
    .trim()

  if (compact) {
    aliases.add(compact)
  }

  if (/Golden_.*Axe/i.test(normalizedFileName) || /Golden Axe/i.test(normalizedName)) aliases.add('Golden_Axe')
  if (/Golden_.*Net/i.test(normalizedFileName) || /Golden Net/i.test(normalizedName)) aliases.add('Golden_Net')
  if (/Golden_.*Rod/i.test(normalizedFileName) || /Golden Rod/i.test(normalizedName)) aliases.add('Golden_Rod')
  if (/Golden_.*Shovel/i.test(normalizedFileName) || /Golden Shovel/i.test(normalizedName)) aliases.add('Golden_Shovel')
  if (/Golden_.*Slingshot/i.test(normalizedFileName) || /Golden Slingshot/i.test(normalizedName)) aliases.add('Golden_Slingshot')
  if (/Golden_.*Watering_Can/i.test(normalizedFileName) || /Golden Watering Can/i.test(normalizedName)) aliases.add('Golden_Watering_Can')
  if (/Fishing[_ ]Rod/i.test(normalizedFileName) || /Fishing Rod/i.test(normalizedName)) aliases.add('Fishing_Rod')
  if (/Ladder_Set-Up_Kit/i.test(normalizedFileName) || /Ladder Set-Up Kit/i.test(normalizedName)) aliases.add('64px-Ladder_Set-Up_Kit')
  if (/Vine_Ladder_Set-Up_Kit/i.test(normalizedFileName) || /Vine Ladder Set-Up Kit/i.test(normalizedName)) aliases.add('64px-Ladder_Set-Up_Kit')

  return Array.from(aliases)
}

function findAsset(assetNames, candidate) {
  const needle = String(candidate || '').toLowerCase()
  return assetNames.find((name) => name.toLowerCase() === needle) || null
}

async function getMusicLibrary() {
  const now = Date.now()

  if (musicLibraryCache.value && musicLibraryCache.expiresAt > now) {
    return musicLibraryCache.value
  }

  if (!musicLibraryCache.promise) {
    musicLibraryCache.promise = buildMusicLibrary()
      .then((library) => {
        musicLibraryCache.value = library
        musicLibraryCache.expiresAt = Date.now() + MUSIC_LIBRARY_CACHE_TTL_MS
        return library
      })
      .finally(() => {
        musicLibraryCache.promise = null
      })
  }

  return musicLibraryCache.promise
}

function getFallbackMusicLibrary(reason) {
  return {
    generatedAt: new Date().toISOString(),
    sourcePage: NOOKIPEDIA_KK_SONGS_URL,
    apiDocs: NOOKIPEDIA_API_DOCS_URL,
    defaultNightTrackId: 'ambient-4am-rainy',
    defaultSunriseTrackId: 'sunrise-animal-crossing-theme',
    degraded: true,
    reason: String(reason || 'Remote music sources unavailable'),
    tracks: [
      {
        id: 'ambient-4am-rainy',
        title: '4 AM Rainy Weather',
        kind: 'ambient',
        group: 'Theme defaults',
        source: 'Local fallback',
        attribution: 'Fallback music library',
        audioUrl: null,
        artworkUrl: MUSIC_LIBRARY_FALLBACK_ART,
        referenceUrl: NOOKIPEDIA_API_DOCS_URL
      },
      {
        id: 'sunrise-animal-crossing-theme',
        title: 'Animal Crossing Theme',
        kind: 'audio',
        group: 'Theme defaults',
        source: 'Local fallback',
        attribution: 'Fallback music library',
        audioUrl: null,
        artworkUrl: MUSIC_LIBRARY_FALLBACK_ART,
        referenceUrl: NOOKIPEDIA_API_DOCS_URL
      }
    ]
  }
}

async function buildMusicLibrary() {
  const [songsPageHtml, sunriseSoundtrackHtml] = await Promise.all([
    requestText(NOOKIPEDIA_KK_SONGS_URL),
    requestText(NOOKIPEDIA_SUNRISE_SOUNDTRACK_URL)
  ])
  const kkAircheckTitles = extractKkAircheckFileTitles(songsPageHtml)
  const kkAlbumArtworkUrl = extractNookipediaOgImageUrl(songsPageHtml) || MUSIC_LIBRARY_FALLBACK_ART
  const sunriseArtworkUrl = extractNookipediaOgImageUrl(sunriseSoundtrackHtml) || MUSIC_LIBRARY_FALLBACK_ART
  const [kkFileMetadata, rainyCoverMetadata, sunriseThemeMetadata] = await Promise.all([
    fetchNookipediaFileMetadata(kkAircheckTitles),
    fetchNookipediaFileMetadata([NOOKIPEDIA_RAINY_4AM_COVER_TITLE]),
    fetchMediaWikiFileMetadata(FANDOM_MEDIAWIKI_API_URL, [FANDOM_CITY_FOLK_TITLE_THEME_FILE_TITLE])
  ])

  const rainyCover = rainyCoverMetadata[0] || null
  const sunriseThemeFile = sunriseThemeMetadata[0] || null
  const kkTracks = kkFileMetadata.map((file) => {
    const trackTitle = formatKkTrackTitle(file.title)
    return {
      id: `kk-${slugifyTrackId(trackTitle)}`,
      title: trackTitle,
      kind: 'audio',
      group: 'K.K. Airchecks',
      source: 'Nookipedia aircheck',
      attribution: 'K.K. Slider songs page',
      audioUrl: file.url,
      artworkUrl: kkAlbumArtworkUrl,
      referenceUrl: file.descriptionUrl || NOOKIPEDIA_KK_SONGS_URL
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    sourcePage: NOOKIPEDIA_KK_SONGS_URL,
    apiDocs: NOOKIPEDIA_API_DOCS_URL,
    defaultNightTrackId: 'ambient-4am-rainy',
    defaultSunriseTrackId: 'sunrise-animal-crossing-theme',
    tracks: [
      {
        id: 'ambient-4am-rainy',
        title: '4 AM Rainy Weather',
        kind: 'ambient',
        group: 'Theme defaults',
        source: 'Night ambient preset',
        attribution: 'Nintendo Music artwork via Nookipedia',
        audioUrl: null,
        artworkUrl: rainyCover ? rainyCover.url : MUSIC_LIBRARY_FALLBACK_ART,
        referenceUrl: rainyCover ? rainyCover.descriptionUrl : NOOKIPEDIA_KK_SONGS_URL
      },
      {
        id: 'sunrise-animal-crossing-theme',
        title: 'Animal Crossing Theme',
        kind: 'audio',
        group: 'Theme defaults',
        source: 'Sunrise default theme',
        attribution: 'Animal Crossing: Your Favourite Songs - Original Soundtrack',
        audioUrl: sunriseThemeFile ? sunriseThemeFile.url : null,
        artworkUrl: sunriseArtworkUrl,
        referenceUrl: NOOKIPEDIA_SUNRISE_SOUNDTRACK_URL
      },
      ...kkTracks
    ]
  }
}

function extractKkAircheckFileTitles(html) {
  const matches = String(html || '').matchAll(/href="([^"]*\/wiki\/File:NH_[^"]+\(Aircheck,_Hi-Fi\)\.flac)"/gi)
  const titles = new Set()

  for (const match of matches) {
    const normalizedTitle = normalizeNookipediaFileTitle(match[1])
    if (!normalizedTitle) continue
    titles.add(normalizedTitle)
  }

  return Array.from(titles)
}

function extractNookipediaOgImageUrl(html) {
  const match = String(html || '').match(/property="og:image"\s+content="([^"]+)"/i)
  return match ? match[1] : ''
}

function normalizeNookipediaFileTitle(rawUrl) {
  try {
    const resolved = new URL(rawUrl, 'https://nookipedia.com')
    if (!resolved.pathname.startsWith('/wiki/')) {
      return ''
    }

    return normalizeMediaWikiTitle(decodeURIComponent(resolved.pathname.slice('/wiki/'.length)))
  } catch (error) {
    return ''
  }
}

async function fetchNookipediaFileMetadata(fileTitles) {
  return fetchMediaWikiFileMetadata(NOOKIPEDIA_MEDIAWIKI_API_URL, fileTitles)
}

async function fetchMediaWikiFileMetadata(apiUrl, fileTitles) {
  const normalizedTitles = Array.from(
    new Set(
      (Array.isArray(fileTitles) ? fileTitles : [])
        .map((title) => normalizeMediaWikiTitle(title))
        .filter(Boolean)
    )
  )

  if (!normalizedTitles.length) {
    return []
  }

  const lookup = new Map()

  for (let index = 0; index < normalizedTitles.length; index += 25) {
    const batch = normalizedTitles.slice(index, index + 25)
    const requestUrl = buildMediaWikiApiUrl(apiUrl, {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url',
      format: 'json',
      titles: batch.join('|')
    })
    const payload = await requestJson(requestUrl)
    const pages = payload && payload.query && payload.query.pages

    Object.values(pages || {}).forEach((page) => {
      if (!page || !page.title || !Array.isArray(page.imageinfo) || !page.imageinfo.length) {
        return
      }

      const imageInfo = page.imageinfo[0]
      lookup.set(normalizeMediaWikiTitle(page.title), {
        title: normalizeMediaWikiTitle(page.title),
        url: imageInfo.url,
        descriptionUrl: imageInfo.descriptionurl || ''
      })
    })
  }

  return normalizedTitles
    .map((title) => lookup.get(title))
    .filter(Boolean)
}

function buildMediaWikiApiUrl(apiUrl, params) {
  const searchParams = new URLSearchParams(params)
  return `${apiUrl}?${searchParams.toString()}`
}

function normalizeMediaWikiTitle(value) {
  return String(value || '').replace(/_/g, ' ').trim()
}

function formatKkTrackTitle(fileTitle) {
  return normalizeMediaWikiTitle(fileTitle)
    .replace(/^File:NH\s+/i, '')
    .replace(/\s+\(Aircheck, Hi-Fi\)\.flac$/i, '')
}

function slugifyTrackId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function requestJson(url) {
  return requestText(url).then((text) => JSON.parse(text))
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'user-agent': 'acnh-live-editor/1.0',
        accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        response.resume()
        reject(new Error(`Request failed with status ${response.statusCode} for ${url}`))
        return
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        resolve(body)
      })
    })

    request.on('error', reject)
    request.setTimeout(MUSIC_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out for ${url}`))
    })
  })
}

function resolveBridgeErrorStatus(error) {
  const message = String(error && error.message || '')

  if (/No bridge client connected|Bridge socket is not ready/i.test(message)) {
    return 503
  }

  if (/timed out/i.test(message)) {
    return 504
  }

  if (/not implemented|unsupported/i.test(message)) {
    return 501
  }

  return 500
}
