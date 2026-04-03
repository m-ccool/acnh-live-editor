const fs = require('fs')
const path = require('path')

const {
  getCachedCatalogItems,
  getCatalogSyncState,
  hasNookipediaApiKey,
  refreshCatalogInBackground
} = require('./nookipediaCatalog')

const dataPath = path.join(__dirname, '..', 'data', 'items.json')
const itemsAssetDir = path.join(__dirname, '..', 'public', 'assets', 'items')

function listStarterItemsWithPreview() {
  const items = readStarterItems()
  const assetNames = getItemAssetNames()

  return items.map((item) => {
    const previewFile = findBestPreviewAsset(item, assetNames)
    return {
      ...item,
      preview_url: previewFile ? `/assets/items/${encodeURIComponent(previewFile)}` : item.image_url || item.icon_url || null
    }
  })
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

function getItemAssetNames() {
  if (!fs.existsSync(itemsAssetDir)) {
    return []
  }

  return fs.readdirSync(itemsAssetDir).filter((name) => name.toLowerCase().endsWith('.png'))
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

module.exports = {
  buildCatalogStatusResponse,
  listStarterItemsWithPreview,
  searchCatalogItems
}
