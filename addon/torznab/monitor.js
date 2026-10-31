import { SOURCE_OPTIONS } from './source.js';
import { buildMagnetUrl } from './release.js';
import { buildSearchActivitySnapshot, recordSearchActivity } from './searchActivity.js';
import { buildSearchDetails, buildSearchLabel, normalizeImdbId, normalizeSearchYear } from './searchMetadata.js';

const EVENT_LIMIT = 30;
const EVENT_RELEASE_LIMIT = 100;
const FAILURE_EVENT_COOLDOWN_MS = 2 * 60 * 1000;
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const SOURCE_METRIC_DAY_LIMIT = 120;
const METRIC_TIME_ZONE = 'America/Sao_Paulo';
const sourceCatalog = new Map(SOURCE_OPTIONS.map(source => [source.key, source]));
const sourceState = new Map(SOURCE_OPTIONS.map(source => [source.key, createInitialState(source)]));
const recentEvents = [];
const metricDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: METRIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function recordConfigurationSaved({ providers = [], sources = [] } = {}) {
  pushEvent({
    level: 'info',
    kind: 'config',
    message: `Configuração salva com ${sources.length || 0} indexador(es) e ${providers.length || 0} provider(s).`,
  });
}

export function recordSearchEvent({
  action,
  query,
  count,
  requester,
  releases = [],
  durationMs,
  limit,
  searchBreakdown,
  outcome = 'success',
  timestamp = Date.now(),
} = {}) {
  const label = buildSearchLabel(action, query);
  const requesterDetails = normalizeRequester(requester);
  const releaseDetails = summarizeReleases(releases);
  const duration = normalizeDuration(durationMs);
  const resultCount = Math.max(0, Number(count) || 0);
  recordSearchActivity(timestamp, { resultCount, durationMs: duration, outcome });
  const search = buildSearchDetails(action, query);
  const normalizedLimit = normalizeCount(limit);
  if (normalizedLimit) search.limit = normalizedLimit;
  const normalizedBreakdown = normalizeSearchBreakdown(searchBreakdown);
  if (normalizedBreakdown.length) search.sourceBreakdown = normalizedBreakdown;
  const message = outcome === 'failure'
    ? `${label} falhou${duration === undefined ? '' : ` após ${formatDuration(duration)}`}.`
    : `${label} solicitada por ${requesterDetails.label} retornou ${count} resultado(s)${duration === undefined ? '' : ` em ${formatDuration(duration)}`}.`;
  pushEvent({
    timestamp: new Date(timestamp).toISOString(),
    level: outcome === 'failure' ? 'error' : 'info',
    kind: 'search',
    message,
    durationMs: duration,
    search,
    requester: requesterDetails,
    releases: releaseDetails,
  });
}

function normalizeSearchBreakdown(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 8).map(entry => ({
    source: truncate(entry.source || 'unknown', 32),
    candidateCount: normalizeCount(entry.candidateCount),
    returnedCount: normalizeCount(entry.returnedCount),
    providers: (Array.isArray(entry.providers) ? entry.providers : []).slice(0, 6).map(provider => ({
      id: truncate(provider.id || 'unknown', 48),
      name: truncate(provider.name || provider.id || 'provider', 80),
      outcome: truncate(provider.outcome || 'unknown', 24),
      foundCount: normalizeCount(provider.foundCount),
      returnedCount: normalizeCount(provider.returnedCount),
      duplicateCount: normalizeCount(provider.duplicateCount),
      omittedByLimit: normalizeCount(provider.omittedByLimit),
    })),
  }));
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function recordSourceSearch(sourceKey, {
  query,
  imdbId,
  year,
  count = 0,
  durationMs,
  outcome = 'success',
  timestamp = Date.now(),
} = {}) {
  const state = ensureState(sourceKey);
  const occurredAt = normalizeTimestamp(timestamp);
  const resultCount = Math.max(0, Number(count) || 0);
  const duration = normalizeDuration(durationMs);
  const search = {
    query: truncate(query || 'Consulta geral', 120),
    count: resultCount,
    durationMs: duration,
    outcome,
    completedAt: new Date(occurredAt).toISOString(),
  };
  const normalizedImdbId = normalizeImdbId(imdbId) || normalizeImdbId(query);
  const normalizedYear = normalizeSearchYear(year);
  if (normalizedImdbId) search.imdbId = normalizedImdbId;
  if (normalizedYear) search.year = normalizedYear;
  state.lastSearch = search;
  recordSourceSearchMetrics(state, { resultCount, durationMs: duration, outcome, timestamp: occurredAt });
}

