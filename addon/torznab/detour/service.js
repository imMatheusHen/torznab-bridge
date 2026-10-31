import { TtlCache } from '../iptv/embedtv/cache.js';
import { normalizeDetailPageLimit, scrapeProvider } from './scraper.js';
import {
  DEFAULT_PROVIDER_ID,
  DETOUR_PROVIDERS,
  buildProviderSearchUrl,
  getProviderConfig,
} from './constants.js';

const DEFAULT_FRESH_TTL_MS = 60 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 200;
const DEFAULT_RESPONSE_WAIT_MS = 2000;
const DEFAULT_MAX_TASK_MS = 25 * 1000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUED = 2;
const DEFAULT_BLOCK_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_TRANSIENT_FAILURE_THRESHOLD = 3;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 2 * 60 * 1000;
const DEFAULT_PROBE_COOLDOWN_MS = 60 * 1000;

export class DetourSearchService {
  constructor(options = {}) {
    this.scrape = options.scrape || scrapeProvider;
    this.clock = options.clock || (() => Date.now());
    this.maxTaskMs = positiveInteger(options.maxTaskMs, DEFAULT_MAX_TASK_MS);
    this.responseWaitMs = nonNegativeInteger(options.responseWaitMs, DEFAULT_RESPONSE_WAIT_MS);
    this.maxConcurrent = positiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
    this.maxQueued = nonNegativeInteger(options.maxQueued, DEFAULT_MAX_QUEUED);
    this.blockCooldownMs = positiveInteger(options.blockCooldownMs, DEFAULT_BLOCK_COOLDOWN_MS);
    this.transientFailureThreshold = positiveInteger(options.transientFailureThreshold, DEFAULT_TRANSIENT_FAILURE_THRESHOLD);
    this.transientCooldownMs = positiveInteger(options.transientCooldownMs, DEFAULT_TRANSIENT_COOLDOWN_MS);
    this.probeCooldownMs = positiveInteger(options.probeCooldownMs, DEFAULT_PROBE_COOLDOWN_MS);
    this.cache = options.cache || new TtlCache({
      ttlMs: positiveInteger(options.freshTtlMs, DEFAULT_FRESH_TTL_MS),
      staleMs: positiveInteger(options.staleTtlMs, DEFAULT_STALE_TTL_MS),
      maxEntries: positiveInteger(options.maxEntries, DEFAULT_CACHE_MAX_ENTRIES),
      clock: this.clock,
    });

    this.tasks = new Map();
    this.queue = [];
    this.activeTasks = 0;
    this.circuits = new Map();
    this.providerHistory = new Map();
    this.probeInFlight = new Map();
    this.lastProbeAt = new Map();
    this.metrics = {
      freshHits: 0,
      staleHits: 0,
      misses: 0,
      joined: 0,
      pendingResponses: 0,
      completed: 0,
      noResults: 0,
      blocked: 0,
      failed: 0,
      hardTimeouts: 0,
      queuedExpired: 0,
      transientCircuitOpens: 0,
      halfOpenProbeFailures: 0,
      rejectedBusy: 0,
    };
  }

