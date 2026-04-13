const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const ITEMS_PATH = path.join(process.cwd(), 'data', 'items.json')
const ITEM_NAMES_PATH = path.join(process.cwd(), 'data', 'item-names-en.txt')
const ITEM_NONE = 0xFFFE
const ITEM_SIZE = 8
const ENCRYPTION_CONSTANT = 0x80E32B11
const SHIFT_BASE = 3
const BLOCK_SIZE = 16
const DEFAULT_LAYOUTS = [
  {
    name: '20',
    personalId: 0x110 + 0xAFA8,
    wallet: 0x36A50 + 0x10 + (ITEM_SIZE * 20) + 0x18 + (ITEM_SIZE * 20) + 0x18,
    nowPoint: 0x110 + 0xBFE0 + 0x5498,
    bank: 0x36A50 + 0x24AFC,
    pockets1: 0x36A50 + 0x10,
    pockets2: (0x36A50 + 0x10) + (ITEM_SIZE * 20) + 0x18
  },
  {
    name: '30',
    personalId: 0x110 + 0xC138,
    wallet: 0x37BE0 + 0x10 + (ITEM_SIZE * 20) + 0x18 + (ITEM_SIZE * 20) + 0x18,
    nowPoint: 0x110 + 0xD170 + 0x5498,
    bank: 0x37BE0 + 0x2D69C,
    pockets1: 0x37BE0 + 0x10,
    pockets2: (0x37BE0 + 0x10) + (ITEM_SIZE * 20) + 0x18
  }
]

let itemIndexCache = null

function readGameData() {
  const save = loadPersonalSave()
  return {
    player: {
      name: save.playerName,
      town: save.townName,
      wallet: save.wallet.value,
      bank: save.bank.value,
      miles: save.miles.value
    },
    slots: buildSlots(save),
    source: 'ryujinx-save',
    lastGameSaveAt: save.modifiedAt,
    lastGameDataFilePath: save.dataPath,
    saveRoot: save.saveRoot,
    villagerDirectory: save.villagerDirectory,
    layout: save.layout.name
  }
}

function readInventory() {
  const save = loadPersonalSave()
  return {
    slots: buildSlots(save),
    source: 'ryujinx-save',
    lastGameSaveAt: save.modifiedAt,
    lastGameDataFilePath: save.dataPath,
    layout: save.layout.name
  }
}

function writeInventorySlot(request) {
  const slotPayload = normalizeSlotPayload(request && request.payload ? request.payload : request)
  if (!slotPayload) {
    throw new Error('payload.slot must be a positive integer')
  }

  const save = loadPersonalSave({ includeHashRegions: true })
  const slotBuffer = resolveSlotBuffer(save, slotPayload.slot)

  if (!slotPayload.itemId) {
    writeEmptyItem(slotBuffer)
  } else {
    const itemId = resolveCatalogItemId(slotPayload.itemId)
    if (!Number.isInteger(itemId) || itemId < 0 || itemId > 0xFFFF) {
      throw new Error(`Unknown ACNH item: ${slotPayload.itemId}`)
    }

    writeItem(slotBuffer, {
      itemId,
      count: slotPayload.count,
      uses: slotPayload.uses,
      flag0: slotPayload.flag0,
      flag1: slotPayload.flag1
    })
  }

  updateHashes(save.data, save.hashRegions)
  const encrypted = encryptSaveData(save.header, save.data)
  fs.writeFileSync(save.dataPath, encrypted)

  const refreshed = loadPersonalSave()
  const writtenSlot = buildSlots(refreshed).find((entry) => entry.slot === slotPayload.slot) || emptySlot(slotPayload.slot)

  return {
    slot: writtenSlot,
    slots: buildSlots(refreshed),
    source: 'ryujinx-save',
    lastGameSaveAt: refreshed.modifiedAt,
    lastGameDataFilePath: refreshed.dataPath,
    layout: refreshed.layout.name
  }
}

function loadPersonalSave(options = {}) {
  const candidate = resolveSaveCandidate()
  const header = fs.readFileSync(candidate.headerPath)
  const encryptedData = fs.readFileSync(candidate.dataPath)
  const data = decryptSaveData(header, encryptedData)
  const layout = selectLayout(data)
  const hashRegions = options.includeHashRegions ? scanHashes(data) : null

  return {
    ...candidate,
    header,
    data,
    layout,
    hashRegions,
    townName: decodeAcnhString(data, layout.personalId + 0x04, 10),
    playerName: decodeAcnhString(data, layout.personalId + 0x20, 10),
    wallet: readEncryptedInt(data, layout.wallet),
    bank: readEncryptedInt(data, layout.bank),
    miles: readEncryptedInt(data, layout.nowPoint)
  }
}

