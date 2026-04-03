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
const inventoryPath = process.env.BRIDGE_INVENTORY_FILE
  ? path.resolve(process.env.BRIDGE_INVENTORY_FILE)
  : null
const persistInventory = String(process.env.BRIDGE_PERSIST_INVENTORY || '0') === '1'
const customStatusCommand = process.env.RYUJINX_STATUS_CMD || ''
const customReadInventoryCommand = process.env.RYUJINX_READ_INVENTORY_CMD || ''
const customWriteInventoryCommand = process.env.RYUJINX_WRITE_INVENTORY_CMD || ''
const commandTimeoutMs = Number(process.env.BRIDGE_COMMAND_TIMEOUT_MS || 4000)

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

const inventoryState = loadInventoryState(inventoryPath)
const startedAt = new Date().toISOString()

const socket = net.createConnection({ host, port }, () => {
  log(`Connected to bridge listener ${host}:${port}`)
  send(buildHello())
  startHeartbeat()
})

socket.setEncoding('utf8')

let buffer = ''
let heartbeatTimer = null

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
  log(`Socket error: ${error.message}`)
  process.exitCode = 1
})

socket.on('close', () => {
  clearIntervalIfSet()
  log('Socket closed')
})

process.on('SIGINT', () => {
  send({ type: 'goodbye', deviceName })
  socket.end()
})

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
    capabilities: ['read_status', 'read_inventory', 'write_inventory_slot']
  }
}

function send(payload) {
  if (!socket.destroyed) {
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
        capabilities: ['read_status', 'read_inventory', 'write_inventory_slot'],
        inventoryAdapter: resolveInventoryAdapter(),
        ryujinx: probe
      }
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

      const matches = lines
        .map(parseProcessLine)
        .filter((entry) => entry && processLooksLikeRyujinx(entry))
        .slice(0, 3)

      resolve({
        running: matches.length > 0,
        source: 'ps',
        matchCount: matches.length,
        matches
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

function processLooksLikeRyujinx(entry) {
  const haystack = `${entry.command} ${entry.args}`.toLowerCase()
  return haystack.includes(processMatch)
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

function printHelp() {
  process.stdout.write('Steam Deck bridge client for ACNH Live Editor\n')
  process.stdout.write('Required: set BRIDGE_TARGET_HOST to your PC LAN IP.\n')
  process.stdout.write('Optional env: BRIDGE_TARGET_PORT, BRIDGE_DEVICE_NAME, BRIDGE_HEARTBEAT_MS, BRIDGE_COMMAND_TIMEOUT_MS, RYUJINX_PROCESS_MATCH, RYUJINX_STATUS_CMD, RYUJINX_READ_INVENTORY_CMD, RYUJINX_WRITE_INVENTORY_CMD, BRIDGE_INVENTORY_FILE, BRIDGE_PERSIST_INVENTORY\n')
}
