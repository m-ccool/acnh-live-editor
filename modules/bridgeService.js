async function getStatus() {
  return {
    connected: false,
    emulator: 'ryujinx',
    game: 'acnh',
    version: null,
    bridge: 'pending'
  }
}

module.exports = {
  getStatus
}