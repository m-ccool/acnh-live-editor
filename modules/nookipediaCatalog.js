const fs = require('fs')
const https = require('https')
const path = require('path')
const tls = require('tls')
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  quiet: true
})

const NOOKIPEDIA_API_BASE_URL = 'https://api.nookipedia.com'
const DEFAULT_ACCEPT_VERSION = process.env.NOOKIPEDIA_ACCEPT_VERSION || '1.7.0'
const CACHE_TTL_MS = 1000 * 60 * 60 * 12
const REQUEST_TIMEOUT_MS = 8000
const FAILURE_TTL_MS = 1000 * 60 * 5
const DISK_CACHE_PATH = path.join(__dirname, '..', 'data', 'nookipedia-items-cache.json')
const DIAGNOSTICS_TTL_MS = 15000
const MAX_REQUEST_RETRIES = 2

const ENDPOINTS = [
  {
    path: '/nh/items',
    sourceLabel: 'miscellaneous items',
    expand(entry) {
      return [createCatalogItem(entry, {
        category: deriveMiscItemCategory(entry),
        imageUrl: entry.image_url
      })]
    }
  },
  {
    path: '/nh/tools',
    sourceLabel: 'tools',
    expand(entry) {
      return expandVariationEntries(entry, {
        category: 'Tool'
      })
    }
  },
  {
    path: '/nh/furniture',
    sourceLabel: 'furniture',
    expand(entry) {
      return expandVariationEntries(entry, {
        category: entry.category || 'Furniture'
      })
    }
  },
  {
    path: '/nh/clothing',
    sourceLabel: 'clothing',
    expand(entry) {
      return expandVariationEntries(entry, {
        category: entry.category || 'Clothing'
      })
    }
  },
  {
    path: '/nh/interior',
    sourceLabel: 'interior items',
    expand(entry) {
      return [createCatalogItem(entry, {
        category: entry.category || 'Interior',
        imageUrl: entry.image_url
      })]
    }
  },
  {
    path: '/nh/fish',
    sourceLabel: 'fish',
    expand(entry) {
      return [createCatalogItem(entry, {
        category: 'Fish',
        imageUrl: entry.image_url || entry.render_url
      })]
    }
  },
  {
    path: '/nh/bugs',
    sourceLabel: 'bugs',
    expand(entry) {
      return [createCatalogItem(entry, {
        category: 'Bug',
        imageUrl: entry.image_url || entry.render_url
      })]
    }
  },
  {
    path: '/nh/sea',
    sourceLabel: 'sea creatures',
    expand(entry) {
      return [createCatalogItem(entry, {
        category: 'Sea creature',
        imageUrl: entry.image_url || entry.render_url
      })]
    }
  },
  {
    path: '/nh/art',
    sourceLabel: 'art',
    expand(entry) {
      const items = []

      if (entry.real_info && entry.real_info.image_url) {
        items.push(createCatalogItem(entry, {
          category: entry.art_type || 'Art',
          imageUrl: entry.real_info.image_url,
          variantLabel: 'Real'
        }))
      }

      if (entry.fake_info && entry.fake_info.image_url) {
        items.push(createCatalogItem(entry, {
          category: entry.art_type || 'Art',
          imageUrl: entry.fake_info.image_url,
          variantLabel: 'Fake'
        }))
      }

      return items
    }
  },
  {
    path: '/nh/recipes',
    sourceLabel: 'recipes',
    expand(entry) {
      return [createCatalogItem(entry, {
        category: 'Recipe',
        imageUrl: entry.image_url
      })]
    }
  },
  {
    path: '/nh/fossils/all',
    sourceLabel: 'fossils',
    expand(entry) {
      const fossils = Array.isArray(entry.fossils) ? entry.fossils : []

      return fossils
        .filter((fossil) => fossil && fossil.image_url)
        .map((fossil) => createCatalogItem(fossil, {
          category: 'Fossil',
          imageUrl: fossil.image_url,
          referenceUrl: fossil.url || entry.url,
          sourceEntry: entry
        }))
    }
  },
  {
    path: '/nh/gyroids',
    sourceLabel: 'gyroids',
    expand(entry) {
      return expandVariationEntries(entry, {
        category: 'Gyroid'
      })
    }
  }
]

