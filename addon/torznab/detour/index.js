import { createDetourSearchService } from './service.js';
import {
  DETOUR_SOURCE,
  PROVIDER_HDRTORRENT,
  PROVIDER_COMANDO,
  DETOUR_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  getProviderConfig,
} from './constants.js';
import { parseReleaseGuid } from '../release.js';
import { getAdapterConfiguration } from '../runtimeConfig.js';
import { buildDetourProviderQuery } from './query.js';

const PROVIDER_RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const PROVIDER_RESPONSE_WAIT_MS = 6000;

let defaultService;

export function getDetourService() {
  if (!defaultService) {
    defaultService = createDetourSearchService();
  }
  return defaultService;
}

export async function searchDetourReleaseRows(options = {}) {
  const service = getDetourService();
  const config = getAdapterConfiguration();
  const enabledProviders = getEffectiveDetourProviders(options.detourProviders || config.detour?.providers);

  if (!enabledProviders.length) {
    return tagSearchObservation([], 'inconclusive', 'Nenhum provedor Scraper habilitado.');
  }

  const query = resolveSearchQuery(options);
  if (!query) {
    return tagSearchObservation([], 'inconclusive', 'Consulta textual indisponível para o Scraper.');
  }

  const type = options.type === 'movie' ? 'movie' : (options.types?.includes('series') || options.season ? 'series' : undefined);
  const limit = options.limit || 100;

  const searchPromises = enabledProviders.map(providerId =>
    service.search({
      providerId,
      query: buildDetourProviderQuery(providerId, { ...options, query }),
      type,
      imdbId: options.imdbId,
      season: options.season,
      episode: undefined,
      responseWaitMs: PROVIDER_RESPONSE_WAIT_MS,
    })
  );

  const results = await Promise.all(searchPromises);
  const merged = mergeDetourProviderResults(enabledProviders, results, limit);
  const combinedRows = merged.rows;

  const hasValidResponse = results.some(result => ['success', 'no_results'].includes(result.outcome));
  const hasInconclusiveResponse = results.some(result => ['pending', 'busy', 'inconclusive', 'unrecognized', 'no_valid_results'].includes(result.outcome));
  const outcome = hasValidResponse ? 'success' : (hasInconclusiveResponse ? 'inconclusive' : 'failure');
  const failureMessage = results.flatMap(result => result.errors || [])
    .map(error => error.code)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  return tagSearchObservation(combinedRows, outcome, failureMessage || undefined, {
    providers: merged.providers,
    responseWaitMs: PROVIDER_RESPONSE_WAIT_MS,
  });
}

export function mergeDetourProviderResults(providerIds, results, limit = 100) {
  const parsedLimit = Number(limit);
  const maxResults = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;
  const providerStats = results.map((result, index) => ({
    id: providerIds[index],
    name: getProviderConfig(providerIds[index]).name,
    outcome: result.outcome || 'unknown',
    foundCount: Array.isArray(result.rows) ? result.rows.length : 0,
    returnedCount: 0,
    duplicateCount: 0,
    omittedByLimit: 0,
  }));
  const rows = [];
  const cursors = results.map(() => 0);
  const seenHashes = new Set();
  let progressed = true;

  while (rows.length < maxResults && progressed) {
    progressed = false;
    for (let index = 0; index < results.length; index += 1) {
      const providerRows = Array.isArray(results[index].rows) ? results[index].rows : [];
      while (cursors[index] < providerRows.length) {
        const row = providerRows[cursors[index]];
        cursors[index] += 1;
        progressed = true;
        const hashKey = row.infoHash?.toLowerCase();
        if (!hashKey) continue;
        if (seenHashes.has(hashKey)) {
          providerStats[index].duplicateCount += 1;
          continue;
        }
        seenHashes.add(hashKey);
        rows.push({ ...row, _source: DETOUR_SOURCE });
        providerStats[index].returnedCount += 1;
        break;
      }
      if (rows.length >= maxResults) break;
    }
  }

  countOmittedProviderRows(results, cursors, seenHashes, providerStats);
  return { rows, providers: providerStats };
}

function countOmittedProviderRows(results, cursors, seenHashes, providerStats) {
  results.forEach((result, index) => {
    const providerRows = Array.isArray(result.rows) ? result.rows : [];
    for (let cursor = cursors[index]; cursor < providerRows.length; cursor += 1) {
      const hashKey = providerRows[cursor].infoHash?.toLowerCase();
      if (!hashKey) continue;
      if (seenHashes.has(hashKey)) {
        providerStats[index].duplicateCount += 1;
      } else {
        seenHashes.add(hashKey);
        providerStats[index].omittedByLimit += 1;
      }
    }
  });
}

function tagSearchObservation(rows, outcome, message, diagnostics = {}) {
  Object.defineProperty(rows, 'searchObservation', { value: { outcome, message }, enumerable: false });
  Object.defineProperty(rows, 'searchDiagnostics', { value: diagnostics, enumerable: false });
  return rows;
}

export async function getDetourReleaseRowByGuid(guid) {
  const service = getDetourService();
  const parsed = parseReleaseGuid(guid);
  if (!parsed.infoHash) {
    return undefined;
  }
  return service.findReleaseByInfoHash(parsed.infoHash);
}

export async function probeDetourProvider(providerId, query) {
  const service = getDetourService();
  return service.probeProvider(providerId, query);
}

