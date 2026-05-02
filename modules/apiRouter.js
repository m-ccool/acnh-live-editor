const express = require('express')

const bridgeService = require('./bridgeService')
const {
  BRIDGE_HOST,
  BRIDGE_PORT
} = require('./bridgeService')
const {
  getCatalogDiagnostics
} = require('./nookipediaCatalog')
const {
  buildCatalogStatusResponse,
  listStarterItemsWithPreview,
  lookupCatalogItems,
  searchCatalogItems
} = require('./catalogApi')
const {
  getMusicLibrary
} = require('./musicLibrary')

function createApiRouter(options = {}) {
  const getPreferredLocalIp = typeof options.getPreferredLocalIp === 'function'
    ? options.getPreferredLocalIp
    : () => null
  const router = express.Router()

  router.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      app: 'acnh-live-editor'
    })
  })

  router.get('/api/status', (req, res) => {
    const bridgeStatus = bridgeService.getStatus()
    const listenerIp = getPreferredLocalIp(req)
    res.json({
      ...bridgeStatus,
      ip: listenerIp || bridgeStatus.ip,
      listenerIp,
      clientIp: bridgeStatus.ip || null,
      bridgeHost: bridgeStatus.bridgeHost || BRIDGE_HOST,
      bridgePort: bridgeStatus.bridgePort || BRIDGE_PORT
    })
  })

  router.get('/api/bridge/status', (req, res) => {
    const bridgeStatus = bridgeService.getStatus()
    const listenerIp = getPreferredLocalIp(req)
    res.json({
      ...bridgeStatus,
      ip: listenerIp || bridgeStatus.ip,
      listenerIp,
      clientIp: bridgeStatus.ip || null,
      bridgeHost: bridgeStatus.bridgeHost || BRIDGE_HOST,
      bridgePort: bridgeStatus.bridgePort || BRIDGE_PORT
    })
  })

  router.get('/api/bridge/read-status', async (req, res) => {
    try {
      res.json(await bridgeService.readStatus())
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.get('/api/bridge/read-inventory', async (req, res) => {
    try {
      res.json(await bridgeService.readInventory())
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.get('/api/bridge/read-game-data', async (req, res) => {
    try {
      res.json(await bridgeService.readGameData())
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.get('/api/bridge/read-villagers', async (req, res) => {
    try {
      res.json(await bridgeService.readVillagers())
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.post('/api/bridge/write-inventory-slot', async (req, res) => {
    const slot = Number(req.body && req.body.slot)
    const itemPayload = req.body && req.body.item && typeof req.body.item === 'object'
      ? req.body.item
      : req.body

    if (!Number.isInteger(slot) || slot < 1) {
      res.status(400).json({ error: 'slot must be a positive integer' })
      return
    }

    try {
      res.json(await bridgeService.writeInventorySlot({
        slot,
        itemId: itemPayload && itemPayload.itemId ? String(itemPayload.itemId) : null,
        count: Number(itemPayload && itemPayload.count || 0),
        uses: Number(itemPayload && itemPayload.uses || 0),
        flag0: Number(itemPayload && itemPayload.flag0 || 0),
        flag1: Number(itemPayload && itemPayload.flag1 || 0)
      }))
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.post('/api/bridge/write-player', async (req, res) => {
    const playerData = req.body && req.body.player
    
    if (!playerData || typeof playerData !== 'object') {
      res.status(400).json({ error: 'player data is required' })
      return
    }

    try {
      const result = await bridgeService.writePlayerData(playerData)
      res.json(result)
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.get('/api/backups', async (req, res) => {
    try {
      const result = await bridgeService.listBackups()
      res.json(result.payload || result)
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.post('/api/backups', async (req, res) => {
    const label = String(req.body && req.body.label || '').slice(0, 80)
    try {
      const result = await bridgeService.createBackup(label)
      res.json(result.payload || result)
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.post('/api/backups/:id/restore', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id || !/^[\w\-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid backup id' })
      return
    }
    try {
      const result = await bridgeService.restoreBackup(id)
      res.json(result.payload || result)
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.delete('/api/backups/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id || !/^[\w\-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid backup id' })
      return
    }
    try {
      const result = await bridgeService.deleteBackup(id)
      res.json(result.payload || result)
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.patch('/api/backups/:id/label', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id || !/^[\w\-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid backup id' })
      return
    }
    const label = String(req.body.label || '').slice(0, 80)
    try {
      const result = await bridgeService.updateBackupLabel(id, label)
      res.json(result.payload || result)
    } catch (error) {
      res.status(resolveBridgeErrorStatus(error)).json({ error: error.message })
    }
  })

  router.get('/api/items', (req, res) => {
    try {
      res.json(listStarterItemsWithPreview())
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'Failed to load items' })
    }
  })

  router.get('/api/items/search', (req, res) => {
    try {
      const query = String(req.query.q || '')
      const filter = String(req.query.filter || 'all')
      const requestedLimit = Number(req.query.limit || 12)
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50) : 12

      res.json(searchCatalogItems({ query, filter, limit }))
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'Failed to search catalog' })
    }
  })

  router.post('/api/items/lookup', express.json(), async (req, res) => {
    try {
      const names = Array.isArray(req.body && req.body.names) ? req.body.names : []
      res.json({ items: await lookupCatalogItems(names) })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'Failed to lookup catalog items' })
    }
  })

  router.get('/api/music/library', async (req, res) => {
    try {
      res.json(await getMusicLibrary())
    } catch (error) {
      console.error(error)
      res.status(503).json({ error: 'Music library unavailable' })
    }
  })

  router.get('/api/catalog/status', (req, res) => {
    res.json(buildCatalogStatusResponse())
  })

  router.get('/api/catalog/diagnostics', async (req, res) => {
    try {
      res.json(await getCatalogDiagnostics())
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'Failed to probe catalog connection' })
    }
  })

  // Proxy villager head icons from acnhcdn.com (used in list view).
  // acnhcdn.com (via Cloudflare) returns 404 status with PNG body — check content-type, not status code.
  router.get('/api/villager-icon/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9_\-]/g, '')
    if (!name) return res.status(400).end()
    const https = require('https')
    const url = `https://acnhcdn.com/latest/NpcIcon/${name}.png`
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
      const ct = upstream.headers['content-type'] || ''
      if (!ct.startsWith('image/')) {
        upstream.resume()
        return res.status(404).end()
      }
      res.setHeader('Content-Type', ct)
      res.setHeader('Cache-Control', 'public, max-age=86400')
      upstream.pipe(res)
    }).on('error', () => res.status(502).end())
  })

  // Proxy villager full-body art via Nookipedia API (used in edit modal).
  // Looks up image_url from /villagers?name=<name>, then proxies the image.
  router.get('/api/villager-art/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9 _'\-]/g, '').trim()
    if (!name) return res.status(400).end()
    const https = require('https')
    const apiKey = String(process.env.NOOKIPEDIA_API_KEY || '').trim()
    if (!apiKey) return res.status(503).json({ error: 'Nookipedia API key not configured' })

    const metaUrl = `https://api.nookipedia.com/villagers?name=${encodeURIComponent(name)}`
    const metaReq = https.get(metaUrl, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept-Version': '1.7.0',
        'User-Agent': 'acnh-live-editor/1.0'
      }
    }, (metaRes) => {
      let body = ''
      metaRes.on('data', (chunk) => { body += chunk })
      metaRes.on('end', () => {
        let imageUrl
        try {
          const data = JSON.parse(body)
          const villager = Array.isArray(data) ? data[0] : data
          imageUrl = villager && villager.image_url
        } catch (_) {}

        if (!imageUrl) return res.status(404).end()

        https.get(imageUrl, { headers: { 'User-Agent': 'acnh-live-editor/1.0' } }, (imgRes) => {
          const ct = imgRes.headers['content-type'] || ''
          if (!ct.startsWith('image/')) {
            imgRes.resume()
            return res.status(404).end()
          }
          res.setHeader('Content-Type', ct)
          res.setHeader('Cache-Control', 'public, max-age=86400')
          imgRes.pipe(res)
        }).on('error', () => res.status(502).end())
      })
    })
    metaReq.on('error', () => res.status(502).end())
  })

  return router
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

module.exports = createApiRouter
