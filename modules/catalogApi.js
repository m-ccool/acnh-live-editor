const fs = require('fs')
const https = require('https')
const path = require('path')

const {
  getCachedCatalogItems,
  getCatalogSyncState,
  hasNookipediaApiKey,
  refreshCatalogInBackground
} = require('./nookipediaCatalog')

const NOOKIPEDIA_MEDIAWIKI_API_URL = 'https://nookipedia.com/w/api.php'
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

async function lookupCatalogItems(names = []) {
  const requestedNames = Array.isArray(names)
    ? names.map((name) => String(name || '').trim()).filter(Boolean)
    : []

  if (!requestedNames.length) {
    return []
  }

  const localItems = listStarterItemsWithPreview()
  const cachedItems = getCachedCatalogItems()
  const catalogItems = mergeCatalogItems(cachedItems, localItems)
  const resolvedItems = []

  for (const requestedName of requestedNames) {
    const directMatch = findCatalogItemByName(catalogItems, requestedName)
    if (directMatch) {
      resolvedItems.push(directMatch)
      continue
    }

    const liveWikiMatch = await fetchNookipediaWikiItem(requestedName)
    if (liveWikiMatch) {
      resolvedItems.push(liveWikiMatch)
    }
  }

  return resolvedItems
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
        : 'offline'
  const labelByState = {
    live: 'Live',
    syncing: 'Syncing',
    cached: 'Cached',
    offline: 'Offline'
  }
  const messageByState = {
    live: 'Nookipedia catalog is cached and ready.',
    syncing: 'Connecting to Nookipedia live catalog.',
    cached: 'Using cached Nookipedia catalog.',
    offline: syncState.configured
      ? (syncState.lastSyncError || 'Catalog unavailable. Run sync and retry.')
      : 'Nookipedia API key is not configured. Set NOOKIPEDIA_API_KEY in .env and restart the server.'
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

function normalizeLookupLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
}

function findCatalogItemByName(items, name) {
  const lookupAliases = buildLookupAliases(name)
  if (!lookupAliases.length) {
    return null
  }

  const catalogItems = Array.isArray(items) ? items : []
  for (const item of catalogItems) {
    const itemName = normalizeLookupLabel(item && item.name)
    const itemFileName = normalizeLookupLabel(item && item.file_name)
    const itemNameCanonical = toCanonicalLookup(itemName)
    const itemFileCanonical = toCanonicalLookup(itemFileName)

    if (lookupAliases.some((lookup) => (
      lookup === itemName ||
      lookup === itemFileName ||
      lookup === itemNameCanonical ||
      lookup === itemFileCanonical
    ))) {
      return item
    }
  }

  return null
}

function buildLookupAliases(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return []
  }

  const direct = normalizeLookupLabel(raw)
  const stripped = normalizeLookupLabel(raw.replace(/\s*\([^)]*\)\s*$/, ''))
  const canonical = toCanonicalLookup(direct)
  const singular = toSingularLookup(direct)
  const bellsAlias = resolveBellBagAlias(raw)

  return Array.from(new Set([
    direct,
    stripped,
    canonical,
    toCanonicalLookup(stripped),
    singular,
    toCanonicalLookup(singular),
    bellsAlias,
    toCanonicalLookup(bellsAlias)
  ].filter(Boolean)))
}

function toCanonicalLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toSingularLookup(value) {
  const normalized = normalizeLookupLabel(value)
  if (!normalized) {
    return ''
  }

  const irregular = {
    cherries: 'cherry',
    peaches: 'peach',
    coconuts: 'coconut',
    oranges: 'orange',
    apples: 'apple',
    pears: 'pear'
  }

  if (irregular[normalized]) {
    return irregular[normalized]
  }

  if (/ies$/.test(normalized)) {
    return normalized.replace(/ies$/, 'y')
  }

  if (/s$/.test(normalized) && !/ss$/.test(normalized)) {
    return normalized.slice(0, -1)
  }

  return normalized
}

function resolveBellBagAlias(name) {
  const match = String(name || '').trim().match(/^(\d{1,3}(?:,\d{3})*)\s+bells$/i)
  if (!match) {
    return ''
  }

  const amount = Number(String(match[1]).replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) {
    return ''
  }

  return amount >= 99000 ? '99k Bells' : '30,000 Bells'
}

function fetchNookipediaWikiItem(name) {
  const aliases = buildLookupAliases(name)
  const preferredLabel = aliases[0] || String(name || '').trim()
  return fetchNookipediaItemIconById(preferredLabel)
    .then((iconItem) => {
      if (iconItem) {
        return iconItem
      }

      const wikiTitle = resolveWikiTitle(preferredLabel)
      if (!wikiTitle) {
        return null
      }

      const urlPath = `/wiki/${encodeURIComponent(wikiTitle)}`
      return requestText(`https://nookipedia.com${urlPath}`)
        .then((html) => {
          const imageUrl = extractOgImage(String(html || ''))
          if (!imageUrl) {
            return null
          }

          const displayName = formatDisplayName(name)
          return {
            name: displayName,
            category: 'Nookipedia',
            icon_url: imageUrl,
            image_url: imageUrl,
            preview_url: imageUrl,
            internal_id: null,
            file_name: wikiTitle,
            source_notes: 'live nookipedia wiki',
            source_files: [],
            source: {
              endpoint: '/wiki',
              path: urlPath
            }
          }
        })
    })
    .catch(() => null)
}