function resolveSaveCandidate() {
  const explicitVillagerDir = process.env.RYUJINX_PERSONAL_SAVE_DIR
  if (explicitVillagerDir) {
    return buildCandidate(path.resolve(explicitVillagerDir))
  }

  const roots = getSaveRoots()
  let latest = null

  for (const root of roots) {
    const candidate = findLatestVillagerSave(root)
    if (!candidate) {
      continue
    }

    if (!latest || candidate.modifiedMs > latest.modifiedMs) {
      latest = candidate
    }
  }

  if (!latest) {
    throw new Error('Unable to locate a Ryujinx personal.dat save pair. Set RYUJINX_PERSONAL_SAVE_DIR if needed.')
  }

  return latest
}

function getSaveRoots() {
  const roots = []
  const envRoot = process.env.RYUJINX_SAVE_ROOT
  if (envRoot) {
    roots.push(path.resolve(envRoot))
  }

  const home = os.homedir()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const configHome = xdgConfigHome ? path.resolve(xdgConfigHome) : path.join(home, '.config')

  roots.push(path.join(configHome, 'Ryujinx', 'bis', 'user', 'save'))
  roots.push(path.join(home, '.var', 'app', 'org.ryujinx.Ryujinx', 'config', 'Ryujinx', 'bis', 'user', 'save'))

  return Array.from(new Set(roots)).filter((entry) => fs.existsSync(entry))
}

function findLatestVillagerSave(rootPath) {
  const queue = [rootPath]
  let latest = null

  while (queue.length > 0) {
    const current = queue.shift()
    let entries = []

    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (error) {
      continue
    }

    const hasPersonal = entries.some((entry) => entry.isFile() && entry.name === 'personal.dat')
    const hasPersonalHeader = entries.some((entry) => entry.isFile() && entry.name === 'personalHeader.dat')
    if (hasPersonal && hasPersonalHeader) {
      const candidate = buildCandidate(current)
      if (!latest || candidate.modifiedMs > latest.modifiedMs) {
        latest = candidate
      }
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name))
      }
    }
  }

  return latest
}

function buildCandidate(villagerDirectory) {
  const dataPath = path.join(villagerDirectory, 'personal.dat')
  const headerPath = path.join(villagerDirectory, 'personalHeader.dat')
  if (!fs.existsSync(dataPath) || !fs.existsSync(headerPath)) {
    throw new Error(`Missing personal save pair in ${villagerDirectory}`)
  }

  const stats = fs.statSync(dataPath)
  return {
    villagerDirectory,
    saveRoot: path.dirname(villagerDirectory),
    dataPath,
    headerPath,
    modifiedAt: stats.mtime.toISOString(),
    modifiedMs: stats.mtimeMs
  }
}

function decryptSaveData(headerData, encryptedData) {
  const { key, counter } = deriveCryptoParams(headerData)
  return aesCtrCrypt(encryptedData, key, counter)
}

function encryptSaveData(headerData, plainData) {
  const { key, counter } = deriveCryptoParams(headerData)
  return aesCtrCrypt(plainData, key, counter)
}

function deriveCryptoParams(headerData) {
  if (!Buffer.isBuffer(headerData) || headerData.length < 0x300) {
    throw new Error('Ryujinx header data is missing or too small')
  }

  const importantData = []
  for (let offset = 0x100; offset < 0x300; offset += 4) {
    importantData.push(headerData.readUInt32LE(offset))
  }

  return {
    key: getParam(importantData, 0),
    counter: getParam(importantData, 2)
  }
}

function getParam(data, index) {
  const rand = new XorShift128(data[data[index] & 0x7F])
  const params = data[data[index + 1] & 0x7F] & 0x7F
  const rollCount = (params & 0xF) + 1

  for (let i = 0; i < rollCount; i += 1) {
    rand.next64()
  }

  const result = Buffer.alloc(BLOCK_SIZE)
  for (let i = 0; i < result.length; i += 1) {
    result[i] = (rand.next() >>> 24) & 0xFF
  }

  return result
}

function aesCtrCrypt(input, key, initialCounter) {
  const output = Buffer.from(input)
  const counter = Buffer.from(initialCounter)
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)

  for (let offset = 0; offset < output.length; offset += BLOCK_SIZE) {
    const encryptedCounter = cipher.update(counter)
    const blockLength = Math.min(BLOCK_SIZE, output.length - offset)
    for (let index = 0; index < blockLength; index += 1) {
      output[offset + index] ^= encryptedCounter[index]
    }
    incrementCounter(counter)
  }

  cipher.final()
  return output
}

