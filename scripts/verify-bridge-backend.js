#!/usr/bin/env node

const assert = require('assert/strict')
const net = require('net')
const path = require('path')
const { spawn } = require('child_process')

const repoDir = path.join(__dirname, '..')
const appPort = Number(process.env.VERIFY_APP_PORT || 3101)
const bridgePort = Number(process.env.VERIFY_BRIDGE_PORT || 32841)
const bridgeHost = '127.0.0.1'
const baseUrl = `http://127.0.0.1:${appPort}`

const playerState = {
  name: 'Backend Verify',
  town: 'Isolated Port',
  wallet: 321000,
  bank: 654000,
  miles: 11111,
  avatar: '/assets/items/Bob_NH.png'
}

const inventoryState = [
  { slot: 1, itemId: 'Golden_Axe', count: 1, uses: 27, flag0: 0, flag1: 0 },
  { slot: 2, itemId: 'Iron_Nugget', count: 30, uses: 0, flag0: 0, flag1: 0 }
]

let serverProcess = null
let bridgeSocket = null
let heartbeatTimer = null
let socketBuffer = ''

main().catch(async (error) => {
  process.stderr.write(`backend bridge verification failed: ${error.message}\n`)
  await cleanup()
  process.exit(1)
})

async function main() {
  serverProcess = startServerProcess()
  await waitForHealth()
  await connectFixtureBridge()
  await waitForBridgeConnection()

  const status = await readJson('/api/status')
  assert.equal(status.connected, true, 'Expected isolated bridge connection')
  assert.equal(status.listenerIp, '127.0.0.1', 'Expected isolated listener IP override')
  assert.equal(status.ip, '127.0.0.1', 'Expected isolated display IP')

  const remoteStatus = await readJson('/api/bridge/read-status')
  assert.equal(remoteStatus.ok, true, 'Expected read-status response')
  assert.equal(remoteStatus.payload.deviceName, 'backend-verify-client', 'Expected isolated backend fixture')
  assert.equal(Array.isArray(remoteStatus.payload.capabilities), false, 'Expected no explicit capabilities in fixture read-status')

  const inventory = await readJson('/api/bridge/read-inventory')
  assert.equal(inventory.ok, true, 'Expected read-inventory response')
  assert.equal(inventory.payload.source, 'backend-test-only', 'Expected isolated backend test source')
  assert.equal(Array.isArray(inventory.payload.slots), true, 'Expected slot array')

  const gameData = await readJson('/api/bridge/read-game-data')
  assert.equal(gameData.ok, true, 'Expected read-game-data response')
  assert.equal(gameData.payload.player.name, playerState.name, 'Expected isolated player payload')

  const writeResult = await writeJson('/api/bridge/write-inventory-slot', {
    slot: 2,
    itemId: 'Apple',
    count: 12,
    uses: 0,
    flag0: 0,
    flag1: 0
  })

  assert.equal(writeResult.ok, true, 'Expected write-inventory-slot response')

  const inventoryAfterWrite = await readJson('/api/bridge/read-inventory')
  const updatedSlot = inventoryAfterWrite.payload.slots.find((entry) => Number(entry.slot) === 2)
  assert(updatedSlot, 'Expected slot 2 after write')
  assert.equal(updatedSlot.itemId, 'Apple', 'Expected slot 2 writeback')
  assert.equal(updatedSlot.count, 12, 'Expected slot 2 count writeback')

  const playerWriteResult = await writeJson('/api/bridge/write-player', {
    player: {
      wallet: 777000,
      bank: 888000,
      miles: 999000
    }
  })

  assert.equal(playerWriteResult.ok, true, 'Expected write-player response')

  const gameDataAfterPlayerWrite = await readJson('/api/bridge/read-game-data')
  assert.equal(gameDataAfterPlayerWrite.payload.player.wallet, 777000, 'Expected wallet writeback')
  assert.equal(gameDataAfterPlayerWrite.payload.player.bank, 888000, 'Expected bank writeback')
  assert.equal(gameDataAfterPlayerWrite.payload.player.miles, 999000, 'Expected miles writeback')

  process.stdout.write('backend bridge verification passed\n')
  await cleanup()
}

function startServerProcess() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoDir,
    env: {
      ...process.env,
      PORT: String(appPort),
      BRIDGE_PORT: String(bridgePort),
      BRIDGE_HOST: bridgeHost,
      BRIDGE_DISPLAY_IP: bridgeHost
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`backend server exited with code ${code}\n`)
    }
  })

  return child
}

async function waitForHealth() {
  const deadline = Date.now() + 15000

  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`Server exited before health check with code ${serverProcess.exitCode}`)
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' })
      if (response.ok) {
        return
      }
    } catch (error) {}

    await delay(250)
  }

  throw new Error('Timed out waiting for backend health endpoint')
}