  async search(options = {}) {
    const query = String(options.query || '').trim();
    const type = options.type === 'series' ? 'series' : 'movie';
    if (!query || query.length > 200) {
      return responseResult({ query, type, outcome: 'invalid_query', rows: [] });
    }

    const providerId = options.providerId || DEFAULT_PROVIDER_ID;
    let baseUrl;
    try {
      const provider = getProviderConfig(providerId);
      baseUrl = options.baseUrl || provider.baseUrl;
      buildProviderSearchUrl(providerId, query, baseUrl);
    } catch (error) {
      const invalidProvider = error?.code === 'UNKNOWN_PROVIDER';
      return responseResult({
        query,
        type,
        providerId,
        outcome: invalidProvider ? 'invalid_provider' : 'invalid_base_url',
        rows: [],
        errors: [{ code: error?.code || 'INVALID_PROVIDER_URL' }],
      });
    }

    const taskOptions = {
      ...options,
      query,
      type,
      providerId,
      baseUrl,
      maxDetailPages: normalizeDetailPageLimit(options.maxDetailPages),
    };

    const key = canonicalSearchKey(taskOptions);
    const cached = this.cache.peek(key);

    if (cached?.state === 'fresh' && !options.forceRefresh) {
      this.metrics.freshHits += 1;
      this.recordHistory(providerId, {
        query,
        outcome: cached.value.outcome,
        count: cached.value.rows?.length || 0,
        source: 'fresh_cache',
        durationMs: undefined,
      });
      return responseResult(cached.value, {
        cacheState: 'fresh',
        cachedAt: cached.cachedAt,
        ageMs: cached.ageMs,
      });
    }

    if (cached?.state === 'stale' && !options.forceRefresh) {
      this.metrics.staleHits += 1;
      let refresh = 'already_inflight';
      if (!this.getCircuitOpen(this.clock(), providerId)) {
        const scheduled = this.getOrScheduleTask(key, taskOptions);
        refresh = scheduled.task ? (scheduled.created ? 'scheduled' : 'already_inflight') : 'busy';
        if (!scheduled.task) this.metrics.rejectedBusy += 1;
      } else {
        refresh = 'circuit_open';
      }
      this.recordHistory(providerId, {
        query,
        outcome: cached.value.outcome,
        count: cached.value.rows?.length || 0,
        source: 'stale_cache',
        durationMs: undefined,
      });
      return responseResult(cached.value, {
        cacheState: 'stale',
        cachedAt: cached.cachedAt,
        ageMs: cached.ageMs,
        refresh,
      });
    }

    this.metrics.misses += 1;
    if (this.getCircuitOpen(this.clock(), providerId)) {
      const result = this.blockedCircuitResult(query, type, providerId);
      this.recordHistory(providerId, {
        query,
        outcome: 'blocked',
        count: 0,
        source: 'circuit_open',
      });
      return result;
    }

    const scheduled = this.getOrScheduleTask(key, taskOptions);
    if (!scheduled.task) {
      this.metrics.rejectedBusy += 1;
      this.recordHistory(providerId, { query, outcome: 'busy', count: 0, source: 'queue' });
      return responseResult({ query, type, outcome: 'busy', rows: [], errors: [{ code: 'PROVIDER_QUEUE_FULL' }] }, {
        cacheState: 'miss',
      });
    }

    const startWaitAt = Date.now();
    const waitBudget = nonNegativeInteger(options.responseWaitMs, this.responseWaitMs);
    const waited = await waitForTask(scheduled.task.promise, waitBudget);

    if (waited.completed) {
      this.recordHistory(providerId, {
        query,
        outcome: waited.value.outcome,
        count: waited.value.rows?.length || 0,
        source: scheduled.task.completionSource || 'network',
        durationMs: scheduled.task.completionSource === 'network' ? Date.now() - startWaitAt : undefined,
      });
      return responseResult(waited.value, { cacheState: 'miss' });
    }

    if (scheduled.task.finalized) {
      const completed = await scheduled.task.promise;
      this.recordHistory(providerId, {
        query,
        outcome: completed.outcome,
        count: completed.rows?.length || 0,
        source: scheduled.task.completionSource || 'network',
      });
      return responseResult(completed, { cacheState: 'miss' });
    }

    this.metrics.pendingResponses += 1;
    scheduled.task.pendingResponseReturned = true;
    this.recordHistory(providerId, {
      query,
      outcome: 'pending',
      count: 0,
      source: 'background_in_flight',
      durationMs: Date.now() - startWaitAt,
    });
    return responseResult({
      query,
      type,
      outcome: 'pending',
      rows: [],
      errors: [],
    }, {
      pending: true,
      cacheState: 'miss',
      taskState: scheduled.task.state,
    });
  }