const catalogCache = {
  value: null,
  expiresAt: 0,
  promise: null,
  failureExpiresAt: 0,
  loadedDiskState: false,
  diskState: null,
  memorySource: null,
  lastLoadedFromDiskAt: null,
  lastSuccessfulSyncAt: null,
  lastSyncError: null,
  diagnostics: null,
  diagnosticsExpiresAt: 0
}

function hasNookipediaApiKey() {
  return Boolean(getApiKey())
}

async function getCatalogItems() {
  const apiKey = getApiKey()

  if (!apiKey) {
    throw new Error('Missing NOOKIPEDIA_API_KEY')
  }

  const now = Date.now()
  if (catalogCache.value && catalogCache.expiresAt > now) {
    return catalogCache.value
  }

  if (catalogCache.failureExpiresAt > now) {
    throw new Error('Nookipedia catalog temporarily unavailable')
  }

  if (!catalogCache.promise) {
    catalogCache.promise = buildCatalogItems(apiKey)
      .then((items) => {
        catalogCache.value = items
        catalogCache.expiresAt = Date.now() + CACHE_TTL_MS
        catalogCache.memorySource = 'api'
        catalogCache.failureExpiresAt = 0
        catalogCache.lastSuccessfulSyncAt = new Date().toISOString()
        catalogCache.lastSyncError = null
        writeDiskCatalogCache(items, catalogCache.lastSuccessfulSyncAt)
        return items
      })
      .catch((error) => {
        const fallbackItems = getCachedCatalogItems()
        if (fallbackItems.length) {
          catalogCache.value = fallbackItems
          catalogCache.expiresAt = 0
          catalogCache.memorySource = 'disk'
          catalogCache.lastSyncError = `Fell back to disk cache: ${error.message}`
          return fallbackItems
        }

        catalogCache.failureExpiresAt = Date.now() + FAILURE_TTL_MS
        catalogCache.lastSyncError = error.message
        throw error
      })
      .finally(() => {
        catalogCache.promise = null
      })
  }

  return catalogCache.promise
}

function getCachedCatalogItems() {
  if (Array.isArray(catalogCache.value) && catalogCache.value.length) {
    return catalogCache.value
  }

  const diskState = readDiskCatalogCache()
  if (Array.isArray(diskState.items) && diskState.items.length) {
    catalogCache.value = diskState.items
    catalogCache.expiresAt = 0
    catalogCache.memorySource = 'disk'
    catalogCache.lastLoadedFromDiskAt = new Date().toISOString()
    if (diskState.updatedAt) {
      catalogCache.lastSuccessfulSyncAt = diskState.updatedAt
    }
    return diskState.items
  }

  return []
}

function refreshCatalogInBackground() {
  if (!hasNookipediaApiKey()) {
    return null
  }

  const now = Date.now()
  if (catalogCache.promise || catalogCache.failureExpiresAt > now) {
    return catalogCache.promise
  }

  const refreshPromise = getCatalogItems().catch((error) => {
    console.warn(`Background Nookipedia refresh failed: ${error.message}`)
    return null
  })

  return refreshPromise
}

function getCatalogSyncState() {
  const diskState = readDiskCatalogCache()
  const diskItems = Array.isArray(diskState.items) ? diskState.items : []

  return {
    configured: hasNookipediaApiKey(),
    acceptVersion: DEFAULT_ACCEPT_VERSION,
    cachePath: DISK_CACHE_PATH,
    inMemoryCount: Array.isArray(catalogCache.value) ? catalogCache.value.length : 0,
    memorySource: catalogCache.memorySource,
    diskCount: diskItems.length,
    diskUpdatedAt: diskState.updatedAt || null,
    lastLoadedFromDiskAt: catalogCache.lastLoadedFromDiskAt,
    lastSuccessfulSyncAt: catalogCache.lastSuccessfulSyncAt,
    lastSyncError: catalogCache.lastSyncError,
    hasActiveRefresh: Boolean(catalogCache.promise)
  }
}

