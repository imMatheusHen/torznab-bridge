#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isIP } from 'node:net';

const args = parseArgs(process.argv.slice(2));
const bridgeUrl = normalizeBridgeUrl(args.bridgeUrl);
const channelId = args.channelId;
const runs = parseInteger(args.runs, 6, 1, 20, '--runs');
const rangeBytes = parseInteger(args.rangeBytes, 65_536, 384, 1_048_576, '--range-bytes');
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(channelId || '')) {
  throw new Error('--channel-id must be a valid EmbedTV channel id');
}

const resolved = await findProxiedMediaResource(bridgeUrl, channelId);
const samples = [];
for (let index = 0; index < runs; index += 1) {
  const order = index % 2 === 0 ? ['origin', 'proxy'] : ['proxy', 'origin'];
  for (const route of order) {
    samples.push(await measure(route === 'origin' ? resolved.originUrl : resolved.proxyUrl, route, rangeBytes));
  }
}

const origin = summarize(samples.filter(sample => sample.route === 'origin'));
const proxy = summarize(samples.filter(sample => sample.route === 'proxy'));
console.log(JSON.stringify({
  channelId,
  originHost: new URL(resolved.originUrl).hostname,
  resourceExtension: extensionOf(resolved.originUrl),
  range: `bytes=0-${rangeBytes - 1}`,
  manifestStatus: resolved.manifestStatus,
  origin,
  proxy,
  pairwisePayloadsMatch: samples.filter(sample => sample.route === 'origin')
      .every((sample, index) => sample.sha256 === samples.filter(item => item.route === 'proxy')[index]?.sha256),
}, null, 2));

async function findProxiedMediaResource(baseUrl, id) {
  let currentManifest = new URL(`/iptv/embedtv/channel/${encodeURIComponent(id)}/index.m3u8`, baseUrl);
  let manifestStatus;
  for (let depth = 0; depth < 4; depth += 1) {
    const response = await fetchWithTimeout(currentManifest);
    manifestStatus = response.status;
    if (!response.ok) throw new Error(`manifest request failed with HTTP ${response.status}`);
    const text = await response.text();
    if (!/^\s*#EXTM3U(?:\s|$)/i.test(text)) throw new Error('bridge did not return an HLS manifest');
    const resource = text.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
    if (!resource) throw new Error('manifest contains no media resource');
    const proxyUrl = new URL(resource, currentManifest);
    const encodedTarget = proxyUrl.searchParams.get('u');
    if (!encodedTarget || !proxyUrl.pathname.includes('/hls')) {
      throw new Error('bridge manifest is not using the HLS proxy; start it with TORZNAB_EMBEDTV_HLS_PROXY=1');
    }
    const originUrl = new URL(Buffer.from(encodedTarget, 'base64url').toString('utf8'));
    if (!isSafeBenchmarkUrl(originUrl)) throw new Error('manifest resolved to an unsafe origin URL');
    if (isManifestUrl(originUrl)) {
      currentManifest = proxyUrl;
      continue;
    }
    return { originUrl, proxyUrl, manifestStatus };
  }
  throw new Error('manifest nesting exceeded the 4-playlist benchmark limit');
}

async function measure(url, route, limit) {
  const startedAt = performance.now();
  const response = await fetchWithTimeout(url, { headers: { Range: `bytes=0-${limit - 1}` } });
  const headersAt = performance.now();
  const prefix = await readBoundedPrefix(response, limit);
  const completedAt = performance.now();
  return {
    route,
    status: response.status,
    bytes: prefix.length,
    headersMs: headersAt - startedAt,
    completeMs: completedAt - startedAt,
    contentType: response.headers.get('content-type'),
    contentRange: response.headers.get('content-range'),
    sha256: createHash('sha256').update(prefix).digest('hex'),
  };
}

async function readBoundedPrefix(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;
  try {
    while (total < limit) {
      const result = await reader.read();
      if (result.done) {
        done = true;
        break;
      }
      const chunk = Buffer.from(result.value).subarray(0, limit - total);
      chunks.push(chunk);
      total += chunk.length;
      if (chunk.length === 0 || total === limit) break;
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (!done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
}

function summarize(rows) {
  const median = key => {
    const values = rows.map(row => row[key]).sort((left, right) => left - right);
    const middle = Math.floor(values.length / 2);
    return Number((values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2).toFixed(1));
  };
  return {
    samples: rows.length,
    statuses: rows.map(row => row.status),
    bytes: rows.map(row => row.bytes),
    medianHeadersMs: median('headersMs'),
    medianCompleteMs: median('completeMs'),
    contentType: rows[0]?.contentType,
    contentRange: rows[0]?.contentRange,
    identicalPayloads: rows.every(row => row.sha256 === rows[0]?.sha256),
  };
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] == null) throw new Error('Expected --option value pairs');
    result[key.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = values[index + 1];
  }
  if (!result.bridgeUrl || !result.channelId) throw new Error('Usage: node tools/embedtv-proxy-benchmark.mjs --bridge-url http://127.0.0.1:19701 --channel-id ae [--runs 6] [--range-bytes 65536]');
  return result;
}

function normalizeBridgeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('--bridge-url must be an HTTP(S) URL without user information');
  }
  return url.toString().replace(/\/$/, '');
}

function parseInteger(value, fallback, min, max, name) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function isManifestUrl(url) {
  return /\.(?:m3u8|txt)$/i.test(url.pathname);
}

function extensionOf(value) {
  return new URL(value).pathname.split('.').pop()?.toLowerCase() || '';
}


function isSafeBenchmarkUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === 'localhost.localdomain') return false;
    const version = isIP(host);
    if (version === 4) {
      const [first, second] = host.split('.').map(Number);
      return first !== 0 && first !== 10 && first !== 127
        && !(first === 100 && second >= 64 && second <= 127)
        && !(first === 169 && second === 254)
        && !(first === 172 && second >= 16 && second <= 31)
        && !(first === 192 && second === 168)
        && !(first === 198 && (second === 18 || second === 19));
    }
    if (version === 6) {
      return host !== '::1' && !host.startsWith('fc') && !host.startsWith('fd')
        && !/^fe[89ab]/i.test(host);
    }
    return true;
  } catch {
    return false;
  }
}
