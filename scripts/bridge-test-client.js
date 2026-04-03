const net = require('net')

const host = process.env.BRIDGE_TARGET_HOST || '127.0.0.1'
const port = Number(process.env.BRIDGE_TARGET_PORT || 32840)
const deviceName = process.env.BRIDGE_DEVICE_NAME || 'bridge-test-client'
const heartbeatMs = 5000
const connectedAt = new Date().toISOString()
const supportedCommands = parseSupportedCommands(process.env.BRIDGE_SUPPORTED_COMMANDS)
const inventoryState = createInventoryState(process.env.BRIDGE_TEST_INVENTORY_JSON)

function parseSupportedCommands(value) {
  const normalized = String(value || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)

  if (normalized.length) {
    return normalized
  }

  return ['read_status', 'read_inventory', 'write_inventory_slot']
}

function createInventoryState(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeInventorySlot).filter(Boolean)
    }
  } catch (error) {}

  return [
    normalizeInventorySlot({ slot: 1, itemId: 'golden_axe', count: 1, uses: 27, flag0: 0, flag1: 0 }),
    normalizeInventorySlot({ slot: 2, itemId: 'iron_nugget', count: 30, uses: 0, flag0: 0, flag1: 0 })
  ].filter(Boolean)
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

const socket = net.createConnection({ host, port }, () => {
  console.log(`Connected to bridge ${host}:${port}`)
  send({
    type: 'hello',
    protocolVersion: '1',
    emulator: 'ryujinx',
    game: 'acnh',
    version: 'test-client',
    deviceName,
    capabilities: supportedCommands
  })

  setInterval(() => {
    send({
      type: 'heartbeat',
      deviceName
    })
  }, heartbeatMs)
})

socket.setEncoding('utf8')

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
      handleMessage(JSON.parse(line))
    } catch (error) {
      console.error(`Invalid bridge message: ${error.message}`)
    }
  }
})

socket.on('error', (error) => {
  console.error(`Bridge client error: ${error.message}`)
  process.exitCode = 1
})

socket.on('close', () => {
  console.log('Bridge connection closed')
})

function send(payload) {
  socket.write(`${JSON.stringify(payload)}\n`)
}

function handleMessage(message) {
  const type = String(message && message.type || '').trim().toLowerCase()

  if (type === 'hello_ack') {
    console.log(`Bridge ack received. Commands: ${(message.supportedCommands || []).join(', ') || 'none'}`)
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
    send({
      type: 'response',
      requestId,
      command,
      ok: true,
      payload: {
        protocolVersion: '1',
        emulator: 'ryujinx',
        game: 'acnh',
        version: 'test-client',
        deviceName,
        connectedAt,
        platform: process.platform,
        capabilities: supportedCommands
      }
    })
    return
  }

  if (command === 'read_inventory') {
    send({
      type: 'response',
      requestId,
      command,
      ok: true,
      payload: {
        slots: inventoryState.slice()
      }
    })
    return
  }

  if (command === 'write_inventory_slot') {
    const slotPayload = normalizeInventorySlot({
      slot: message && message.payload && message.payload.slot,
      itemId: message && message.payload && message.payload.itemId,
      count: message && message.payload && message.payload.count,
      uses: message && message.payload && message.payload.uses,
      flag0: message && message.payload && message.payload.flag0,
      flag1: message && message.payload && message.payload.flag1
    })

    if (!slotPayload) {
      send({
        type: 'response',
        requestId,
        command,
        ok: false,
        error: 'slot must be a positive integer'
      })
      return
    }

    const existingIndex = inventoryState.findIndex((entry) => entry.slot === slotPayload.slot)
    if (existingIndex >= 0) {
      inventoryState[existingIndex] = slotPayload
    } else {
      inventoryState.push(slotPayload)
    }

    send({
      type: 'response',
      requestId,
      command,
      ok: true,
      payload: {
        slot: slotPayload
      }
    })
    return
  }

  send({
    type: 'response',
    requestId,
    command,
    ok: false,
    error: `${command} not implemented in bridge test client`
  })
}

process.on('SIGINT', () => {
  send({ type: 'goodbye', deviceName })
  socket.end()
})
