const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

const publicDir = path.join(__dirname, 'public')
const dataPath = path.join(__dirname, 'data', 'items.json')

app.use(express.static(publicDir))
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'acnh-live-editor'
  })
})

app.get('/api/status', (req, res) => {
  res.json({
    connected: false,
    emulator: 'ryujinx',
    game: 'acnh',
    version: null,
    bridge: 'pending'
  })
})

app.get('/api/items', (req, res) => {
  try {
    if (!fs.existsSync(dataPath)) {
      return res.json([])
    }

    const raw = fs.readFileSync(dataPath, 'utf8')
    const items = JSON.parse(raw)

    res.json(items)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load items' })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Running http://localhost:${PORT}`)
})