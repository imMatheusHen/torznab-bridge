import { HLS_CONTENT_TYPES } from './constants.js';

export function isHlsContent(text, contentType = '') {
  const normalizedType = `${contentType}`.toLowerCase().split(';', 1)[0].trim();
  return HLS_CONTENT_TYPES.includes(normalizedType)
    || /^\s*#EXTM3U(?:\s|$)/i.test(`${text || ''}`)
    || /^\s*#EXT-X-/im.test(`${text || ''}`);
}

export function getManifestResourceUrls(manifest, manifestUrl) {
  const urls = new Set();
  for (const line of `${manifest || ''}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const matches = trimmed.matchAll(/URI\s*=\s*["']([^"']+)["']/gi);
      for (const match of matches) {
        addResolved(urls, match[1], manifestUrl);
      }
      continue;
    }
    addResolved(urls, trimmed, manifestUrl);
  }
  return [...urls];
}

export function getFirstVariantUrl(manifest, manifestUrl) {
  const lines = `${manifest || ''}`.split(/\r?\n/);
  let expectingVariant = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (expectingVariant && !trimmed.startsWith('#')) {
      return toAbsoluteUrl(trimmed, manifestUrl);
    }
    expectingVariant = /^#EXT-X-STREAM-INF\b/i.test(trimmed);
  }
  return undefined;
}

export function getFirstMediaSegmentUrl(manifest, manifestUrl) {
  const line = `${manifest || ''}`.split(/\r?\n/)
      .map(value => value.trim())
      .find(value => value && !value.startsWith('#'));
  return line ? toAbsoluteUrl(line, manifestUrl) : undefined;
}

export function isPlausibleMediaSegment(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 4) return false;

  const textPrefix = bytes.subarray(0, Math.min(bytes.length, 96)).toString('utf8').trimStart().toLowerCase();
  if (textPrefix.startsWith('<!doctype html') || textPrefix.startsWith('<html')
    || textPrefix.startsWith('{') || textPrefix.startsWith('[')
    || textPrefix.startsWith('#extm3u') || textPrefix.startsWith('access denied')) {
    return false;
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return false;
  }

  // MPEG-TS normally uses 188-byte packets. Some transport streams use
  // 192-byte M2TS packets or prepend a short ID3 block.
  for (let offset = 0; offset < Math.min(32, bytes.length); offset += 1) {
    for (const packetSize of [188, 192]) {
      if (bytes[offset] !== 0x47 || bytes[offset + packetSize] !== 0x47) continue;
      if (packetSize === 192 || offset + packetSize * 2 >= bytes.length
        || bytes[offset + packetSize * 2] === 0x47) return true;
    }
  }

  // Fragmented MP4 segments start with an ISO BMFF box, not an arbitrary
  // byte sequence that happens to contain a box-like marker later on.
  if (bytes.length >= 8) {
    const boxLength = bytes.readUInt32BE(0);
    const boxType = bytes.toString('ascii', 4, 8);
    if (boxLength >= 8 && ['ftyp', 'styp', 'moof', 'moov', 'sidx', 'emsg'].includes(boxType)) {
      return true;
    }
  }

  // Some HLS playlists carry standalone AAC/MP3 audio segments.
  if (bytes[0] === 0x49 && bytes.toString('ascii', 0, 3) === 'ID3') return true;
  return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

export function rewriteHlsManifest(manifest, manifestUrl, { mode = 'direct', proxyUrl } = {}) {
  const lines = `${manifest || ''}`.split(/\r?\n/);
  const rewrite = value => {
    const absolute = toAbsoluteUrl(value, manifestUrl);
    if (!absolute) return value;
    return mode === 'proxy' && typeof proxyUrl === 'function' ? proxyUrl(absolute) : absolute;
  };
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return line.replace(/(URI\s*=\s*["'])([^"']+)(["'])/gi, (_match, prefix, value, suffix) => (
        `${prefix}${rewrite(value)}${suffix}`
      ));
    }
    return rewrite(trimmed);
  }).join('\n');
}

export function encodeProxyTarget(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}

export function decodeProxyTarget(value) {
  try {
    return Buffer.from(`${value || ''}`, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}

function addResolved(set, value, baseUrl) {
  const url = toAbsoluteUrl(value, baseUrl);
  if (url) set.add(url);
}

function toAbsoluteUrl(value, baseUrl) {
  try {
    const url = new URL(`${value || ''}`, baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
