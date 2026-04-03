const https = require('https')
const fs = require('fs')
const path = require('path')

const NOOKIPEDIA_KK_SONGS_URL = 'https://nookipedia.com/wiki/K.K._Slider_songs'
const NOOKIPEDIA_SUNRISE_SOUNDTRACK_URL = 'https://nookipedia.com/wiki/Animal_Crossing:_Your_Favourite_Songs_-_Original_Soundtrack'
const NOOKIPEDIA_MEDIAWIKI_API_URL = 'https://nookipedia.com/w/api.php'
const NOOKIPEDIA_API_DOCS_URL = 'https://api.nookipedia.com/doc'
const NOOKIPEDIA_RAINY_4AM_COVER_TITLE = 'File:Nintendo Music ACNH 4 00 AM - Rainy.jpg'
const FANDOM_MEDIAWIKI_API_URL = 'https://animalcrossing.fandom.com/api.php'
const FANDOM_CITY_FOLK_TITLE_THEME_FILE_TITLE = 'File:ACCF Main Theme.ogg'
const MUSIC_LIBRARY_CACHE_TTL_MS = 1000 * 60 * 60 * 12
const MUSIC_LIBRARY_FALLBACK_ART = '/assets/icons/Aircheck_NH_Inv_Icon.png'
const MUSIC_REQUEST_TIMEOUT_MS = 8000
const MUSIC_LIBRARY_DISK_CACHE_PATH = path.join(__dirname, '..', 'data', 'music-library-cache.json')
const MAX_REQUEST_RETRIES = 2

const musicLibraryCache = {
  value: null,
  expiresAt: 0,
  promise: null,
  loadedDiskState: false,
  diskState: null
}

async function getMusicLibrary() {
  const now = Date.now()

  if (musicLibraryCache.value && musicLibraryCache.expiresAt > now) {
    return musicLibraryCache.value
  }

  const diskLibrary = getDiskMusicLibrary()
  if (diskLibrary && !musicLibraryCache.value) {
    musicLibraryCache.value = diskLibrary
    musicLibraryCache.expiresAt = 0
  }

  if (!musicLibraryCache.promise) {
    musicLibraryCache.promise = buildMusicLibrary()
      .then((library) => {
        musicLibraryCache.value = library
        musicLibraryCache.expiresAt = Date.now() + MUSIC_LIBRARY_CACHE_TTL_MS
        writeDiskMusicLibrary(library)
        return library
      })
      .catch((error) => {
        if (diskLibrary) {
          return {
            ...diskLibrary,
            degraded: true,
            reason: `Using cached music library: ${error.message}`,
            stale: true
          }
        }

        if (musicLibraryCache.value) {
          return {
            ...musicLibraryCache.value,
            degraded: true,
            reason: `Using in-memory music library: ${error.message}`,
            stale: true
          }
        }

        throw error
      })
      .finally(() => {
        musicLibraryCache.promise = null
      })
  }

  return musicLibraryCache.promise
}

function getFallbackMusicLibrary(reason) {
  return {
    generatedAt: new Date().toISOString(),
    sourcePage: NOOKIPEDIA_KK_SONGS_URL,
    apiDocs: NOOKIPEDIA_API_DOCS_URL,
    defaultNightTrackId: 'ambient-4am-rainy',
    defaultSunriseTrackId: 'sunrise-animal-crossing-theme',
    degraded: true,
    reason: String(reason || 'Remote music sources unavailable'),
    tracks: [
      {
        id: 'ambient-4am-rainy',
        title: '4 AM Rainy Weather',
        kind: 'ambient',
        group: 'Theme defaults',
        source: 'Local fallback',
        attribution: 'Fallback music library',
        audioUrl: null,
        artworkUrl: MUSIC_LIBRARY_FALLBACK_ART,
        referenceUrl: NOOKIPEDIA_API_DOCS_URL
      },
      {
        id: 'sunrise-animal-crossing-theme',
        title: 'Animal Crossing Theme',
        kind: 'audio',
        group: 'Theme defaults',
        source: 'Local fallback',
        attribution: 'Fallback music library',
        audioUrl: null,
        artworkUrl: MUSIC_LIBRARY_FALLBACK_ART,
        referenceUrl: NOOKIPEDIA_API_DOCS_URL
      }
    ]
  }
}

