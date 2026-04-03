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
  searchCatalogItems
} = require('./catalogApi')
const {
  getFallbackMusicLibrary,
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
    res.json({
      ...bridgeStatus,
      ip: bridgeStatus.ip || getPreferredLocalIp(req),
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

  router.post('/api/bridge/write-inventory-slot', async (req, res) => {
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

  router.get('/api/music/library', async (req, res) => {
    try {
      res.json(await getMusicLibrary())
    } catch (error) {
      console.warn(`Music library fallback: ${error.message}`)
      res.json(getFallbackMusicLibrary(error.message))
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