function incrementCounter(counter) {
  for (let index = counter.length - 1; index >= 0; index -= 1) {
    counter[index] = (counter[index] + 1) & 0xFF
    if (counter[index] !== 0) {
      break
    }
  }
}

function selectLayout(data) {
  let bestLayout = null
  let bestScore = -1

  for (const layout of DEFAULT_LAYOUTS) {
    const score = scoreLayout(data, layout)
    if (score > bestScore) {
      bestLayout = layout
      bestScore = score
    }
  }

  if (!bestLayout || bestScore < 4) {
    throw new Error('Unable to identify the ACNH personal.dat layout')
  }

  return bestLayout
}

function scoreLayout(data, layout) {
  const requiredOffsets = [
    layout.personalId + 0x34,
    layout.wallet + 8,
    layout.bank + 8,
    layout.nowPoint + 8,
    layout.pockets1 + (ITEM_SIZE * 20) + 4,
    layout.pockets2 + (ITEM_SIZE * 20) + 4
  ]

  if (requiredOffsets.some((offset) => offset > data.length)) {
    return -1
  }

  let score = 0

  try {
    readEncryptedInt(data, layout.wallet)
    score += 2
  } catch (error) {
    return -1
  }

  try {
    readEncryptedInt(data, layout.bank)
    score += 2
  } catch (error) {
    return -1
  }

  try {
    readEncryptedInt(data, layout.nowPoint)
    score += 2
  } catch (error) {
    return -1
  }

  const bagCount = data.readUInt32LE(layout.pockets1 + (ITEM_SIZE * 20))
  const pocketCount = data.readUInt32LE(layout.pockets2 + (ITEM_SIZE * 20))
  if (bagCount >= 0 && bagCount <= 20 && bagCount % 10 === 0) {
    score += 2
  }
  if (pocketCount === 20) {
    score += 3
  }

  if (decodeAcnhString(data, layout.personalId + 0x04, 10)) {
    score += 1
  }
  if (decodeAcnhString(data, layout.personalId + 0x20, 10)) {
    score += 1
  }

  return score
}

function buildSlots(save) {
  const slots = []
  const itemIndex = getItemIndex()

  for (let index = 0; index < 20; index += 1) {
    slots.push(readSlot(save.data, save.layout.pockets2 + (index * ITEM_SIZE), index + 1, itemIndex))
  }

  for (let index = 0; index < 20; index += 1) {
    slots.push(readSlot(save.data, save.layout.pockets1 + (index * ITEM_SIZE), index + 21, itemIndex))
  }

  return slots
}

function readSlot(data, offset, slot, itemIndex) {
  const itemId = data.readUInt16LE(offset)
  const flag0 = data[offset + 2]
  const flag1 = data[offset + 3]
  const count = data.readUInt16LE(offset + 4)
  const uses = data.readUInt16LE(offset + 6)

  if (itemId === ITEM_NONE) {
    return emptySlot(slot)
  }

  const catalogItem = itemIndex.byInternalId.get(itemId) || null
  return {
    slot,
    itemId: catalogItem ? catalogItem.file_name : formatFallbackItemId(itemId),
    count,
    uses,
    flag0,
    flag1
  }
}

function emptySlot(slot) {
  return {
    slot,
    itemId: null,
    count: 0,
    uses: 0,
    flag0: 0,
    flag1: 0
  }
}

function normalizeSlotPayload(entry) {
  const slot = Number(entry && entry.slot)
  if (!Number.isInteger(slot) || slot < 1 || slot > 40) {
    return null
  }

  return {
    slot,
    itemId: entry && entry.itemId ? String(entry.itemId) : null,
    count: normalizeUInt16(entry && entry.count),
    uses: normalizeUInt16(entry && entry.uses),
    flag0: normalizeByte(entry && entry.flag0),
    flag1: normalizeByte(entry && entry.flag1)
  }
}

function resolveSlotBuffer(save, slot) {
  const baseOffset = slot <= 20
    ? save.layout.pockets2 + ((slot - 1) * ITEM_SIZE)
    : save.layout.pockets1 + ((slot - 21) * ITEM_SIZE)

  return save.data.subarray(baseOffset, baseOffset + ITEM_SIZE)
}

function writeEmptyItem(buffer) {
  buffer.writeUInt16LE(ITEM_NONE, 0)
  buffer[2] = 0
  buffer[3] = 0
  buffer.writeUInt16LE(0, 4)
  buffer.writeUInt16LE(0, 6)
}

