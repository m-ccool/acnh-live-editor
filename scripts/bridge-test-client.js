const net = require('net')

const host = process.env.BRIDGE_TARGET_HOST || '127.0.0.1'
const port = Number(process.env.BRIDGE_TARGET_PORT || 32840)
const deviceName = process.env.BRIDGE_DEVICE_NAME || 'bridge-test-client'
const heartbeatMs = 5000
const connectedAt = new Date().toISOString()
const supportedCommands = ['read_status']

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
