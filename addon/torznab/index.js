import express from 'express';
import { buildCapsXml, buildErrorXml, buildRssXml } from './xml.js';
import {
  buildReleaseGuid,
  buildMagnetUrl,
  parseReleaseGuid,
  getAdapterConfiguration,
  normalizeEpisodeNumber,
  normalizeImdbId,
  normalizeQueryLimit,
  parseCategories,
  toTorznabItem,
} from './release.js';
import {
  searchReleaseRows as searchReleaseRowsDb,
  closePool,
  getReleaseRowByGuid,
  checkDatabaseHealth,
} from './repository.js';
import {
  checkStremioHealth,
  getStremioRuntimeStatus,
  getStremioReleaseRowByGuid,
  isTemporaryStremioError,
  searchStremioReleaseRows,
} from './stremio.js';
import {
  checkBetorHealth,
  getBetorRuntimeStatus,
  getBetorReleaseRowByGuid,
  isTemporaryBetorError,
  searchBetorReleaseRows,
} from './betor.js';
import {
  searchDetourReleaseRows,
  getDetourReleaseRowByGuid,
  probeDetourProvider,
  getDetourRuntimeStatus,
  isTemporaryDetourError,
  DETOUR_SOURCE,
} from './detour/index.js';
import { buildDetourSearchOptions } from './detour/query.js';
import {
  getSourceMode,
  SOURCE_BETOR,
  SOURCE_DATABASE,
  SOURCE_STREMIO,
  SOURCE_DETOUR,
} from './source.js';
import {
  buildStatusSnapshot,
  recordConfigurationSaved,
  recordDownloadEvent,
  recordSearchEvent,
  recordSourceSearch,
  recordSourceFailure,
  recordSourceSuccess,
} from './monitor.js';
import { renderConfigurePage } from './configurePage.js';
import { getDefaultRuntimeConfiguration, getRuntimeConfigPath, saveRuntimeConfig } from './runtimeConfig.js';
import { createEmbedTvRouter, createEmbedTvService } from './iptv/embedtv/index.js';

const PORT = parseInt(process.env.PORT || process.env.TORZNAB_PORT || '9699', 10);
const BIND_ADDRESS = process.env.TORZNAB_BIND_ADDRESS || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.TORZNAB_BASE_URL || `http://localhost:${PORT}`;
const API_KEY = process.env.TORZNAB_API_KEY;
const LOG_REQUESTS = process.env.TORZNAB_LOG_REQUESTS === '1';
const BETOR_FALLBACK_DELAY_MS = parseInt(process.env.TORZNAB_BETOR_FALLBACK_DELAY_MS || '2500', 10);
const DELIVERED_RELEASE_TTL_MS = parseInt(process.env.TORZNAB_RELEASE_CACHE_TTL_MS || `${60 * 60 * 1000}`, 10);
const SOURCE_HEALTH_PROBE_COOLDOWN_MS = 60 * 1000;
let sourceHealthProbeInFlight;
let lastSourceHealthProbeAt = 0;
let lastSourceHealthProbeKey = '';
const deliveredReleaseCache = new Map();
const embedTvService = createEmbedTvService();

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));

app.use((req, _, next) => {
  if (LOG_REQUESTS) {
    console.log(`${req.method} ${req.originalUrl}`);
  }
  next();
});

app.get('/', renderProviderUi);
app.get('/status', handleStatusRequest);
app.use('/iptv/embedtv', createEmbedTvRouter({
  service: embedTvService,
  isEnabled: isEmbedTvEnabled,
  getBaseUrl: getRequestBaseUrl,
}));

app.get('/health', async (_, res) => {
  const snapshot = await buildRuntimeStatus();
  const response = {
    ok: true,
    dependenciesOk: snapshot.health.dependenciesOk,
    dependencyStatus: snapshot.health.status,
    degraded: snapshot.degraded,
    service: 'torznab-bridge',
    source: getSourceMode(),
    sources: getActiveSources(),
    configuration: process.env.TORZNAB_CONFIGURATION || 'brazuca',
    checks: snapshot.indexers.filter(indexer => indexer.enabled),
    events: snapshot.events,
    betor: snapshot.betor,
    stremio: snapshot.stremio,
    iptv: snapshot.iptv,
    detour: snapshot.detour,
  };

  res.json(response);
});

