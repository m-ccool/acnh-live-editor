const express = require('express')
const dgram = require('dgram')
const path = require('path')
const fs = require('fs')
require('dotenv').config({
  path: path.join(__dirname, '.env'),
  quiet: true
})

const bridgeService = require('./modules/bridgeService')
const {
  BRIDGE_HOST,
  BRIDGE_PORT
} = require('./modules/bridgeService')
const createApiRouter = require('./modules/apiRouter')
const { getPreferredLocalIp } = require('./modules/localIp')
const { refreshCatalogInBackground } = require('./modules/nookipediaCatalog')

const app = express()
const PORT = process.env.PORT || 3000
const publicDir = path.join(__dirname, 'public')

// Auto cache-bust: stamp all ?v=\d+ query strings with startup time.
// No more manual version number bumps needed.
const STARTUP_STAMP = Date.now()
let _indexHtml = null
function getIndexHtml() {
  if (!_indexHtml) {
    const raw = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
    _indexHtml = raw.replace(/\?v=\d+/g, `?v=${STARTUP_STAMP}`)
  }
  return _indexHtml
}

// CORS — allow GitHub Pages and any origin to call the API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.static(publicDir, { index: false }))
app.use(express.json())
app.use(createApiRouter({ getPreferredLocalIp }))

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(getIndexHtml())
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

  // UDP beacon: broadcast our IP every 3s so Deck clients auto-discover us
  // Uses port 32841 (BRIDGE_PORT+1). Outbound UDP broadcast is never firewalled.
  const BEACON_PORT = BRIDGE_PORT + 1
  const beacon = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  beacon.bind(() => {
    beacon.setBroadcast(true)
    const payload = Buffer.from(JSON.stringify({ service: 'acnh-bridge', port: BRIDGE_PORT }))
    const sendBeacon = () => {
      beacon.send(payload, 0, payload.length, BEACON_PORT, '255.255.255.255', () => {})
    }
    sendBeacon()
    setInterval(sendBeacon, 3000)
    console.log(`UDP beacon broadcasting on port ${BEACON_PORT}`)
  })

  refreshCatalogInBackground()
})
