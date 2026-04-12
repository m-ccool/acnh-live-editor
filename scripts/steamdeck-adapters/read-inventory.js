const { readInventory } = require('./ryujinx-save')

function main() {
  process.stdout.write(`${JSON.stringify(readInventory())}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`read-inventory failed: ${error.message}\n`)
  process.exit(1)
}