app.post('/detour/probe/:provider', async (req, res) => {
  try {
    const providerId = req.params.provider;
    const query = req.query.q || 'interestelar';
    const result = await probeDetourProvider(providerId, query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/download/:guid', async (req, res) => {
  try {
    const row = await getReleaseByGuid(req.params.guid);
    if (!row) {
      res.status(404).send('Release not found');
      return;
    }
    if (req.method === 'GET') {
      recordDownloadEvent({ row, requester: buildRequester(req) });
    }
    res.redirect(302, buildMagnetUrl(row));
  } catch (error) {
    console.error('Failed download redirect', error);
    res.status(500).send('Failed to build magnet link');
  }
});

app.get('/details/:guid', async (req, res) => {
  try {
    const row = await getReleaseByGuid(req.params.guid);
    if (!row) {
      res.status(404).send('Release not found');
      return;
    }
    res.type('text/plain').send([
      `Torrent: ${row.torrentTitle}`,
      `File: ${row.fileTitle}`,
      `Provider: ${row.provider}`,
      `InfoHash: ${row.infoHash}`,
      `IMDb: ${row.imdbId || ''}`,
      `Season: ${row.imdbSeason || ''}`,
      `Episode: ${row.imdbEpisode || ''}`,
      `Seeders: ${row.seeders || 0}`,
    ].join('\n'));
  } catch (error) {
    console.error('Failed details request', error);
    res.status(500).send('Failed to load release');
  }
});

app.get('/configure', renderProviderUi);

app.post('/configure', (req, res) => {
  const providers = normalizeProviderSelection(req.body?.providers);
  const sources = normalizeProviderSelection(req.body?.sources);
  const iptv = normalizeIptvSelection(req.body?.iptvEnabled);
  const detour = normalizeDetourSelection(sources.includes(SOURCE_DETOUR), req.body?.detourProviders);
  saveRuntimeConfig({ providers, sources, iptv, detour });
  recordConfigurationSaved({ providers, sources });
  res.redirect(303, '/configure?saved=1');
});

app.get('/api', handleApiRequest);
app.get('/api/', handleApiRequest);

const server = app.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Started Torznab Bridge at: ${PUBLIC_BASE_URL}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function handleApiRequest(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).type('application/xml').send(buildErrorXml(100, 'Missing or invalid API key'));
    return;
  }

  const action = `${req.query.t || ''}`.toLowerCase();
  const baseUrl = getRequestBaseUrl(req);
  let searchStartedAt;

  try {
    if (action === 'caps') {
      res.type('application/xml').send(buildCapsXml(baseUrl));
      return;
    }

    if (!['search', 'tvsearch', 'movie'].includes(action)) {
      res.status(400).type('application/xml').send(buildErrorXml(200, `Unsupported action: ${action || 'empty'}`));
      return;
    }

    searchStartedAt = Date.now();
    const searchOptions = buildSearchOptions(action, req.query);
    const rows = await searchReleaseRows(searchOptions);
    cacheDeliveredRows(rows);
    const items = rows.map(row => toTorznabItem(row, baseUrl));
    const channelTitle = buildChannelTitle(action, req.query);
    res.type('application/xml').send(buildRssXml(channelTitle, items));
    recordSearchEvent({
      action,
      query: req.query,
      count: items.length,
      requester: buildRequester(req),
      releases: rows,
      durationMs: Date.now() - searchStartedAt,
      limit: searchOptions.limit,
      searchBreakdown: rows.searchBreakdown,
    });
  } catch (error) {
    if (searchStartedAt !== undefined) {
      recordSearchEvent({
        action,
        query: req.query,
        count: 0,
        requester: buildRequester(req),
        durationMs: Date.now() - searchStartedAt,
        outcome: 'failure',
      });
    }
    console.error('Torznab Bridge request failed', error);
    res.status(500).type('application/xml').send(buildErrorXml(500, 'Internal adapter error'));
  }
}

