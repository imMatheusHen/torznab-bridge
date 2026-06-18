import express from 'express';
import { buildCapsXml, buildErrorXml, buildRssXml } from './xml.js';
import {
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
import { checkStremioHealth, getStremioReleaseRowByGuid, searchStremioReleaseRows } from './stremio.js';
import {
  checkBetorHealth,
  getBetorRuntimeStatus,
  getBetorReleaseRowByGuid,
  isTemporaryBetorError,
  searchBetorReleaseRows,
} from './betor.js';
import {
  getSourceMode,
  SOURCE_BETOR,
  SOURCE_DATABASE,
  SOURCE_STREMIO,
} from './source.js';
import {
  buildStatusSnapshot,
  recordConfigurationSaved,
  recordSearchEvent,
  recordSourceFailure,
  recordSourceSuccess,
} from './monitor.js';
import { renderConfigurePage } from './configurePage.js';
import { getRuntimeConfigPath, saveRuntimeConfig } from './runtimeConfig.js';

const PORT = parseInt(process.env.PORT || process.env.TORZNAB_PORT || '9699', 10);
const BIND_ADDRESS = process.env.TORZNAB_BIND_ADDRESS || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.TORZNAB_BASE_URL || `http://localhost:${PORT}`;
const API_KEY = process.env.TORZNAB_API_KEY;
const LOG_REQUESTS = process.env.TORZNAB_LOG_REQUESTS === '1';
const BETOR_FALLBACK_DELAY_MS = parseInt(process.env.TORZNAB_BETOR_FALLBACK_DELAY_MS || '2500', 10);

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

app.get('/health', async (_, res) => {
  const snapshot = await buildRuntimeStatus();
  const response = {
    ok: snapshot.ok,
    degraded: snapshot.degraded,
    service: 'torznab-bridge',
    source: getSourceMode(),
    sources: getActiveSources(),
    configuration: process.env.TORZNAB_CONFIGURATION || 'brazuca',
    checks: snapshot.indexers.filter(indexer => indexer.enabled),
    events: snapshot.events,
    betor: snapshot.betor,
  };

  if (!snapshot.ok) {
    response.error = 'all_enabled_indexers_unreachable';
  }

  res.status(snapshot.ok ? 200 : 503).json(response);
});

app.get('/download/:guid', async (req, res) => {
  try {
    const row = await getReleaseByGuid(req.params.guid);
    if (!row) {
      res.status(404).send('Release not found');
      return;
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
  saveRuntimeConfig({ providers, sources });
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

  try {
    if (action === 'caps') {
      res.type('application/xml').send(buildCapsXml(baseUrl));
      return;
    }

    if (!['search', 'tvsearch', 'movie'].includes(action)) {
      res.status(400).type('application/xml').send(buildErrorXml(200, `Unsupported action: ${action || 'empty'}`));
      return;
    }

    const rows = await searchReleaseRows(buildSearchOptions(action, req.query));
    const items = rows.map(row => toTorznabItem(row, baseUrl));
    const channelTitle = buildChannelTitle(action, req.query);
    recordSearchEvent({ action, query: req.query, count: items.length });
    res.type('application/xml').send(buildRssXml(channelTitle, items));
  } catch (error) {
    console.error('Torznab Bridge request failed', error);
    res.status(500).type('application/xml').send(buildErrorXml(500, 'Internal adapter error'));
  }
}

async function handleStatusRequest(_, res) {
  const snapshot = await buildRuntimeStatus();
  res.json({
    service: 'torznab-bridge',
    ok: snapshot.ok,
    degraded: snapshot.degraded,
    sources: getActiveSources(),
    indexers: snapshot.indexers,
    events: snapshot.events,
    betor: snapshot.betor,
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
  const resultsBySource = new Map();

  if (orderedSources.includes(SOURCE_BETOR)) {
    const betorRows = await searchWithBetorPrimary(options, orderedSources, resultsBySource);
    resultsBySource.set(SOURCE_BETOR, betorRows);
  }

  const remainingSources = orderedSources.filter(source => !resultsBySource.has(source));
  if (remainingSources.length) {
    const sourceRows = await Promise.all(remainingSources.map(source => searchSourceRowsSafely(source, options)));
    sourceRows.forEach((rows, index) => {
      resultsBySource.set(remainingSources[index], rows);
    });
  }

  return mergeRowsInSourceOrder(orderedSources, resultsBySource, limit);
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
  const row = await getReleaseBySourceGuid(parsedGuid);
  const allowedProviders = new Set((getAdapterConfiguration().providers || []).map(provider => provider.toLowerCase()));
  if (!row) {
    return undefined;
  }
  if (allowedProviders.size && !allowedProviders.has(`${row.provider}`.toLowerCase())) {
    return undefined;
  }
  return row;
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

function renderProviderUi(req, res) {
  const adapterConfig = getAdapterConfiguration();
  res.type('html').send(renderConfigurePage({
    selectedProviders: adapterConfig.providers || [],
    selectedSources: adapterConfig.sources || [],
    baseUrl: PUBLIC_BASE_URL.replace(/\/$/, ''),
    saved: req.query.saved === '1',
    configPath: getRuntimeConfigPath(),
  }));
}

function getActiveSources() {
  const configuredSources = getAdapterConfiguration().sources || [];
  return configuredSources.length ? configuredSources : [getSourceMode()];
}

async function searchSourceRows(source, options) {
  if (source === SOURCE_STREMIO) {
    return searchStremioReleaseRows(options);
  }
  if (source === SOURCE_BETOR) {
    return searchBetorReleaseRows(options);
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
  if (parsedGuid.source === SOURCE_DATABASE) {
    return getDatabaseReleaseByGuid(normalizedGuid);
  }
  return undefined;
}

async function checkSourceHealth(source) {
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
    recordSourceFailure(source, error, { kind: 'health', temporary });
    console.error(`Health check failed for source ${source}`, error);
    return { source, ok: false, error: error.message, temporary };
  }
}

async function buildRuntimeStatus() {
  const sources = getActiveSources();
  await Promise.all(sources.map(checkSourceHealth));
  return {
    ...buildStatusSnapshot(sources),
    betor: getBetorRuntimeStatus(),
  };
}

function isTemporarySourceError(source, error) {
  if (source === SOURCE_BETOR) {
    return isTemporaryBetorError(error);
  }
  return false;
}

function getSourceLabel(source) {
  if (source === SOURCE_BETOR) {
    return 'BeTor';
  }
  if (source === SOURCE_STREMIO) {
    return 'Stremio';
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
    stremioPromise = searchSourceRowsSafely(SOURCE_STREMIO, options);
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
    recordSourceSuccess(source, {
      kind: 'search',
      message: `${getSourceLabel(source)} respondeu à busca normalmente.`,
    });
    console.log(`[search:${source}] Busca concluida em ${Date.now() - startedAt}ms com ${rows.length} resultado(s).`);
    return rows;
  } catch (error) {
    const temporary = isTemporarySourceError(source, error);
    recordSourceFailure(source, error, { kind: 'search', temporary });
    console.error(`Failed searching source ${source}`, error);
    throw error;
  }
}

function mergeRowsInSourceOrder(orderedSources, resultsBySource, limit) {
  const mergedRows = [];
  const seenKeys = new Set();

  for (const source of orderedSources) {
    const rows = resultsBySource.get(source) || [];
    for (const row of rows) {
      const dedupeKey = `${row.infoHash}:${row.fileIndex || 0}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);
      mergedRows.push(row);
      if (mergedRows.length >= limit) {
        return mergedRows;
      }
    }
  }

  return mergedRows;
}

function buildEffectiveSourceOrder(activeSources) {
  const orderedSources = [];
  if (activeSources.includes(SOURCE_BETOR)) {
    orderedSources.push(SOURCE_BETOR);
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
