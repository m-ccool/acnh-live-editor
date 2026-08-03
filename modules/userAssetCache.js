'use strict'

const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data')
const USER_CONFIG_PATH = path.join(DATA_DIR, 'user-config.json')
const VILLAGER_ASSET_DIR = path.join(DATA_DIR, 'user-assets', 'villagers')

function createDefaultConfig() {
  return {
    version: 1,
    assetCache: {
      updatedAt: null,
      villagers: {}
    }
  }
}

function readUserConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'))
    const config = parsed && typeof parsed === 'object' ? parsed : createDefaultConfig()
    config.version = 1
    config.assetCache = config.assetCache && typeof config.assetCache === 'object'
      ? config.assetCache
      : {}
    config.assetCache.villagers = config.assetCache.villagers && typeof config.assetCache.villagers === 'object'
      ? config.assetCache.villagers
      : {}
    return config
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to read user config: ${error.message}`)
    }
    return createDefaultConfig()
  }
}

function writeUserConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tempPath = `${USER_CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  fs.renameSync(tempPath, USER_CONFIG_PATH)
}

function normalizeVillagerName(value) {
  const name = String(value || '')
    .replace(/[^a-zA-Z0-9 _'\-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  return name || null
}

function getAssetKey(name) {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 16)
}

function getAssetFilePath(name, kind) {
  const normalizedName = normalizeVillagerName(name)
  if (!normalizedName || !['icon', 'art'].includes(kind)) {
    return null
  }
  return path.join(VILLAGER_ASSET_DIR, `${getAssetKey(normalizedName)}-${kind}.png`)
}

function getRemoteAssetUrl(name, kind) {
  const normalizedName = normalizeVillagerName(name)
  if (!normalizedName || !['icon', 'art'].includes(kind)) {
    return null
  }

  const capitalName = normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1)
  const filename = kind === 'icon'
    ? `${capitalName}_NH_Villager_Icon.png`
    : `${capitalName}_NH.png`
  const hash = crypto.createHash('md5').update(filename).digest('hex')
  return `https://dodo.ac/np/images/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(filename)}`
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'acnh-live-editor/1.0' }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Asset source returned ${response.statusCode || 'an error'}`))
        return
      }

      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          contentType: String(response.headers['content-type'] || 'image/png')
        })
      })
    })

    request.setTimeout(15000, () => request.destroy(new Error('Asset download timed out')))
    request.on('error', reject)
  })
}

function writeAsset(filePath, body) {
  fs.mkdirSync(VILLAGER_ASSET_DIR, { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, body)
  fs.renameSync(tempPath, filePath)
}

function getCachedAsset(name, kind) {
  const filePath = getAssetFilePath(name, kind)
  return filePath && fs.existsSync(filePath) ? filePath : null
}

function getAssetStatus() {
  const config = readUserConfig()
  const villagers = Object.values(config.assetCache.villagers)
  const cachedVillagers = villagers.filter((entry) => (
    entry && getCachedAsset(entry.name, 'icon') && getCachedAsset(entry.name, 'art')
  ))

  return {
    configuredVillagers: villagers.length,
    cachedVillagers: cachedVillagers.length,
    cachedFiles: cachedVillagers.length * 2,
    updatedAt: config.assetCache.updatedAt || null,
    configPath: USER_CONFIG_PATH
  }
}

async function cacheVillagerAssets(rawNames) {
  const names = Array.from(new Set(
    (Array.isArray(rawNames) ? rawNames : [])
      .map(normalizeVillagerName)
      .filter(Boolean)
  ))

  if (!names.length) {
    throw new Error('No live villagers are available to cache')
  }

  const config = readUserConfig()
  const failures = []
  let downloadedFiles = 0
  let cachedVillagers = 0

  for (const name of names) {
    const assetPaths = {
      icon: getAssetFilePath(name, 'icon'),
      art: getAssetFilePath(name, 'art')
    }

    try {
      for (const kind of ['icon', 'art']) {
        if (fs.existsSync(assetPaths[kind])) {
          continue
        }
        const remoteUrl = getRemoteAssetUrl(name, kind)
        const asset = await fetchBinary(remoteUrl)
        writeAsset(assetPaths[kind], asset.body)
        downloadedFiles += 1
      }

      config.assetCache.villagers[getAssetKey(name)] = {
        name,
        iconFile: path.basename(assetPaths.icon),
        artFile: path.basename(assetPaths.art),
        cachedAt: new Date().toISOString()
      }
      cachedVillagers += 1
    } catch (error) {
      failures.push({ name, error: error.message })
    }
  }

  if (!cachedVillagers) {
    throw new Error(failures[0] ? `No villager assets were cached: ${failures[0].error}` : 'No villager assets were cached')
  }

  config.assetCache.updatedAt = new Date().toISOString()
  writeUserConfig(config)

  return {
    ...getAssetStatus(),
    requestedVillagers: names.length,
    cachedVillagers,
    downloadedFiles,
    failures
  }
}

module.exports = {
  USER_CONFIG_PATH,
  cacheVillagerAssets,
  getAssetStatus,
  getCachedAsset,
  getRemoteAssetUrl,
  normalizeVillagerName
}