async function buildMusicLibrary() {
  const [songsPageResult, sunrisePageResult] = await Promise.allSettled([
    requestText(NOOKIPEDIA_KK_SONGS_URL),
    requestText(NOOKIPEDIA_SUNRISE_SOUNDTRACK_URL)
  ])
  const songsPageHtml = songsPageResult.status === 'fulfilled' ? songsPageResult.value : ''
  const sunriseSoundtrackHtml = sunrisePageResult.status === 'fulfilled' ? sunrisePageResult.value : ''
  const kkAircheckTitles = extractKkAircheckFileTitles(songsPageHtml)
  const kkAlbumArtworkUrl = extractNookipediaOgImageUrl(songsPageHtml) || MUSIC_LIBRARY_FALLBACK_ART
  const sunriseArtworkUrl = extractNookipediaOgImageUrl(sunriseSoundtrackHtml) || MUSIC_LIBRARY_FALLBACK_ART
  const [kkFileMetadataResult, rainyCoverResult, sunriseThemeResult] = await Promise.allSettled([
    fetchNookipediaFileMetadata(kkAircheckTitles),
    fetchNookipediaFileMetadata([NOOKIPEDIA_RAINY_4AM_COVER_TITLE]),
    fetchMediaWikiFileMetadata(FANDOM_MEDIAWIKI_API_URL, [FANDOM_CITY_FOLK_TITLE_THEME_FILE_TITLE])
  ])
  const kkFileMetadata = kkFileMetadataResult.status === 'fulfilled' ? kkFileMetadataResult.value : []
  const rainyCoverMetadata = rainyCoverResult.status === 'fulfilled' ? rainyCoverResult.value : []
  const sunriseThemeMetadata = sunriseThemeResult.status === 'fulfilled' ? sunriseThemeResult.value : []

  const rainyCover = rainyCoverMetadata[0] || null
  const sunriseThemeFile = sunriseThemeMetadata[0] || null
  const kkTracks = kkFileMetadata.map((file) => {
    const trackTitle = formatKkTrackTitle(file.title)
    return {
      id: `kk-${slugifyTrackId(trackTitle)}`,
      title: trackTitle,
      kind: 'audio',
      group: 'K.K. Airchecks',
      source: 'Nookipedia aircheck',
      attribution: 'K.K. Slider songs page',
      audioUrl: file.url,
      artworkUrl: kkAlbumArtworkUrl,
      referenceUrl: file.descriptionUrl || NOOKIPEDIA_KK_SONGS_URL
    }
  })

  const degraded = [
    songsPageResult,
    sunrisePageResult,
    kkFileMetadataResult,
    rainyCoverResult,
    sunriseThemeResult
  ].some((result) => result.status === 'rejected')

  return {
    generatedAt: new Date().toISOString(),
    sourcePage: NOOKIPEDIA_KK_SONGS_URL,
    apiDocs: NOOKIPEDIA_API_DOCS_URL,
    defaultNightTrackId: 'ambient-4am-rainy',
    defaultSunriseTrackId: 'sunrise-animal-crossing-theme',
    degraded,
    reason: degraded ? 'One or more remote music sources were unavailable during sync.' : '',
    tracks: [
      {
        id: 'ambient-4am-rainy',
        title: '4 AM Rainy Weather',
        kind: 'ambient',
        group: 'Theme defaults',
        source: 'Night ambient preset',
        attribution: 'Nintendo Music artwork via Nookipedia',
        audioUrl: null,
        artworkUrl: rainyCover ? rainyCover.url : MUSIC_LIBRARY_FALLBACK_ART,
        referenceUrl: rainyCover ? rainyCover.descriptionUrl : NOOKIPEDIA_KK_SONGS_URL
      },
      {
        id: 'sunrise-animal-crossing-theme',
        title: 'Animal Crossing Theme',
        kind: 'audio',
        group: 'Theme defaults',
        source: 'Sunrise default theme',
        attribution: 'Animal Crossing: Your Favourite Songs - Original Soundtrack',
        audioUrl: sunriseThemeFile ? sunriseThemeFile.url : null,
        artworkUrl: sunriseArtworkUrl,
        referenceUrl: NOOKIPEDIA_SUNRISE_SOUNDTRACK_URL
      },
      ...kkTracks
    ]
  }
}

function extractKkAircheckFileTitles(html) {
  const matches = String(html || '').matchAll(/href="([^"]*\/wiki\/File:NH_[^"]+\(Aircheck,_Hi-Fi\)\.flac)"/gi)
  const titles = new Set()

  for (const match of matches) {
    const normalizedTitle = normalizeNookipediaFileTitle(match[1])
    if (!normalizedTitle) continue
    titles.add(normalizedTitle)
  }

  return Array.from(titles)
}

function extractNookipediaOgImageUrl(html) {
  const match = String(html || '').match(/property="og:image"\s+content="([^"]+)"/i)
  return match ? match[1] : ''
}

function normalizeNookipediaFileTitle(rawUrl) {
  try {
    const resolved = new URL(rawUrl, 'https://nookipedia.com')
    if (!resolved.pathname.startsWith('/wiki/')) {
      return ''
    }

    return normalizeMediaWikiTitle(decodeURIComponent(resolved.pathname.slice('/wiki/'.length)))
  } catch (error) {
    return ''
  }
}