export function recordDownloadEvent({ row, requester } = {}) {
  if (!row) {
    return;
  }

  const requesterDetails = normalizeRequester(requester);
  const [release] = summarizeReleases([row]);
  pushEvent({
    level: 'info',
    kind: 'download',
    source: row._source,
    message: `Torrent enviado para ${requesterDetails.label}: ${release.title}.`,
    requester: requesterDetails,
    releases: [release],
  });
}

export function recordSourceSuccess(sourceKey, { kind = 'health', message } = {}) {
  const state = ensureState(sourceKey);
  const now = new Date().toISOString();
  const wasFailing = state.consecutiveFailures > 0;

  state.lastCheckAt = now;
  state.lastSuccessAt = now;
  state.lastResult = 'success';
  state.consecutiveFailures = 0;
  state.lastError = undefined;
  state.temporaryFailure = false;

  if (wasFailing) {
    pushEvent({
      level: 'info',
      kind,
      source: sourceKey,
      message: message || `${state.label} voltou a responder normalmente.`,
    });
  }
}

export function recordSourceFailure(sourceKey, error, { kind = 'health', temporary = false } = {}) {
  const state = ensureState(sourceKey);
  const now = new Date().toISOString();
  const details = extractErrorDetails(error);
  const message = normalizeErrorMessage(error, state.label, temporary, details);
  const signature = `${kind}:${temporary}:${message}`;

  state.lastCheckAt = now;
  state.lastFailureAt = now;
  state.lastResult = 'failure';
  state.consecutiveFailures += 1;
  state.lastError = message;
  state.temporaryFailure = temporary;

  if (state.lastFailureSignature !== signature || isCooldownExpired(state.lastFailureEventAt)) {
    pushEvent({
      level: temporary ? 'warn' : 'error',
      kind,
      source: sourceKey,
      message,
      error: details,
    });
    state.lastFailureSignature = signature;
    state.lastFailureEventAt = now;
  }

  return message;
}

export function buildStatusSnapshot(activeSources = [], { sourceStatusOverrides = {} } = {}) {
  const activeSet = new Set(activeSources);
  const indexers = SOURCE_OPTIONS.map(source => {
    const state = ensureState(source.key);
    const enabled = activeSet.has(source.key);
    const override = enabled ? sourceStatusOverrides[source.key] : undefined;
    const status = override?.status || deriveStatus(state, enabled);
    return {
      key: source.key,
      label: source.label,
      description: source.description,
      enabled,
      status,
      statusLabel: getStatusLabel(status),
      message: override?.message || buildStatusMessage(state, status, enabled),
      lastCheckAt: override?.lastCheckAt || state.lastCheckAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      temporaryFailure: state.temporaryFailure,
      lastSearch: state.lastSearch,
      searchMetrics: buildSourceSearchMetrics(state),
    };
  });

  const enabledIndexers = indexers.filter(indexer => indexer.enabled);
  const unavailableCount = enabledIndexers.filter(indexer => indexer.status === 'unavailable').length;
  const degraded = enabledIndexers.some(indexer => ['unstable', 'unavailable'].includes(indexer.status));
  const ok = enabledIndexers.length === 0 || unavailableCount < enabledIndexers.length;
  const health = buildHealthSummary(enabledIndexers);

  return {
    ok,
    degraded,
    health,
    indexers,
    events: [...recentEvents],
    activity: buildSearchActivitySnapshot(),
  };
}

function createInitialState(source) {
  return {
    key: source.key,
    label: source.label,
    lastCheckAt: undefined,
    lastSuccessAt: undefined,
    lastFailureAt: undefined,
    lastFailureEventAt: undefined,
    lastFailureSignature: undefined,
    lastResult: undefined,
    lastError: undefined,
    consecutiveFailures: 0,
    temporaryFailure: false,
    lastSearch: undefined,
    searchMetricsByDay: new Map(),
  };
}

