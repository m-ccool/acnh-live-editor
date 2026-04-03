const fs = require('fs')
const path = require('path')

const inventoryPath = resolveInventoryPath()

function main() {
  const slots = loadInventorySlots(inventoryPath)
  process.stdout.write(`${JSON.stringify({ slots })}\n`)
}

function resolveInventoryPath() {
  if (process.env.BRIDGE_INVENTORY_FILE) {
    return path.resolve(process.env.BRIDGE_INVENTORY_FILE)
  }

  return path.join(process.cwd(), 'data', 'steamdeck-inventory.json')
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
    process.stderr.write(`Failed to read inventory file: ${error.message}\n`)
    process.exitCode = 1
    return []
  }
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

main()