export function getDetourRuntimeStatus() {
  const service = getDetourService();
  const config = getAdapterConfiguration();
  const enabledProviders = new Set(getEffectiveDetourProviders(config.detour?.providers));
  const rawStatus = service.getStatus();
  const enabled = Boolean(config.detour?.enabled || config.sources?.includes(DETOUR_SOURCE));
  const providers = Object.entries(rawStatus.providers).map(([id, provider]) => {
    const selected = enabledProviders.has(id);
    const status = deriveProviderStatus(selected, provider.state, provider.history);
    return {
      id,
      name: provider.name,
      baseUrl: getProviderConfig(id).baseUrl,
      selected,
      enabled: selected,
      state: selected ? provider.state : 'disabled',
      status,
      statusLabel: getProviderStatusLabel(status, provider.history.lastOutcome),
      lastCheckAt: provider.history.lastVerifiedAt,
      circuit: provider.circuit,
      history: provider.history,
    };
  });
  const health = summarizeProviderHealth(providers.filter(provider => provider.enabled));

  return {
    enabled,
    state: enabled ? rawStatus.state : 'disabled',
    status: enabled ? health.status : 'disabled',
    statusLabel: getProviderStatusLabel(enabled ? health.status : 'disabled'),
    message: health.message,
    lastCheckAt: health.lastCheckAt,
    health,
    providers,
    cache: rawStatus.cache,
    tasks: rawStatus.tasks,
    metrics: rawStatus.metrics,
  };
}

function deriveProviderStatus(selected, circuitState, history = {}, now = Date.now()) {
  if (!selected) return 'disabled';
  if (circuitState === 'open') return 'unavailable';
  if (circuitState === 'half-open') return 'unstable';
  if (['pending', 'busy'].includes(history.lastOutcome)) return 'unstable';
  if (!history.lastVerifiedAt) return 'unknown';

  if (['success', 'no_results'].includes(history.lastVerifiedOutcome)) {
    const lastFailureAt = Date.parse(history.lastFailureAt || '');
    const lastSuccessAt = Date.parse(history.lastSuccessAt || '');
    if (lastSuccessAt > lastFailureAt && now - lastFailureAt < PROVIDER_RECOVERY_WINDOW_MS) return 'unstable';
    return 'online';
  }
  if (['inconclusive', 'unrecognized', 'no_valid_results'].includes(history.lastVerifiedOutcome)) return 'unstable';
  return 'unavailable';
}

function summarizeProviderHealth(providers) {
  const online = providers.filter(provider => provider.status === 'online').length;
  const unstable = providers.filter(provider => provider.status === 'unstable').length;
  const unavailable = providers.filter(provider => provider.status === 'unavailable').length;
  const unknown = providers.filter(provider => provider.status === 'unknown').length;
  const checked = providers.length - unknown;
  const status = !checked ? 'unknown'
    : (unavailable === providers.length ? 'unavailable'
      : (unstable || (unavailable && online) ? 'unstable'
        : (online === providers.length ? 'online'
          : (unknown ? 'partial' : 'unavailable'))));
  const lastCheckAt = providers
    .map(provider => provider.lastCheckAt)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return {
    enabled: providers.length,
    checked,
    online,
    unstable,
    unavailable,
    unknown,
    status,
    lastCheckAt,
    message: buildProviderHealthMessage(status, { online, unknown, unavailable }),
  };
}

function buildProviderHealthMessage(status, counts) {
  if (status === 'online') return 'Os provedores testados responderam normalmente.';
  if (status === 'unavailable') return 'Os provedores testados não responderam.';
  if (status === 'unstable') return 'As respostas recentes incluem falhas ou recuperação.';
  if (status === 'partial') return `${counts.online} online; ${counts.unavailable} indisponível(is) e ${counts.unknown} sem teste.`;
  return 'Sem busca ou teste real registrado nos provedores.';
}

function getProviderStatusLabel(status, outcome) {
  if (status === 'unstable' && outcome === 'pending') return 'Em andamento';
  if (status === 'unstable' && outcome === 'busy') return 'Fila ocupada';
  const labels = {
    online: 'Online',
    unstable: 'Instável',
    unavailable: 'Indisponível',
    partial: 'Parcial',
    disabled: 'Desativado',
  };
  return labels[status] || 'Sem teste';
}

export function isTemporaryDetourError(error) {
  const code = String(error?.code || error?.message || '').toLowerCase();
  const statusCode = Number(error?.statusCode || error?.response?.status);
  return (
    code.includes('circuit') ||
    code.includes('circuit_open') ||
    code.includes('timeout') ||
    code.includes('econn') ||
    code.includes('etimedout') ||
    code.includes('eai_again') ||
    code.includes('enetunreach') ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode < 600)
  );
}

function getEffectiveDetourProviders(configuredProviders) {
  if (Array.isArray(configuredProviders) && configuredProviders.length) {
    const valid = new Set(DETOUR_PROVIDERS);
    return configuredProviders
      .map(p => `${p || ''}`.trim().toLowerCase())
      .filter(p => valid.has(p));
  }
  return [PROVIDER_HDRTORRENT];
}

function resolveSearchQuery(options) {
  if (options.query) {
    return options.query.trim();
  }
  if (options.q) {
    return options.q.trim();
  }
  return undefined;
}

export {
  DETOUR_SOURCE,
  PROVIDER_HDRTORRENT,
  PROVIDER_COMANDO,
  DETOUR_PROVIDERS,
  DEFAULT_PROVIDER_ID,
};