function recordSourceSearchMetrics(state, { resultCount, durationMs, outcome, timestamp }) {
  const day = getMetricDayKey(timestamp);
  const daily = state.searchMetricsByDay.get(day) || {
    searchCount: 0,
    successCount: 0,
    failureCount: 0,
    resultCount: 0,
    durationTotalMs: 0,
    durationSampleCount: 0,
  };
  daily.searchCount += 1;
  if (outcome === 'failure') {
    daily.failureCount += 1;
  } else if (outcome === 'success') {
    daily.successCount += 1;
    daily.resultCount += resultCount;
  }
  if (durationMs !== undefined) {
    daily.durationTotalMs += durationMs;
    daily.durationSampleCount += 1;
  }
  state.searchMetricsByDay.set(day, daily);

  const retainedDays = new Set(getMetricDayKeys(timestamp, SOURCE_METRIC_DAY_LIMIT));
  for (const existingDay of state.searchMetricsByDay.keys()) {
    if (!retainedDays.has(existingDay)) state.searchMetricsByDay.delete(existingDay);
  }
}

function buildSourceSearchMetrics(state) {
  const cutoff = new Set(getMetricDayKeys(Date.now(), SOURCE_METRIC_DAY_LIMIT));
  const total = {
    searchCount: 0,
    successCount: 0,
    failureCount: 0,
    resultCount: 0,
    durationTotalMs: 0,
    durationSampleCount: 0,
  };
  for (const [day, daily] of state.searchMetricsByDay) {
    if (!cutoff.has(day)) continue;
    total.searchCount += daily.searchCount;
    total.successCount += daily.successCount;
    total.failureCount += daily.failureCount;
    total.resultCount += daily.resultCount;
    total.durationTotalMs += daily.durationTotalMs;
    total.durationSampleCount += daily.durationSampleCount;
  }
  return {
    periodDays: SOURCE_METRIC_DAY_LIMIT,
    searchCount: total.searchCount,
    successfulSearchCount: total.successCount,
    failedSearchCount: total.failureCount,
    resultSampleCount: total.successCount,
    durationSampleCount: total.durationSampleCount,
    averageResults: total.successCount ? total.resultCount / total.successCount : null,
    averageDurationMs: total.durationSampleCount
      ? total.durationTotalMs / total.durationSampleCount
      : null,
  };
}

function buildHealthSummary(enabledIndexers) {
  const counts = {
    enabled: enabledIndexers.length,
    online: enabledIndexers.filter(indexer => indexer.status === 'online').length,
    unstable: enabledIndexers.filter(indexer => indexer.status === 'unstable').length,
    unavailable: enabledIndexers.filter(indexer => indexer.status === 'unavailable').length,
    unknown: enabledIndexers.filter(indexer => indexer.status === 'unknown').length,
    partial: enabledIndexers.filter(indexer => indexer.status === 'partial').length,
  };
  const tested = counts.enabled - counts.unknown;
  const hasFailure = counts.unstable > 0 || counts.unavailable > 0;
  const status = counts.enabled === 0 || tested === 0
    ? 'unknown'
    : (counts.unavailable === counts.enabled ? 'unavailable'
      : (hasFailure ? 'degraded'
        : (counts.online === counts.enabled ? 'online' : 'partial')));

  return {
    ...counts,
    tested,
    status,
    dependenciesOk: status === 'online' ? true
      : (status === 'unavailable' || status === 'degraded' ? false : null),
  };
}

function normalizeTimestamp(value) {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
    ? Number(value)
    : Date.now();
}

