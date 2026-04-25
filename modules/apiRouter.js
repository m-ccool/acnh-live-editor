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
