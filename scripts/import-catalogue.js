const fs = require('fs')
const path = require('path')

const assetsDir = path.join(__dirname, '..', 'public', 'assets', 'items')
const outputPath = path.join(__dirname, '..', 'data', 'items.json')

function toPublicUrl(fileName) {
  return `/assets/items/${encodeURIComponent(fileName)}`
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, '')
}

function removeKnownSuffixes(stem) {
  return stem
    .replace(/_NH_Inv_Icon$/i, '')
    .replace(/_NH_Villager_Icon$/i, '')
    .replace(/_NH_Icon$/i, '')
    .replace(/_Villager_Icon$/i, '')
    .replace(/_Inv_Icon$/i, '')
    .replace(/_Icon$/i, '')
    .replace(/_NH_Texture$/i, '')
    .replace(/_NH$/i, '')
}

function baseKeyFromFile(fileName) {
  return removeKnownSuffixes(stripExtension(fileName))
}

function inferCategory(baseKey, fileNames) {
  const lower = baseKey.toLowerCase()

  if (lower.startsWith('sea_')) return 'Sea creature'
  if (fileNames.some(name => /villager/i.test(name))) return 'Villager'
  if (lower.includes('sweater') || lower.includes('dress') || lower.includes('shirt')) return 'Clothing'
  if (
    lower.includes('wand') ||
    lower.includes('shovel') ||
    lower.includes('rod') ||
    lower.includes('net') ||
    lower.includes('slingshot') ||
    lower.includes('watering_can') ||
    lower.includes('ladder') ||
    lower.includes('axe')
  ) {
    return 'Tool'
  }
  if (
    lower.includes('nugget') ||
    lower.includes('stone') ||
    lower.includes('clay') ||
    lower.includes('wood')
  ) {
    return 'Material'
  }

  return 'Local'
}

function prettyName(baseKey) {
  return baseKey.replace(/_/g, ' ').trim()
}

function chooseIcon(fileNames) {
  const priority = [
    /_NH_Inv_Icon\.png$/i,
    /_Inv_Icon\.png$/i,
    /_NH_Villager_Icon\.png$/i,
    /_Villager_Icon\.png$/i,
    /_NH_Icon\.png$/i,
    /_Icon\.png$/i,
    /_NH\.png$/i,
    /\.png$/i
  ]

  for (const rule of priority) {
    const match = fileNames.find(name => rule.test(name))
    if (match) return match
  }

  return null
}

function chooseImage(fileNames) {
  const priority = [
    /_NH\.png$/i,
    /_NH_Texture\.png$/i,
    /_NH_Villager_Icon\.png$/i,
    /_Villager_Icon\.png$/i,
    /_NH_Icon\.png$/i,
    /_Icon\.png$/i,
    /_NH_Inv_Icon\.png$/i,
    /_Inv_Icon\.png$/i,
    /\.png$/i
  ]

  for (const rule of priority) {
    const match = fileNames.find(name => rule.test(name))
    if (match) return match
  }

  return null
}

function buildItems() {
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Missing assets directory: ${assetsDir}`)
  }

  const files = fs
    .readdirSync(assetsDir)
    .filter(file => /\.png$/i.test(file))
    .sort((a, b) => a.localeCompare(b))

  const groups = new Map()

  for (const file of files) {
    const baseKey = baseKeyFromFile(file)

    if (!groups.has(baseKey)) {
      groups.set(baseKey, [])
    }

    groups.get(baseKey).push(file)
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([baseKey, fileNames], index) => {
      const iconFile = chooseIcon(fileNames)
      const imageFile = chooseImage(fileNames)

      return {
        name: prettyName(baseKey),
        category: inferCategory(baseKey, fileNames),

        // Nookipedia-style fields
        icon_url: iconFile ? toPublicUrl(iconFile) : null,
        image_url: imageFile ? toPublicUrl(imageFile) : null,

        // local compatibility metadata
        internal_id: index + 1,
        file_name: baseKey,
        source_notes: 'local offline asset',
        source_files: fileNames
      }
    })
    .filter(item => item.icon_url || item.image_url)
}

function run() {
  const items = buildItems()

  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf8')

  console.log('Injected local items:', items.length)
  console.log('Wrote:', outputPath)
}

run()