function fetchNookipediaItemIconById(value) {
  const candidateIds = buildWikiFileIdCandidates(value)
  if (!candidateIds.length) {
    return Promise.resolve(null)
  }

  const fileCandidates = candidateIds.flatMap((id) => [
    `File:${id}_NH_Icon.png`,
    `File:${id}_NH_Inv_Icon.png`,
    `File:${id}_NH_DIY_Icon.png`
  ])

  return queryMediaWikiFileInfo(fileCandidates)
    .then((fileInfo) => {
      if (!fileInfo || !fileInfo.url) {
        return null
      }

      const resolvedId = candidateIds.find((id) => String(fileInfo.title || '').includes(id.replace(/_/g, ' '))) || candidateIds[0]

      return {
        name: formatDisplayName(value),
        category: 'Nookipedia',
        icon_url: fileInfo.url,
        image_url: fileInfo.url,
        preview_url: fileInfo.url,
        internal_id: null,
        file_name: resolvedId,
        source_notes: 'live nookipedia file metadata',
        source_files: [],
        source: {
          endpoint: '/w/api.php',
          path: fileInfo.descriptionUrl || ''
        }
      }
    })
}

function buildWikiFileIdCandidates(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return []
  }

  const singular = toSingularLookup(raw)
  const bases = Array.from(new Set([raw, singular].filter(Boolean)))
  const ids = []

  for (const base of bases) {
    const normalized = String(base).trim().replace(/[-\s]+/g, '_')
    if (!normalized) {
      continue
    }

    ids.push(normalized)
    ids.push(normalized.toLowerCase())
    ids.push(toWikiTitle(base))
    ids.push(toWikiTitleWithStopwords(base))
  }

  return Array.from(new Set(ids.filter(Boolean)))
}

function toWikiTitleWithStopwords(value) {
  const canonical = toCanonicalLookup(value)
  if (!canonical) {
    return ''
  }

  const lowerWords = new Set(['of', 'the', 'and', 'a', 'an', 'to', 'in', 'on', 'for', 'with'])
  return canonical
    .split(' ')
    .filter(Boolean)
    .map((token, index) => {
      if (index > 0 && lowerWords.has(token)) {
        return token
      }

      return token.charAt(0).toUpperCase() + token.slice(1)
    })
    .join('_')
}

function queryMediaWikiFileInfo(fileTitles) {
  const normalizedTitles = Array.from(new Set(
    (Array.isArray(fileTitles) ? fileTitles : [])
      .map((title) => String(title || '').trim())
      .filter(Boolean)
  ))

  if (!normalizedTitles.length) {
    return Promise.resolve(null)
  }

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    iiprop: 'url',
    titles: normalizedTitles.join('|')
  })

  return requestJson(`${NOOKIPEDIA_MEDIAWIKI_API_URL}?${params.toString()}`)
    .then((payload) => {
      const pages = payload && payload.query && payload.query.pages
      if (!pages || typeof pages !== 'object') {
        return null
      }

      for (const page of Object.values(pages)) {
        const info = Array.isArray(page && page.imageinfo) ? page.imageinfo[0] : null
        const url = info && typeof info.url === 'string' ? info.url : ''
        if (!url) {
          continue
        }

        return {
          url,
          title: String(page.title || ''),
          descriptionUrl: info.descriptionurl || ''
        }
      }

      return null
    })
}

function resolveWikiTitle(value) {
  const canonical = toCanonicalLookup(value)
  if (!canonical) {
    return ''
  }

  return toWikiTitle(toSingularLookup(canonical) || canonical)
}

function toWikiTitle(value) {
  const canonical = toCanonicalLookup(value)
  if (!canonical) {
    return ''
  }

  return canonical
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('_')
}

function fromWikiTitle(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim()
}

function formatDisplayName(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function extractOgImage(html) {
  const match = String(html || '').match(/property="og:image"\s+content="([^"]+)"/i)
  return match ? String(match[1]).trim() : ''
}

function requestJson(url) {
  return requestText(url).then((text) => JSON.parse(String(text || '{}')))
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = https.get(url, {
      headers: {
        'User-Agent': 'acnh-live-editor/1.0'
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        response.resume()
        settled = true
        reject(new Error(`Request failed (${response.statusCode}) for ${url}`))
        return
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (settled) {
          return
        }
        settled = true
        resolve(body)
      })
      response.on('close', () => {
        if (!settled) {
          settled = true
          resolve(body)
        }
      })
    })

    request.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    })

    request.setTimeout(8000, () => {
      request.destroy(new Error(`Request timed out for ${url}`))
    })
  })
}

function mergeCatalogItems(primaryItems, secondaryItems) {
  const merged = []
  const seen = new Set()

  ;[primaryItems, secondaryItems].forEach((list) => {
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
  lookupCatalogItems,
  searchCatalogItems,
  findCatalogItemByName,
  mergeCatalogItems
}