  async probeProvider(providerId = DEFAULT_PROVIDER_ID, query = 'interestelar') {
    const inFlight = this.probeInFlight.get(providerId);
    if (inFlight) return inFlight;

    const now = this.clock();
    const lastProbeAt = this.lastProbeAt.get(providerId);
    if (lastProbeAt !== undefined && now - lastProbeAt < this.probeCooldownMs) {
      return {
        providerId,
        ok: null,
        outcome: 'cooldown',
        retryAfterMs: this.probeCooldownMs - (now - lastProbeAt),
      };
    }

    this.lastProbeAt.set(providerId, now);
    const probe = this.runProviderProbe(providerId, query)
      .finally(() => this.probeInFlight.delete(providerId));
    this.probeInFlight.set(providerId, probe);
    return probe;
  }

  async runProviderProbe(providerId, query) {
    const startedAt = Date.now();
    try {
      const result = await this.search({
        providerId,
        query,
        type: 'movie',
        forceRefresh: true,
        responseWaitMs: this.maxTaskMs,
      });
      const durationMs = Date.now() - startedAt;
      return {
        providerId,
        ok: result.outcome === 'success' || result.outcome === 'no_results',
        outcome: result.outcome,
        count: result.rows?.length || 0,
        durationMs,
        errors: result.errors,
      };
    } catch (error) {
      return {
        providerId,
        ok: false,
        outcome: 'error',
        count: 0,
        durationMs: Date.now() - startedAt,
        error: error.message,
      };
    }
  }

  findReleaseByInfoHash(infoHash) {
    if (!infoHash) return undefined;
    const targetHash = infoHash.toLowerCase();
    this.cache.prune();
    for (const entry of this.cache.entries.values()) {
      const rows = entry?.value?.rows;
      if (Array.isArray(rows)) {
        const found = rows.find(r => r.infoHash?.toLowerCase() === targetHash);
        if (found) return found;
      }
    }
    return undefined;
  }

  recordHistory(providerId, event) {
    const history = this.providerHistory.get(providerId) || {
      lastSearchQuery: undefined,
      lastSearchAt: undefined,
      lastOutcome: undefined,
      lastDurationMs: undefined,
      lastCount: undefined,
      lastSource: undefined,
      lastVerifiedAt: undefined,
      lastVerifiedOutcome: undefined,
      lastVerifiedDurationMs: undefined,
      lastVerifiedCount: undefined,
      lastVerifiedSource: undefined,
      lastSuccessAt: undefined,
      lastFailureAt: undefined,
      lastError: undefined,
    };

    history.lastSearchQuery = event.query;
    history.lastSearchAt = new Date().toISOString();
    history.lastOutcome = event.outcome;
    history.lastDurationMs = event.durationMs;
    history.lastCount = event.count;
    history.lastSource = event.source;

    if (event.source === 'network') {
      history.lastVerifiedAt = history.lastSearchAt;
      history.lastVerifiedOutcome = event.outcome;
      history.lastVerifiedDurationMs = event.durationMs;
      history.lastVerifiedCount = event.count;
      history.lastVerifiedSource = event.source;

      if (event.outcome === 'success' || event.outcome === 'no_results') {
        history.lastSuccessAt = history.lastSearchAt;
        history.lastError = undefined;
      } else if (!['pending', 'busy', 'inconclusive', 'unrecognized', 'no_valid_results'].includes(event.outcome)) {
        history.lastFailureAt = history.lastSearchAt;
        history.lastError = event.error || event.outcome;
      }
    }

    this.providerHistory.set(providerId, history);
  }

  getStatus() {
    const now = this.clock();
    const cache = this.cache.stats();
    const providersStatus = {};

    for (const providerId of DETOUR_PROVIDERS) {
      const circuit = this.describeCircuit(providerId, now);
      const history = this.providerHistory.get(providerId) || {};
      const config = getProviderConfig(providerId);

      providersStatus[providerId] = {
        id: providerId,
        name: config.name,
        state: circuit.state,
        circuit,
        history,
      };
    }

    const openCircuits = Object.values(providersStatus).filter(p => p.state === 'open');

    return {
      state: openCircuits.length === DETOUR_PROVIDERS.length ? 'unavailable' : (openCircuits.length ? 'degraded' : 'ready'),
      providers: providersStatus,
      cache,
      tasks: {
        active: this.activeTasks,
        queued: this.queue.length,
        inFlightKeys: this.tasks.size,
        maxConcurrent: this.maxConcurrent,
        maxQueued: this.maxQueued,
        maxTaskMs: this.maxTaskMs,
        responseWaitMs: this.responseWaitMs,
      },
      metrics: { ...this.metrics },
    };
  }

