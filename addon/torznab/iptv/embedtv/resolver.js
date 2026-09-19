import { EmbedTvError, isSafeUpstreamUrl } from './client.js';

const GENERIC_FALLBACK_HOSTS = new Set(['live-chunks.mediacdn.net']);

export function extractStreamCandidates(html, { pageUrl } = {}) {
  const source = decodeHtml(`${html || ''}`)
      .replace(/\\u0026/gi, '&')
      .replace(/\\\//g, '/');
  const raw = [];
  const patterns = [
    { regex: /startPlayer\s*\(\s*["']([^"']+)["']/gi, allowUnknown: true },
    { regex: /data-stream\s*=\s*["']([^"']+)["']/gi, allowUnknown: true },
    { regex: /\bstream\s*:\s*["']([^"']+)["']/gi, allowUnknown: true },
    { regex: /(?:src|file|url)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi },
    { regex: /https?:\/\/[^\s"'<>]+?\.(?:m3u8|txt)(?:\?[^\s"'<>]*)?/gi },
  ];
  for (const { regex, allowUnknown = false } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source))) {
      const value = match[1] || match[0];
      const prefix = source.slice(Math.max(0, match.index - 32), match.index);
      const isStaticVariable =
        /^src\s*[:=]/i.test(match[0]) && /\bvar\s+$/i.test(prefix);
      raw.push({
        value,
        allowUnknown,
        fallback: isStaticVariable,
      });
    }
  }

  const candidates = [];
  const seen = new Set();
  for (const entry of raw) {
    const url = toAbsoluteUrl(cleanCandidate(entry.value), pageUrl);
    if (!url || !isSafeUpstreamUrl(url) || seen.has(url)) continue;
    const kind = classifyStreamUrl(url);
    if (kind === 'unknown' && !entry.allowUnknown) continue;
    seen.add(url);
    candidates.push({
      url,
      kind,
      genericFallback: isGenericFallback(url),
      fallback: entry.fallback,
    });
  }

  const specific = candidates.filter(candidate => !candidate.genericFallback);
  return (specific.length ? specific : candidates).sort(compareCandidates);
}

export function selectStreamCandidate(candidates = [], { excludeFallback = false } = {}) {
  const pool = excludeFallback
    ? candidates.filter(candidate => !candidate.fallback && !candidate.genericFallback)
    : candidates;
  return [...pool].sort(compareCandidates)[0];
}

export function classifyStreamUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.m3u8')) return 'm3u8';
  if (pathname.endsWith('.txt')) return 'txt';
  return 'unknown';
}

export async function resolveChannelPage(channel, client) {
  if (!channel?.pageUrl) {
    throw new EmbedTvError('Canal EmbedTV não possui página de origem', { code: 'missing_channel_url' });
  }
  const html = await client.fetchChannelPage(channel.pageUrl);
  const candidates = extractStreamCandidates(html, { pageUrl: channel.pageUrl });
  const browserChallenge = isBrowserChallengeFlow(html);
  // Some current pages keep the protected dynamic flow but also publish a
  // static HLS source (`var src = ...txt`). It is part of the public HTML,
  // not an authentication bypass, so it remains usable. Only discard generic
  // candidates when the challenge is the only flow available.
  const selectableCandidates = browserChallenge
    ? candidates.filter(candidate => !candidate.genericFallback)
    : candidates;
  const selected = selectStreamCandidate(selectableCandidates);
  if (!selected) {
    throw new EmbedTvError(browserChallenge
      ? 'EmbedTV exige a execução pública do Turnstile para gerar a origem do stream'
      : 'Nenhuma origem HLS encontrada na página do canal', {
      statusCode: browserChallenge ? 424 : undefined,
      code: browserChallenge ? 'browser_challenge_required' : 'stream_not_found',
      url: channel.pageUrl,
      stage: 'resolve',
    });
  }
  const page = new URL(channel.pageUrl);
  return {
    channelId: channel.id,
    pageUrl: channel.pageUrl,
    streamUrl: selected.url,
    streamKind: selected.kind,
    headers: {
      Referer: page.origin,
      Origin: page.origin,
      'User-Agent': client.userAgent,
    },
    candidates,
    resolvedAt: new Date().toISOString(),
  };
}

export function isBrowserChallengeFlow(html) {
  return /startPlayer\s*\(\s*(?:data\.)?(?:url|stream|src)\s*\)/i.test(`${html || ''}`)
    && /(?:turnstile|cloudflaire|get_token)/i.test(`${html || ''}`);
}

export function extractNestedManifestUrl(text, baseUrl) {
  const trimmed = `${text || ''}`.trim();
  if (!trimmed || trimmed.startsWith('#EXT')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    const value = parsed?.url || parsed?.stream || parsed?.src;
    const url = value ? toAbsoluteUrl(value, baseUrl) : undefined;
    return url && isSafeUpstreamUrl(url) ? url : undefined;
  } catch {
    const line = trimmed.split(/\r?\n/).map(value => value.trim()).find(value => /^(?:https?:\/\/|\/).+\.(?:m3u8|txt)(?:\?.*)?$/i.test(value));
    const url = line ? toAbsoluteUrl(line, baseUrl) : undefined;
    return url && isSafeUpstreamUrl(url) ? url : undefined;
  }
}

export function isHlsBody(text, contentType = '') {
  const normalizedType = `${contentType}`.toLowerCase();
  return normalizedType.includes('mpegurl')
    || /^\s*#EXTM3U(?:\s|$)/i.test(`${text || ''}`)
    || /^\s*#EXT-X-/im.test(`${text || ''}`);
}

function compareCandidates(left, right) {
  const score = candidate => {
    let value = candidate.kind === 'm3u8' ? 40 : candidate.kind === 'txt' ? 30 : 10;
    if (candidate.genericFallback) value -= 100;
    return value;
  };
  return score(right) - score(left);
}

function isGenericFallback(url) {
  try {
    return GENERIC_FALLBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function toAbsoluteUrl(value, pageUrl) {
  const normalized = `${value || ''}`.trim().replace(/[),;]+$/, '');
  if (!normalized) return undefined;
  try {
    return new URL(normalized, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function cleanCandidate(value) {
  return `${value || ''}`
      .replace(/&amp;/gi, '&')
      .replace(/\\["']/g, match => match.slice(1));
}

function decodeHtml(value) {
  return value
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
}
