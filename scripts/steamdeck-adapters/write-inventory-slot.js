const fs = require('fs')
const path = require('path')

const inventoryPath = resolveInventoryPath()

readStdin()
  .then((request) => {
    const slotPayload = normalizeSlot(request && request.payload ? request.payload : request)

    if (!slotPayload) {
      throw new Error('payload.slot must be a positive integer')
    }

    const slots = loadInventorySlots(inventoryPath)
    const existingIndex = slots.findIndex((entry) => entry.slot === slotPayload.slot)

    if (existingIndex >= 0) {
      slots[existingIndex] = slotPayload
    } else {
      slots.push(slotPayload)
    }

    slots.sort((a, b) => a.slot - b.slot)
    saveInventorySlots(inventoryPath, slots)

    process.stdout.write(`${JSON.stringify({ slot: slotPayload, slots })}\n`)
  })
  .catch((error) => {
    process.stderr.write(`write-inventory-slot failed: ${error.message}\n`)
    process.exit(1)
  })

function resolveInventoryPath() {
  if (process.env.BRIDGE_INVENTORY_FILE) {
    return path.resolve(process.env.BRIDGE_INVENTORY_FILE)
  }

  return path.join(process.cwd(), 'data', 'steamdeck-inventory.json')
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => {
      const text = chunks.join('').trim()
      if (!text) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error('stdin must contain valid JSON'))
      }
    })
    process.stdin.on('error', reject)
  })
}

function loadInventorySlots(filePath) {
  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const source = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.slots) ? parsed.slots : [])

    return source.map(normalizeSlot).filter(Boolean)
  } catch (error) {
    throw new Error(`failed to parse inventory file: ${error.message}`)
  }
}

function saveInventorySlots(filePath, slots) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(slots, null, 2), 'utf8')
}

function normalizeSlot(entry) {
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