async function connectFixtureBridge() {
  await new Promise((resolve, reject) => {
    bridgeSocket = net.createConnection({ host: bridgeHost, port: bridgePort }, resolve)
    bridgeSocket.setEncoding('utf8')

    bridgeSocket.on('data', handleSocketData)
    bridgeSocket.on('error', reject)
    bridgeSocket.on('close', () => {
      stopHeartbeat()
    })
  })

  sendSocketMessage({
    type: 'hello',
    protocolVersion: '1',
    emulator: 'ryujinx',
    game: 'acnh',
    version: 'backend-verify-fixture',
    deviceName: 'backend-verify-client'
  })

  heartbeatTimer = setInterval(() => {
    sendSocketMessage({
      type: 'heartbeat',
      deviceName: 'backend-verify-client',
      timestamp: new Date().toISOString()
    })
  }, 3000)
}

async function waitForBridgeConnection() {
  const deadline = Date.now() + 8000

  while (Date.now() < deadline) {
    const status = await readJson('/api/status')
    if (status.connected === true) {
      return
    }
    await delay(150)
  }

  throw new Error('Timed out waiting for isolated bridge connection')
}

function handleSocketData(chunk) {
  socketBuffer += chunk

  while (socketBuffer.includes('\n')) {
    const newlineIndex = socketBuffer.indexOf('\n')
    const line = socketBuffer.slice(0, newlineIndex).trim()
    socketBuffer = socketBuffer.slice(newlineIndex + 1)

    if (!line) {
      continue
    }

    const message = JSON.parse(line)
    if (String(message.type || '').trim().toLowerCase() === 'request') {
      handleBridgeRequest(message)
    }
  }
}

function handleBridgeRequest(message) {
  const requestId = String(message.requestId || '').trim()
  const command = String(message.command || '').trim()

  if (!requestId || !command) {
    return
  }

  if (command === 'read_status') {
    sendBridgeResponse(requestId, command, {
      protocolVersion: '1',
      emulator: 'ryujinx',
      game: 'acnh',
      version: 'backend-verify-fixture',
      deviceName: 'backend-verify-client',
      inventoryAdapter: 'backend-test-only',
      gameDataAdapter: 'backend-test-only',
      ryujinx: {
        running: true,
        source: 'backend-test-only'
      }
    })
    return
  }

  if (command === 'read_inventory') {
    sendBridgeResponse(requestId, command, {
      slots: inventoryState.slice(),
      source: 'backend-test-only',
      backend: 'isolated-verification'
    })
    return
  }

  if (command === 'read_game_data') {
    sendBridgeResponse(requestId, command, {
      player: { ...playerState },
      slots: inventoryState.slice(),
      source: 'backend-test-only',
      backend: 'isolated-verification'
    })
    return
  }

  if (command === 'write_inventory_slot') {
    const slotPayload = normalizeSlot(message.payload)
    if (!slotPayload) {
      sendBridgeError(requestId, command, 'slot must be an integer from 1 to 40')
      return
    }

    const existingIndex = inventoryState.findIndex((entry) => entry.slot === slotPayload.slot)
    if (existingIndex >= 0) {
      inventoryState[existingIndex] = slotPayload
    } else {
      inventoryState.push(slotPayload)
      inventoryState.sort((left, right) => left.slot - right.slot)
    }

    sendBridgeResponse(requestId, command, {
      slot: slotPayload,
      slots: inventoryState.slice(),
      source: 'backend-test-only',
      backend: 'isolated-verification'
    })
    return
  }

  if (command === 'write_game_data') {
    const playerPayload = normalizePlayer(message.payload && message.payload.player)
    if (!playerPayload) {
      sendBridgeError(requestId, command, 'player payload is required')
      return
    }

    playerState.wallet = playerPayload.wallet
    playerState.bank = playerPayload.bank
    playerState.miles = playerPayload.miles

    sendBridgeResponse(requestId, command, {
      player: { ...playerState },
      slots: inventoryState.slice(),
      source: 'backend-test-only',
      backend: 'isolated-verification'
    })
    return
  }

  sendBridgeError(requestId, command, `${command} is not implemented`)
}

function normalizePlayer(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  return {
    wallet: Number(value.wallet || 0),
    bank: Number(value.bank || 0),
    miles: Number(value.miles || 0)
  }
}

function sendBridgeResponse(requestId, command, payload) {
  sendSocketMessage({
    type: 'response',
    requestId,
    command,
    ok: true,
    payload
  })
}

function sendBridgeError(requestId, command, error) {
  sendSocketMessage({
    type: 'response',
    requestId,
    command,
    ok: false,
    error
  })
}

function sendSocketMessage(payload) {
  if (!bridgeSocket || bridgeSocket.destroyed) {
    return
  }

  bridgeSocket.write(`${JSON.stringify(payload)}\n`)
}

function normalizeSlot(entry) {
  const slot = Number(entry && entry.slot)
  if (!Number.isInteger(slot) || slot < 1 || slot > 40) {
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

async function readJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: 'no-store' })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}`)
  }
  return body
}

async function writeJson(pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}`)
  }
  return body
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

async function cleanup() {
  stopHeartbeat()

  if (bridgeSocket && !bridgeSocket.destroyed) {
    sendSocketMessage({ type: 'goodbye', deviceName: 'backend-verify-client' })
    bridgeSocket.end()
  }

  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM')
    await delay(250)
    if (serverProcess.exitCode === null) {
      serverProcess.kill('SIGKILL')
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