async function handleStatusRequest(req, res) {
  const probeDetour = req.query.probe_detour;
  if (probeDetour) {
    const probeResult = await probeDetourProvider(probeDetour, req.query.q || 'interestelar');
    res.json({
      service: 'torznab-bridge',
      probe: probeResult,
      detour: getDetourRuntimeStatus(),
    });
    return;
  }

  const legacyProbe = req.query.probe === '1';
  const snapshot = await buildRuntimeStatus({
    probeSources: legacyProbe || req.query.probe_sources === '1',
    probeIptv: legacyProbe || req.query.probe_iptv === '1',
    probeDetour: legacyProbe,
  });
  res.json({
    service: 'torznab-bridge',
    ok: snapshot.ok,
    degraded: snapshot.degraded,
    health: snapshot.health,
    probe: snapshot.sourceProbe,
    sources: getActiveSources(),
    indexers: snapshot.indexers,
    events: snapshot.events,
    activity: snapshot.activity,
    betor: snapshot.betor,
    stremio: snapshot.stremio,
    iptv: snapshot.iptv,
    detour: snapshot.detour,
  });
}

async function shutdown() {
  server.close(async () => {
    await closePool().catch(error => console.error('Failed closing pool', error));
    process.exit(0);
  });
}

function isAuthorized(req) {
  if (!API_KEY) {
    return true;
  }
  return req.query.apikey === API_KEY || req.headers['x-api-key'] === API_KEY;
}

function getRequestBaseUrl(req) {
  if (process.env.TORZNAB_BASE_URL) {
    return process.env.TORZNAB_BASE_URL;
  }
  return `${req.protocol}://${req.get('host')}`;
}

function buildRequester(req) {
  const forwardedFor = `${req.get('x-forwarded-for') || ''}`.split(',')[0].trim();
  return {
    ip: forwardedFor || req.get('x-real-ip') || req.ip || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
  };
}

function buildSearchOptions(action, query) {
  const adapterConfig = getAdapterConfiguration();
  const providers = (adapterConfig.providers || []).map(provider => provider.toLowerCase());
  const imdbId = normalizeImdbId(query.imdbid);
  const season = normalizeEpisodeNumber(query.season);
  const episode = normalizeEpisodeNumber(query.ep);
  const categories = parseCategories(query.cat);
  const types = action === 'tvsearch' ? ['series', 'anime'] : [];

  return {
    type: action === 'movie' ? 'movie' : undefined,
    types,
    imdbId,
    query: normalizeTextQuery(action, query),
    year: query.year,
    season,
    episode,
    categories,
    providers,
    limit: normalizeQueryLimit(query.limit),
  };
}

async function searchReleaseRows(options) {
  const limit = options.limit || 100;
  const activeSources = getActiveSources();
  const orderedSources = buildEffectiveSourceOrder(activeSources);
  const allowedProviders = buildAllowedProviderSet(options.providers);
  const resultsBySource = new Map();

  let betorRows = [];
  if (orderedSources.includes(SOURCE_BETOR)) {
    betorRows = await searchWithBetorPrimary(options, orderedSources, resultsBySource);
    resultsBySource.set(SOURCE_BETOR, betorRows);
  }

  const remainingSources = orderedSources.filter(source => !resultsBySource.has(source));
  if (remainingSources.length) {
    const detourOptions = buildDetourSearchOptions(options, betorRows);
    const sourceRows = await Promise.all(remainingSources.map(source => {
      if (source === SOURCE_DETOUR && !detourOptions) {
        console.info('[search:detour] Busca ignorada: não foi possível resolver um título textual confiável.');
        return [];
      }
      return searchSourceRowsTolerantly(
        source,
        source === SOURCE_DETOUR ? detourOptions : options,
      );
    }));
    sourceRows.forEach((rows, index) => {
      resultsBySource.set(remainingSources[index], rows);
    });
  }

  return mergeRowsInSourceOrder(orderedSources, resultsBySource, limit, allowedProviders);
}

