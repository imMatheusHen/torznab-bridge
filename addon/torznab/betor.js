import axios from 'axios';
import magnet from 'magnet-uri';
import titleParser from 'parse-torrent-title';
import * as cheerio from 'cheerio';
import { SOURCE_BETOR } from './source.js';

const BETOR_BASE_URL = (process.env.TORZNAB_BETOR_URL || 'https://catalogo.betor.top').replace(/\/$/, '');
const BETOR_TIMEOUT = parseInt(process.env.TORZNAB_BETOR_TIMEOUT_MS || '12000', 10);
const BETOR_TOTAL_TIMEOUT_MS = parseInt(process.env.TORZNAB_BETOR_TOTAL_TIMEOUT_MS || '18000', 10);
const BETOR_RETRY_MAX_ATTEMPTS = parseInt(process.env.TORZNAB_BETOR_RETRY_MAX_ATTEMPTS || '3', 10);
const BETOR_RETRY_BASE_DELAY_MS = parseInt(process.env.TORZNAB_BETOR_RETRY_BASE_DELAY_MS || '800', 10);
const BETOR_SEARCH_CACHE_TTL_MS = parseInt(process.env.TORZNAB_BETOR_SEARCH_CACHE_TTL_MS || `${60 * 60 * 1000}`, 10);
const BETOR_SEARCH_CACHE_STALE_MS = parseInt(process.env.TORZNAB_BETOR_SEARCH_CACHE_STALE_MS || `${24 * 60 * 60 * 1000}`, 10);
const RELEASE_CACHE_TTL_MS = parseInt(process.env.TORZNAB_RELEASE_CACHE_TTL_MS || `${60 * 60 * 1000}`, 10);
const BETOR_CIRCUIT_FAILURE_THRESHOLD = parseInt(process.env.TORZNAB_BETOR_CIRCUIT_FAILURE_THRESHOLD || '3', 10);
const BETOR_CIRCUIT_OPEN_MS = parseInt(process.env.TORZNAB_BETOR_CIRCUIT_OPEN_MS || `${2 * 60 * 1000}`, 10);
const BETOR_HEADERS = {
  'User-Agent': process.env.TORZNAB_BETOR_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const releaseCache = new Map();
const searchCache = new Map();
const inflightSearches = new Map();
const circuitBreaker = {
  state: 'closed',
  consecutiveFailures: 0,
  openedAt: undefined,
  lastFailureAt: undefined,
  lastFailureReason: undefined,
  halfOpenProbeInFlight: false,
  halfOpenProbeStartedAt: undefined,
};

export function isTemporaryBetorError(error) {
  return Boolean(error?.temporary && error?.source === SOURCE_BETOR);
}

export function getBetorRuntimeStatus() {
  const cachedSearches = Array.from(searchCache.values());
  const freshCacheEntries = cachedSearches.filter(entry => entry.expiresAt > Date.now()).length;
  const staleCacheEntries = cachedSearches.filter(entry => entry.expiresAt <= Date.now() && entry.staleUntil > Date.now()).length;

  return {
    circuitBreaker: {
      state: circuitBreaker.state,
      consecutiveFailures: circuitBreaker.consecutiveFailures,
      openedAt: circuitBreaker.openedAt,
      lastFailureAt: circuitBreaker.lastFailureAt,
      lastFailureReason: circuitBreaker.lastFailureReason,
      halfOpenProbeInFlight: circuitBreaker.halfOpenProbeInFlight,
      halfOpenProbeStartedAt: circuitBreaker.halfOpenProbeStartedAt,
      openRemainingMs: getCircuitOpenRemainingMs(),
    },
    cache: {
      searchEntries: searchCache.size,
      freshSearchEntries: freshCacheEntries,
      staleSearchEntries: staleCacheEntries,
      releaseEntries: releaseCache.size,
      inflightGroupedSearches: inflightSearches.size,
    },
  };
}

export async function checkBetorHealth() {
  await fetchHtmlWithRetry({
    path: '/',
    logKey: 'health',
    skipCacheFallback: true,
  });
}

export async function searchBetorReleaseRows(options = {}) {
  pruneCaches();
  const searchKey = buildSearchCacheKey(options);
  const cachedEntry = getCachedSearchEntry(searchKey);
  const inflightSearch = inflightSearches.get(searchKey);
  if (inflightSearch) {
    logBetor('group', `Agrupando busca identica em andamento para ${searchKey}.`);
    return inflightSearch;
  }

  const searchPromise = runBetorSearch(searchKey, options, cachedEntry)
      .finally(() => {
        inflightSearches.delete(searchKey);
      });
  inflightSearches.set(searchKey, searchPromise);
  return searchPromise;
}

export async function getBetorReleaseRowByGuid(guid) {
  const parts = decodeURIComponent(`${guid || ''}`).split(':');
  const infoHash = parts.length >= 3 ? parts[1] : parts[0];
  const fileIndex = parseInt(parts.length >= 3 ? parts[2] : parts[1] || '0', 10) || 0;
  pruneCaches();
  return releaseCache.get(cacheKey(infoHash.toLowerCase(), fileIndex))?.row;
}

async function runBetorSearch(searchKey, options, cachedEntry) {
  const startedAt = Date.now();
  const attemptContext = beginCircuitRequest();

  try {
    const rows = await withTimeout(
        performBetorSearch(searchKey, options),
        BETOR_TOTAL_TIMEOUT_MS,
        createTemporaryBetorError(undefined, 'timeout_total', { searchKey }),
    );
    const filteredRows = applySearchFilters(rows, options).slice(0, options.limit || 100);
    cacheSearchResult(searchKey, filteredRows);
    cacheRows(filteredRows);
    markCircuitSuccess(attemptContext);
    logBetor('search', `Busca ${searchKey} concluida em ${Date.now() - startedAt}ms com ${filteredRows.length} resultado(s).`);
    return filteredRows;
  } catch (error) {
    markCircuitFailure(error, attemptContext);

    if (cachedEntry?.staleRows?.length) {
      logBetor('cache', `Usando cache antigo para ${searchKey} apos falha do BeTor.`, {
        state: circuitBreaker.state,
        ageMs: Date.now() - cachedEntry.cachedAtMs,
      });
      cacheRows(cachedEntry.staleRows);
      return cachedEntry.staleRows;
    }

    if (cachedEntry?.freshRows?.length) {
      logBetor('cache', `Usando cache fresco para ${searchKey} apos falha do BeTor.`, {
        state: circuitBreaker.state,
      });
      cacheRows(cachedEntry.freshRows);
      return cachedEntry.freshRows;
    }

    logBetor('search', `Busca ${searchKey} falhou em ${Date.now() - startedAt}ms.`, {
      error: error.message,
      circuitState: circuitBreaker.state,
    });
    throw error;
  }
}

async function performBetorSearch(searchKey, options) {
  const {
    type,
    types = [],
    imdbId,
    query,
    season,
    limit = 100,
  } = options;

  const searchPlan = buildSearchPlan({ type, types, imdbId, query, season });
  const rows = [];

  for (const step of searchPlan) {
    const html = await fetchHtmlWithRetry({
      path: step.path,
      logKey: `${searchKey}:${step.label}`,
    });
    const parsedRows = parseReleaseRows(html, { query, season, episode: options.episode });

    if (parsedRows.length) {
      rows.push(...parsedRows);
      if (step.direct) {
        logBetor('route', `Parando busca do BeTor apos rota direta ${step.label} retornar ${parsedRows.length} resultado(s).`);
        break;
      }
    }

    if (rows.length >= limit * 3) {
      break;
    }
  }

  return rows;
}

async function fetchHtmlWithRetry({ path, logKey, skipCacheFallback = false }) {
  const url = `${BETOR_BASE_URL}${path}`;
  let lastError;

  for (let attempt = 1; attempt <= BETOR_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await axios.get(url, {
        timeout: BETOR_TIMEOUT,
        responseType: 'text',
        headers: BETOR_HEADERS,
      });
      return response.data || '';
    } catch (error) {
      const retryDetails = classifyRetryableError(error);
      if (!retryDetails.retryable) {
        throw error;
      }

      lastError = retryDetails.error;
      if (attempt >= BETOR_RETRY_MAX_ATTEMPTS) {
        break;
      }

      const delayMs = retryDetails.retryAfterMs ?? computeBackoffMs(attempt);
      logBetor('retry', `Retry ${attempt}/${BETOR_RETRY_MAX_ATTEMPTS - 1} para ${logKey}.`, {
        statusCode: retryDetails.error.statusCode,
        code: retryDetails.error.code,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  if (!skipCacheFallback) {
    logBetor('retry', `Falha definitiva em ${logKey} apos retries esgotados.`, {
      error: lastError?.message,
    });
  }

  throw lastError || createTemporaryBetorError(undefined, 'retry_exhausted');
}

function buildSearchPlan({ type, types, imdbId, query, season }) {
  const encodedQuery = encodeURIComponent(`${query || ''}`.trim());
  const wantsSeries = types.includes('series') || types.includes('anime') || Number.isInteger(season);
  const plan = [];

  if (wantsSeries && imdbId && Number.isInteger(season)) {
    plan.push({ path: `/imdb/${encodeURIComponent(imdbId)}/season/${season}/`, label: 'season-direct', direct: true });
  }
  if (imdbId) {
    plan.push({ path: `/imdb/${encodeURIComponent(imdbId)}/`, label: 'imdb-direct', direct: true });
  }
  if (encodedQuery) {
    plan.push({ path: `/search/?q=${encodedQuery}`, label: 'text-search', direct: false });
  }
  if (type === 'movie' && !plan.length) {
    plan.push({ path: '/filmes/', label: 'movies-index', direct: false });
  }

  return plan;
}

function applySearchFilters(rows, { season, episode }) {
  const filteredRows = applyEpisodeFilter(rows, season, episode);
  return filteredRows.sort((left, right) => {
    const seedersDiff = (right.seeders || 0) - (left.seeders || 0);
    if (seedersDiff !== 0) {
      return seedersDiff;
    }
    return `${right.uploadDate || ''}`.localeCompare(`${left.uploadDate || ''}`);
  });
}

function parseReleaseRows(html, context = {}) {
  const $ = cheerio.load(html);
  const rows = [];

  $('[data-torrent]').each((_, element) => {
    const node = $(element);
    const magnetUrl = node.attr('data-torrent-magnet-uri') || '';
    const infoHash = extractInfoHash(magnetUrl);
    if (!infoHash) {
      return;
    }

    const torrentTitle = node.attr('data-torrent-name') || '';
    const files = `${node.attr('data-torrent-files') || ''}`
        .split(';')
        .map(file => file.trim())
        .filter(Boolean);
    const fileTitle = files[0] || torrentTitle;
    const parsed = titleParser.parse(fileTitle || torrentTitle);
    const itemType = node.attr('data-item-type') === 'movie' ? 'movie' : 'series';
    const providerName = node.closest('.provider').find('.header .name').first().text().trim() || 'BeTor';
    const imdbSeason = parseInt(`${context.season ?? parsed.season ?? ''}`, 10);
    const imdbEpisode = inferEpisode(parsed, torrentTitle, fileTitle);

    rows.push({
      _source: SOURCE_BETOR,
      infoHash,
      provider: providerName,
      torrentId: infoHash,
      torrentTitle,
      torrentSize: parseInt(node.attr('data-torrent-size') || '0', 10) || 0,
      type: itemType,
      uploadDate: node.attr('data-torrent-inserted-at') || new Date().toISOString(),
      seeders: parseInt(node.attr('data-torrent-num-seeds') || '0', 10) || 0,
      trackers: extractTrackers(magnetUrl).join(','),
      languages: JSON.stringify(parseLanguages(node.attr('data-torrent-languages') || '')),
      resolution: parsed.resolution,
      fileId: infoHash,
      fileIndex: 0,
      fileTitle,
      fileSize: parseInt(node.attr('data-torrent-size') || '0', 10) || 0,
      imdbId: node.attr('data-item-imdb-id') || undefined,
      imdbSeason: Number.isInteger(imdbSeason) ? imdbSeason : undefined,
      imdbEpisode,
      canonicalTitle: node.closest('.item').find('.details > .title').first().text().trim() || context.query || undefined,
      magnetUrl,
    });
  });

  return rows;
}

function applyEpisodeFilter(rows, season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) {
    return rows;
  }

  const exact = rows.filter(row => row.imdbSeason === season && row.imdbEpisode === episode);
  if (exact.length) {
    return exact;
  }

  return rows.filter(row => row.imdbSeason === season);
}

function inferEpisode(parsed, torrentTitle, fileTitle) {
  if (Number.isInteger(parsed.episode)) {
    return parsed.episode;
  }

  const blob = `${torrentTitle} ${fileTitle}`;
  const match = blob.match(/\bS\d{1,2}E(\d{1,3})\b/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function parseLanguages(rawLanguages) {
  const mapping = {
    en: 'english',
    'pt-br': 'brazilian',
    pt: 'portuguese',
  };

  return `${rawLanguages || ''}`
      .split(',')
      .map(language => language.trim().toLowerCase())
      .filter(Boolean)
      .map(language => mapping[language] || language);
}

function extractInfoHash(magnetUrl) {
  try {
    const parsed = magnet.decode(magnetUrl);
    return `${parsed.infoHash || ''}`.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function extractTrackers(magnetUrl) {
  try {
    const parsed = magnet.decode(magnetUrl);
    return parsed.announce || [];
  } catch {
    return [];
  }
}

function cacheSearchResult(searchKey, rows) {
  const now = Date.now();
  searchCache.set(searchKey, {
    rows,
    cachedAtMs: now,
    expiresAt: now + BETOR_SEARCH_CACHE_TTL_MS,
    staleUntil: now + BETOR_SEARCH_CACHE_STALE_MS,
  });
  logBetor('cache', `Cacheando busca ${searchKey} com ${rows.length} resultado(s).`);
}

function getCachedSearchEntry(searchKey) {
  const entry = searchCache.get(searchKey);
  if (!entry) {
    return undefined;
  }

  const now = Date.now();
  return {
    freshRows: entry.expiresAt > now ? entry.rows : undefined,
    staleRows: entry.staleUntil > now ? entry.rows : undefined,
    cachedAtMs: entry.cachedAtMs,
  };
}

function cacheRows(rows) {
  pruneCaches();
  const expiresAt = Date.now() + RELEASE_CACHE_TTL_MS;
  rows.forEach(row => {
    releaseCache.set(cacheKey(row.infoHash, row.fileIndex || 0), { row, expiresAt });
  });
  return rows;
}

function pruneCaches() {
  const now = Date.now();

  for (const [key, value] of releaseCache.entries()) {
    if (value.expiresAt <= now) {
      releaseCache.delete(key);
    }
  }

  for (const [key, value] of searchCache.entries()) {
    if (value.staleUntil <= now) {
      searchCache.delete(key);
    }
  }
}

function cacheKey(infoHash, fileIndex) {
  return `${infoHash}:${fileIndex}`;
}

function beginCircuitRequest() {
  const now = Date.now();

  if (circuitBreaker.state === 'open') {
    if (getCircuitOpenRemainingMs(now) > 0) {
      throw createTemporaryBetorError(521, 'circuit_open', {
        circuitState: circuitBreaker.state,
        retryAfterMs: getCircuitOpenRemainingMs(now),
      });
    }

    circuitBreaker.state = 'half-open';
    circuitBreaker.halfOpenProbeInFlight = false;
    circuitBreaker.halfOpenProbeStartedAt = undefined;
    logBetor('circuit', 'Circuit breaker do BeTor entrou em half-open.');
  }

  if (circuitBreaker.state === 'half-open') {
    if (circuitBreaker.halfOpenProbeInFlight) {
      throw createTemporaryBetorError(521, 'circuit_half_open_busy', {
        circuitState: circuitBreaker.state,
        retryAfterMs: 1000,
      });
    }

    circuitBreaker.halfOpenProbeInFlight = true;
    circuitBreaker.halfOpenProbeStartedAt = new Date(now).toISOString();
    logBetor('circuit', 'Executando probe half-open do BeTor.');
    return { halfOpenProbe: true };
  }

  return { halfOpenProbe: false };
}

function markCircuitSuccess(context = {}) {
  const previousState = circuitBreaker.state;
  circuitBreaker.state = 'closed';
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.openedAt = undefined;
  circuitBreaker.lastFailureReason = undefined;
  circuitBreaker.halfOpenProbeInFlight = false;
  circuitBreaker.halfOpenProbeStartedAt = undefined;

  if (previousState !== 'closed' || context.halfOpenProbe) {
    logBetor('circuit', 'Circuit breaker do BeTor voltou para closed.');
  }
}

function markCircuitFailure(error, context = {}) {
  circuitBreaker.lastFailureAt = new Date().toISOString();
  circuitBreaker.lastFailureReason = error.message;
  circuitBreaker.halfOpenProbeInFlight = false;
  circuitBreaker.halfOpenProbeStartedAt = undefined;

  if (context.halfOpenProbe) {
    circuitBreaker.state = 'open';
    circuitBreaker.openedAt = new Date().toISOString();
    circuitBreaker.consecutiveFailures = BETOR_CIRCUIT_FAILURE_THRESHOLD;
    logBetor('circuit', 'Probe half-open falhou; circuit breaker do BeTor voltou para open.', {
      error: error.message,
    });
    return;
  }

  circuitBreaker.consecutiveFailures += 1;
  if (circuitBreaker.consecutiveFailures >= BETOR_CIRCUIT_FAILURE_THRESHOLD) {
    if (circuitBreaker.state !== 'open') {
      logBetor('circuit', 'Circuit breaker do BeTor abriu.', {
        failures: circuitBreaker.consecutiveFailures,
        error: error.message,
      });
    }
    circuitBreaker.state = 'open';
    circuitBreaker.openedAt = new Date().toISOString();
    return;
  }

  circuitBreaker.state = 'closed';
}

function getCircuitOpenRemainingMs(now = Date.now()) {
  if (circuitBreaker.state !== 'open' || !circuitBreaker.openedAt) {
    return 0;
  }

  const openedAtMs = Date.parse(circuitBreaker.openedAt);
  if (Number.isNaN(openedAtMs)) {
    return 0;
  }

  return Math.max(0, BETOR_CIRCUIT_OPEN_MS - (now - openedAtMs));
}

function classifyRetryableError(error) {
  const statusCode = error?.response?.status;
  const retryAfterMs = parseRetryAfterMs(error?.response?.headers?.['retry-after']);
  const isTimeout = error?.code === 'ECONNABORTED' || `${error?.message || ''}`.toLowerCase().includes('timeout');
  const isNetworkError = !error?.response;
  const isRetryableStatus = statusCode === 429 || statusCode === 521 || (statusCode >= 500 && statusCode < 600);

  if (!isTimeout && !isNetworkError && !isRetryableStatus) {
    return {
      retryable: false,
      error,
    };
  }

  return {
    retryable: true,
    retryAfterMs,
    error: createTemporaryBetorError(statusCode, error?.code || (isTimeout ? 'timeout' : 'network'), {
      retryAfterMs,
      cause: error,
    }),
  };
}

function buildSearchCacheKey({ type, types = [], imdbId, query, season, episode }) {
  if (type === 'movie') {
    return imdbId ? `movie:${imdbId}` : `movie:text:${normalizeKeyPart(query)}`;
  }
  if (Number.isInteger(season) && Number.isInteger(episode)) {
    return `episode:${imdbId || normalizeKeyPart(query)}:${season}:${episode}`;
  }
  if (Number.isInteger(season)) {
    return `season:${imdbId || normalizeKeyPart(query)}:${season}`;
  }
  if (imdbId && (types.includes('series') || types.includes('anime'))) {
    return `series:${imdbId}`;
  }
  if (imdbId) {
    return `imdb:${imdbId}`;
  }
  return `text:${normalizeKeyPart(query)}`;
}

function normalizeKeyPart(value) {
  return `${value || ''}`
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
}

function computeBackoffMs(attempt) {
  return BETOR_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
}

function parseRetryAfterMs(rawValue) {
  if (!rawValue) {
    return undefined;
  }

  const numeric = parseInt(`${rawValue}`, 10);
  if (Number.isInteger(numeric)) {
    return Math.max(0, numeric * 1000);
  }

  const parsedDate = Date.parse(`${rawValue}`);
  if (Number.isNaN(parsedDate)) {
    return undefined;
  }

  return Math.max(0, parsedDate - Date.now());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function withTimeout(promise, timeoutMs, timeoutError) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError), timeoutMs);
    promise
        .then(value => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
  });
}

function logBetor(kind, message, details = {}) {
  const serializedDetails = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`[betor:${kind}] ${message}${serializedDetails}`);
}

function createTemporaryBetorError(statusCode, code, details = {}) {
  const suffix = statusCode ? ` (${statusCode})` : '';
  const error = new Error(`BeTor temporariamente indisponivel${suffix}.`);
  error.name = 'TemporaryIndexerUnavailableError';
  error.source = SOURCE_BETOR;
  error.temporary = true;
  error.statusCode = statusCode;
  error.code = code;
  error.retryAfterMs = details.retryAfterMs;
  error.circuitState = details.circuitState;
  error.searchKey = details.searchKey;
  error.cause = details.cause;
  return error;
}
