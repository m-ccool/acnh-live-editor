const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { execFile } = require('child_process')

const host = process.env.BRIDGE_TARGET_HOST || '127.0.0.1'
const port = Number(process.env.BRIDGE_TARGET_PORT || 32840)
const deviceName = process.env.BRIDGE_DEVICE_NAME || 'steamdeck-bridge-client'
const heartbeatMs = Number(process.env.BRIDGE_HEARTBEAT_MS || 5000)
const processMatch = String(process.env.RYUJINX_PROCESS_MATCH || 'Ryujinx').toLowerCase()
const strictRyujinxProbe = String(process.env.RYUJINX_STRICT_PROCESS_CHECK || '1') !== '0'
const inventoryPath = process.env.BRIDGE_INVENTORY_FILE
  ? path.resolve(process.env.BRIDGE_INVENTORY_FILE)
  : null
const persistInventory = String(process.env.BRIDGE_PERSIST_INVENTORY || '0') === '1'
const customStatusCommand = process.env.RYUJINX_STATUS_CMD || ''
const customReadInventoryCommand = process.env.RYUJINX_READ_INVENTORY_CMD || ''
const customWriteInventoryCommand = process.env.RYUJINX_WRITE_INVENTORY_CMD || ''
const customReadGameDataCommand = process.env.RYUJINX_READ_GAME_DATA_CMD || ''
const commandTimeoutMs = Number(process.env.BRIDGE_COMMAND_TIMEOUT_MS || 4000)
const reconnectDelayMs = Number(process.env.BRIDGE_RECONNECT_DELAY_MS || 3000)

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

const inventoryState = loadInventoryState(inventoryPath)
const startedAt = new Date().toISOString()
let panelConnectionState = 'CONNECTING'
let panelConnectionDetail = `Connecting to ${host}:${port}`
let socket = null
let reconnectTimer = null
let reconnectAttempt = 0
let isShuttingDown = false

renderStartupPanel()

connectSocket()

let buffer = ''
let heartbeatTimer = null

process.on('SIGINT', () => {
  isShuttingDown = true
  clearReconnectTimerIfSet()
  send({ type: 'goodbye', deviceName })
  if (socket && !socket.destroyed) {
    socket.end()
  }
})

process.on('SIGTERM', () => {
  isShuttingDown = true
  clearReconnectTimerIfSet()
  send({ type: 'goodbye', deviceName })
  if (socket && !socket.destroyed) {
    socket.end()
  }
})

function connectSocket() {
  if (isShuttingDown) {
    return
  }

  panelConnectionState = 'CONNECTING'
  panelConnectionDetail = reconnectAttempt > 0
    ? `Reconnect attempt ${reconnectAttempt} to ${host}:${port}`
    : `Connecting to ${host}:${port}`
  renderStartupPanel()

  socket = net.createConnection({ host, port }, () => {
    reconnectAttempt = 0
    clearReconnectTimerIfSet()
    panelConnectionState = 'CONNECTED'
    panelConnectionDetail = `Connected to ${host}:${port}`
    renderStartupPanel()
    log(`Connected to bridge listener ${host}:${port}`)
    send(buildHello())
    startHeartbeat()
  })

  socket.setEncoding('utf8')
  buffer = ''

  socket.on('data', (chunk) => {
    buffer += chunk

    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n')
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      try {
        handleMessage(JSON.parse(line))
      } catch (error) {
        log(`Invalid JSON payload from listener: ${error.message}`)
      }
    }
  })

  socket.on('error', (error) => {
    panelConnectionState = 'ERROR'
    panelConnectionDetail = `${error.message} (retrying in ${Math.ceil(reconnectDelayMs / 1000)}s)`
    renderStartupPanel()
    log(`Socket error: ${error.message}`)
  })

  socket.on('close', () => {
    clearIntervalIfSet()
    log('Socket closed')

    if (isShuttingDown) {
      panelConnectionState = 'CLOSED'
      panelConnectionDetail = 'Bridge client stopped'
      renderStartupPanel()
      return
    }

    panelConnectionState = 'CLOSED'
    panelConnectionDetail = `Disconnected from ${host}:${port}`
    renderStartupPanel()
    scheduleReconnect()
  })
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) {
    return
  }

  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectSocket()
  }, reconnectDelayMs)
}