async function getCatalogDiagnostics() {
  const now = Date.now()
  if (catalogCache.diagnostics && catalogCache.diagnosticsExpiresAt > now) {
    return catalogCache.diagnostics
  }

  const diagnostics = {
    generatedAt: new Date().toISOString(),
    host: 'api.nookipedia.com',
    tcpTls: await probeTlsHandshake(),
    httpDoc: await probeHttpRequest('/doc'),
    httpApi: await probeHttpRequest('/nh/fish?thumbsize=64', {
      'X-API-KEY': getApiKey(),
      'Accept-Version': DEFAULT_ACCEPT_VERSION
    })
  }

  catalogCache.diagnostics = diagnostics
  catalogCache.diagnosticsExpiresAt = now + DIAGNOSTICS_TTL_MS
  return diagnostics
}

function getApiKey() {
  return String(process.env.NOOKIPEDIA_API_KEY || '').trim()
}

function readDiskCatalogCache() {
  if (catalogCache.loadedDiskState) {
    return catalogCache.diskState || normalizeDiskCatalogState([], null)
  }

  catalogCache.loadedDiskState = true

  if (!fs.existsSync(DISK_CACHE_PATH)) {
    catalogCache.diskState = normalizeDiskCatalogState([], null)
    return catalogCache.diskState
  }

  try {
    const raw = fs.readFileSync(DISK_CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    const normalized = normalizeDiskCatalogState(parsed.items, parsed.updatedAt)
    catalogCache.diskState = normalized

    if (normalized.updatedAt) {
      catalogCache.lastSuccessfulSyncAt = normalized.updatedAt
    }

    return normalized
  } catch (error) {
    catalogCache.lastSyncError = `Failed to read disk cache: ${error.message}`
    catalogCache.diskState = normalizeDiskCatalogState([], null)
    return catalogCache.diskState
  }
}

function writeDiskCatalogCache(items, updatedAt) {
  fs.mkdirSync(path.dirname(DISK_CACHE_PATH), { recursive: true })

  const payload = {
    updatedAt: String(updatedAt || new Date().toISOString()),
    acceptVersion: DEFAULT_ACCEPT_VERSION,
    count: Array.isArray(items) ? items.length : 0,
    items: Array.isArray(items) ? items : []
  }

  fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8')
  catalogCache.loadedDiskState = true
  catalogCache.diskState = normalizeDiskCatalogState(payload.items, payload.updatedAt)
}

function normalizeDiskCatalogState(items, updatedAt) {
  return {
    updatedAt: updatedAt ? String(updatedAt) : null,
    items: Array.isArray(items) ? items : []
  }
}

async function buildCatalogItems(apiKey) {
  const responses = await Promise.allSettled(
    ENDPOINTS.map(async (endpoint) => {
      const entries = await requestNookipediaJson(endpoint.path, apiKey)
      return normalizeEndpointEntries(endpoint, entries)
    })
  )

  const endpointErrors = []
  const items = responses
    .flatMap((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      }

      const errorMessage = describeError(result.reason)
      const endpointPath = ENDPOINTS[index].path
      endpointErrors.push(`${endpointPath}: ${errorMessage}`)
      console.warn(`Skipping ${endpointPath}: ${errorMessage}`)
      return []
    })
    .flat()
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name)
      if (byName !== 0) {
        return byName
      }

      return left.file_name.localeCompare(right.file_name)
    })
    .map((item, index) => ({
      ...item,
      internal_id: index + 1
    }))

  if (!items.length) {
    const detail = endpointErrors.length
      ? ` (${endpointErrors.slice(0, 3).join('; ')})`
      : ''
    throw new Error(`No Nookipedia catalog items were fetched successfully${detail}`)
  }

  return items
}

function normalizeEndpointEntries(endpoint, entries) {
  if (!Array.isArray(entries)) {
    return []
  }

  return entries.flatMap((entry) => {
    try {
      return endpoint.expand(entry)
        .filter(Boolean)
        .map((item) => ({
          ...item,
          source_notes: `Nookipedia ${endpoint.sourceLabel}`,
          source: {
            provider: 'nookipedia',
            endpoint: endpoint.path,
            version: DEFAULT_ACCEPT_VERSION,
            url: item.reference_url
          }
        }))
    } catch (error) {
      return []
    }
  })
}