function normalizeTextQuery(action, query) {
  if (action === 'movie' || action === 'search') {
    return `${query.q || ''}`.trim() || undefined;
  }

  const parts = [`${query.q || ''}`.trim()];
  if (query.season) {
    const season = `${query.season}`.padStart(2, '0');
    if (query.ep) {
      const episode = `${query.ep}`.padStart(2, '0');
      parts.push(`S${season}E${episode}`);
    } else {
      parts.push(`S${season}`);
    }
  }
  return parts.filter(Boolean).join(' ').trim() || undefined;
}

function buildChannelTitle(action, query) {
  if (action === 'tvsearch') {
    return `Torznab Bridge TV Search: ${query.q || query.imdbid || 'all'}`;
  }
  if (action === 'movie') {
    return `Torznab Bridge Movie Search: ${query.q || query.imdbid || 'all'}`;
  }
  return `Torznab Bridge Search: ${query.q || query.imdbid || 'all'}`;
}

async function getReleaseByGuid(guid) {
  const parsedGuid = parseReleaseGuid(guid);
  const deliveredRow = getDeliveredRelease(parsedGuid);
  if (deliveredRow) {
    return deliveredRow;
  }
  const row = await getReleaseBySourceGuid(parsedGuid);
  const allowedProviders = buildAllowedProviderSet(getAdapterConfiguration().providers);
  if (!row) {
    return undefined;
  }
  if (parsedGuid.source === SOURCE_BETOR || parsedGuid.source === SOURCE_DETOUR) {
    return row;
  }
  if (allowedProviders.size && !allowedProviders.has(normalizeProviderName(row.provider))) {
    return undefined;
  }
  return row;
}

function cacheDeliveredRows(rows) {
  pruneDeliveredReleaseCache();
  const expiresAt = Date.now() + DELIVERED_RELEASE_TTL_MS;
  rows.forEach(row => {
    const guid = buildReleaseGuid(row._source, row.infoHash?.toLowerCase(), row.fileIndex || 0);
    deliveredReleaseCache.set(guid, { row, expiresAt });
  });
}

function getDeliveredRelease(parsedGuid) {
  pruneDeliveredReleaseCache();
  const guid = buildReleaseGuid(
      parsedGuid.source,
      parsedGuid.infoHash?.toLowerCase(),
      parsedGuid.fileIndex,
  );
  return deliveredReleaseCache.get(guid)?.row;
}

function pruneDeliveredReleaseCache() {
  const now = Date.now();
  for (const [guid, entry] of deliveredReleaseCache.entries()) {
    if (entry.expiresAt <= now) {
      deliveredReleaseCache.delete(guid);
    }
  }
}

async function getDatabaseReleaseByGuid(guid) {
  const { infoHash, fileIndex } = parseReleaseGuid(guid);
  return getReleaseRowByGuid(infoHash, fileIndex);
}

function normalizeProviderSelection(rawProviders) {
  if (Array.isArray(rawProviders)) {
    return rawProviders;
  }
  if (typeof rawProviders === 'string' && rawProviders.length > 0) {
    return [rawProviders];
  }
  return [];
}

function normalizeIptvSelection(rawValue) {
  return { enabled: rawValue === '1' || rawValue === true };
}

function normalizeDetourSelection(rawEnabled, rawProviders) {
  return {
    enabled: rawEnabled === '1' || rawEnabled === true,
    providers: normalizeProviderSelection(rawProviders),
  };
}

function buildAllowedProviderSet(providers = []) {
  const normalizedProviders = Array.isArray(providers)
    ? providers.map(normalizeProviderName).filter(Boolean)
    : [];

  return new Set(normalizedProviders);
}

function renderProviderUi(req, res) {
  const adapterConfig = getAdapterConfiguration();
  res.type('html').send(renderConfigurePage({
    selectedProviders: adapterConfig.providers || [],
    selectedSources: getConfiguredSourcesForUi(adapterConfig),
    iptvEnabled: adapterConfig.iptv?.enabled !== false,
    detourConfig: adapterConfig.detour,
    baseUrl: getRequestBaseUrl(req).replace(/\/$/, ''),
    saved: req.query.saved === '1',
    configPath: getRuntimeConfigPath(),
    defaultConfiguration: getDefaultRuntimeConfiguration(),
  }));
}

