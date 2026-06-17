import { SOURCE_OPTIONS } from './source.js';

const EVENT_LIMIT = 10;
const FAILURE_EVENT_COOLDOWN_MS = 2 * 60 * 1000;
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

const sourceCatalog = new Map(SOURCE_OPTIONS.map(source => [source.key, source]));
const sourceState = new Map(SOURCE_OPTIONS.map(source => [source.key, createInitialState(source)]));
const recentEvents = [];

export function recordConfigurationSaved({ providers = [], sources = [] } = {}) {
  pushEvent({
    level: 'info',
    kind: 'config',
    message: `Configuração salva com ${sources.length || 0} indexador(es) e ${providers.length || 0} provider(s).`,
  });
}

export function recordSearchEvent({ action, query, count } = {}) {
  const label = buildSearchLabel(action, query);
  pushEvent({
    level: 'info',
    kind: 'search',
    message: `${label} retornou ${count} resultado(s).`,
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
  const message = normalizeErrorMessage(error, state.label, temporary);
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
    });
    state.lastFailureSignature = signature;
    state.lastFailureEventAt = now;
  }
}

export function buildStatusSnapshot(activeSources = []) {
  const activeSet = new Set(activeSources);
  const indexers = SOURCE_OPTIONS.map(source => {
    const state = ensureState(source.key);
    const enabled = activeSet.has(source.key);
    const status = deriveStatus(state, enabled);
    return {
      key: source.key,
      label: source.label,
      description: source.description,
      enabled,
      status,
      statusLabel: getStatusLabel(status),
      message: buildStatusMessage(state, status, enabled),
      lastCheckAt: state.lastCheckAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      temporaryFailure: state.temporaryFailure,
    };
  });

  const enabledIndexers = indexers.filter(indexer => indexer.enabled);
  const unavailableCount = enabledIndexers.filter(indexer => indexer.status === 'unavailable').length;
  const degraded = unavailableCount > 0 && unavailableCount < enabledIndexers.length;
  const ok = enabledIndexers.length === 0 || unavailableCount < enabledIndexers.length;

  return {
    ok,
    degraded,
    indexers,
    events: [...recentEvents],
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
  };
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

function normalizeErrorMessage(error, label, temporary) {
  if (temporary) {
    return error?.message || `${label} está temporariamente indisponível.`;
  }
  return error?.message || `Falha ao consultar ${label}.`;
}

function buildSearchLabel(action, query = {}) {
  const lookup = `${query.q || query.imdbid || 'geral'}`.trim();
  if (action === 'tvsearch') {
    return `Busca de série: ${lookup}`;
  }
  if (action === 'movie') {
    return `Busca de filme: ${lookup}`;
  }
  return `Busca geral: ${lookup}`;
}

function pushEvent(event) {
  recentEvents.unshift({
    timestamp: new Date().toISOString(),
    ...event,
  });
  recentEvents.splice(EVENT_LIMIT);
}

function isCooldownExpired(lastTimestamp) {
  if (!lastTimestamp) {
    return true;
  }
  const lastTime = Date.parse(lastTimestamp);
  return Number.isNaN(lastTime) || Date.now() - lastTime >= FAILURE_EVENT_COOLDOWN_MS;
}
