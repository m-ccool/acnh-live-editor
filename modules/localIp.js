const { execSync } = require('child_process')
const os = require('os')

const localIpCache = {
  value: null,
  expiresAt: 0
}

function getPreferredLocalIp(req) {
  const requestHostIp = getRequestHostIp(req)
  if (requestHostIp) {
    return requestHostIp
  }

  const now = Date.now()
  if (localIpCache.value && localIpCache.expiresAt > now) {
    return localIpCache.value
  }

  const detectedIp = getWindowsDefaultRouteInterfaceIp() || getBestInterfaceIp()
  localIpCache.value = detectedIp
  localIpCache.expiresAt = now + 15000
  return detectedIp
}

function getRequestHostIp(req) {
  if (!req) {
    return null
  }

  const rawHost =
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    req.hostname

  if (!rawHost) {
    return null
  }

  const hostValue = Array.isArray(rawHost) ? rawHost[0] : String(rawHost)
  const firstHost = hostValue.split(',')[0].trim()
  const normalizedHost = normalizeHost(firstHost)

  if (!normalizedHost || isLocalHost(normalizedHost)) {
    return null
  }

  return isIpv4Address(normalizedHost) ? normalizedHost : null
}

function normalizeHost(host) {
  if (!host) {
    return ''
  }

  const value = String(host).trim()
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')
    return closingBracket > 1 ? value.slice(1, closingBracket) : value
  }

  const colonIndex = value.indexOf(':')
  return colonIndex >= 0 ? value.slice(0, colonIndex) : value
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isIpv4Address(value) {
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(value)
}

function getBestInterfaceIp() {
  const candidates = getInterfaceCandidates()
  if (!candidates.length) {
    return null
  }

  candidates.sort((a, b) => scoreInterface(b) - scoreInterface(a))
  return candidates[0].address
}

function getInterfaceCandidates() {
  const interfaces = os.networkInterfaces()
  const candidates = []

  Object.entries(interfaces).forEach(([name, addresses]) => {
    if (!Array.isArray(addresses)) return

    addresses.forEach((address) => {
      const family = typeof address.family === 'string' ? address.family : String(address.family)
      if (family !== 'IPv4' || address.internal || !isIpv4Address(address.address)) return

      candidates.push({
        name: name.toLowerCase(),
        address: address.address
      })
    })
  })

  return candidates
}

function getWindowsDefaultRouteInterfaceIp() {
  if (process.platform !== 'win32') {
    return null
  }

  try {
    const output = execSync('route print -4', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const interfaceScoreByIp = new Map(
      getInterfaceCandidates().map((candidate) => [candidate.address, scoreInterface(candidate)])
    )

    const defaultRoutes = parseWindowsDefaultRoutes(output)
    if (!defaultRoutes.length) {
      return null
    }

    defaultRoutes.sort((a, b) => {
      const metricDelta = a.metric - b.metric
      if (metricDelta !== 0) {
        return metricDelta
      }

      return (interfaceScoreByIp.get(b.iface) || 0) - (interfaceScoreByIp.get(a.iface) || 0)
    })

    return defaultRoutes[0].iface
  } catch (error) {
    return null
  }
}

function parseWindowsDefaultRoutes(output) {
  const routes = []
  let inActiveRoutes = false

  String(output || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim()

      if (trimmed === 'Active Routes:') {
        inActiveRoutes = true
        return
      }

      if (trimmed === 'Persistent Routes:') {
        inActiveRoutes = false
        return
      }

      if (!inActiveRoutes || !trimmed || trimmed.startsWith('Network Destination')) {
        return
      }

      const parts = trimmed.split(/\s+/)
      if (parts.length < 5) {
        return
      }

      const [destination, netmask, gateway, iface, metricValue] = parts
      if (destination !== '0.0.0.0' || netmask !== '0.0.0.0' || !isIpv4Address(iface)) {
        return
      }

      routes.push({
        gateway,
        iface,
        metric: Number(metricValue) || Number.MAX_SAFE_INTEGER
      })
    })

  return routes
}

function scoreInterface(candidate) {
  let score = 0

  if (candidate.name.includes('wi-fi') || candidate.name.includes('wifi') || candidate.name.includes('wlan')) {
    score += 40
  }

  if (candidate.name.includes('ethernet') || candidate.name.includes('en')) {
    score += 30
  }

  if (candidate.name.includes('loopback') || candidate.name.includes('virtual') || candidate.name.includes('vmware')) {
    score -= 100
  }

  if (candidate.address.startsWith('10.') || candidate.address.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(candidate.address)) {
    score += 20
  }

  return score
}

module.exports = {
  getPreferredLocalIp
}
