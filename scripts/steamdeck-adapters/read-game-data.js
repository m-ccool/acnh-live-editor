const { readGameData } = require('./ryujinx-save')

function main() {
  const payload = readGameData()
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`read-game-data failed: ${error.message}\n`)
  process.exit(1)
}