function clearReconnectTimerIfSet() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function startHeartbeat() {
  clearIntervalIfSet()
  heartbeatTimer = setInterval(() => {
    send({
      type: 'heartbeat',
      deviceName,
      timestamp: new Date().toISOString()
    })
  }, heartbeatMs)
}

function clearIntervalIfSet() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function buildHello() {
  return {
    type: 'hello',
    protocolVersion: '1',
    emulator: 'ryujinx',
    game: 'acnh',
    version: 'steamdeck-bridge-v1',
    deviceName,
    capabilities: ['read_status', 'read_inventory', 'write_inventory_slot', 'read_game_data']
  }
}

function send(payload) {
  if (socket && !socket.destroyed) {
    socket.write(`${JSON.stringify(payload)}\n`)
  }
}

function handleMessage(message) {
  const type = normalize(message && message.type)

  if (type === 'hello_ack') {
    log('Handshake complete')
    return
  }

  if (type !== 'request') {
    return
  }

  const requestId = String(message.requestId || '').trim()
  const command = String(message.command || '').trim()

  if (!requestId || !command) {
    return
  }

  if (command === 'read_status') {
    handleReadStatus(requestId, command)
    return
  }

  if (command === 'read_inventory') {
    handleReadInventory(requestId, command)
    return
  }

  if (command === 'write_inventory_slot') {
    handleWriteInventorySlot(requestId, command, message && message.payload)
    return
  }

  if (command === 'read_game_data') {
    handleReadGameData(requestId, command)
    return
  }

  sendError(requestId, command, `${command} is not implemented`)
}

