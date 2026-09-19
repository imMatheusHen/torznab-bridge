import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

export const MAX_TEXT_BYTES = 512 * 1024;
export const MAX_SEGMENT_SAMPLE_BYTES = 4096;

export class ProbeClient {
  constructor({ baseUrl, timeoutMs, userAgent }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
    this.cookies = new CookieJar();
  }

  async request(url, {
    method = 'GET',
    headers = {},
    includeCookies = true,
    read = 'none',
    maxBytes = MAX_TEXT_BYTES,
  } = {}) {
    const requestHeaders = { ...headers };
    if (includeCookies && !hasHeader(requestHeaders, 'cookie')) {
      const cookie = this.cookies.get(url);
      if (cookie) requestHeaders.Cookie = cookie;
    }
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(url, { method, headers: requestHeaders, signal: controller.signal });
    } catch (error) {
      return {
        ok: false,
        status: undefined,
        url,
        durationMs: elapsedMs(startedAt),
        error: error.name === 'AbortError' ? 'timeout' : `${error.name}: ${error.message}`,
        request: summarizeHeaders(requestHeaders),
      };
    } finally {
      clearTimeout(timeoutId);
    }

    this.cookies.capture(url, response.headers);
    const result = {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      redirected: response.redirected,
      contentType: response.headers.get('content-type') || undefined,
      contentLength: response.headers.get('content-length') || undefined,
      setCookieNames: getSetCookieNames(response.headers),
      durationMs: elapsedMs(startedAt),
      request: summarizeHeaders(requestHeaders),
    };
    if (read === 'text') return { ...result, ...(await readLimitedText(response, maxBytes)) };
    if (read === 'sample') return { ...result, ...(await readFirstChunk(response, MAX_SEGMENT_SAMPLE_BYTES)) };
    return result;
  }
}

class CookieJar {
  constructor() {
    this.entries = [];
  }

  capture(url, headers) {
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : splitSetCookie(headers.get('set-cookie'));
    for (const value of values) {
      const parsed = parseSetCookie(value, url);
      if (!parsed) continue;
      this.entries = this.entries.filter(item => item.name !== parsed.name || item.domain !== parsed.domain);
      this.entries.push(parsed);
    }
  }

  get(url) {
    const target = new URL(url);
    return this.entries
      .filter(item => domainMatches(target.hostname, item.domain))
      .filter(item => target.pathname.startsWith(item.path))
      .map(item => `${item.name}=${item.value}`)
      .join('; ');
  }
}

export function toSafeUrl(value, baseUrl) {
  try {
    const url = new URL(`${value}`.trim().replace(/[),;]+$/, ''), baseUrl);
    if (url.protocol !== 'https:' || isPrivateHost(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function classifyUrl(url) {
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith('.m3u8') ? 'm3u8' : path.endsWith('.txt') ? 'txt' : 'unknown';
}

export function redactUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    const query = [...url.searchParams.keys()]
        .map(key => `${encodeURIComponent(key)}=<redacted>`)
        .join('&');
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${maskHost(url.hostname)}${port}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return '<invalid-url>';
  }
}

export function maskHost(host) {
  return `${host}`.replace(/[a-f0-9]{12,}/gi, value => `${value.slice(0, 6)}…`);
}

export function summarizeHeaders(headers) {
  const get = name => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return {
    userAgent: get('user-agent') || undefined,
    refererHost: hostOnly(get('referer')),
    originHost: hostOnly(get('origin')),
    cookiePresent: Boolean(get('cookie')),
    range: get('range') || undefined,
  };
}

export function classifySample(hex) {
  if (hex.startsWith('47')) return 'mpeg-ts-sync-byte';
  if (hex.includes('66747970') || hex.includes('6d6f6f66')) return 'fmp4-box';
  if (hex.startsWith('3c21444f4354595045') || hex.startsWith('3c68746d6c')) return 'html';
  return 'unknown-binary';
}

function isPrivateHost(host) {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  const version = isIP(normalized);
  if (version === 4) {
    const [first, second] = normalized.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  }
  return version === 6 && (normalized === '::1' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || /^fe[89ab]/i.test(normalized));
}

function hasHeader(headers, name) {
  return Object.keys(headers).some(key => key.toLowerCase() === name.toLowerCase());
}

function hostOnly(value) {
  try {
    return value ? maskHost(new URL(value).hostname) : undefined;
  } catch {
    return undefined;
  }
}

function getSetCookieNames(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : splitSetCookie(headers.get('set-cookie'));
  return values.map(value => value.split('=', 1)[0].trim()).filter(Boolean);
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=]+=[^;,]*)/);
}

function parseSetCookie(value, sourceUrl) {
  const [pair, ...attributes] = `${value}`.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) return undefined;
  const source = new URL(sourceUrl);
  const item = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: source.hostname.toLowerCase(),
    path: '/',
  };
  for (const attribute of attributes) {
    const [key, rawValue] = attribute.trim().split('=');
    if (key?.toLowerCase() === 'domain' && rawValue) item.domain = rawValue.replace(/^\./, '').toLowerCase();
    if (key?.toLowerCase() === 'path' && rawValue) item.path = rawValue;
  }
  return item;
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) return { text: '', bytesRead: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytesRead = 0;
  let truncated = false;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      bytesRead += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytesRead, truncated };
}

async function readFirstChunk(response, maxBytes) {
  if (!response.body) return { sampleBytes: 0, sampleHex: '' };
  const reader = response.body.getReader();
  try {
    const { value } = await reader.read();
    const chunk = value ? value.subarray(0, maxBytes) : new Uint8Array();
    return { sampleBytes: chunk.byteLength, sampleHex: Buffer.from(chunk).toString('hex').slice(0, 32) };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function elapsedMs(startedAt) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}
