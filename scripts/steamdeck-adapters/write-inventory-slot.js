const { writeInventorySlot } = require('./ryujinx-save')

readStdin()
  .then((request) => {
    process.stdout.write(`${JSON.stringify(writeInventorySlot(request))}\n`)
  })
  .catch((error) => {
    process.stderr.write(`write-inventory-slot failed: ${error.message}\n`)
    process.exit(1)
  })

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
