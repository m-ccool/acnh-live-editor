const express = require('express')
const { execFile, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const bridgeService = require('./bridgeService')
const cheatsService = require('./cheatsService')
const {
  BRIDGE_HOST,
  BRIDGE_PORT
} = require('./bridgeService')
const {
  getCatalogDiagnostics,
  getCachedCatalogItems
} = require('./nookipediaCatalog')
const {
  buildCatalogStatusResponse,
  listStarterItemsWithPreview,
  lookupCatalogItems,
  searchCatalogItems,
  findCatalogItemByName,
  mergeCatalogItems
} = require('./catalogApi')
const {
  getMusicLibrary
} = require('./musicLibrary')


function resolveAppVersion() {
  try {
    const repoRoot = path.join(__dirname, '..')
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim() || 'detached'
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    return `${branch}@${commit}`
  } catch (_) {
    return process.env.APP_VERSION || 'dev@unknown'
  }
}

const APP_VERSION = resolveAppVersion()

// Item-names-en.txt index: loaded once, keyed by hex itemId string (e.g. "0x059A" → "Sleeping bag")
let _itemNamesIndex = null
function getItemNamesIndex() {
  if (_itemNamesIndex) return _itemNamesIndex
  const namesPath = path.join(__dirname, '..', 'data', 'item-names-en.txt')
  _itemNamesIndex = {}
  try {
    const lines = fs.readFileSync(namesPath, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const name = line.trim()
      if (name) {
        const hex = '0x' + i.toString(16).toUpperCase().padStart(4, '0')
        _itemNamesIndex[hex] = name
      }
    })
  } catch (_) {}
  return _itemNamesIndex
}

function enrichVillagerItems(items) {
  if (!Array.isArray(items)) return items
  const index = getItemNamesIndex()
  const localItems = listStarterItemsWithPreview()
  const cachedItems = getCachedCatalogItems()
  const catalogItems = mergeCatalogItems(cachedItems, localItems)
  return items.map(slot => {
    if (!slot || typeof slot !== 'object') return slot
    const rawId = String(slot.itemId || '')
    const hexKey = rawId.match(/^0x([0-9a-f]+)$/i)
      ? '0x' + rawId.slice(2).toUpperCase().padStart(4, '0')
      : rawId
    const name = index[hexKey] || null
    if (!name) return slot
    const catalogItem = findCatalogItemByName(catalogItems, name)
    const imageUrl = catalogItem
      ? (catalogItem.preview_url || catalogItem.icon_url || catalogItem.image_url || null)
      : null
    return { ...slot, name, ...(imageUrl ? { imageUrl } : {}) }
  })
}