function expandVariationEntries(entry, options) {
  const variations = Array.isArray(entry.variations) ? entry.variations : []

  if (!variations.length) {
    return [createCatalogItem(entry, {
      category: options.category,
      imageUrl: entry.image_url || '',
      referenceUrl: entry.url
    })]
  }

  return variations
    .filter((variation) => variation && variation.image_url)
    .map((variation) => createCatalogItem(entry, {
      category: options.category,
      imageUrl: variation.image_url,
      variantLabel: variationLabelFromVariation(variation),
      referenceUrl: entry.url,
      variation
    }))
}

function createCatalogItem(entry, options = {}) {
  const displayName = formatItemName(entry.name)
  const variantLabel = String(options.variantLabel || '').trim()
  const imageUrl = String(options.imageUrl || '').trim()

  if (!displayName || !imageUrl) {
    return null
  }

  const fullName = variantLabel ? `${displayName} (${variantLabel})` : displayName
  const sourceEntry = options.sourceEntry || entry

  return {
    name: fullName,
    category: String(options.category || 'Catalog').trim(),
    icon_url: imageUrl,
    image_url: imageUrl,
    preview_url: imageUrl,
    file_name: buildFileName(options.category || 'catalog', displayName, variantLabel),
    source_files: [],
    reference_url: String(options.referenceUrl || entry.url || sourceEntry.url || '').trim(),
    nookipedia_url: String(entry.url || sourceEntry.url || '').trim(),
    variation: variantLabel || null,
    buy: Array.isArray(entry.buy) ? entry.buy : [],
    sell: getSellValue(entry),
    stack: typeof entry.stack === 'number' ? entry.stack : null
  }
}