function writeItem(buffer, value) {
  buffer.writeUInt16LE(value.itemId & 0xFFFF, 0)
  buffer[2] = value.flag0 & 0xFF
  buffer[3] = value.flag1 & 0xFF
  buffer.writeUInt16LE(value.count & 0xFFFF, 4)
  buffer.writeUInt16LE(value.uses & 0xFFFF, 6)
}

function decodeAcnhString(buffer, offset, maxChars) {
  if (offset < 0 || offset >= buffer.length) {
    return ''
  }

  const end = Math.min(buffer.length, offset + (maxChars * 2))
  const raw = buffer.subarray(offset, end)
  let actualEnd = raw.length

  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (raw[index] === 0 && raw[index + 1] === 0) {
      actualEnd = index
      break
    }
  }

  return raw.subarray(0, actualEnd).toString('utf16le').replace(/\0+$/g, '').trim()
}

function readEncryptedInt(buffer, offset) {
  const encrypted = buffer.readUInt32LE(offset)
  const adjust = buffer.readUInt16LE(offset + 4)
  const shift = buffer[offset + 6]
  const checksum = buffer[offset + 7]
  const expectedChecksum = calculateEncryptedChecksum(encrypted)
  if (checksum !== expectedChecksum) {
    throw new Error(`Encrypted value checksum mismatch at 0x${offset.toString(16)}`)
  }

  return {
    value: decryptEncryptedInt(encrypted, shift, adjust),
    encrypted,
    adjust,
    shift,
    checksum
  }
}

function writeEncryptedInt(buffer, offset, value) {
  const current = readEncryptedInt(buffer, offset)
  const encrypted = encryptEncryptedInt(value, current.shift, current.adjust)
  buffer.writeUInt32LE(encrypted, offset)
  buffer.writeUInt16LE(current.adjust, offset + 4)
  buffer[offset + 6] = current.shift
  buffer[offset + 7] = calculateEncryptedChecksum(encrypted)
}

function decryptEncryptedInt(encrypted, shift, adjust) {
  const rotated = rotateRight(encrypted >>> 0, shift + SHIFT_BASE)
  return (rotated + ENCRYPTION_CONSTANT - adjust) >>> 0
}

function encryptEncryptedInt(value, shift, adjust) {
  const adjusted = (value + adjust - ENCRYPTION_CONSTANT) >>> 0
  return rotateLeft(adjusted, shift + SHIFT_BASE)
}

function calculateEncryptedChecksum(value) {
  const byteSum = (value + (value >>> 16) + (value >>> 24) + (value >>> 8)) >>> 0
  return (byteSum - 0x2D) & 0xFF
}

