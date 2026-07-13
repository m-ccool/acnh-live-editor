// Server-side cheats engine.
//
// Holds the enabled cheat set, persists it to disk, and runs a periodic loop
// that re-applies every active cheat via the bridge so the game keeps the
// mutated values pinned (the game overwrites memory on its own tick).
//
// Public API:
//   cheatsService.list()                -> { enabled: [ids] }
//   cheatsService.enable(id)            -> Promise<{ok, ...}>
//   cheatsService.disable(id)           -> Promise<{ok, ...}>
//   cheatsService.startLoop(bridge)     -> void
//   cheatsService.stopLoop()            -> void

const fs = require('fs')
const path = require('path')

const CHEAT_IDS = Object.freeze(['halfSpeed', 'doubleSpeed', 'ghostWalk', 'maxWallet'])
const STATE_FILE = path.join(__dirname, '..', 'data', 'cheats-state.json')
const LOOP_INTERVAL_MS = 2000

let bridgeRef = null
let loopTimer = null
let enabled = new Set()
// Cheats auto-disabled after a bridge error so we don't spin failing writes.
const disabledDueToError = new Set()

function loadPersisted() {
  try {
    if (!fs.existsSync(STATE_FILE)) return
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.enabled)) {
      enabled = new Set(parsed.enabled.filter((id) => CHEAT_IDS.includes(id)))
    }
  } catch (err) {
    console.error('[cheats] failed to load persisted state:', err.message)
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: Array.from(enabled) }, null, 2))
  } catch (err) {
    console.error('[cheats] failed to persist state:', err.message)
  }
}

function list() {
  return { enabled: Array.from(enabled), supported: CHEAT_IDS.slice() }
}

async function applyToBridge(cheatId, on) {
  if (!bridgeRef || typeof bridgeRef.applyCheat !== 'function') {
    return { ok: false, error: 'bridge unavailable' }
  }
  try {
    const res = await bridgeRef.applyCheat(cheatId, on)
    // Success — clear any error latch for this cheat.
    disabledDueToError.delete(cheatId)
    return res || { ok: true }
  } catch (err) {
    // Latch — the loop will skip this cheat until the user toggles again.
    disabledDueToError.add(cheatId)
    console.error(`[cheats] apply_cheat ${cheatId} failed:`, err.message)
    return { ok: false, error: err.message }
  }
}

async function enable(cheatId) {
  if (!CHEAT_IDS.includes(cheatId)) {
    return { ok: false, error: `Unknown cheat: ${cheatId}` }
  }
  // Speed cheats are mutually exclusive.
  if (cheatId === 'halfSpeed' && enabled.has('doubleSpeed')) enabled.delete('doubleSpeed')
  if (cheatId === 'doubleSpeed' && enabled.has('halfSpeed')) enabled.delete('halfSpeed')
  enabled.add(cheatId)
  disabledDueToError.delete(cheatId)
  persist()
  const res = await applyToBridge(cheatId, true)
  return { ok: true, applied: res.ok !== false, list: list() }
}

async function disable(cheatId) {
  if (!CHEAT_IDS.includes(cheatId)) {
    return { ok: false, error: `Unknown cheat: ${cheatId}` }
  }
  enabled.delete(cheatId)
  disabledDueToError.delete(cheatId)
  persist()
  const res = await applyToBridge(cheatId, false)
  return { ok: true, applied: res.ok !== false, list: list() }
}

async function tick() {
  if (!bridgeRef) return
  // Only touch bridge when connected — avoids spamming errors when offline.
  const status = bridgeRef.getStatus ? bridgeRef.getStatus() : null
  if (!status || !status.connected) return
  for (const cheatId of enabled) {
    if (disabledDueToError.has(cheatId)) continue
    // Fire-and-forget per cheat so a slow bridge doesn't block subsequent ones.
    applyToBridge(cheatId, true).catch(() => {})
  }
}

function startLoop(bridge) {
  bridgeRef = bridge
  if (loopTimer) clearInterval(loopTimer)
  loopTimer = setInterval(tick, LOOP_INTERVAL_MS)
  // Fire once immediately after startup to re-assert persisted cheats.
  setTimeout(() => { tick().catch(() => {}) }, 2500)
}

function stopLoop() {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}

loadPersisted()

module.exports = {
  CHEAT_IDS,
  LOOP_INTERVAL_MS,
  list,
  enable,
  disable,
  startLoop,
  stopLoop
}
