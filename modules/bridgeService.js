const net = require('net')

const BRIDGE_HOST = process.env.BRIDGE_HOST || '0.0.0.0'
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 32840)
const HEARTBEAT_STALE_MS = 15000
const BRIDGE_REQUEST_TIMEOUT_MS = Number(process.env.BRIDGE_REQUEST_TIMEOUT_MS || 5000)
const SUPPORTED_COMMANDS = Object.freeze(['read_status', 'read_inventory', 'write_inventory_slot'])

const pendingRequests = new Map()
let requestCounter = 0

const state = {
  started: false,
  listening: false,
  host: BRIDGE_HOST,
  port: BRIDGE_PORT,
  connected: false,
  emulator: 'ryujinx',
  game: 'acnh',
  version: null,
  protocolVersion: null,
  capabilities: [],
  bridge: 'offline',
  message: 'Bridge listener offline.',
  lastError: null,
  lastHandshakeAt: null,
  lastHeartbeatAt: null,
  lastCommandAt: null,
  lastCommand: null,
  lastResponseAt: null,
  lastResponse: null,
  remoteAddress: null,
  remotePort: null,
  deviceName: null,
  remoteStatus: null,
  server: null,
  client: null,
  heartbeatTimer: null
}

function start() {
  if (state.started) {
    return Promise.resolve(getStatus())
  }

  state.started = true

  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      attachClient(socket)
    })

    state.server = server

    server.on('error', (error) => {
      state.listening = false
      state.connected = false
      state.bridge = 'error'
      state.message = `Bridge listener error: ${error.message}`
      state.lastError = error.message

      if (!state.listening) {
        state.started = false
        state.server = null
        reject(error)
      }
    })

    server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      state.listening = true
      state.bridge = 'listening'
      state.message = `Listening for bridge on ${BRIDGE_HOST}:${BRIDGE_PORT}`
      resolve(getStatus())
    })
  })
}

function attachClient(socket) {
  if (state.client && state.client !== socket) {
    state.client.destroy()
  }

  state.client = socket
  state.remoteAddress = normalizeRemoteAddress(socket.remoteAddress)
  state.remotePort = socket.remotePort || null
  state.connected = false
  state.bridge = 'handshake'
  state.message = `Bridge client connected from ${formatRemoteLabel()}`
  state.lastError = null

  socket.setEncoding('utf8')
  socket.setNoDelay(true)

  let buffer = ''

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
        handleBridgeMessage(JSON.parse(line))
      } catch (error) {
        state.lastError = `Invalid bridge payload: ${error.message}`
      }
    }
  })

  socket.on('error', (error) => {
    state.lastError = error.message
  })

  socket.on('close', () => {
    if (state.client === socket) {
      rejectPendingRequests(new Error('Bridge connection closed'))
      state.client = null
      state.connected = false
      state.bridge = state.listening ? 'listening' : 'offline'
      state.message = state.listening
        ? `Listening for bridge on ${BRIDGE_HOST}:${BRIDGE_PORT}`
        : 'Bridge listener offline.'
      clearHeartbeatTimer()
      state.remoteAddress = null
      state.remotePort = null
      state.deviceName = null
      state.protocolVersion = null
      state.capabilities = []
      state.remoteStatus = null
    }
  })
}

function handleBridgeMessage(message) {
  const type = String(message && message.type || '').trim().toLowerCase()

  if (type === 'hello') {
    state.connected = true
    state.bridge = 'connected'
    state.emulator = String(message.emulator || 'ryujinx')
    state.game = String(message.game || 'acnh')
    state.version = message.version ? String(message.version) : null
    state.protocolVersion = message.protocolVersion ? String(message.protocolVersion) : null
    state.capabilities = normalizeCapabilities(message.capabilities || message.supportedCommands)
    state.deviceName = message.deviceName ? String(message.deviceName) : null
    state.lastHandshakeAt = new Date().toISOString()
    state.lastHeartbeatAt = state.lastHandshakeAt
    state.message = `Bridge connected from ${formatRemoteLabel()}`
    scheduleHeartbeatWatch()
    sendMessage({
      type: 'hello_ack',
      protocolVersion: '1',
      supportedCommands: SUPPORTED_COMMANDS
    })
    queueReadStatusProbe()
    return
  }

  if (type === 'heartbeat' || type === 'ping') {
    state.lastHeartbeatAt = new Date().toISOString()
    if (state.client) {
      state.connected = true
      state.bridge = 'connected'
      state.message = `Bridge connected from ${formatRemoteLabel()}`
      scheduleHeartbeatWatch()
    }
    return
  }

  if (type === 'goodbye') {
    if (state.client) {
      state.client.end()
    }
    return
  }

  if (type === 'response') {
    handleBridgeResponse(message)
  }
}

function scheduleHeartbeatWatch() {
  clearHeartbeatTimer()

  state.heartbeatTimer = setTimeout(() => {
    if (!state.client) {
      return
    }

    const lastHeartbeatMs = state.lastHeartbeatAt ? Date.parse(state.lastHeartbeatAt) : 0
    if (!lastHeartbeatMs || (Date.now() - lastHeartbeatMs) > HEARTBEAT_STALE_MS) {
      state.connected = false
      state.bridge = 'stale'
      state.message = `Bridge heartbeat stale from ${formatRemoteLabel()}`
    }
  }, HEARTBEAT_STALE_MS + 250)
}