  getOrScheduleTask(key, options) {
    const existing = this.tasks.get(key);
    if (existing) {
      this.metrics.joined += 1;
      return { task: existing, created: false };
    }

    if (this.activeTasks >= this.maxConcurrent && this.queue.length >= this.maxQueued) {
      return { task: undefined, created: false };
    }

    const task = createTask(key, options, this.maxTaskMs);
    this.tasks.set(key, task);
    task.timer = setTimeout(() => this.expireTask(task), this.maxTaskMs);

    if (this.activeTasks < this.maxConcurrent) {
      this.startTask(task);
    } else {
      task.state = 'queued';
      this.queue.push(task);
    }
    return { task, created: true };
  }

  startTask(task) {
    if (task.finalized) return;
    if (Date.now() >= task.deadlineAtMs) {
      this.expireTask(task);
      return;
    }
    const circuit = this.getCircuit(task.options.providerId);
    if (this.getCircuitOpen(this.clock(), task.options.providerId)) {
      this.finishQueuedTask(task, this.blockedCircuitResult(
        task.options.query,
        task.options.type,
        task.options.providerId,
      ), 'circuit_open');
      return;
    }
    if (circuit.openUntilMs && circuit.openUntilMs <= this.clock()) {
      if (circuit.halfOpenProbeInFlight) {
        this.finishQueuedTask(task, this.blockedCircuitResult(
          task.options.query,
          task.options.type,
          task.options.providerId,
        ));
        return;
      }
      circuit.halfOpenProbeInFlight = true;
      task.halfOpenProbe = true;
    }

    task.state = 'active';
    task.startedAtMs = Date.now();
    task.controller = new AbortController();
    this.activeTasks += 1;

    const taskMaxTotalMs = Math.max(1, Math.min(
      this.maxTaskMs,
      positiveInteger(task.options.maxTotalMs, this.maxTaskMs),
      task.deadlineAtMs - Date.now(),
    ));

    Promise.resolve()
      .then(() => this.scrape({
        ...task.options,
        signal: task.controller.signal,
        maxTotalMs: taskMaxTotalMs,
      }))
      .then(result => this.finishTask(task, result))
      .catch(error => this.finishTask(task, thrownResult(task.options, error)));
  }

  expireTask(task) {
    if (task.finalized || task.timedOut) return;
    task.timedOut = true;
    const queued = task.state !== 'active';
    const result = responseResult({
      query: task.options.query,
      type: task.options.type,
      outcome: queued ? 'busy' : 'timeout',
      rows: [],
      errors: [{ code: queued ? 'TASK_QUEUE_DEADLINE_EXCEEDED' : 'TASK_DEADLINE_EXCEEDED' }],
    }, { cacheState: 'miss' });

    if (queued) {
      this.metrics.queuedExpired += 1;
      this.finishQueuedTask(task, result, 'queue');
      return;
    }

    this.metrics.hardTimeouts += 1;
    task.controller?.abort();
    this.recordOutcome(task.key, result, task);
    if (task.pendingResponseReturned) {
      this.recordHistory(task.options.providerId, { query: task.options.query, outcome: result.outcome, count: 0, source: 'network', durationMs: Date.now() - (task.startedAtMs || Date.now()) });
      task.pendingResponseReturned = false;
    }
    task.completionSource = 'network';
    task.resolve(result);
    task.responseSettled = true;
  }

