#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import {
  ProbeClient,
  maskHost,
  redactUrl,
} from './embedtv-probe-http.mjs';
import {
  analyzePage,
  dedupeCandidates,
  probeCandidate,
  probeHlsResources,
} from './embedtv-probe-hls.mjs';

const DEFAULT_BASE_URL = 'https://embedtv.lat';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CHANNEL_LIMIT = 5;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = new ProbeClient(options);
  const api = await fetchChannels(client);
  const selectedChannels = selectChannels(api, options);
  const legacy = await fetchLegacyMap(client, options);
  const channels = [];
  for (const channel of selectedChannels) {
    channels.push(await probeChannel(client, channel, legacy, options));
  }

  console.log(JSON.stringify({
    tool: 'embedtv-probe',
    generatedAt: new Date().toISOString(),
    configuration: {
      baseUrl: client.baseUrl,
      timeoutMs: options.timeoutMs,
      userAgent: client.userAgent,
      channelLimit: options.limit,
      noFullStreams: true,
    },
    api: {
      endpoint: `${client.baseUrl}/api/channels`,
      status: api.status,
      contentType: api.contentType,
      channelCount: api.channels.length,
      categoryCount: api.categories.length,
      categories: api.categories.map(category => ({ id: category.id, name: category.name })),
    },
    legacy24hChaves: legacy.report,
    channels,
    conclusion: conclude(channels),
  }, null, 2));
}

async function fetchChannels(client) {
  const result = await client.request(`${client.baseUrl}/api/channels`, {
    headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': client.userAgent },
    read: 'text',
  });
  if (!result.ok || !result.text) {
    throw new Error(`API channels falhou: HTTP ${result.status || result.error || 'unknown'}`);
  }
  let payload;
  try {
    payload = JSON.parse(result.text);
  } catch (error) {
    throw new Error(`API channels retornou JSON inválido: ${error.message}`);
  }
  return {
    ...result,
    categories: Array.isArray(payload.categories) ? payload.categories.map(normalizeCategory).filter(Boolean) : [],
    channels: Array.isArray(payload.channels) ? payload.channels.map(normalizeChannel).filter(Boolean) : [],
  };
}

async function fetchLegacyMap(client, options) {
  const url = `${client.baseUrl}${options.legacyPath}`;
  const response = await client.request(url, {
    headers: {
      Accept: 'text/plain, text/html, */*',
      'User-Agent': client.userAgent,
      Referer: `${client.baseUrl}/`,
    },
    read: 'text',
  });
  const hash = response.text ? extractLegacyHash(response.text) : undefined;
  return {
    hash,
    report: {
      endpoint: url,
      status: response.status,
      contentType: response.contentType,
      durationMs: response.durationMs,
      hashFound: Boolean(hash),
      hashHost: hash ? maskHost(`${hash}.s21-cloudfront-net.lat`) : undefined,
      regex: '/https:\/\/([a-f0-9]{20,})\\.s21-cloudfront-net\\.lat/i',
      cacheModel: {
        hashTtlSeconds: 60,
        backgroundRefreshSeconds: 300,
        refreshOnStatus: [403, 404, 410],
      },
      request: response.request,
      setCookieNames: response.setCookieNames,
      error: response.error,
    },
  };
}

async function probeChannel(client, channel, legacy, options) {
  const startedAt = performance.now();
  const page = await client.request(channel.pageUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': client.userAgent,
      Referer: `${client.baseUrl}/`,
      Origin: client.baseUrl,
    },
    read: 'text',
  });
  const pageAnalysis = page.ok && page.text ? analyzePage(page.text, channel.pageUrl) : emptyPageAnalysis();
  const candidates = [...pageAnalysis.candidates];
  if (legacy.hash) {
    candidates.unshift({
      method: 'legacy-24h_chaves',
      url: `https://${legacy.hash}.s21-cloudfront-net.lat/ss/${channel.id}.txt`,
      kind: 'txt',
      headerContext: 'legacy',
    });
  }

  const candidateReports = [];
  const resolvedCandidates = [];
  for (const candidate of dedupeCandidates(candidates).slice(0, options.maxCandidates)) {
    const probed = await probeCandidate(client, candidate, channel.pageUrl);
    candidateReports.push(probed.report);
    if (probed.resolved) resolvedCandidates.push(probed.resolved);
  }

  const legacyAttempt = candidateReports.find(candidate => candidate.method === 'legacy-24h_chaves');
  let legacyRefresh;
  if (legacyAttempt && legacy.hash && legacyAttempt.attempts.some(attempt => attempt.status >= 400)) {
    const refreshed = await fetchLegacyMap(client, options);
    legacyRefresh = refreshed.report;
    if (refreshed.hash) {
      const retry = await probeCandidate(client, {
        method: 'legacy-24h_chaves-refresh',
        url: `https://${refreshed.hash}.s21-cloudfront-net.lat/ss/${channel.id}.txt`,
        kind: 'txt',
        headerContext: 'legacy',
      }, channel.pageUrl);
      candidateReports.push(retry.report);
      if (retry.resolved) resolvedCandidates.push(retry.resolved);
    }
  }

  const resolved = resolvedCandidates[0];
  const resources = resolved ? await probeHlsResources(client, resolved, channel.pageUrl) : undefined;
  const currentResolved = resolvedCandidates.find(item => !item.method.startsWith('legacy-24h_chaves'));
  const legacyResolved = resolvedCandidates.find(item => item.method.startsWith('legacy-24h_chaves'));
  return {
    id: channel.id,
    name: channel.name,
    category: channel.category,
    page: {
      status: page.status,
      url: redactUrl(channel.pageUrl),
      finalUrl: redactUrl(page.url),
      contentType: page.contentType,
      durationMs: page.durationMs,
      setCookieNames: page.setCookieNames,
      error: page.error,
      markers: pageAnalysis.markers,
    },
    methodResolved: resolved?.method || null,
    resolvedUrl: resolved ? redactUrl(resolved.url) : null,
    resolvedHost: resolved ? maskHost(new URL(resolved.url).hostname) : null,
    methodComparison: {
      legacy: legacyResolved ? redactUrl(legacyResolved.url) : null,
      current: currentResolved ? redactUrl(currentResolved.url) : null,
      sameHost: Boolean(legacyResolved && currentResolved
        && new URL(legacyResolved.url).hostname === new URL(currentResolved.url).hostname),
    },
    legacyRefresh,
    resolutionMs: round(performance.now() - startedAt),
    candidates: candidateReports,
    hlsResources: resources,
  };
}