function normalizeDuration(value) {
  return value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function getMetricDayKeys(timestamp, count) {
  const today = new Date(`${getMetricDayKey(timestamp)}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - count + index + 1);
    return date.toISOString().slice(0, 10);
  });
}

function getMetricDayKey(timestamp) {
  const parts = metricDayFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ensureState(sourceKey) {
  const existing = sourceState.get(sourceKey);
  if (existing) {
    return existing;
  }

  const source = sourceCatalog.get(sourceKey) || {
    key: sourceKey,
    label: sourceKey,
    description: '',
  };
  const created = createInitialState(source);
  sourceState.set(sourceKey, created);
  return created;
}

function deriveStatus(state, enabled) {
  if (!enabled) {
    return 'disabled';
  }
  if (state.lastResult === 'failure') {
    return 'unavailable';
  }
  if (state.lastSuccessAt && state.lastFailureAt) {
    const recoveryWindowStartedAt = Date.parse(state.lastFailureAt);
    if (!Number.isNaN(recoveryWindowStartedAt) && Date.now() - recoveryWindowStartedAt < RECOVERY_WINDOW_MS) {
      return 'unstable';
    }
  }
  if (state.lastSuccessAt) {
    return 'online';
  }
  return 'unknown';
}

function getStatusLabel(status) {
  if (status === 'online') {
    return 'Online';
  }
  if (status === 'unstable') {
    return 'Instável';
  }
  if (status === 'unavailable') {
    return 'Indisponível';
  }
  if (status === 'partial') {
    return 'Parcial';
  }
  if (status === 'disabled') {
    return 'Desativado';
  }
  return 'Aguardando';
}

function buildStatusMessage(state, status, enabled) {
  if (!enabled) {
    return 'Indexador desativado nesta configuração.';
  }
  if (status === 'online') {
    return 'Operando normalmente.';
  }
  if (status === 'unstable') {
    return 'Recuperado recentemente após falha temporária.';
  }
  if (status === 'unavailable') {
    return state.lastError || 'Sem resposta no momento.';
  }
  return 'Aguardando a primeira verificação.';
}

function normalizeErrorMessage(error, label, temporary, details = {}) {
  const reason = error?.message || (temporary
    ? `${label} está temporariamente indisponível.`
    : `Falha ao consultar ${label}.`);
  const diagnostics = [
    details.statusCode ? `HTTP ${details.statusCode}` : undefined,
    details.code ? `código ${details.code}` : undefined,
    details.endpoint ? `endpoint ${details.endpoint}` : undefined,
    details.retryAfterMs != null ? `nova tentativa em ${details.retryAfterMs} ms` : undefined,
  ].filter(Boolean);
  const availability = temporary ? 'indisponibilidade temporária' : 'erro';
  return `${label} com ${availability}: ${reason}${diagnostics.length ? ` (${diagnostics.join(', ')})` : ''}`;
}

function pushEvent(event) {
  recentEvents.unshift({
    timestamp: new Date().toISOString(),
    ...event,
  });
  recentEvents.splice(EVENT_LIMIT);
}

function normalizeRequester(requester = {}) {
  const ip = truncate(requester.ip || 'IP desconhecido', 64);
  const userAgent = truncate(requester.userAgent || 'cliente desconhecido', 160);
  const client = userAgent.split(/[\s/]/)[0] || 'cliente desconhecido';
  return {
    ip,
    userAgent,
    client,
    label: `${client} (${ip})`,
  };
}

function summarizeReleases(rows) {
  return rows.slice(0, EVENT_RELEASE_LIMIT).map(row => ({
    title: truncate(row.torrentTitle || row.fileTitle || row.infoHash || 'Torrent sem título', 240),
    provider: truncate(row.provider || 'desconhecido', 80),
    source: truncate(row._source || 'desconhecida', 40),
    infoHash: truncate(row.infoHash || '', 64),
    magnetUrl: buildSafeMagnetUrl(row),
  }));
}

function buildSafeMagnetUrl(row) {
  if (!row?.infoHash) {
    return undefined;
  }
  try {
    return buildMagnetUrl(row);
  } catch {
    return undefined;
  }
}


function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
}

function extractErrorDetails(error = {}) {
  const statusCode = error.statusCode || error.response?.status;
  const code = error.code || error.cause?.code;
  const endpoint = sanitizeEndpoint(error.config?.url || error.cause?.config?.url);
  return {
    statusCode,
    code,
    endpoint,
    retryAfterMs: error.retryAfterMs,
    circuitState: error.circuitState,
  };
}

function sanitizeEndpoint(rawUrl) {
  if (!rawUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return truncate(rawUrl, 160).split('?')[0];
  }
}

function truncate(value, maxLength) {
  const normalized = `${value || ''}`.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function isCooldownExpired(lastTimestamp) {
  if (!lastTimestamp) {
    return true;
  }
  const lastTime = Date.parse(lastTimestamp);
  return Number.isNaN(lastTime) || Date.now() - lastTime >= FAILURE_EVENT_COOLDOWN_MS;
}