function enrichVillagers(villagers) {
  if (!Array.isArray(villagers)) return villagers
  return villagers.map(v => {
    if (!v || v.empty) return v
    return {
      ...v,
      furniture: enrichVillagerItems(v.furniture),
      clothes:   enrichVillagerItems(v.clothes),
    }
  })
}

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

  router.post('/api/dev/cleanup', async (req, res) => {
    const repoRoot = path.join(__dirname, '..')
    const generatedPaths = [
      path.join(os.homedir(), '.acnh-live-server.log'),
      path.join(os.homedir(), '.acnh-live-bridge.log'),
      path.join(os.tmpdir(), 'bridge.log'),
      path.join(os.tmpdir(), 'acnh-live-editor-shot.png')
    ]

    try {
      const removed = []
      await new Promise((resolve, reject) => {
        execFile(
          'git',
          ['clean', '-fdX', '--', 'test-results', '.codex-temp', '.codex-*.log'],
          { cwd: repoRoot, timeout: 20000 },
          (error, stdout) => {
            if (error) {
              reject(error)
              return
            }
            String(stdout || '').split(/\r?\n/).filter(Boolean).forEach((line) => removed.push(line))
            resolve()
          }
        )
      })

      for (const targetPath of generatedPaths) {
        try {
          await fs.promises.access(targetPath)
          await fs.promises.rm(targetPath, { recursive: true, force: true })
          removed.push(targetPath)
        } catch (error) {
          if (error && error.code !== 'ENOENT') throw error
        }
      }

      res.json({ ok: true, removedCount: removed.length })
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message })
    }
  })

  router.get('/api/status', (req, res) => {
    const bridgeStatus = bridgeService.getStatus()
    const listenerIp = getPreferredLocalIp(req)
    res.json({
      ...bridgeStatus,
      appVersion: APP_VERSION,
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
      const result = await bridgeService.readVillagers()
      if (result && result.payload && Array.isArray(result.payload.villagers)) {
        result.payload.villagers = enrichVillagers(result.payload.villagers)
      }
      res.json(result)
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

  // ── Cheats: enable/disable + server-persisted list ──
  router.get('/api/bridge/cheats', (req, res) => {
    res.json({ ok: true, ...cheatsService.list() })
  })

  router.post('/api/bridge/cheats/:id', async (req, res) => {
    const id = String(req.params.id || '')
    const enabled = !!(req.body && req.body.enabled)
    try {
      const result = enabled
        ? await cheatsService.enable(id)
        : await cheatsService.disable(id)
      if (!result.ok) return res.status(400).json(result)
      res.json(result)
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message })
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

  router.post('/api/backups/force-close-ryujinx', async (req, res) => {
    res.status(409).json({
      ok: false,
      error: 'Force close is disabled. Close Ryujinx manually on Steam Deck before backups.'
    })
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

  // Proxy villager head icons from Nookipedia CDN (dodo.ac).
  // Path is derived from MediaWiki MD5 hash of the filename — no API key needed.
  // Filename pattern: {DisplayName}_NH_Villager_Icon.png
  router.get('/api/villager-icon/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9 _'\-]/g, '').trim()
    if (!name) return res.status(400).end()
    const https = require('https')
    const crypto = require('crypto')

    const capitalName = name.charAt(0).toUpperCase() + name.slice(1)
    const filename = `${capitalName}_NH_Villager_Icon.png`
    const hash = crypto.createHash('md5').update(filename).digest('hex')
    const d1 = hash[0]
    const d2 = hash.slice(0, 2)
    const iconUrl = `https://dodo.ac/np/images/${d1}/${d2}/${encodeURIComponent(filename)}`

    https.get(iconUrl, { headers: { 'User-Agent': 'acnh-live-editor/1.0' } }, (upstream) => {
      if (upstream.statusCode !== 200) { upstream.resume(); return res.status(404).end() }
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      upstream.pipe(res)
    }).on('error', () => res.status(502).end())
  })

  // Proxy villager full-body art via Wikia CDN (same hash approach as villager-icon).
  router.get('/api/villager-art/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9 _'\-]/g, '').trim()
    if (!name) return res.status(400).end()
    const https = require('https')
    const crypto = require('crypto')

    const capitalName = name.charAt(0).toUpperCase() + name.slice(1)
    const filename = `${capitalName}_NH.png`
    const hash = crypto.createHash('md5').update(filename).digest('hex')
    const d1 = hash[0]
    const d2 = hash.slice(0, 2)
    const artUrl = `https://dodo.ac/np/images/${d1}/${d2}/${encodeURIComponent(filename)}`

    https.get(artUrl, { headers: { 'User-Agent': 'acnh-live-editor/1.0' } }, (upstream) => {
      if (upstream.statusCode !== 200) { upstream.resume(); return res.status(404).end() }
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      upstream.pipe(res)
    }).on('error', () => res.status(502).end())
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

  // List backup files for a specific villager (newest first, with catchphrase + movingOut extracted)
  router.get('/api/villager/backups/:name', (req, res) => {
    const fs = require('fs')
    const path = require('path')
    const name = (req.params.name || '').trim()
    if (!name) return res.status(400).json({ ok: false, error: 'name required' })
    const dir = path.join(__dirname, '..', 'data', 'villager-backups')
    if (!fs.existsSync(dir)) return res.json({ ok: true, backups: [] })
    let files
    try { files = fs.readdirSync(dir) } catch { return res.json({ ok: true, backups: [] }) }
    const prefix = name.toLowerCase()
    const backups = files
      .filter(f => f.toLowerCase().startsWith(prefix + '_') && f.endsWith('.nhv'))
      .map(f => {
        const fullPath = path.join(dir, f)
        let catchphrase = null, movingOut = null, timestamp = null
        try {
          const raw = fs.readFileSync(fullPath, 'utf8')
          const parsed = JSON.parse(raw)
          catchphrase = parsed.catchphrase != null ? parsed.catchphrase : null
          movingOut   = parsed.movingOut   != null ? parsed.movingOut   : null
          // Extract timestamp from filename: Name_YYYY-MM-DDTHH-MM-SS-mssZ.nhv
          const tsMatch = f.slice(name.length + 1, -4).replace(/-(?=\d{4}$)/, 'Z').replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, '$1-$2-$3T$4:$5:$6.$7Z')
          const stat = fs.statSync(fullPath)
          timestamp = stat.mtime.toISOString()
          const sizeKb = +(stat.size / 1024).toFixed(1)
          return { filename: f, timestamp, sizeKb, catchphrase, movingOut }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    res.json({ ok: true, backups })
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
      // Single SSH connection: pull + restart via systemd (D-Bus env required for SSH sessions)
      const combined = await runStep(SSH_EXE, [
        ...SSH_OPTS, DECK_HOST,
        'cd ~/acnh-live-editor' +
        ' && (git pull --ff-only origin dev 2>&1 || true)' +
        ' ; export XDG_RUNTIME_DIR=/run/user/$(id -u)' +
        ' ; export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus' +
        ' ; systemctl --user restart acnh-live-bridge' +
        ' && echo "systemd restarted"'
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

  // Reload server — graceful restart
  router.post('/api/reload-server', (req, res) => {
    res.json({ ok: true, message: 'Server reloading...' })
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  })

  // Batch 3: report how many commits the local checkout is behind origin/dev.
  // Runs `git fetch` at most once per 15 minutes (cached), then compares HEAD
  // to origin/dev via rev-list. Fail-closed: any git error returns ok:false
  // so the client hides the update button rather than showing stale info.
  const REPO_STATUS_TTL_MS = 15 * 60 * 1000
  let _repoStatusCache = { at: 0, payload: null }
  router.get('/api/repo-status', (req, res) => {
    const now = Date.now()
    if (_repoStatusCache.payload && (now - _repoStatusCache.at) < REPO_STATUS_TTL_MS) {
      return res.json(_repoStatusCache.payload)
    }
    const path = require('path')
    const { execFile } = require('child_process')
    const repoRoot = path.join(__dirname, '..')
    const branch = 'dev'

    function runGit(args) {
      return new Promise(resolve => {
        execFile('git', args, { cwd: repoRoot, timeout: 20000 }, (err, stdout, stderr) => {
          resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() })
        })
      })
    }

    ;(async () => {
      const fetchStep = await runGit(['fetch', 'origin', branch])
      if (!fetchStep.ok) {
        const payload = { ok: false, error: fetchStep.err || 'git fetch failed' }
        _repoStatusCache = { at: now, payload }
        return res.json(payload)
      }
      const behindStep = await runGit(['rev-list', '--count', `HEAD..origin/${branch}`])
      const aheadStep = await runGit(['rev-list', '--count', `origin/${branch}..HEAD`])
      const localStep = await runGit(['rev-parse', '--short', 'HEAD'])
      const remoteStep = await runGit(['rev-parse', '--short', `origin/${branch}`])
      const payload = {
        ok: true,
        branch,
        behind: Number(behindStep.out || 0),
        ahead: Number(aheadStep.out || 0),
        local: localStep.out || null,
        remote: remoteStep.out || null
      }
      _repoStatusCache = { at: now, payload }
      res.json(payload)
    })().catch(err => {
      const payload = { ok: false, error: String(err && err.message || err) }
      _repoStatusCache = { at: now, payload }
      res.status(500).json(payload)
    })
  })

  // Update local repo from origin/dev, then exit so systemd restarts with new code
  router.post('/api/update-local', (req, res) => {
    const path = require('path')
    const { execFile } = require('child_process')
    const repoRoot = path.join(__dirname, '..')
    const branch = 'dev'

    const steps = []
    function runStep(file, args) {
      return new Promise(resolve => {
        execFile(file, args, { cwd: repoRoot, timeout: 30000 }, (err, stdout, stderr) => {
          const out = ((stdout || '') + (stderr || '')).trim().slice(0, 800)
          resolve({ ok: !err, out, code: err ? (err.code || 1) : 0 })
        })
      })
    }

    ;(async () => {
      const currentBranch = await runStep('git', ['branch', '--show-current'])
      steps.push({ step: 'git branch', ...currentBranch })
      if (!currentBranch.ok || currentBranch.out !== branch) {
        return res.status(409).json({ ok: false, branch, error: `Checkout must be on ${branch}`, steps })
      }

      const fetch = await runStep('git', ['fetch', 'origin', branch])
      steps.push({ step: 'git fetch', ...fetch })
      if (!fetch.ok) {
        return res.status(500).json({ ok: false, branch, error: 'git fetch failed', steps })
      }

      const pull = await runStep('git', ['pull', '--ff-only', 'origin', branch])
      steps.push({ step: 'git pull', ...pull })

      const rev = await runStep('git', ['rev-parse', '--short', 'HEAD'])
      steps.push({ step: 'git rev-parse', ...rev })

      res.json({ ok: pull.ok && rev.ok, branch, commit: rev.out, steps })

      if (pull.ok && rev.ok) {
        setTimeout(() => { process.exit(0) }, 1500)
      }
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
