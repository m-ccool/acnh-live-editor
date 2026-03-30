const fs = require('fs')
const path = require('path')

const dataPath = path.join(__dirname, '..', 'data', 'items.json')

function readItems() {
  if (!fs.existsSync(dataPath)) {
    return []
  }

  const raw = fs.readFileSync(dataPath, 'utf8')
  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed
}

function normalizeItem(item) {
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    category: String(item.category || ''),
    resolvedImageUrl: item.resolvedImageUrl ? String(item.resolvedImageUrl) : null,
    source: item.source || null
  }
}

function getItems(options = {}) {
  const search = String(options.search || '').trim().toLowerCase()
  const category = String(options.category || '').trim().toLowerCase()

  let items = readItems().map(normalizeItem)

  if (category) {
    items = items.filter(function (item) {
      return item.category.toLowerCase() === category
    })
  }

  if (search) {
    items = items.filter(function (item) {
      return (
        item.name.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search)
      )
    })
  }

  return items
}

module.exports = {
  getItems
}