  finishTask(task, rawResult) {
    if (task.finalized) return;
    task.finalized = true;
    clearTimeout(task.timer);

    const expired = task.timedOut || Date.now() >= task.deadlineAtMs;
    const result = expired
      ? responseResult({
        query: task.options.query,
        type: task.options.type,
        outcome: 'timeout',
        rows: [],
        errors: [{ code: 'TASK_DEADLINE_EXCEEDED' }],
      }, { cacheState: 'miss' })
      : normalizeScrapeResult(task.options, rawResult);

    if (expired && !task.timedOut) {
      task.timedOut = true;
      this.metrics.hardTimeouts += 1;
      task.controller?.abort();
      this.recordOutcome(task.key, result, task);
    } else if (!expired) {
      this.recordOutcome(task.key, result, task);
    }

    task.completionSource = 'network';
    if (task.pendingResponseReturned) {
      this.recordHistory(task.options.providerId, {
        query: task.options.query,
        outcome: result.outcome,
        count: result.rows?.length || 0,
        source: 'network',
        durationMs: Date.now() - (task.startedAtMs || Date.now()),
        error: result.errors?.[0]?.code,
      });
      task.pendingResponseReturned = false;
    }

    if (!task.responseSettled) {
      task.resolve(result);
      task.responseSettled = true;
    }

    this.tasks.delete(task.key);
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.drainQueue();
  }

  finishQueuedTask(task, result, source = 'queue') {
    task.finalized = true;
    task.completionSource = source;
    if (task.pendingResponseReturned) {
      this.recordHistory(task.options.providerId, {
        query: task.options.query,
        outcome: result.outcome,
        count: result.rows?.length || 0,
        source,
        error: result.errors?.[0]?.code,
      });
      task.pendingResponseReturned = false;
    }
    clearTimeout(task.timer);
    this.queue = this.queue.filter(queuedTask => queuedTask !== task);
    this.tasks.delete(task.key);
    task.resolve(result);
    task.responseSettled = true;
  }

  drainQueue() {
    while (this.activeTasks < this.maxConcurrent && this.queue.length) {
      const next = this.queue.shift();
      if (!this.tasks.has(next.key)) continue;
      if (Date.now() >= next.deadlineAtMs) {
        this.expireTask(next);
        continue;
      }
      if (this.getCircuitOpen(this.clock(), next.options.providerId)) {
        this.finishQueuedTask(next, this.blockedCircuitResult(
          next.options.query,
          next.options.type,
          next.options.providerId,
        ), 'circuit_open');
        continue;
      }
      this.startTask(next);
    }
  }

  recordOutcome(key, result, task) {
    const providerId = task?.options.providerId || DEFAULT_PROVIDER_ID;
    const circuit = this.getCircuit(providerId);

    if (isBlockedResult(result)) {
      const blockedCode = getBlockedCode(result);
      const now = this.clock();
      circuit.openUntilMs = now + this.blockCooldownMs;
      circuit.reason = 'blocked';
      circuit.consecutiveFailures = 0;
      circuit.halfOpenProbeInFlight = false;
      circuit.lastBlockedAt = now;
      circuit.lastBlockedCode = blockedCode;
      this.metrics.blocked += 1;
      return;
    }

    if (result.outcome === 'success' && result.rows.length > 0) {
      this.resetCircuit(providerId);
      this.cache.set(key, cacheableSnapshot(result));
      this.metrics.completed += 1;
      return;
    }

    if (result.outcome === 'no_results' && result.rows.length === 0) {
      this.resetCircuit(providerId);
      this.cache.set(key, cacheableSnapshot(result));
      this.metrics.noResults += 1;
      return;
    }

    this.metrics.failed += 1;
    if (isTransientFailure(result)) {
      this.recordTransientFailure(result, task);
    } else if (task?.halfOpenProbe) {
      circuit.halfOpenProbeInFlight = false;
      task.halfOpenProbe = false;
    }
  }

