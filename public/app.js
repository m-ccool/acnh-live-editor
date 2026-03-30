const FALLBACK_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" fill="#111111"/>
      <rect x="8" y="8" width="164" height="164" rx="10" fill="#1f1f1f" stroke="#ffffff"/>
      <circle cx="60" cy="58" r="14" fill="#ffffff"/>
      <path d="M30 132l30-34 16 16 20-26 34 44H30z" fill="#ffffff"/>
    </svg>
  `)

const state = {
  items: [],
  filtered: [],
  selectedItem: null
}

async function loadStatus() {
  const response = await fetch('/api/status')
  const status = await response.json()

  document.getElementById('bridge-status').textContent = JSON.stringify(status, null, 2)

  const bridgeOk = status && status.connected === true
  document.getElementById('catalog-status').textContent = '✓'
  document.getElementById('bridge-status-inline').textContent = bridgeOk ? '✓' : '✕'
  document.getElementById('connection-line').textContent = bridgeOk
    ? 'Connection active'
    : 'No connection active'
}

async function loadItems() {
  const response = await fetch('/api/items')
  const items = await response.json()

  state.items = items
  state.filtered = items
  state.selectedItem = items[0] || null
}

function safeSrc(value) {
  return value && typeof value === 'string' ? value : FALLBACK_IMAGE
}

function getDisplayId(item) {
  return item.internal_id ?? '—'
}

function buildBadges(item) {
  const badges = ['In catalog']
  const category = String(item.category || '').toLowerCase()

  if (category) {
    badges.push(category)
  }

  return badges
}

function renderInventoryGrid() {
  const grid = document.getElementById('inventory-grid')
  grid.innerHTML = ''

  const slots = 40

  for (let i = 0; i < slots; i += 1) {
    const slot = document.createElement('div')
    slot.className = 'inventory-slot'

    const item = state.items[i]

    if (item) {
      slot.classList.add('is-filled')

      const img = document.createElement('img')
      img.src = safeSrc(item.icon_url)
      img.alt = item.name || ''
      img.onerror = function () {
        this.onerror = null
        this.src = FALLBACK_IMAGE
      }

      slot.appendChild(img)
      slot.style.cursor = 'pointer'
      slot.addEventListener('click', function () {
        selectItem(item)
      })
    }

    grid.appendChild(slot)
  }

  document.getElementById('selection-line').textContent = state.selectedItem
    ? `Selected: ${state.selectedItem.name}`
    : 'No item selected'
}

function createResultRow(item) {
  const row = document.createElement('div')
  row.className = 'result-row'

  if (state.selectedItem && state.selectedItem.internal_id === item.internal_id) {
    row.classList.add('is-selected')
  }

  const thumbWrap = document.createElement('div')
  thumbWrap.className = 'result-thumb-wrap'

  const thumb = document.createElement('img')
  thumb.className = 'result-thumb'
  thumb.src = safeSrc(item.icon_url)
  thumb.alt = item.name || ''
  thumb.onerror = function () {
    this.onerror = null
    this.src = FALLBACK_IMAGE
  }

  thumbWrap.appendChild(thumb)

  const main = document.createElement('div')
  main.className = 'result-main'

  const name = document.createElement('div')
  name.className = 'result-name'
  name.textContent = item.name || 'unknown'

  const sub = document.createElement('div')
  sub.className = 'result-sub'
  sub.textContent = item.category || 'local'

  main.appendChild(name)
  main.appendChild(sub)

  row.appendChild(thumbWrap)
  row.appendChild(main)

  row.addEventListener('click', function () {
    selectItem(item)
  })

  return row
}

function renderResults() {
  const list = document.getElementById('results-list')
  list.innerHTML = ''

  for (const item of state.filtered) {
    list.appendChild(createResultRow(item))
  }
}

function renderFiles(item) {
  const container = document.getElementById('detail-files')
  container.innerHTML = ''

  const files = Array.isArray(item.source_files) ? item.source_files : []

  if (!files.length) {
    const empty = document.createElement('div')
    empty.className = 'file-chip'
    empty.textContent = item.file_name || '—'
    container.appendChild(empty)
    return
  }

  for (const file of files) {
    const chip = document.createElement('div')
    chip.className = 'file-chip'
    chip.textContent = file
    container.appendChild(chip)
  }
}

function renderDetails() {
  const item = state.selectedItem

  const name = document.getElementById('detail-name')
  const badges = document.getElementById('detail-badges')
  const icon = document.getElementById('detail-icon')
  const preview = document.getElementById('detail-preview')
  const id = document.getElementById('detail-id')
  const category = document.getElementById('detail-category')
  const fileName = document.getElementById('detail-file-name')
  const source = document.getElementById('detail-source')
  const subcategory = document.getElementById('detail-subcategory')
  const color = document.getElementById('detail-color')
  const size = document.getElementById('detail-size')

  if (!item) {
    name.textContent = 'No item selected'
    badges.innerHTML = ''
    id.textContent = '—'
    category.textContent = '—'
    fileName.textContent = '—'
    source.textContent = 'local offline asset'
    subcategory.textContent = '—'
    color.textContent = '—'
    size.textContent = '—'
    icon.src = FALLBACK_IMAGE
    preview.src = FALLBACK_IMAGE
    renderFiles({})
    return
  }

  name.textContent = item.name || 'unknown'
  id.textContent = getDisplayId(item)
  category.textContent = item.category || 'local'
  fileName.textContent = item.file_name || '—'
  source.textContent = item.source_notes || 'local offline asset'
  subcategory.textContent = item.category || 'local'
  color.textContent = 'local'
  size.textContent = '1×1'

  badges.innerHTML = ''
  for (const label of buildBadges(item)) {
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = label
    badges.appendChild(badge)
  }

  icon.src = safeSrc(item.icon_url)
  icon.alt = item.name || ''
  icon.onerror = function () {
    this.onerror = null
    this.src = FALLBACK_IMAGE
  }

  preview.src = safeSrc(item.image_url || item.icon_url)
  preview.alt = item.name || ''
  preview.onerror = function () {
    this.onerror = null
    this.src = FALLBACK_IMAGE
  }

  renderFiles(item)
}

function renderAll() {
  renderInventoryGrid()
  renderResults()
  renderDetails()
}

function selectItem(item) {
  state.selectedItem = item
  renderAll()
}

function applySearch(query) {
  const q = query.trim().toLowerCase()

  if (!q) {
    state.filtered = state.items
    if (!state.filtered.includes(state.selectedItem)) {
      state.selectedItem = state.filtered[0] || null
    }
    renderAll()
    return
  }

  state.filtered = state.items.filter(item => {
    const name = String(item.name || '').toLowerCase()
    const id = String(getDisplayId(item)).toLowerCase()
    const category = String(item.category || '').toLowerCase()
    const fileName = String(item.file_name || '').toLowerCase()

    return (
      name.includes(q) ||
      id.includes(q) ||
      category.includes(q) ||
      fileName.includes(q)
    )
  })

  if (!state.filtered.includes(state.selectedItem)) {
    state.selectedItem = state.filtered[0] || null
  }

  renderAll()
}

function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden')
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden')
}

function finishLoading() {
  const loadingScreen = document.getElementById('loading-screen')
  const appRoot = document.getElementById('app-root')

  appRoot.classList.remove('app-hidden')

  requestAnimationFrame(() => {
    loadingScreen.classList.add('hidden')
  })
}

function wireEvents() {
  document.getElementById('search-input').addEventListener('input', function (event) {
    applySearch(event.target.value)
  })

  document.getElementById('settings-button').addEventListener('click', openSettings)
  document.getElementById('settings-close').addEventListener('click', closeSettings)

  document.getElementById('settings-modal').addEventListener('click', function (event) {
    if (event.target.id === 'settings-modal') {
      closeSettings()
    }
  })
}

async function init() {
  await loadStatus()
  await loadItems()
  renderAll()
  wireEvents()
  finishLoading()
}

init()