function selectChannels(api, options) {
  if (options.channelIds.length) {
    const selected = options.channelIds.map(id => api.channels.find(channel => channel.id === id)).filter(Boolean);
    if (selected.length < 5 && !options.allowFewer) {
      throw new Error(`--channels selecionou apenas ${selected.length}; informe pelo menos 5 canais ou use --allow-fewer`);
    }
    return selected.map(channel => ({
      ...channel,
      category: api.categories.find(category => category.id !== 0 && channel.categories.includes(category.id)),
    }));
  }
  const categories = api.categories.filter(category => `${category.id}` !== '0');
  const selected = [];
  for (const category of categories) {
    const channel = api.channels.find(item => item.categories.includes(category.id));
    if (!channel || selected.some(item => item.id === channel.id)) continue;
    selected.push({ ...channel, category: { id: category.id, name: category.name } });
    if (selected.length >= Math.max(5, options.limit)) break;
  }
  if (selected.length < 5) throw new Error(`A API só permitiu selecionar ${selected.length} categorias distintas`);
  return selected.slice(0, options.limit);
}

function normalizeCategory(category) {
  if (!category || category.id == null || !category.name) return undefined;
  return { id: Number.isNaN(Number(category.id)) ? `${category.id}` : Number(category.id), name: `${category.name}` };
}

function normalizeChannel(channel) {
  if (!channel?.id || !channel.url) return undefined;
  return {
    id: `${channel.id}`,
    name: `${channel.name || channel.id}`,
    pageUrl: `${channel.url}`,
    categories: Array.isArray(channel.categories)
      ? channel.categories.map(Number).filter(Number.isFinite)
      : [],
  };
}

function extractLegacyHash(text) {
  const direct = `${text}`.match(/https?:\/\/([a-f0-9]{20,})\.s21-cloudfront-net\.lat/i);
  if (direct?.[1]) return direct[1];
  const raw = `${text}`.match(/\b([a-f0-9]{20,})\b(?=["']?\s*\.s21-cloudfront-net\.lat)/i);
  return raw?.[1];
}

function parseArgs(args) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    legacyPath: '/24h_chaves',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    limit: DEFAULT_CHANNEL_LIMIT,
    maxCandidates: 5,
    userAgent: DEFAULT_USER_AGENT,
    channelIds: [],
    allowFewer: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--base-url') options.baseUrl = next;
    if (arg === '--legacy-path') options.legacyPath = next;
    if (arg === '--timeout-ms') options.timeoutMs = Number(next);
    if (arg === '--limit') options.limit = Number(next);
    if (arg === '--max-candidates') options.maxCandidates = Number(next);
    if (arg === '--user-agent') options.userAgent = next;
    if (arg === '--channels') options.channelIds = `${next}`.split(',').map(value => value.trim()).filter(Boolean);
    if (arg === '--allow-fewer') options.allowFewer = true;
    if (arg.startsWith('--') && next && !next.startsWith('--')) index += 1;
  }
  options.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  options.limit = Number.isFinite(options.limit) ? Math.max(5, options.limit) : DEFAULT_CHANNEL_LIMIT;
  options.maxCandidates = Number.isFinite(options.maxCandidates) ? Math.max(1, options.maxCandidates) : 5;
  options.baseUrl = `${options.baseUrl}`.replace(/\/$/, '');
  return options;
}

function conclude(channels) {
  const resolved = channels.filter(channel => channel.methodResolved);
  const segmentAttempts = channels.flatMap(channel => channel.hlsResources?.segment?.attempts || []);
  const segmentWorks = segmentAttempts.some(attempt => attempt.status >= 200 && attempt.status < 300
    && ['mpeg-ts-sync-byte', 'fmp4-box'].includes(attempt.sampleSignature));
  return {
    resolvedChannels: resolved.length,
    testedChannels: channels.length,
    directSegmentsAppearAccessible: segmentWorks,
    architectureRecommendation: segmentWorks
      ? 'A: resolver/rewrite direto parece suficiente para os segmentos testados.'
      : 'B: não foi possível provar acesso aos segmentos; não habilite proxy de segmentos automaticamente. Obtenha primeiro uma origem HLS legítima.',
    note: 'O probe não baixa streams completas; segmentos usam GET com Range bytes=0-1023 e cancelamento imediato.',
  };
}

function emptyPageAnalysis() {
  return { candidates: [], markers: {} };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

main().catch(error => {
  console.error(`[embedtv-probe] ${error.message}`);
  process.exitCode = 1;
});