async function fetchNookipediaFileMetadata(fileTitles) {
  return fetchMediaWikiFileMetadata(NOOKIPEDIA_MEDIAWIKI_API_URL, fileTitles)
}

async function fetchMediaWikiFileMetadata(apiUrl, fileTitles) {
  const normalizedTitles = Array.from(
    new Set(
      (Array.isArray(fileTitles) ? fileTitles : [])
        .map((title) => normalizeMediaWikiTitle(title))
        .filter(Boolean)
    )
  )

  if (!normalizedTitles.length) {
    return []
  }

  const lookup = new Map()

  for (let index = 0; index < normalizedTitles.length; index += 25) {
    const batch = normalizedTitles.slice(index, index + 25)
    const requestUrl = buildMediaWikiApiUrl(apiUrl, {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url',
      format: 'json',
      titles: batch.join('|')
    })
    const payload = await requestJson(requestUrl)
    const pages = payload && payload.query && payload.query.pages

    Object.values(pages || {}).forEach((page) => {
      if (!page || !page.title || !Array.isArray(page.imageinfo) || !page.imageinfo.length) {
        return
      }

      const imageInfo = page.imageinfo[0]
      lookup.set(normalizeMediaWikiTitle(page.title), {
        title: normalizeMediaWikiTitle(page.title),
        url: imageInfo.url,
        descriptionUrl: imageInfo.descriptionurl || ''
      })
    })
  }

  return normalizedTitles
    .map((title) => lookup.get(title))
    .filter(Boolean)
}

function buildMediaWikiApiUrl(apiUrl, params) {
  const searchParams = new URLSearchParams(params)
  return `${apiUrl}?${searchParams.toString()}`
}

function normalizeMediaWikiTitle(value) {
  return String(value || '').replace(/_/g, ' ').trim()
}

function formatKkTrackTitle(fileTitle) {
  return normalizeMediaWikiTitle(fileTitle)
    .replace(/^File:NH\s+/i, '')
    .replace(/\s+\(Aircheck, Hi-Fi\)\.flac$/i, '')
}

function slugifyTrackId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function requestJson(url) {
  return requestText(url).then((text) => JSON.parse(text))
}

function requestText(url) {
  return requestTextWithRetry(url, 0)
}

function requestTextWithRetry(url, attempt) {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = https.get(url, {
      headers: {
        'user-agent': 'acnh-live-editor/1.0',
        accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        const statusCode = Number(response.statusCode)
        response.resume()

        if (shouldRetryRequest(statusCode, attempt)) {
          delay(getRetryDelayMs(attempt))
            .then(() => resolve(requestTextWithRetry(url, attempt + 1)))
            .catch(reject)
          return
        }

        settled = true
        reject(new Error(`Request failed with status ${response.statusCode} for ${url}`))
        return
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (settled) {
          return
        }
        settled = true
        resolve(body)
      })
    })

    request.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true

      if (shouldRetryNetworkError(error, attempt)) {
        delay(getRetryDelayMs(attempt))
          .then(() => resolve(requestTextWithRetry(url, attempt + 1)))
          .catch(reject)
        return
      }

      reject(error)
    })
    request.setTimeout(MUSIC_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out for ${url}`))
    })
  })
}

function getDiskMusicLibrary() {
  if (musicLibraryCache.loadedDiskState) {
    return musicLibraryCache.diskState
  }

  musicLibraryCache.loadedDiskState = true

  if (!fs.existsSync(MUSIC_LIBRARY_DISK_CACHE_PATH)) {
    musicLibraryCache.diskState = null
    return null
  }

  try {
    const raw = fs.readFileSync(MUSIC_LIBRARY_DISK_CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.tracks)) {
      musicLibraryCache.diskState = null
      return null
    }

    musicLibraryCache.diskState = parsed
    return parsed
  } catch (error) {
    musicLibraryCache.diskState = null
    return null
  }
}

function writeDiskMusicLibrary(library) {
  fs.mkdirSync(path.dirname(MUSIC_LIBRARY_DISK_CACHE_PATH), { recursive: true })
  fs.writeFileSync(MUSIC_LIBRARY_DISK_CACHE_PATH, JSON.stringify(library, null, 2), 'utf8')
  musicLibraryCache.loadedDiskState = true
  musicLibraryCache.diskState = library
}

function shouldRetryRequest(statusCode, attempt) {
  return attempt < MAX_REQUEST_RETRIES && [429, 502, 503, 504].includes(Number(statusCode))
}

function shouldRetryNetworkError(error, attempt) {
  if (attempt >= MAX_REQUEST_RETRIES) {
    return false
  }

  const code = String(error && error.code || '').trim().toUpperCase()
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)
}

function getRetryDelayMs(attempt) {
  return 400 * (attempt + 1)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

module.exports = {
  getFallbackMusicLibrary,
  getMusicLibrary
}
