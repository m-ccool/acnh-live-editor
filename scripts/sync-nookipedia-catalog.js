const {
  DISK_CACHE_PATH,
  getCatalogItems,
  getCatalogSyncState
} = require('../modules/nookipediaCatalog')

async function run() {
  const startedAt = Date.now()
  const items = await getCatalogItems()
  const syncState = getCatalogSyncState()

  console.log(`Synced ${items.length} Nookipedia catalog items`)
  console.log(`Cache: ${DISK_CACHE_PATH}`)
  console.log(`Updated: ${syncState.lastSuccessfulSyncAt || 'unknown'}`)
  console.log(`Elapsed: ${Date.now() - startedAt}ms`)
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
