import {
  classifySample,
  classifyUrl,
  maskHost,
  redactUrl,
  toSafeUrl,
} from './embedtv-probe-http.mjs';

export async function probeCandidate(client, candidate, pageUrl) {
  const variants = buildHeaderVariants(client, pageUrl, candidate.headerContext);
  const attempts = [];
  let resolved;
  for (const variant of variants) {
    const result = await client.request(candidate.url, {
      headers: variant.headers,
      includeCookies: variant.includeCookies,
      read: 'text',
    });
    const hls = result.text ? parseHlsManifest(result.text, result.url) : undefined;
    attempts.push(publicResult(result, {
      variant: variant.name,
      url: candidate.url,
      hls,
      responseBodyKind: classifyBody(result.text, result.contentType),
    }));
    if (!resolved && result.status >= 200 && result.status < 300 && hls?.valid) {
      resolved = { ...result, hls, method: candidate.method };
    }
  }
  const head = await client.request(candidate.url, {
    method: 'HEAD',
    headers: variants.at(-1).headers,
    includeCookies: variants.at(-1).includeCookies,
  });
  return {
    report: {
      method: candidate.method,
      url: redactUrl(candidate.url),
      host: maskHost(new URL(candidate.url).hostname),
      kind: candidate.kind,
      fallback: Boolean(candidate.fallback),
      resolved: Boolean(resolved),
      requiredHeaders: resolved ? attempts.find(attempt => attempt.hls?.valid)?.variant : null,
      attempts,
      head: publicResult(head, { variant: 'browser-like', url: candidate.url }),
    },
    resolved,
  };
}

export async function probeHlsResources(client, resolved, pageUrl) {
  const manifest = resolved.hls;
  const variantRef = manifest.references.find(reference => reference.role === 'variant');
  const directSegmentRef = manifest.references.find(reference => reference.role === 'segment');
  let child;
  let childManifest;
  if (variantRef) {
    child = await probeResource(client, variantRef.url, pageUrl, 'child-playlist');
    if (child.hls?.valid) childManifest = child.hls;
  }
  const segmentRef = childManifest?.references.find(reference => reference.role === 'segment') || directSegmentRef;
  const segment = segmentRef ? await probeSegment(client, segmentRef.url, pageUrl) : undefined;
  return {
    manifest: {
      valid: manifest.valid,
      type: manifest.type,
      absoluteReferences: manifest.absoluteReferences,
      relativeReferences: manifest.relativeReferences,
      references: manifest.references.slice(0, 8).map(publicReference),
      contentType: resolved.contentType,
    },
    childPlaylist: child,
    segment,
  };
}