function getConfiguredSourcesForUi(adapterConfig = getAdapterConfiguration()) {
  const sources = [...(adapterConfig.sources || [])];
  if (adapterConfig.detour?.enabled && !sources.includes(SOURCE_DETOUR)) {
    sources.push(SOURCE_DETOUR);
  }
  return sources;
}

function getActiveSources() {
  const adapterConfig = getAdapterConfiguration();
  const configuredSources = getConfiguredSourcesForUi(adapterConfig);
  return configuredSources.length ? configuredSources : [getSourceMode()];
}

async function searchSourceRows(source, options) {
  if (source === SOURCE_STREMIO) {
    return searchStremioReleaseRows(options);
  }
  if (source === SOURCE_BETOR) {
    return searchBetorReleaseRows(options);
  }
  if (source === SOURCE_DETOUR) {
    return searchDetourReleaseRows(options);
  }
  if (source === SOURCE_DATABASE) {
    const rows = await searchReleaseRowsDb(options);
    return rows.map(row => ({ ...row, _source: SOURCE_DATABASE }));
  }
  return [];
}

async function getReleaseBySourceGuid(parsedGuid) {
  const normalizedGuid = parsedGuid.source === SOURCE_DATABASE
    ? `${parsedGuid.infoHash}:${parsedGuid.fileIndex}`
    : `${parsedGuid.source}:${parsedGuid.infoHash}:${parsedGuid.fileIndex}`;

  if (parsedGuid.source === SOURCE_STREMIO) {
    return getStremioReleaseRowByGuid(normalizedGuid);
  }
  if (parsedGuid.source === SOURCE_BETOR) {
    return getBetorReleaseRowByGuid(normalizedGuid);
  }
  if (parsedGuid.source === SOURCE_DETOUR) {
    return getDetourReleaseRowByGuid(normalizedGuid);
  }
  if (parsedGuid.source === SOURCE_DATABASE) {
    return getDatabaseReleaseByGuid(normalizedGuid);
  }
  return undefined;
}

async function checkSourceHealth(source) {
  if (source === SOURCE_DETOUR) {
    return { source, ok: null, skipped: 'no independent lightweight health check' };
  }
  try {
    if (source === SOURCE_STREMIO) {
      await checkStremioHealth();
    } else if (source === SOURCE_BETOR) {
      await checkBetorHealth();
    } else if (source === SOURCE_DATABASE) {
      await checkDatabaseHealth();
    }

    recordSourceSuccess(source);
    return { source, ok: true };
  } catch (error) {
    const temporary = isTemporarySourceError(source, error);
    const message = recordSourceFailure(source, error, { kind: 'health', temporary });
    console.error(`[health:${source}] ${message}`);
    return { source, ok: false, error: error.message, temporary };
  }
}