  getCircuit(providerId = DEFAULT_PROVIDER_ID) {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = {
        openUntilMs: 0,
        reason: undefined,
        consecutiveFailures: 0,
        lastFailureAt: undefined,
        lastFailureCode: undefined,
        lastBlockedAt: undefined,
        lastBlockedCode: undefined,
        halfOpenProbeInFlight: false,
      };
      this.circuits.set(providerId, circuit);
    }
    return circuit;
  }

  describeCircuit(providerId, now = this.clock()) {
    const circuit = this.getCircuit(providerId);
    return {
      state: this.getCircuitState(now, providerId),
      halfOpenProbeInFlight: circuit.halfOpenProbeInFlight,
      openUntilMs: circuit.openUntilMs || undefined,
      retryAfterMs: Math.max(0, circuit.openUntilMs - now),
      reason: circuit.reason,
      consecutiveFailures: circuit.consecutiveFailures,
      lastFailureAt: circuit.lastFailureAt,
      lastFailureCode: circuit.lastFailureCode,
      lastBlockedAt: circuit.lastBlockedAt,
      lastBlockedCode: circuit.lastBlockedCode,
    };
  }

  resetCircuit(providerId = DEFAULT_PROVIDER_ID) {
    const circuit = this.getCircuit(providerId);
    circuit.openUntilMs = 0;
    circuit.reason = undefined;
    circuit.consecutiveFailures = 0;
    circuit.halfOpenProbeInFlight = false;
  }

  recordTransientFailure(result, task) {
    const circuit = this.getCircuit(task?.options.providerId || DEFAULT_PROVIDER_ID);
    const now = this.clock();
    circuit.consecutiveFailures += 1;
    circuit.lastFailureAt = now;
    circuit.lastFailureCode = result.errors?.[0]?.code || result.outcome;

    if (task?.halfOpenProbe) {
      circuit.openUntilMs = now + this.transientCooldownMs;
      circuit.reason = 'half_open_failure';
      circuit.consecutiveFailures = this.transientFailureThreshold;
      circuit.halfOpenProbeInFlight = false;
      task.halfOpenProbe = false;
      this.metrics.halfOpenProbeFailures += 1;
      this.metrics.transientCircuitOpens += 1;
      return;
    }

    if (circuit.consecutiveFailures >= this.transientFailureThreshold) {
      circuit.openUntilMs = now + this.transientCooldownMs;
      circuit.reason = 'transient_failures';
      this.metrics.transientCircuitOpens += 1;
    }
  }

  getCircuitState(now = this.clock(), providerId = DEFAULT_PROVIDER_ID) {
    const circuit = this.getCircuit(providerId);
    if (this.getCircuitOpen(now, providerId)) return 'open';
    return circuit.halfOpenProbeInFlight ? 'half-open' : 'closed';
  }

  getCircuitOpen(now = this.clock(), providerId = DEFAULT_PROVIDER_ID) {
    return this.getCircuit(providerId).openUntilMs > now;
  }

  blockedCircuitResult(query, type, providerId = DEFAULT_PROVIDER_ID) {
    const circuit = this.getCircuit(providerId);
    const retryAfterMs = Math.max(0, circuit.openUntilMs - this.clock());
    return responseResult({
      query,
      type,
      outcome: 'blocked',
      rows: [],
      errors: [{
        code: retryAfterMs > 0 ? 'CIRCUIT_OPEN' : 'CIRCUIT_HALF_OPEN_BUSY',
        retryAfterMs: retryAfterMs || (circuit.halfOpenProbeInFlight ? 1000 : 0),
      }],
    }, { cacheState: 'miss', retryAfterMs });
  }
}

export function createDetourSearchService(options = {}) {
  return new DetourSearchService(options);
}

export function canonicalSearchKey({
  providerId = DEFAULT_PROVIDER_ID,
  type,
  query,
  imdbId,
  season,
  episode,
  baseUrl,
  maxDetailPages,
} = {}) {
  const normalizeText = value => String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(baseUrl || getProviderConfig(providerId).baseUrl).origin.toLowerCase();
  } catch {
    normalizedOrigin = String(baseUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  }
  return JSON.stringify([
    providerId,
    normalizedOrigin,
    type === 'series' ? 'series' : 'movie',
    normalizeText(query),
    normalizeText(imdbId),
    Number.isInteger(season) ? season : null,
    Number.isInteger(episode) ? episode : null,
    normalizeDetailPageLimit(maxDetailPages),
  ]);
}