function rotateLeft(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function rotateRight(value, shift) {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0
}

function scanHashes(data) {
  const results = []
  if (tryPopulateHashes(data, results, 0x100)) {
    return results
  }
  throw new Error('Unable to determine personal.dat hash regions')
}

function tryPopulateHashes(data, results, startOffset) {
  results.length = 0
  let offset = startOffset
  let gap = 0

  while (true) {
    if (offset + 4 >= data.length) {
      break
    }

    const hash = data.readUInt32LE(offset)
    const possible = data.subarray(offset + 4)
    const length = murmurGetLength(possible, hash)
    if (length === -1) {
      if (gap >= 0x110) {
        return false
      }

      offset += 0x10
      gap += 0x10
      continue
    }

    results.push({ hashOffset: offset, hashLength: length })
    offset += 4 + length
    gap = 0
  }

  return results.length > 0 && offset === data.length
}

function updateHashes(data, hashRegions) {
  if (!Array.isArray(hashRegions) || hashRegions.length === 0) {
    throw new Error('No personal.dat hash regions available for save write')
  }

  for (const region of hashRegions) {
    const hash = murmurHash(data.subarray(region.hashOffset + 4, region.hashOffset + 4 + region.hashLength))
    data.writeUInt32LE(hash >>> 0, region.hashOffset)
  }
}

function murmurGetLength(data, expected, seed = 0) {
  let checksum = seed >>> 0

  for (let index = 0; index + 3 < data.length; index += 4) {
    const value = data.readUInt32LE(index)
    checksum = murmurAdvance(checksum, value)
    const length = index + 4
    if (murmurFinalize(checksum, length) === (expected >>> 0)) {
      return length
    }
  }

  return -1
}

function murmurHash(data, seed = 0) {
  let checksum = seed >>> 0
  for (let index = 0; index + 3 < data.length; index += 4) {
    checksum = murmurAdvance(checksum, data.readUInt32LE(index))
  }
  return murmurFinalize(checksum, data.length)
}

function murmurAdvance(checksum, value) {
  checksum ^= murmurScramble(value)
  checksum = rotateLeft(checksum, 13)
  checksum = (Math.imul(checksum, 5) + 0xE6546B64) >>> 0
  return checksum >>> 0
}

function murmurScramble(value) {
  value = Math.imul(value >>> 0, 0xCC9E2D51) >>> 0
  value = rotateLeft(value, 15)
  value = Math.imul(value, 0x1B873593) >>> 0
  return value >>> 0
}

function murmurFinalize(checksum, length) {
  checksum ^= length >>> 0
  checksum ^= checksum >>> 16
  checksum = Math.imul(checksum, 0x85EBCA6B) >>> 0
  checksum ^= checksum >>> 13
  checksum = Math.imul(checksum, 0xC2B2AE35) >>> 0
  checksum ^= checksum >>> 16
  return checksum >>> 0
}

function getItemIndex() {
  if (itemIndexCache) {
    return itemIndexCache
  }

  const byInternalId = new Map()
  const byLookup = new Map()

  if (fs.existsSync(ITEM_NAMES_PATH)) {
    const lines = fs.readFileSync(ITEM_NAMES_PATH, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const name = lines[i].trim()
      if (!name) continue
      const entry = { name, file_name: name }
      byInternalId.set(i, entry)
      const normalized = normalizeItemLookup(name)
      if (normalized) byLookup.set(normalized, entry)
    }
  } else if (fs.existsSync(ITEMS_PATH)) {
    const raw = fs.readFileSync(ITEMS_PATH, 'utf8')
    const items = JSON.parse(raw)
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue
      const internalId = Number(item.internal_id)
      if (Number.isInteger(internalId) && internalId >= 0 && internalId <= 0xFFFF) {
        byInternalId.set(internalId, item)
      }
      const keys = [item.file_name, item.name]
      for (const key of keys) {
        const normalized = normalizeItemLookup(key)
        if (normalized) byLookup.set(normalized, item)
      }
    }
  }

  itemIndexCache = { byInternalId, byLookup }
  return itemIndexCache
}

function resolveCatalogItemId(itemId) {
  const value = String(itemId || '').trim()
  if (!value) {
    return ITEM_NONE
  }

  const directNumeric = parseItemIdValue(value)
  if (directNumeric !== null) {
    return directNumeric
  }

  const itemIndex = getItemIndex()
  const match = itemIndex.byLookup.get(normalizeItemLookup(value))
  if (match && Number.isInteger(Number(match.internal_id))) {
    return Number(match.internal_id)
  }

  return null
}

function parseItemIdValue(value) {
  if (/^0x[0-9a-f]+$/i.test(value)) {
    return parseInt(value.slice(2), 16)
  }

  if (/^\d+$/.test(value)) {
    return Number(value)
  }

  if (/^[0-9a-f]{4,8}$/i.test(value) && /[a-f]/i.test(value)) {
    return parseInt(value, 16)
  }

  return null
}

function normalizeItemLookup(value) {
  return String(value || '').trim().toLowerCase()
}

function formatFallbackItemId(itemId) {
  return `0x${itemId.toString(16).toUpperCase().padStart(4, '0')}`
}

function normalizeUInt16(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.max(0, Math.min(0xFFFF, Math.trunc(parsed)))
}

function normalizeByte(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.max(0, Math.min(0xFF, Math.trunc(parsed)))
}

class XorShift128 {
  constructor(seed) {
    const mersenne = 0x6C078965
    this.a = (Math.imul(mersenne, (seed ^ (seed >>> 30)) >>> 0) + 1) >>> 0
    this.b = (Math.imul(mersenne, (this.a ^ (this.a >>> 30)) >>> 0) + 2) >>> 0
    this.c = (Math.imul(mersenne, (this.b ^ (this.b >>> 30)) >>> 0) + 3) >>> 0
    this.d = (Math.imul(mersenne, (this.c ^ (this.c >>> 30)) >>> 0) + 4) >>> 0
  }

  next() {
    let t = this.a >>> 0
    this.a = this.b >>> 0
    this.b = this.c >>> 0
    this.c = this.d >>> 0
    t ^= (t << 11) >>> 0
    t ^= t >>> 8
    this.d = (t ^ this.d ^ (this.d >>> 19)) >>> 0
    return this.d >>> 0
  }

  next64() {
    const high = this.next()
    const low = this.next()
    return ((BigInt(high) << 32n) | BigInt(low))
  }
}

module.exports = {
  readGameData,
  readInventory,
  writeInventorySlot,
  resolveSaveCandidate,
  loadPersonalSave,
  writeEncryptedInt
}