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

// Server-side cache for Nookipedia villager metadata (keyed by lowercase display name).
// Avoids a Nookipedia API call on every page load; TTL = 24 h.
const _nookCache = new Map() // name → { id, image_url, expiry }
const _NOOK_TTL_MS = 24 * 60 * 60 * 1000

function _fetchNookVillager(name) {
  const key = name.toLowerCase()
  const cached = _nookCache.get(key)
  if (cached && cached.expiry > Date.now()) return Promise.resolve(cached)

  const https = require('https')
  const apiKey = String(process.env.NOOKIPEDIA_API_KEY || '').trim()
  if (!apiKey) return Promise.reject(new Error('no api key'))

  return new Promise((resolve, reject) => {
    const url = `https://api.nookipedia.com/villagers?name=${encodeURIComponent(name)}`
    const req = https.get(url, {
      headers: { 'X-API-KEY': apiKey, 'Accept-Version': '1.7.0', 'User-Agent': 'acnh-live-editor/1.0' }
    }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          const v = Array.isArray(data) ? data[0] : data
          if (!v || !v.id) return reject(new Error('not found'))
          const entry = { id: v.id, image_url: v.image_url || null, expiry: Date.now() + _NOOK_TTL_MS }
          _nookCache.set(key, entry)
          resolve(entry)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

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
  // Uses Nookipedia to resolve display name → internal id (e.g. "Bob" → "cat00").
  // Cache-Control: no-store prevents browsers from caching a stale placeholder PNG.
  router.get('/api/villager-icon/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9 _'\-]/g, '').trim()
    if (!name) return res.status(400).end()
    const https = require('https')

    _fetchNookVillager(name).then(({ id }) => {
      const iconUrl = `https://acnhcdn.com/latest/NpcIcon/${id}.png`
      https.get(iconUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
        const ct = upstream.headers['content-type'] || ''
        if (!ct.startsWith('image/')) { upstream.resume(); return res.status(404).end() }
        res.setHeader('Content-Type', ct)
        res.setHeader('Cache-Control', 'public, max-age=3600')
        upstream.pipe(res)
      }).on('error', () => res.status(502).end())
    }).catch(() => res.status(404).end())
  })

  // Proxy villager full-body art via Nookipedia API (used in edit modal).
  router.get('/api/villager-art/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9 _'\-]/g, '').trim()
    if (!name) return res.status(400).end()
    const https = require('https')

    _fetchNookVillager(name).then(({ image_url }) => {
      if (!image_url) return res.status(404).end()
      https.get(image_url, { headers: { 'User-Agent': 'acnh-live-editor/1.0' } }, (upstream) => {
        const ct = upstream.headers['content-type'] || ''
        if (!ct.startsWith('image/')) { upstream.resume(); return res.status(404).end() }
        res.setHeader('Content-Type', ct)
        res.setHeader('Cache-Control', 'public, max-age=86400')
        upstream.pipe(res)
      }).on('error', () => res.status(502).end())
    }).catch(() => res.status(404).end())
  })

  // Save villager data as an .nhv backup file in data/villager-backups/
  router.post('/api/villager/backup', (req, res) => {
    const { villager } = req.body || {}
    if (!villager || !villager.name) return res.status(400).json({ ok: false, error: 'no villager data' })
    const fs = require('fs')
    const path = require('path')
    const dir = path.join(__dirname, '..', 'data', 'villager-backups')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${villager.name}_${ts}.nhv`
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(villager, null, 2), 'utf8')
    res.json({ ok: true, filename })
  })

  // Open the villager-backups folder in Windows Explorer
  router.post('/api/villager/open-backups', (req, res) => {
    const path = require('path')
    const fs = require('fs')
    const { exec } = require('child_process')
    const dir = path.join(__dirname, '..', 'data', 'villager-backups')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    exec(`explorer "${dir}"`, () => {}) // fire-and-forget; non-Windows is a no-op
    res.json({ ok: true, path: dir })
  })

  // Push local commits, pull to Steam Deck, restart bridge
  // Connect Bridge: git pull on Deck + bridge restart in ONE SSH connection
  router.post('/api/connect-bridge', (req, res) => {
    const { execFile } = require('child_process')
    const path = require('path')
    const repoRoot = path.join(__dirname, '..')
    const SSH_EXE   = process.env.SSH_PATH || 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
    const SSH_KEY   = process.env.STEAMDECK_SSH_KEY || 'C:/Users/mccoo/.ssh/id_ed25519_steamdeck'
    const DECK_HOST = process.env.STEAMDECK_HOST    || 'deck@10.0.0.233'
    const SSH_OPTS  = ['-i', SSH_KEY, '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no']

    const steps = []
    function runStep(file, args, timeoutMs = 40000) {
      return new Promise(resolve => {
        execFile(file, args, { cwd: repoRoot, timeout: timeoutMs }, (err, stdout, stderr) => {
          const out = ((stdout || '') + (stderr || '')).trim().slice(0, 800)
          resolve({ ok: !err, out, code: err ? (err.code || 1) : 0 })
        })
      })
    }

    ;(async () => {
      // Single SSH connection: pull + kill old bridge + start new bridge
      const combined = await runStep(SSH_EXE, [
        ...SSH_OPTS, DECK_HOST,
        'cd ~/acnh-live-editor' +
        ' && git pull --ff-only origin dev 2>&1 || echo "pull skipped"' +
        ' ; pkill -f steamdeck-bridge-client 2>/dev/null || true' +
        ' ; systemctl --user restart acnh-live-bridge 2>/dev/null' +
        ' || nohup bash ~/acnh-live-editor/scripts/steamdeck-run-bridge.sh >/tmp/bridge.log 2>&1 </dev/null &' +
        ' ; echo "bridge launch sent"'
      ])
      steps.push({ step: 'deck pull + bridge restart', ...combined })
      res.json({ ok: combined.ok, steps })
    })().catch(err => res.status(500).json({ ok: false, error: err.message, steps }))
  })

  router.post('/api/deploy', (req, res) => {
    const path = require('path')
    const { execFile } = require('child_process')
    const repoRoot = path.join(__dirname, '..')
    const SSH_EXE   = process.env.SSH_PATH || 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
    const SSH_KEY  = process.env.STEAMDECK_SSH_KEY  || 'C:/Users/mccoo/.ssh/id_ed25519_steamdeck'
    const DECK_HOST = process.env.STEAMDECK_HOST    || 'deck@10.0.0.233'
    const SSH_OPTS  = ['-i', SSH_KEY, '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no']

    const steps = []
    function runStep(file, args, opts = {}) {
      return new Promise(resolve => {
        execFile(file, args, { cwd: repoRoot, timeout: 30000, ...opts }, (err, stdout, stderr) => {
          const out = ((stdout || '') + (stderr || '')).trim().slice(0, 800)
          resolve({ ok: !err, out, code: err ? (err.code || 1) : 0 })
        })
      })
    }

    ;(async () => {
      const push = await runStep('git', ['push', 'origin', 'dev'])
      steps.push({ step: 'git push', ...push })
      // continue to SSH steps even if push fails (nothing new to push is fine)

      const pull = await runStep('ssh', [
        ...SSH_OPTS, DECK_HOST,
        'cd ~/acnh-live-editor && git pull --ff-only origin dev 2>&1'
      ])
      steps.push({ step: 'deck pull', ...pull })

      const restart = await runStep('ssh', [
        ...SSH_OPTS, DECK_HOST,
        'systemctl --user restart acnh-live-bridge 2>/dev/null || ' +
        '(pkill -f steamdeck-bridge-client 2>/dev/null; ' +
        'nohup bash ~/acnh-live-editor/scripts/steamdeck-run-bridge.sh >/tmp/bridge.log 2>&1 </dev/null & disown; sleep 3; grep -q "connected\\|Connected\\|CONNECTED\\|listening\\|Listening" /tmp/bridge.log && echo "bridge started" || tail -5 /tmp/bridge.log)'
      ])
      steps.push({ step: 'bridge restart', ...restart })

      const allOk = pull.ok && restart.ok
      res.json({ ok: allOk, steps })
    })().catch(err => res.status(500).json({ ok: false, error: err.message, steps }))
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
