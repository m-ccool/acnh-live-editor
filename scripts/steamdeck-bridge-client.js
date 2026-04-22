const net = require('net')
const os = require('os')
const { execFile } = require('child_process')

const host = process.env.BRIDGE_TARGET_HOST || '127.0.0.1'
const port = Number(process.env.BRIDGE_TARGET_PORT || 32840)
const deviceName = process.env.BRIDGE_DEVICE_NAME || 'steamdeck-bridge-client'
const heartbeatMs = Number(process.env.BRIDGE_HEARTBEAT_MS || 5000)
const reconnectDelayMs = Number(process.env.BRIDGE_RECONNECT_DELAY_MS || 3000)
const commandTimeoutMs = Number(process.env.BRIDGE_COMMAND_TIMEOUT_MS || 5000)
const processMatch = String(process.env.RYUJINX_PROCESS_MATCH || 'ryujinx').toLowerCase()
const strictRyujinxProbe = String(process.env.RYUJINX_STRICT_PROCESS_CHECK || '1') !== '0'
const customStatusCommand = String(process.env.RYUJINX_STATUS_CMD || '').trim()
const customReadInventoryCommand = String(process.env.RYUJINX_READ_INVENTORY_CMD || '').trim()
const customWriteInventoryCommand = String(process.env.RYUJINX_WRITE_INVENTORY_CMD || '').trim()
const customReadGameDataCommand = String(process.env.RYUJINX_READ_GAME_DATA_CMD || '').trim()
const customWriteGameDataCommand = String(process.env.RYUJINX_WRITE_GAME_DATA_CMD || '').trim()
const startedAt = new Date().toISOString()

const supportedCommands = buildSupportedCommands()

let socket = null
let buffer = ''
let heartbeatTimer = null
let reconnectTimer = null
let reconnectAttempt = 0
let isShuttingDown = false
let panelState = 'CONNECTING'
let panelDetail = `Connecting to ${host}:${port}`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

renderPanel()
connectSocket()

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function connectSocket() {
  if (isShuttingDown) {
    return
  }

  panelState = 'CONNECTING'
  panelDetail = reconnectAttempt > 0
    ? `Reconnect ${reconnectAttempt} to ${host}:${port}`
    : `Connecting to ${host}:${port}`
  renderPanel()

  socket = net.createConnection({ host, port }, () => {
    reconnectAttempt = 0
    clearReconnectTimer()
    buffer = ''
    panelState = 'CONNECTED'
    panelDetail = `Connected to ${host}:${port}`
    renderPanel()
    log(`Connected to ${host}:${port}`)
    send(buildHello())
    startHeartbeat()
  })

  socket.setEncoding('utf8')

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
        log(`Invalid listener payload: ${error.message}`)
      }
    }
  })

  socket.on('error', (error) => {
    panelState = 'ERROR'
    panelDetail = `${error.message} (retrying in ${Math.ceil(reconnectDelayMs / 1000)}s)`
    renderPanel()
    log(`Socket error: ${error.message}`)
  })

  socket.on('close', () => {
    stopHeartbeat()
    log('Socket closed')

    if (isShuttingDown) {
      panelState = 'CLOSED'
      panelDetail = 'Bridge client stopped'
      renderPanel()
      return
    }

    panelState = 'CLOSED'
    panelDetail = `Disconnected from ${host}:${port}`
    renderPanel()
    scheduleReconnect()
  })
}

function shutdown() {
  isShuttingDown = true
  clearReconnectTimer()
  stopHeartbeat()
  send({ type: 'goodbye', deviceName })

  if (socket && !socket.destroyed) {
    socket.end()
  }
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

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    send({
      type: 'heartbeat',
      deviceName,
      timestamp: new Date().toISOString()
    })
  }, heartbeatMs)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function buildSupportedCommands() {
  const commands = ['read_status']

  if (customReadInventoryCommand) {
    commands.push('read_inventory')
  }

  if (customWriteInventoryCommand) {
    commands.push('write_inventory_slot')
  }

  if (customReadGameDataCommand) {
    commands.push('read_game_data')
  }

  if (customWriteGameDataCommand) {
    commands.push('write_game_data')
  }

  return commands
}