async function handleReadStatus(requestId, command) {
  try {
    const probe = await getRyujinxProbe()
    send({
      type: 'response',
      requestId,
      command,
      ok: true,
      payload: {
        protocolVersion: '1',
        emulator: 'ryujinx',
        game: 'acnh',
        version: 'steamdeck-bridge-v1',
        deviceName,
        platform: os.platform(),
        startedAt,
        capabilities: ['read_status', 'read_inventory', 'write_inventory_slot', 'read_game_data'],
        inventoryAdapter: resolveInventoryAdapter(),
        gameDataAdapter: resolveGameDataAdapter(),
        ryujinx: probe
      }
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleReadGameData(requestId, command) {
  try {
    if (!customReadGameDataCommand) {
      send({
        type: 'response',
        requestId,
        command,
        ok: true,
        payload: {
          player: null,
          source: 'none',
          adapter: resolveGameDataAdapter()
        }
      })
      return
    }

    const output = await runJsonCommand(customReadGameDataCommand, {
      command: 'read_game_data'
    }, 'RYUJINX_READ_GAME_DATA_CMD')

    const payload = normalizeGameDataResult(output)
    payload.adapter = resolveGameDataAdapter()

    send({
      type: 'response',
      requestId,
      command,
      ok: true,
      payload
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleReadInventory(requestId, command) {
  try {
    const slots = await getInventorySlots()
    send({
      type: 'response',
      requestId,
      command,
      ok: true,
      payload: {
        slots,
        adapter: resolveInventoryAdapter()
      }
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleWriteInventorySlot(requestId, command, payload) {
  const slotPayload = normalizeInventorySlot(payload)

  if (!slotPayload) {
    sendError(requestId, command, 'slot must be a positive integer')
    return
  }

  if (customWriteInventoryCommand) {
    try {
      const writeResult = await runWriteInventoryCommand(slotPayload)
      send({
        type: 'response',
        requestId,
        command,
        ok: true,
        payload: {
          slot: writeResult,
          adapter: resolveInventoryAdapter()
        }
      })
    } catch (error) {
      sendError(requestId, command, error.message)
    }
    return
  }

  const existingIndex = inventoryState.findIndex((entry) => entry.slot === slotPayload.slot)
  if (existingIndex >= 0) {
    inventoryState[existingIndex] = slotPayload
  } else {
    inventoryState.push(slotPayload)
  }

  inventoryState.sort((a, b) => a.slot - b.slot)

  if (persistInventory && inventoryPath) {
    persistInventoryState(inventoryPath, inventoryState)
  }

  send({
    type: 'response',
    requestId,
    command,
    ok: true,
    payload: {
      slot: slotPayload,
      adapter: resolveInventoryAdapter(),
      persistence: persistInventory && inventoryPath ? 'file' : 'memory'
    }
  })
}

function resolveInventoryAdapter() {
  if (customReadInventoryCommand || customWriteInventoryCommand) {
    return 'custom-command'
  }

  if (persistInventory && inventoryPath) {
    return 'file'
  }

  return 'memory'
}

function resolveGameDataAdapter() {
  return customReadGameDataCommand ? 'custom-command' : 'none'
}

async function getInventorySlots() {
  if (customReadInventoryCommand) {
    const output = await runJsonCommand(customReadInventoryCommand, {
      command: 'read_inventory'
    }, 'RYUJINX_READ_INVENTORY_CMD')
    return normalizeInventoryResult(output)
  }

  return inventoryState.slice()
}

async function runWriteInventoryCommand(slotPayload) {
  const output = await runJsonCommand(customWriteInventoryCommand, {
    command: 'write_inventory_slot',
    payload: slotPayload
  }, 'RYUJINX_WRITE_INVENTORY_CMD')

  if (output && typeof output === 'object') {
    const candidate = output.slot || output.payload || output.writtenSlot || output
    const normalized = normalizeInventorySlot(candidate)
    if (normalized) {
      return normalized
    }
  }

  return slotPayload
}

function normalizeInventoryResult(value) {
  const source = Array.isArray(value)
    ? value
    : (value && Array.isArray(value.slots) ? value.slots : null)

  if (!source) {
    throw new Error('RYUJINX_READ_INVENTORY_CMD must output JSON array or object with slots array')
  }

  return source.map(normalizeInventorySlot).filter(Boolean)
}

function normalizeInventorySlot(entry) {
  const slot = Number(entry && entry.slot)
  if (!Number.isInteger(slot) || slot < 1) {
    return null
  }

  return {
    slot,
    itemId: entry && entry.itemId ? String(entry.itemId) : null,
    count: Number(entry && entry.count || 0),
    uses: Number(entry && entry.uses || 0),
    flag0: Number(entry && entry.flag0 || 0),
    flag1: Number(entry && entry.flag1 || 0)
  }
}

function normalizeGameDataResult(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('RYUJINX_READ_GAME_DATA_CMD must output a JSON object')
  }

  const player = normalizeGameDataPlayer(value)
  const hasUnavailableFlag = value.unavailable === true || player === null

  const payload = {
    player,
    source: value.source ? String(value.source) : (hasUnavailableFlag ? 'unavailable' : 'custom-command')
  }

  if (hasUnavailableFlag) {
    payload.unavailable = true
  }

  if (Array.isArray(value.slots)) {
    payload.slots = value.slots.map(normalizeInventorySlot).filter(Boolean)
  }

  return payload
}

function normalizeGameDataPlayer(value) {
  const playerSource = value.player && typeof value.player === 'object'
    ? value.player
    : (value && typeof value === 'object' ? value : null)

  if (!playerSource || typeof playerSource !== 'object') {
    return null
  }

  const hasPlayerFields = (
    Object.prototype.hasOwnProperty.call(playerSource, 'name') ||
    Object.prototype.hasOwnProperty.call(playerSource, 'town') ||
    Object.prototype.hasOwnProperty.call(playerSource, 'wallet') ||
    Object.prototype.hasOwnProperty.call(playerSource, 'bank') ||
    Object.prototype.hasOwnProperty.call(playerSource, 'miles') ||
    Object.prototype.hasOwnProperty.call(playerSource, 'avatar')
  )

  if (!hasPlayerFields) {
    return null
  }

  return {
    name: normalizePlayerString(playerSource.name, ''),
    town: normalizePlayerString(playerSource.town, ''),
    wallet: normalizeWholeNumber(playerSource.wallet, 0),
    bank: normalizeWholeNumber(playerSource.bank, 0),
    miles: normalizeWholeNumber(playerSource.miles, 0),
    avatar: normalizePlayerString(playerSource.avatar, '/assets/items/Bob_NH.png')
  }
}

function normalizePlayerString(value, fallback) {
  const text = String(value || '').trim()
  return text || fallback
}

function normalizeWholeNumber(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.trunc(parsed))
}

function loadInventoryState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return []
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.map(normalizeInventorySlot).filter(Boolean)
  } catch (error) {
    log(`Failed to load inventory file: ${error.message}`)
    return []
  }
}

function persistInventoryState(filePath, inventory) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(inventory, null, 2), 'utf8')
  } catch (error) {
    log(`Failed to persist inventory file: ${error.message}`)
  }
}

async function getRyujinxProbe() {
  if (customStatusCommand) {
    return runStatusCommand(customStatusCommand)
  }

  return probeProcessFromPs()
}

function runJsonCommand(commandLine, payload, commandLabel) {
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-lc', commandLine], {
      timeout: commandTimeoutMs,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${commandLabel} failed: ${error.message}`))
        return
      }

      const text = String(stdout || '').trim()
      if (!text) {
        reject(new Error(`${commandLabel} returned empty output`))
        return
      }

      try {
        resolve(JSON.parse(text))
      } catch (parseError) {
        reject(new Error(`${commandLabel} must output valid JSON`))
      }

      const stderrText = String(stderr || '').trim()
      if (stderrText) {
        log(`${commandLabel} stderr: ${stderrText}`)
      }
    })

    if (child && child.stdin) {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
      child.stdin.end()
    }
  })
}

function runStatusCommand(commandLine) {
  return new Promise((resolve, reject) => {
    execFile('sh', ['-lc', commandLine], { timeout: 2500 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`RYUJINX_STATUS_CMD failed: ${error.message}`))
        return
      }

      const text = String(stdout || '').trim()
      if (!text) {
        resolve({
          running: false,
          source: 'custom-command',
          output: ''
        })
        return
      }

      try {
        const parsed = JSON.parse(text)
        resolve({
          source: 'custom-command',
          ...parsed
        })
      } catch (parseError) {
        resolve({
          running: /ryujinx/i.test(text),
          source: 'custom-command',
          output: text,
          stderr: String(stderr || '').trim() || null
        })
      }
    })
  })
}

function probeProcessFromPs() {
  return new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid=,comm=,args='], { timeout: 2000 }, (error, stdout) => {
      if (error) {
        resolve({
          running: false,
          source: 'ps',
          error: error.message
        })
        return
      }

      const lines = String(stdout || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

      const classifiedMatches = lines
        .map(parseProcessLine)
        .map(classifyRyujinxProcess)
        .filter(Boolean)

      const emulatorMatches = classifiedMatches
        .filter((entry) => entry.matchType === 'emulator')
        .slice(0, 3)

      const launcherMatches = classifiedMatches
        .filter((entry) => entry.matchType === 'launcher')
        .slice(0, 3)

      const matches = strictRyujinxProbe
        ? emulatorMatches
        : classifiedMatches.slice(0, 3)

      resolve({
        running: matches.length > 0,
        source: 'ps',
        strict: strictRyujinxProbe,
        matchCount: matches.length,
        matches,
        emulatorMatchCount: emulatorMatches.length,
        launcherMatchCount: launcherMatches.length,
        launcherMatches
      })
    })
  })
}

function parseProcessLine(line) {
  const match = line.match(/^(\d+)\s+(\S+)\s+(.+)$/)
  if (!match) {
    return null
  }

  return {
    pid: Number(match[1]),
    command: match[2],
    args: match[3]
  }
}

function classifyRyujinxProcess(entry) {
  if (!entry) {
    return null
  }

  const haystack = `${entry.command} ${entry.args}`.toLowerCase()
  if (!haystack.includes(processMatch)) {
    return null
  }

  if (Number(entry.pid) === process.pid) {
    return null
  }

  if (isProbeNoise(haystack)) {
    return null
  }

  const matchType = isLikelyRyujinxBinary(entry)
    ? 'emulator'
    : 'launcher'

  return {
    ...entry,
    matchType
  }
}

function isProbeNoise(haystack) {
  return haystack.includes('grep ryujinx') || haystack.includes('steamdeck-bridge-client.js')
}

function isLikelyRyujinxBinary(entry) {
  if (processMatch !== 'ryujinx') {
    return true
  }

  const command = String(entry.command || '')
  const args = String(entry.args || '')

  if (/(^|\/|\\)ryujinx(\.headless)?$/i.test(command)) {
    return true
  }

  if (/ryujinx\.dll/i.test(args)) {
    return true
  }

  if (/\bryujinx(\.headless)?\b/i.test(args) && !/launchers\/ryujinx\.sh/i.test(args)) {
    return true
  }

  if (/\/ryujinx\.sh\b/i.test(args)) {
    return false
  }

  return false
}

function sendError(requestId, command, errorMessage) {
  send({
    type: 'response',
    requestId,
    command,
    ok: false,
    error: errorMessage
  })
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function log(message) {
  process.stdout.write(`[steamdeck-bridge] ${message}\n`)
}

function renderStartupPanel() {
  const title = 'ACNH LIVE BRIDGE'
  const statusColor = resolvePanelStatusColor(panelConnectionState)
  const resetColor = '\u001b[0m'
  const dimColor = '\u001b[2m'
  const accentColor = '\u001b[36m'

  const lines = [
    `${accentColor}${title}${resetColor}`,
    `Target   : ${host}:${port}`,
    `Device   : ${deviceName}`,
    `Status   : ${statusColor}${panelConnectionState}${resetColor}`,
    `Detail   : ${panelConnectionDetail}`,
    `${dimColor}Press Ctrl+C to stop bridge client.${resetColor}`
  ]

  const width = Math.max(...lines.map((line) => stripAnsi(line).length))
  const border = `+${'-'.repeat(width + 2)}+`

  process.stdout.write('\u001b[2J\u001b[H')
  process.stdout.write(`${border}\n`)
  lines.forEach((line) => {
    const visibleLength = stripAnsi(line).length
    const padding = ' '.repeat(width - visibleLength)
    process.stdout.write(`| ${line}${padding} |\n`)
  })
  process.stdout.write(`${border}\n`)
}

function resolvePanelStatusColor(status) {
  if (status === 'CONNECTED') {
    return '\u001b[32m'
  }

  if (status === 'ERROR') {
    return '\u001b[31m'
  }

  if (status === 'CLOSED') {
    return '\u001b[33m'
  }

  return '\u001b[36m'
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '')
}

function printHelp() {
  process.stdout.write('Steam Deck bridge client for ACNH Live Editor\n')
  process.stdout.write('Required: set BRIDGE_TARGET_HOST to your PC LAN IP.\n')
  process.stdout.write('Optional env: BRIDGE_TARGET_PORT, BRIDGE_DEVICE_NAME, BRIDGE_HEARTBEAT_MS, BRIDGE_COMMAND_TIMEOUT_MS, BRIDGE_RECONNECT_DELAY_MS, RYUJINX_PROCESS_MATCH, RYUJINX_STRICT_PROCESS_CHECK, RYUJINX_STATUS_CMD, RYUJINX_READ_INVENTORY_CMD, RYUJINX_WRITE_INVENTORY_CMD, RYUJINX_READ_GAME_DATA_CMD, BRIDGE_INVENTORY_FILE, BRIDGE_PERSIST_INVENTORY\n')
}