function clearHeartbeatTimer() {
  if (state.heartbeatTimer) {
    clearTimeout(state.heartbeatTimer)
    state.heartbeatTimer = null
  }
}

function getStatus() {
  return {
    connected: state.connected,
    emulator: state.emulator,
    game: state.game,
    version: state.version,
    protocolVersion: state.protocolVersion,
    capabilities: state.capabilities.slice(),
    bridge: state.bridge,
    ip: state.remoteAddress,
    bridgeHost: state.host,
    bridgePort: state.port,
    listening: state.listening,
    message: state.message,
    deviceName: state.deviceName,
    lastHandshakeAt: state.lastHandshakeAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastCommandAt: state.lastCommandAt,
    lastCommand: state.lastCommand,
    lastResponseAt: state.lastResponseAt,
    lastResponse: state.lastResponse,
    lastError: state.lastError,
    pendingRequests: pendingRequests.size,
    remoteStatus: state.remoteStatus
  }
}

function sendCommand(command, payload = {}, options = {}) {
  const normalizedCommand = String(command || '').trim()
  const timeoutMs = Number(options.timeoutMs || BRIDGE_REQUEST_TIMEOUT_MS)

  if (!normalizedCommand) {
    return Promise.reject(new Error('Bridge command is required'))
  }

  if (!state.client || !state.connected) {
    return Promise.reject(new Error('No bridge client connected'))
  }

  const requestId = `bridge-${Date.now()}-${++requestCounter}`
  const requestMessage = {
    type: 'request',
    requestId,
    command: normalizedCommand,
    payload
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      state.lastError = `Bridge command timed out: ${normalizedCommand}`
      reject(new Error(`Bridge command timed out: ${normalizedCommand}`))
    }, timeoutMs)

    pendingRequests.set(requestId, {
      command: normalizedCommand,
      resolve,
      reject,
      timer
    })

    state.lastCommandAt = new Date().toISOString()
    state.lastCommand = {
      requestId,
      command: normalizedCommand
    }

    if (!sendMessage(requestMessage)) {
      clearTimeout(timer)
      pendingRequests.delete(requestId)
      reject(new Error('Bridge socket is not ready'))
    }
  })
}

function readStatus() {
  return sendCommand('read_status')
}

function readInventory() {
  return sendCommand('read_inventory')
}

function writeInventorySlot(payload) {
  return sendCommand('write_inventory_slot', payload, {
    timeoutMs: 8000
  })
}

function handleBridgeResponse(message) {
  const requestId = String(message && message.requestId || '').trim()
  if (!requestId || !pendingRequests.has(requestId)) {
    return
  }

  const pending = pendingRequests.get(requestId)
  pendingRequests.delete(requestId)
  clearTimeout(pending.timer)

  const ok = Boolean(message.ok)
  const command = String(message.command || pending.command || '').trim()
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {}
  const errorMessage = message.error ? String(message.error) : null

  state.lastResponseAt = new Date().toISOString()
  state.lastResponse = {
    requestId,
    command,
    ok
  }
  state.lastError = ok ? null : (errorMessage || `Bridge command failed: ${command}`)

  if (command === 'read_status' && ok) {
    state.remoteStatus = payload
    if (payload.version) {
      state.version = String(payload.version)
    }
    if (payload.deviceName) {
      state.deviceName = String(payload.deviceName)
    }
    if (payload.emulator) {
      state.emulator = String(payload.emulator)
    }
    if (payload.game) {
      state.game = String(payload.game)
    }
    if (payload.protocolVersion) {
      state.protocolVersion = String(payload.protocolVersion)
    }
    if (payload.capabilities || payload.supportedCommands) {
      state.capabilities = normalizeCapabilities(payload.capabilities || payload.supportedCommands)
    }
  }

  if (ok) {
    pending.resolve({
      requestId,
      command,
      ok: true,
      payload
    })
    return
  }

  pending.reject(new Error(errorMessage || `Bridge command failed: ${command}`))
}

function rejectPendingRequests(error) {
  pendingRequests.forEach((pending, requestId) => {
    clearTimeout(pending.timer)
    pending.reject(error)
    pendingRequests.delete(requestId)
  })
}

function sendMessage(payload) {
  if (!state.client || state.client.destroyed) {
    return false
  }

  state.client.write(`${JSON.stringify(payload)}\n`)
  return true
}

function queueReadStatusProbe() {
  setTimeout(() => {
    if (!state.client || !state.connected || pendingRequests.size > 0) {
      return
    }

    readStatus().catch((error) => {
      state.lastError = error.message
    })
  }, 50)
}

function normalizeCapabilities(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  )
}

function normalizeRemoteAddress(value) {
  if (!value) {
    return null
  }

  return String(value).replace(/^::ffff:/, '')
}

function formatRemoteLabel() {
  const address = state.remoteAddress || 'unknown'
  return state.deviceName ? `${state.deviceName} (${address})` : address
}

module.exports = {
  BRIDGE_HOST,
  BRIDGE_PORT,
  getStatus,
  readInventory,
  readStatus,
  sendCommand,
  start,
  writeInventorySlot
}