async function runSourceHealthProbes(sources) {
  const probeableSources = sources.filter(source => source !== SOURCE_DETOUR);
  const probeKey = [...probeableSources].sort().join(',');
  const now = Date.now();
  if (sourceHealthProbeInFlight) return sourceHealthProbeInFlight;
  if (lastSourceHealthProbeAt > 0 && now - lastSourceHealthProbeAt < SOURCE_HEALTH_PROBE_COOLDOWN_MS) {
    return {
      state: 'cooldown',
      checkedAt: new Date(lastSourceHealthProbeAt).toISOString(),
      retryAfterMs: SOURCE_HEALTH_PROBE_COOLDOWN_MS - (now - lastSourceHealthProbeAt),
      sources: lastSourceHealthProbeKey ? lastSourceHealthProbeKey.split(',') : [],
      results: [],
    };
  }

  lastSourceHealthProbeAt = now;
  lastSourceHealthProbeKey = probeKey;
  sourceHealthProbeInFlight = runWithConcurrency(probeableSources, 2, checkSourceHealth)
    .then(results => ({ state: 'completed', checkedAt: new Date().toISOString(), results }))
    .finally(() => { sourceHealthProbeInFlight = undefined; });
  return sourceHealthProbeInFlight;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      results.push(await worker(queue.shift()));
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildRuntimeStatus({ probeSources = false, probeIptv = false, probeDetour = false } = {}) {
  const sources = getActiveSources();
  const sourceProbe = probeSources ? runSourceHealthProbes(sources) : undefined;
  const probes = [];
  if (sourceProbe) probes.push(sourceProbe);
  if (probeIptv && isEmbedTvEnabled()) {
    probes.push(embedTvService.probe());
  }
  if (probeDetour && isDetourEnabled()) {
    probes.push(probeDetourProvider());
  }
  const [sourceProbeResult] = await Promise.all(probes);
  const detour = getDetourRuntimeStatus();
  const sourceStatusOverrides = sources.includes(SOURCE_DETOUR)
    ? { [SOURCE_DETOUR]: { status: detour.status, message: detour.message, lastCheckAt: detour.lastCheckAt } }
    : {};
  const snapshot = buildStatusSnapshot(sources, { sourceStatusOverrides });

  return {
    ...snapshot,
    sourceProbe: sourceProbeResult,
    betor: getBetorRuntimeStatus(),
    stremio: getStremioRuntimeStatus(),
    iptv: embedTvService.getStatus({ enabled: isEmbedTvEnabled() }),
    detour,
  };
}

function isEmbedTvEnabled() {
  return getAdapterConfiguration().iptv?.enabled !== false;
}

function isDetourEnabled() {
  const config = getAdapterConfiguration();
  return Boolean(config.detour?.enabled || config.sources?.includes(SOURCE_DETOUR));
}

function isTemporarySourceError(source, error) {
  if (source === SOURCE_BETOR) {
    return isTemporaryBetorError(error);
  }
  if (source === SOURCE_DETOUR) {
    return isTemporaryDetourError(error);
  }
  if (source === SOURCE_STREMIO && isTemporaryStremioError(error)) {
    return true;
  }
  const statusCode = error?.response?.status || error?.statusCode;
  const code = error?.code || error?.cause?.code;
  return ['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)
    || statusCode === 429
    || (statusCode >= 500 && statusCode < 600);
}

function getSourceLabel(source) {
  if (source === SOURCE_BETOR) {
    return 'BeTor';
  }
  if (source === SOURCE_DETOUR) {
    return 'Scraper';
  }
  if (source === SOURCE_STREMIO) {
    return 'Torrentio';
  }
  if (source === SOURCE_DATABASE) {
    return 'Database';
  }
  return source;
}

async function searchWithBetorPrimary(options, orderedSources, resultsBySource) {
  const stremioEnabled = orderedSources.includes(SOURCE_STREMIO);
  let fallbackStarted = false;
  let stremioPromise;
  let fallbackReason;
  let fallbackTimer;
  let betorError;

  const startStremioFallback = reason => {
    if (!stremioEnabled || fallbackStarted) {
      return;
    }
    fallbackStarted = true;
    fallbackReason = reason;
    console.log(`[search:fallback] Iniciando fallback do Stremio: ${reason}.`);
    stremioPromise = searchSourceRowsTolerantly(SOURCE_STREMIO, options);
  };

  if (stremioEnabled) {
    fallbackTimer = setTimeout(() => {
      startStremioFallback('betor_slow');
    }, BETOR_FALLBACK_DELAY_MS);
  }

  let betorRows = [];
  try {
    betorRows = await searchSourceRowsSafely(SOURCE_BETOR, options);
  } catch (error) {
    betorError = error;
    startStremioFallback('betor_failed');
  } finally {
    clearTimeout(fallbackTimer);
  }

  if (fallbackStarted && stremioPromise) {
    resultsBySource.set(SOURCE_STREMIO, await stremioPromise);
    console.log(`[search:fallback] Fallback do Stremio concluido para ${fallbackReason}.`);
  }

  if (betorError) {
    if (fallbackStarted) {
      return [];
    }
    throw betorError;
  }

  return betorRows;
}

async function searchSourceRowsSafely(source, options) {
  const startedAt = Date.now();
  try {
    const rows = await searchSourceRows(source, options);
    const durationMs = Date.now() - startedAt;
    const observation = rows.searchObservation || { outcome: 'success' };
    recordSourceSearch(source, {
      query: options.query || options.imdbId || 'Consulta geral',
      imdbId: options.imdbId,
      year: options.year,
      count: rows.length,
      durationMs: observation.outcome === 'inconclusive' ? undefined : durationMs,
      outcome: observation.outcome,
    });
    if (observation.outcome === 'success') {
      recordSourceSuccess(source, {
        kind: 'search',
        message: `${getSourceLabel(source)} respondeu à busca normalmente.`,
      });
    } else if (observation.outcome === 'failure') {
      const error = Object.assign(new Error(observation.message || 'Todos os provedores Scraper falharam.'), {
        code: 'DETOUR_SEARCH_FAILED',
        source: SOURCE_DETOUR,
        temporary: true,
      });
      recordSourceFailure(source, error, { kind: 'search', temporary: true });
    }
    console.log(`[search:${source}] Busca concluida em ${durationMs}ms com ${rows.length} resultado(s) (${observation.outcome}).`);
    return rows;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    recordSourceSearch(source, {
      query: options.query || options.imdbId || 'Consulta geral',
      imdbId: options.imdbId,
      year: options.year,
      count: 0,
      durationMs,
      outcome: 'failure',
    });
    const temporary = isTemporarySourceError(source, error);
    const message = recordSourceFailure(source, error, { kind: 'search', temporary });
    console.error(`[search:${source}] ${message}`);
    throw error;
  }
}

async function searchSourceRowsTolerantly(source, options) {
  try {
    return await searchSourceRowsSafely(source, options);
  } catch (error) {
    if (!isTemporarySourceError(source, error)) {
      throw error;
    }

    console.warn(`[search:${source}] Falha temporaria isolada; continuando com as demais fontes.`);
    return [];
  }
}

function mergeRowsInSourceOrder(orderedSources, resultsBySource, limit, allowedProviders = new Set()) {
  const mergedRows = [];
  const seenKeys = new Set();
  const returnedBySource = new Map();
  let reachedLimit = false;

  for (const source of orderedSources) {
    const rows = resultsBySource.get(source) || [];
    for (const row of rows) {
      if (source !== SOURCE_DETOUR && allowedProviders.size && !allowedProviders.has(normalizeProviderName(row.provider))) {
        continue;
      }

      const dedupeKey = String(row.infoHash) + ':' + String(row.fileIndex || 0);
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      mergedRows.push(row);
      returnedBySource.set(source, (returnedBySource.get(source) || 0) + 1);
      if (mergedRows.length >= limit) {
        reachedLimit = true;
        break;
      }
    }
    if (reachedLimit) break;
  }

  const searchBreakdown = orderedSources.map(source => {
    const sourceRows = resultsBySource.get(source) || [];
    const providers = sourceRows.searchDiagnostics?.providers;
    return {
      source,
      candidateCount: sourceRows.length,
      returnedCount: returnedBySource.get(source) || 0,
      ...(Array.isArray(providers) ? { providers } : {}),
    };
  });
  Object.defineProperty(mergedRows, 'searchBreakdown', {
    value: searchBreakdown,
    enumerable: false,
  });
  return mergedRows;
}

function normalizeProviderName(value) {
  return `${value || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .replace(/torrents?$/, '');
}

function buildEffectiveSourceOrder(activeSources) {
  const orderedSources = [];
  if (activeSources.includes(SOURCE_BETOR)) {
    orderedSources.push(SOURCE_BETOR);
  }
  if (activeSources.includes(SOURCE_DETOUR)) {
    orderedSources.push(SOURCE_DETOUR);
  }
  if (activeSources.includes(SOURCE_STREMIO)) {
    orderedSources.push(SOURCE_STREMIO);
  }
  activeSources.forEach(source => {
    if (!orderedSources.includes(source)) {
      orderedSources.push(source);
    }
  });
  return orderedSources;
}