export function analyzePage(html, pageUrl) {
  const candidates = [];
  const add = (method, value, fallback = false) => {
    const url = toSafeUrl(value, pageUrl);
    if (!url || classifyUrl(url) === 'unknown') return;
    candidates.push({ method, url, kind: classifyUrl(url), fallback });
  };
  collectMatches(html, /startPlayer\s*\(\s*["']([^"']+)["']/gi, value => add('startPlayer-literal', value));
  collectMatches(html, /data-stream\s*=\s*["']([^"']+)["']/gi, value => add('data-stream', value));
  collectMatches(html, /(?:src|file|url)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi, (value, match) => {
    const prefix = html.slice(Math.max(0, match.index - 32), match.index);
    const fallback = /\bvar\s+$/i.test(prefix);
    add(fallback ? 'page-static-var' : 'page-url-assignment', value, fallback);
  });
  collectMatches(html, /https?:\/\/[^\s"'<>]+?\.(?:m3u8|txt)(?:\?[^\s"'<>]*)?/gi, value => add('page-hls-url', value));
  return {
    candidates,
    markers: {
      startPlayerLiteral: countMatches(html, /startPlayer\s*\(\s*["']/gi),
      startPlayerDynamic: countMatches(html, /startPlayer\s*\(\s*(?:data\.)?(?:url|stream|src)\s*\)/gi),
      dataStream: countMatches(html, /data-stream\s*=/gi),
      txtUrls: countMatches(html, /\.txt(?:\?|["'\s])/gi),
      m3u8Urls: countMatches(html, /\.m3u8(?:\?|["'\s])/gi),
      tokenEndpoint: countMatches(html, /cloudflaire|\/get_token/gi),
      fetch: countMatches(html, /\bfetch\s*\(/gi),
      xhr: countMatches(html, /XMLHttpRequest/gi),
      hlsLoadSource: countMatches(html, /(?:hls\.loadSource|loadSource)\s*\(/gi),
    },
  };
}

export function parseHlsManifest(text, baseUrl) {
  const value = `${text || ''}`;
  const valid = /^\s*#EXTM3U(?:\s|$)/i.test(value);
  if (!valid) return { valid: false, type: 'not-hls', references: [], absoluteReferences: 0, relativeReferences: 0 };
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const master = /#EXT-X-STREAM-INF/i.test(value) || /#EXT-X-I-FRAME-STREAM-INF/i.test(value);
  const references = [];
  let nextIsVariant = false;
  for (const line of lines) {
    if (/^#EXT-X-STREAM-INF/i.test(line)) nextIsVariant = true;
    for (const match of line.matchAll(/\bURI\s*=\s*["']([^"']+)["']/gi)) {
      addReference(references, match[1], baseUrl, 'tag-uri');
    }
    if (!line.startsWith('#')) {
      addReference(references, line, baseUrl, nextIsVariant ? 'variant' : 'segment');
      nextIsVariant = false;
    }
  }
  return {
    valid: true,
    type: master ? 'master' : 'media',
    references,
    absoluteReferences: references.filter(reference => reference.absolute).length,
    relativeReferences: references.filter(reference => !reference.absolute).length,
  };
}

function buildHeaderVariants(client, pageUrl, context = 'current') {
  const page = new URL(pageUrl);
  const refererUrl = context === 'legacy' ? `${client.baseUrl}/` : page.href;
  const originUrl = context === 'legacy' ? client.baseUrl : page.origin;
  return [
    { name: 'none', headers: {}, includeCookies: false },
    { name: 'user-agent', headers: { 'User-Agent': client.userAgent }, includeCookies: false },
    { name: 'user-agent+referer', headers: { 'User-Agent': client.userAgent, Referer: refererUrl }, includeCookies: false },
    {
      name: 'user-agent+referer+origin',
      headers: {
        Accept: '*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': client.userAgent,
        Referer: refererUrl,
        Origin: originUrl,
      },
      includeCookies: true,
    },
  ];
}

async function probeResource(client, url, pageUrl, role) {
  const variants = buildHeaderVariants(client, pageUrl)
      .filter(variant => ['none', 'user-agent+referer+origin'].includes(variant.name));
  const attempts = [];
  let hls;
  for (const variant of variants) {
    const result = await client.request(url, {
      headers: variant.headers,
      includeCookies: variant.includeCookies,
      read: 'text',
    });
    const parsed = result.text ? parseHlsManifest(result.text, result.url) : undefined;
    if (!hls && parsed?.valid) hls = parsed;
    attempts.push(publicResult(result, {
      variant: variant.name,
      url,
      hls: parsed,
      responseBodyKind: classifyBody(result.text, result.contentType),
    }));
  }
  return {
    role,
    url: redactUrl(url),
    host: maskHost(new URL(url).hostname),
    resolved: Boolean(hls),
    attempts,
    hls: hls ? {
      valid: hls.valid,
      type: hls.type,
      absoluteReferences: hls.absoluteReferences,
      relativeReferences: hls.relativeReferences,
      references: hls.references.slice(0, 8).map(publicReference),
    } : undefined,
  };
}

async function probeSegment(client, url, pageUrl) {
  const variants = buildHeaderVariants(client, pageUrl)
      .filter(variant => ['none', 'user-agent+referer+origin'].includes(variant.name));
  const attempts = [];
  for (const variant of variants) {
    const result = await client.request(url, {
      headers: { ...variant.headers, Range: 'bytes=0-1023' },
      includeCookies: variant.includeCookies,
      read: 'sample',
    });
    attempts.push(publicResult(result, { variant: variant.name, url }));
  }
  return {
    url: redactUrl(url),
    host: maskHost(new URL(url).hostname),
    range: 'bytes=0-1023',
    attempts,
    fullBodyDownloaded: false,
  };
}

function publicResult(result, { variant, url, hls, responseBodyKind } = {}) {
  return {
    variant,
    requestUrl: redactUrl(url),
    status: result.status,
    durationMs: result.durationMs,
    finalUrl: redactUrl(result.url),
    redirected: Boolean(result.redirected),
    contentType: result.contentType,
    contentLength: result.contentLength,
    setCookieNames: result.setCookieNames,
    request: result.request,
    responseBodyKind,
    hls: hls ? {
      valid: hls.valid,
      type: hls.type,
      absoluteReferences: hls.absoluteReferences,
      relativeReferences: hls.relativeReferences,
    } : undefined,
    sampleBytes: result.sampleBytes,
    sampleSignature: result.sampleHex ? classifySample(result.sampleHex) : undefined,
    rangeHonored: result.status === 206,
    error: result.error,
  };
}

function classifyBody(text, contentType) {
  if (/mpegurl/i.test(`${contentType}`) || /^\s*#EXTM3U/i.test(`${text || ''}`)) return 'hls';
  if (text && /https?:\/\/.*\.(?:m3u8|txt)/i.test(text)) return 'manifest-pointer';
  return contentType || 'empty';
}

function addReference(references, value, baseUrl, role) {
  const url = toSafeUrl(value, baseUrl);
  if (!url || references.some(reference => reference.url === url)) return;
  references.push({ url, role, absolute: /^https?:\/\//i.test(value) });
}

function publicReference(reference) {
  return { url: redactUrl(reference.url), role: reference.role, absolute: reference.absolute };
}

function collectMatches(text, regex, callback) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text))) callback(match[1] || match[0], match);
}

function countMatches(text, regex) {
  return [...`${text}`.matchAll(regex)].length;
}

export function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter(candidate => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}