function requestNookipediaJson(pathname, apiKey, attempt = 0) {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = https.get(`${NOOKIPEDIA_API_BASE_URL}${pathname}`, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept-Version': DEFAULT_ACCEPT_VERSION,
        'User-Agent': 'acnh-live-editor/1.0',
        accept: 'application/json'
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        const statusCode = response.statusCode
        let errorBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          errorBody += chunk
        })
        response.on('end', () => {
          if (settled) {
            return
          }
          settled = true
          const bodySnippet = String(errorBody || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 120)

          if (shouldRetryRequest(statusCode, attempt) || shouldRetryBodySnippet(bodySnippet, attempt)) {
            delay(getRetryDelayMs(attempt))
              .then(() => resolve(requestNookipediaJson(pathname, apiKey, attempt + 1)))
              .catch(reject)
            return
          }

          const bodySuffix = bodySnippet ? `: ${bodySnippet}` : ''
          reject(new Error(`Nookipedia request failed (${statusCode}) for ${pathname}${bodySuffix}`))
        })
        response.on('close', () => {
          if (settled) {
            return
          }
          settled = true
          const bodySnippet = String(errorBody || '').trim().replace(/\s+/g, ' ').slice(0, 120)
          const bodySuffix = bodySnippet ? `: ${bodySnippet}` : ''
          reject(new Error(`Nookipedia request failed (${statusCode}) for ${pathname}${bodySuffix}`))
        })
        response.resume()
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
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          if (attempt < MAX_REQUEST_RETRIES) {
            delay(getRetryDelayMs(attempt))
              .then(() => resolve(requestNookipediaJson(pathname, apiKey, attempt + 1)))
              .catch(reject)
            return
          }

          reject(new Error(`Invalid Nookipedia JSON for ${pathname}: ${error.message}`))
        }
      })
    })

    request.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true

      if (shouldRetryNetworkError(error, attempt)) {
        delay(getRetryDelayMs(attempt))
          .then(() => resolve(requestNookipediaJson(pathname, apiKey, attempt + 1)))
          .catch(reject)
        return
      }

      reject(error)
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Nookipedia request timed out for ${pathname}`))
    })
  })
}

function shouldRetryRequest(statusCode, attempt) {
  return attempt < MAX_REQUEST_RETRIES && [429, 502, 503, 504].includes(Number(statusCode))
}

function shouldRetryNetworkError(error, attempt) {
  if (attempt >= MAX_REQUEST_RETRIES) {
    return false
  }

  const code = String(error && error.code || '').trim().toUpperCase()
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)
}

function shouldRetryBodySnippet(bodySnippet, attempt) {
  return attempt < MAX_REQUEST_RETRIES && /rate limit|temporarily unavailable|try again/i.test(String(bodySnippet || ''))
}

function getRetryDelayMs(attempt) {
  return 400 * (attempt + 1)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function probeTlsHandshake() {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const socket = tls.connect({
      host: 'api.nookipedia.com',
      port: 443,
      servername: 'api.nookipedia.com',
      timeout: 4000
    }, () => {
      resolve({
        ok: true,
        authorized: socket.authorized,
        elapsedMs: Date.now() - startedAt
      })
      socket.end()
    })

    socket.on('timeout', () => {
      resolve({
        ok: false,
        phase: 'tls',
        error: 'TLS handshake timed out',
        elapsedMs: Date.now() - startedAt
      })
      socket.destroy()
    })

    socket.on('error', (error) => {
      resolve({
        ok: false,
        phase: 'tls',
        error: error.message,
        elapsedMs: Date.now() - startedAt
      })
    })
  })
}

function probeHttpRequest(pathname, extraHeaders = {}) {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    let settled = false
    const request = https.get(`${NOOKIPEDIA_API_BASE_URL}${pathname}`, {
      headers: {
        'User-Agent': 'acnh-live-editor/1.0',
        ...extraHeaders
      }
    }, (response) => {
      let bytes = 0

      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > 0 && !settled) {
          settled = true
          request.destroy()
          const status = response.statusCode || 0
          resolve({
            ok: status >= 200 && status < 400,
            status,
            firstByteMs: Date.now() - startedAt,
            bytes
          })
        }
      })

      response.on('end', () => {
        if (settled) {
          return
        }
        settled = true
        const status = response.statusCode || 0
        resolve({
          ok: status >= 200 && status < 400,
          status,
          firstByteMs: Date.now() - startedAt,
          bytes
        })
      })
    })

    request.setTimeout(4000, () => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        ok: false,
        phase: 'http',
        path: pathname,
        error: 'HTTP response timed out',
        elapsedMs: Date.now() - startedAt
      })
      request.destroy()
    })

    request.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        ok: false,
        phase: 'http',
        path: pathname,
        error: error.message,
        elapsedMs: Date.now() - startedAt
      })
    })
  })
}

function describeError(error) {
  if (error instanceof Error) {
    const message = String(error.message || '').trim()
    if (message) {
      return message
    }

    return error.name || 'Error'
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (error && typeof error === 'object') {
    const status = error.statusCode || error.status
    if (status) {
      return `HTTP ${status}`
    }

    const fallback = String(error.toString ? error.toString() : '').trim()
    if (fallback && fallback !== '[object Object]') {
      return fallback
    }
  }

  return 'Unknown error'
}

function deriveMiscItemCategory(entry) {
  if (entry && entry.is_fence) {
    return 'Fence'
  }

  if (entry && entry.plant_type) {
    return 'Plant'
  }

  if (entry && entry.edible) {
    return 'Food'
  }

  return 'Material'
}

function variationLabelFromVariation(variation) {
  const variationName = String(variation.variation || '').trim()
  const patternName = String(variation.pattern || '').trim()

  if (variationName && patternName) {
    return `${variationName} / ${patternName}`
  }

  return variationName || patternName || ''
}

function formatItemName(value) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

function buildFileName(category, name, variantLabel) {
  const parts = [
    'nookipedia',
    slugify(category),
    slugify(name)
  ]

  if (variantLabel) {
    parts.push(slugify(variantLabel))
  }

  return parts.filter(Boolean).join('_')
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getSellValue(entry) {
  if (typeof entry.sell === 'number') {
    return entry.sell
  }

  if (typeof entry.sell_nook === 'number') {
    return entry.sell_nook
  }

  return null
}

module.exports = {
  DISK_CACHE_PATH,
  getCachedCatalogItems,
  getCatalogItems,
  getCatalogDiagnostics,
  getCatalogSyncState,
  hasNookipediaApiKey,
  refreshCatalogInBackground
}