function buildHello() {
  return {
    type: 'hello',
    protocolVersion: '1',
    emulator: 'ryujinx',
    game: 'acnh',
    version: 'steamdeck-bridge-mvp',
    deviceName,
    capabilities: supportedCommands
  }
}

function handleMessage(message) {
  const type = normalizeText(message && message.type)

  if (type === 'hello_ack') {
    log('Handshake complete')
    return
  }

  if (type !== 'request') {
    return
  }

  const requestId = String(message && message.requestId || '').trim()
  const command = String(message && message.command || '').trim()

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

  if (command === 'write_game_data') {
    handleWriteGameData(requestId, command, message && message.payload)
    return
  }

  sendError(requestId, command, `${command} is not implemented`)
}

async function handleReadStatus(requestId, command) {
  try {
    const ryujinx = await getRyujinxProbe()
    sendResponse(requestId, command, {
      protocolVersion: '1',
      emulator: 'ryujinx',
      game: 'acnh',
      version: 'steamdeck-bridge-mvp',
      deviceName,
      platform: os.platform(),
      startedAt,
      capabilities: supportedCommands,
      inventoryAdapter: resolveInventoryAdapter(),
      gameDataAdapter: resolveGameDataAdapter(),
      bridgeTargetHost: host,
      bridgeTargetPort: port,
      ryujinx
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleReadInventory(requestId, command) {
  if (!customReadInventoryCommand) {
    sendResponse(requestId, command, {
      slots: [],
      source: 'unavailable',
      unavailable: true,
      adapter: resolveInventoryAdapter()
    })
    return
  }

  try {
    const output = await runJsonCommand(
      customReadInventoryCommand,
      { command: 'read_inventory' },
      'RYUJINX_READ_INVENTORY_CMD'
    )

    const source = Array.isArray(output)
      ? output
      : (output && Array.isArray(output.slots) ? output.slots : null)

    if (!Array.isArray(source)) {
      throw new Error('RYUJINX_READ_INVENTORY_CMD must output a JSON array or object with slots')
    }

    sendResponse(requestId, command, {
      slots: source,
      source: output && output.source ? String(output.source) : 'live-memory',
      backend: output && output.backend ? String(output.backend) : null,
      adapter: resolveInventoryAdapter(),
      lastGameSaveAt: output && output.lastGameSaveAt ? String(output.lastGameSaveAt) : null,
      lastGameDataFilePath: output && output.lastGameDataFilePath ? String(output.lastGameDataFilePath) : null
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleWriteInventorySlot(requestId, command, payload) {
  if (!customWriteInventoryCommand) {
    sendError(requestId, command, 'RYUJINX_WRITE_INVENTORY_CMD is not configured')
    return
  }

  try {
    const output = await runJsonCommand(
      customWriteInventoryCommand,
      {
        command: 'write_inventory_slot',
        payload: payload || {}
      },
      'RYUJINX_WRITE_INVENTORY_CMD'
    )

    sendResponse(requestId, command, {
      slot: output && output.slot ? output.slot : payload,
      slots: Array.isArray(output && output.slots) ? output.slots : null,
      source: output && output.source ? String(output.source) : 'live-memory',
      backend: output && output.backend ? String(output.backend) : null,
      adapter: resolveInventoryAdapter()
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleReadGameData(requestId, command) {
  if (!customReadGameDataCommand) {
    sendResponse(requestId, command, {
      player: null,
      slots: [],
      source: 'unavailable',
      unavailable: true,
      adapter: resolveGameDataAdapter()
    })
    return
  }

  try {
    const output = await runJsonCommand(
      customReadGameDataCommand,
      { command: 'read_game_data' },
      'RYUJINX_READ_GAME_DATA_CMD'
    )

    if (!output || typeof output !== 'object') {
      throw new Error('RYUJINX_READ_GAME_DATA_CMD must output a JSON object')
    }

    sendResponse(requestId, command, {
      player: output.player || null,
      slots: Array.isArray(output.slots) ? output.slots : [],
      source: output.source ? String(output.source) : 'live-memory',
      backend: output.backend ? String(output.backend) : null,
      adapter: resolveGameDataAdapter(),
      lastGameSaveAt: output.lastGameSaveAt ? String(output.lastGameSaveAt) : null,
      lastGameDataFilePath: output.lastGameDataFilePath ? String(output.lastGameDataFilePath) : null
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

async function handleWriteGameData(requestId, command, payload) {
  if (!customWriteGameDataCommand) {
    sendError(requestId, command, 'RYUJINX_WRITE_GAME_DATA_CMD is not configured')
    return
  }

  try {
    const output = await runJsonCommand(
      customWriteGameDataCommand,
      {
        command: 'write_game_data',
        payload: payload || {}
      },
      'RYUJINX_WRITE_GAME_DATA_CMD'
    )

    if (!output || typeof output !== 'object') {
      throw new Error('RYUJINX_WRITE_GAME_DATA_CMD must output a JSON object')
    }

    sendResponse(requestId, command, {
      player: output.player && typeof output.player === 'object' ? output.player : null,
      slots: Array.isArray(output.slots) ? output.slots : null,
      source: output.source ? String(output.source) : 'live-memory',
      backend: output.backend ? String(output.backend) : null,
      adapter: resolveGameDataAdapter(),
      lastGameSaveAt: output.lastGameSaveAt ? String(output.lastGameSaveAt) : null,
      lastGameDataFilePath: output.lastGameDataFilePath ? String(output.lastGameDataFilePath) : null
    })
  } catch (error) {
    sendError(requestId, command, error.message)
  }
}

function resolveInventoryAdapter() {
  return customReadInventoryCommand || customWriteInventoryCommand
    ? 'live-command'
    : 'unconfigured'
}

function resolveGameDataAdapter() {
  return customReadGameDataCommand ? 'live-command' : 'unconfigured'
}

function runJsonCommand(commandLine, payload, label) {
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-lc', commandLine], {
      timeout: commandTimeoutMs,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      const stderrText = String(stderr || '').trim()

      if (stderrText) {
        log(`${label} stderr: ${stderrText}`)
      }

      if (error) {
        reject(new Error(`${label} failed: ${stderrText || error.message}`))
        return
      }

      const text = String(stdout || '').trim()
      if (!text) {
        reject(new Error(`${label} returned empty output`))
        return
      }

      try {
        resolve(JSON.parse(text))
      } catch (parseError) {
        reject(new Error(`${label} must output valid JSON`))
      }
    })

    if (child && child.stdin) {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
      child.stdin.end()
    }
  })
}

async function getRyujinxProbe() {
  if (customStatusCommand) {
    return runStatusCommand(customStatusCommand)
  }

  return probeProcessFromPs()
}

function runStatusCommand(commandLine) {
  return new Promise((resolve, reject) => {
    execFile('sh', ['-lc', commandLine], { timeout: 2500 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`RYUJINX_STATUS_CMD failed: ${error.message}`))
        return
      }

      const text = String(stdout || '').trim()
      const stderrText = String(stderr || '').trim()

      if (!text) {
        resolve({
          running: false,
          source: 'custom-command',
          stderr: stderrText || null
        })
        return
      }

      try {
        resolve({
          source: 'custom-command',
          ...JSON.parse(text)
        })
      } catch (parseError) {
        resolve({
          running: /ryujinx/i.test(text),
          source: 'custom-command',
          output: text,
          stderr: stderrText || null
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

      const matches = lines
        .map(parseProcessLine)
        .map(classifyRyujinxProcess)
        .filter(Boolean)

      const emulatorMatches = matches
        .filter((entry) => entry.matchType === 'emulator')
        .slice(0, 3)

      const selectedMatches = strictRyujinxProbe
        ? emulatorMatches
        : matches.slice(0, 3)

      resolve({
        running: selectedMatches.length > 0,
        source: 'ps',
        strict: strictRyujinxProbe,
        matchCount: selectedMatches.length,
        matches: selectedMatches
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
  if (!entry || !Number.isInteger(entry.pid)) {
    return null
  }

  if (entry.pid === process.pid) {
    return null
  }

  const haystack = `${entry.command} ${entry.args}`.toLowerCase()
  if (!haystack.includes(processMatch)) {
    return null
  }

  if (haystack.includes('steamdeck-bridge-client.js') || haystack.includes('grep ryujinx')) {
    return null
  }

  return {
    ...entry,
    matchType: isLikelyRyujinxBinary(entry) ? 'emulator' : 'launcher'
  }
}

function isLikelyRyujinxBinary(entry) {
  const command = String(entry.command || '')
  const args = String(entry.args || '')
  const argsLower = args.toLowerCase()

  if (/(^|\/|\\)dolphin$/i.test(command) || /\.config\/ryujinx/.test(argsLower)) {
    return false
  }

  if (/(^|\/|\\)ryujinx(\.headless)?$/i.test(command)) {
    return true
  }

  if (/ryujinx\.dll/i.test(args)) {
    return true
  }

  if ((/(^|\s|"|')ryujinx(\.headless)?(\s|$|"|')/i.test(args) ||
      /(^|\s|"|')[^\s"']*\/ryujinx(\.headless)?(\s|$|"|')/i.test(args)) &&
      !/launchers\/ryujinx\.sh/i.test(argsLower)) {
    return true
  }

  return false
}

function send(payload) {
  if (socket && !socket.destroyed) {
    socket.write(`${JSON.stringify(payload)}\n`)
  }
}

function sendResponse(requestId, command, payload) {
  send({
    type: 'response',
    requestId,
    command,
    ok: true,
    payload
  })
}

function sendError(requestId, command, errorMessage) {
  send({
    type: 'response',
    requestId,
    command,
    ok: false,
    error: String(errorMessage || 'Unknown bridge error')
  })
}

function renderPanel() {
  const title = 'ACNH LIVE BRIDGE MVP'
  const statusColor = resolvePanelColor(panelState)
  const reset = '\u001b[0m'
  const accent = '\u001b[36m'
  const dim = '\u001b[2m'

  const lines = [
    `${accent}${title}${reset}`,
    `Target   : ${host}:${port}`,
    `Device   : ${deviceName}`,
    `Status   : ${statusColor}${panelState}${reset}`,
    `Detail   : ${panelDetail}`,
    `${dim}Ctrl+C stops the bridge client.${reset}`
  ]

  const width = Math.max(...lines.map((line) => stripAnsi(line).length))
  const border = `+${'-'.repeat(width + 2)}+`

  process.stdout.write('\u001b[2J\u001b[H')
  process.stdout.write(`${border}\n`)
  lines.forEach((line) => {
    const padding = ' '.repeat(width - stripAnsi(line).length)
    process.stdout.write(`| ${line}${padding} |\n`)
  })
  process.stdout.write(`${border}\n`)
}

function resolvePanelColor(status) {
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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function log(message) {
  process.stdout.write(`[steamdeck-bridge] ${message}\n`)
}

function printHelp() {
  process.stdout.write('Steam Deck bridge client for ACNH Live Editor MVP\n')
  process.stdout.write('Required env: BRIDGE_TARGET_HOST\n')
  process.stdout.write('Optional env: BRIDGE_TARGET_PORT, BRIDGE_DEVICE_NAME, BRIDGE_HEARTBEAT_MS, BRIDGE_RECONNECT_DELAY_MS, BRIDGE_COMMAND_TIMEOUT_MS, RYUJINX_PROCESS_MATCH, RYUJINX_STRICT_PROCESS_CHECK, RYUJINX_STATUS_CMD, RYUJINX_READ_INVENTORY_CMD, RYUJINX_WRITE_INVENTORY_CMD, RYUJINX_READ_GAME_DATA_CMD, RYUJINX_WRITE_GAME_DATA_CMD\n')
}