function createTask(key, options, maxTaskMs) {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const createdAtMs = Date.now();
  return {
    key,
    options,
    promise,
    resolve,
    state: 'created',
    createdAtMs,
    deadlineAtMs: createdAtMs + maxTaskMs,
    responseSettled: false,
    finalized: false,
    timedOut: false,
  };
}

function normalizeScrapeResult(options, rawResult) {
  if (!rawResult || typeof rawResult !== 'object') {
    return responseResult({
      query: options.query,
      type: options.type,
      outcome: 'unavailable',
      rows: [],
      errors: [{ code: 'INVALID_SCRAPER_RESULT' }],
    }, { cacheState: 'miss' });
  }

  const result = {
    ...rawResult,
    query: rawResult.query || options.query,
    type: rawResult.type || options.type,
    rows: Array.isArray(rawResult.rows) ? rawResult.rows : [],
    errors: Array.isArray(rawResult.errors) ? rawResult.errors : [],
  };
  return responseResult(result, { cacheState: 'miss' });
}

function thrownResult(options, error) {
  const statusCode = error?.response?.status || error?.statusCode;
  const code = statusCode === 403 ? 'ACCESS_BLOCKED' : (error?.code || 'SCRAPE_ERROR');
  return responseResult({
    query: options.query,
    type: options.type,
    outcome: statusCode === 403 ? 'blocked' : 'unavailable',
    rows: [],
    errors: [{ code, statusCode, message: String(error?.message || 'Scrape failed') }],
  }, { cacheState: 'miss' });
}

function isTransientFailure(result) {
  if (result?.outcome === 'timeout') return true;
  return (result?.errors || []).some(error => {
    const statusCode = Number(error?.statusCode);
    const code = String(error?.code || '').toLowerCase();
    return statusCode === 429 || (statusCode >= 500 && statusCode < 600)
      || /timeout|network|econn|etimedout|eai_again|enetunreach|reset/.test(code);
  });
}

function isBlockedResult(result) {
  if (result?.outcome === 'blocked') return true;
  return (result?.errors || []).some(error => {
    const code = String(error?.code || '').toLowerCase();
    return Number(error?.statusCode) === 403
      || /403|blocked|challenge|captcha|cloudflare/.test(code);
  });
}

function getBlockedCode(result) {
  return result.errors?.find(error => {
    const code = String(error?.code || '').toLowerCase();
    return Number(error?.statusCode) === 403 || /403|blocked|challenge|captcha|cloudflare/.test(code);
  })?.code || 'ACCESS_BLOCKED';
}

function cacheableSnapshot(result) {
  return {
    query: result.query,
    type: result.type,
    providerId: result.providerId,
    provider: result.provider,
    outcome: result.outcome,
    rows: result.rows.map(cloneValue),
    counts: result.counts ? cloneValue(result.counts) : undefined,
    metrics: result.metrics ? cloneValue(result.metrics) : undefined,
    errors: [],
  };
}

function responseResult(result, metadata = {}) {
  const snapshot = cloneValue(result) || {};
  return {
    ...snapshot,
    rows: Array.isArray(snapshot.rows) ? snapshot.rows : [],
    errors: Array.isArray(snapshot.errors) ? snapshot.errors : [],
    pending: Boolean(metadata.pending),
    cacheState: metadata.cacheState || 'miss',
    cachedAt: metadata.cachedAt,
    ageMs: metadata.ageMs,
    refresh: metadata.refresh,
    taskState: metadata.taskState,
    retryAfterMs: metadata.retryAfterMs,
  };
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
}

function waitForTask(promise, waitMs) {
  if (waitMs <= 0) return Promise.resolve({ completed: false });
  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve({ completed: false });
    }, waitMs);
    promise.then(value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ completed: true, value });
    });
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
