const express = require('express')
const path = require('path')
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

app.use(express.static(publicDir))
app.use(express.json())
app.use(createApiRouter({ getPreferredLocalIp }))

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'))
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

  refreshCatalogInBackground()
})
