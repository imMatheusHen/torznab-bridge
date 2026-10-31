import axios from 'axios';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DEFAULT_PROVIDER_ID,
  getProviderConfig,
  buildProviderSearchUrl,
  buildProviderFallbackUrls,
} from './constants.js';
import { fetchProviderHtml } from './client.js';
import {
  extractProviderListing,
  isBlockedResponse,
  parseProviderDetailHtml,
  isRelevantTitleMatch,
} from './parser.js';

const DEFAULT_TIMEOUT_MS = 18000;
const DEFAULT_MAX_TOTAL_MS = 25000;
const DEFAULT_DETAIL_LIMIT = 3;
const DEFAULT_DELAY_MS = 200;
const MAX_ROWS_PER_SEARCH = 100;

export async function scrapeProvider(options = {}) {
  const context = createContext(options);
  if (!context.query || context.query.length > 200) {
    return emptyResult(context.query, context.type, 'invalid_query');
  }
  if (context.baseError) {
    context.errors.push({ code: context.configError || 'INVALID_BASE_URL' });
    return finishResult(context, context.configError === 'UNKNOWN_PROVIDER' ? 'invalid_provider' : 'invalid_base_url');
  }
  return runSearch(context);
}

function createContext(options) {
  const query = String(options.query || '').trim();
  const startedAt = performance.now();
  let providerId = options.providerId || DEFAULT_PROVIDER_ID;
  let provider;
  let providerError;

  try {
    provider = getProviderConfig(providerId);
  } catch (error) {
    providerId = 'unknown';
    providerError = error?.code || 'UNKNOWN_PROVIDER';
  }

  const context = {
    query,
    type: options.type === 'series' ? 'series' : 'movie',
    startedAt,
    providerId,
    providerName: provider?.name || providerId,
    baseUrl: options.baseUrl || provider?.baseUrl,
    imdbId: String(options.imdbId || '').trim() || undefined,
    season: positiveIntegerOrUndefined(options.season),
    episode: positiveIntegerOrUndefined(options.episode),
    client: options.client || axios,
    signal: options.signal,
    timeoutMs: positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxTotalMs: positiveNumber(options.maxTotalMs, DEFAULT_MAX_TOTAL_MS),
    maxDetailPages: normalizeDetailPageLimit(options.maxDetailPages),
    delayMs: Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : DEFAULT_DELAY_MS,
    sleepFn: options.sleepFn || sleep,
    metrics: {
      totalMs: 0,
      searchLoadMs: null,
      fallbackLoadMs: 0,
      detailLoadMs: 0,
      parseMs: 0,
      requests: [],
    },
    counts: {
      listingEntries: 0,
      relevantEntries: 0,
      detailPages: 0,
      validRows: 0,
      magnetsExtracted: 0,
      invalidMagnets: 0,
      duplicates: 0,
      truncatedRows: 0,
    },
    errors: [],
    rows: [],
    terminalOutcome: null,
    searchUrl: null,
    fallbackUrls: [],
    baseError: false,
    configError: providerError,
  };

  try {
    if (!provider) throw Object.assign(new Error('UNKNOWN_PROVIDER'), { code: 'UNKNOWN_PROVIDER' });
    context.searchUrl = buildProviderSearchUrl(providerId, query, context.baseUrl);
    context.fallbackUrls = buildProviderFallbackUrls(providerId, context.baseUrl);
  } catch (error) {
    context.baseError = true;
    context.configError = error?.code || 'INVALID_BASE_URL';
  }
  return context;
}

async function runSearch(context) {
  let selected = await loadListing(context, context.searchUrl, 'text_search');
  if (selected.outcome) return finishResult(context, selected.outcome);

  if (!selected.listing.recognizable) {
    // If search page is not recognizable, try fallbacks if available
    for (const url of context.fallbackUrls.slice(0, 1)) {
      const fallback = await loadListing(context, url, 'homepage_fallback');
      if (fallback.outcome) return finishResult(context, fallback.outcome);
      selected = fallback;
      if (fallback.listing.recognizable && fallback.relevant.length > 0) {
        break;
      }
    }
  }

  context.counts.relevantEntries = selected.relevant.length;
  if (!selected.listing.recognizable) {
    const code = selected.stage === 'homepage_fallback'
      ? 'UNRECOGNIZED_FALLBACK_LISTING'
      : 'UNRECOGNIZED_SEARCH_PAGE';
    context.errors.push({ code });
    return finishResult(context, selected.stage === 'homepage_fallback' ? 'inconclusive' : 'unrecognized');
  }

  if (!selected.relevant.length) {
    if (selected.stage === 'homepage_fallback') {
      context.errors.push({ code: 'LIMITED_FALLBACK_INCOMPLETE' });
      return finishResult(context, 'inconclusive');
    }
    return finishResult(context, 'no_results');
  }

  await collectDetailPages(context, selected.relevant);
  const outcome = context.terminalOutcome
    || (context.rows.length ? 'success' : 'no_valid_results');
  return finishResult(context, outcome);
}

async function loadListing(context, url, stage) {
  const budgetMs = remainingBudget(context);
  if (budgetMs <= 0) {
    context.errors.push({ code: 'TOTAL_TIMEOUT', stage });
    return { outcome: 'unavailable' };
  }

  const response = await fetchProviderHtml(url, {
    client: context.client,
    providerId: context.providerId,
    timeoutMs: Math.min(context.timeoutMs, budgetMs),
    signal: context.signal,
  });

  context.metrics.requests.push(...tagRequests(response.requests, stage));
  if (stage === 'text_search') {
    context.metrics.searchLoadMs = response.loadMs == null ? null : response.loadMs;
  } else {
    context.metrics.fallbackLoadMs += response.loadMs || 0;
  }

  if (response.error) {
    context.errors.push({ code: response.error.code, stage });
    return { outcome: classifyErrorOutcome(response.error.code) };
  }

  if (isBlockedResponse(response.statusCode, response.body)) {
    context.errors.push({ code: 'BLOCKED', statusCode: response.statusCode, stage });
    return { outcome: 'blocked' };
  }

  if (response.statusCode >= 400) {
    context.errors.push({ code: `HTTP_${response.statusCode}`, stage });
    return { outcome: 'unavailable' };
  }

  const listingParseStart = performance.now();
  const listing = extractProviderListing(response.body, context.providerId, url);
  context.metrics.parseMs += performance.now() - listingParseStart;
  context.counts.listingEntries += listing.entries.length;

  const relevant = listing.entries.filter(entry =>
    isListingSeasonCompatible(entry.title, context.season)
      && isRelevantTitleMatch(context.query, entry.title)
  );

  return { listing, relevant, stage };
}

async function collectDetailPages(context, relevantEntries) {
  const selectedEntries = relevantEntries.slice(0, context.maxDetailPages);
  const seenHashes = new Set();

  for (let i = 0; i < selectedEntries.length; i += 1) {
    const entry = selectedEntries[i];
    if (i > 0 && context.delayMs > 0) {
      await context.sleepFn(context.delayMs);
    }

    const budgetMs = remainingBudget(context);
    if (budgetMs <= 0) {
      context.errors.push({ code: 'TOTAL_TIMEOUT', stage: 'detail' });
      context.terminalOutcome = context.rows.length ? 'partial_success' : 'unavailable';
      return;
    }

    const response = await fetchProviderHtml(entry.url, {
      client: context.client,
      providerId: context.providerId,
      timeoutMs: Math.min(context.timeoutMs, budgetMs),
      signal: context.signal,
    });

    context.metrics.requests.push(...tagRequests(response.requests, 'detail'));
    context.metrics.detailLoadMs += response.loadMs || 0;

    if (response.error) {
      context.errors.push({ code: response.error.code, url: entry.url, stage: 'detail' });
      continue;
    }

    if (isBlockedResponse(response.statusCode, response.body)) {
      context.errors.push({ code: 'BLOCKED', statusCode: response.statusCode, stage: 'detail' });
      context.terminalOutcome = 'blocked';
      return;
    }

    if (response.statusCode >= 400) {
      context.errors.push({ code: `HTTP_${response.statusCode}`, url: entry.url, stage: 'detail' });
      continue;
    }

    context.counts.detailPages += 1;
    const detailParseStart = performance.now();
    const parsed = parseProviderDetailHtml(response.body, {
      providerId: context.providerId,
      providerUrl: entry.url,
      listingTitle: entry.title,
      type: context.type,
      query: context.query,
      season: context.season,
      episode: context.episode,
    });
    context.metrics.parseMs += performance.now() - detailParseStart;

    context.counts.magnetsExtracted += parsed.magnetCandidates;
    context.counts.invalidMagnets += parsed.invalidMagnets;
    context.counts.duplicates += parsed.duplicateMagnets;

    for (const row of parsed.results.filter(row => matchesRequestedSeason(row, context))) {
      if (seenHashes.has(row.infoHash)) {
        context.counts.duplicates += 1;
        continue;
      }
      seenHashes.add(row.infoHash);
      if (context.rows.length >= MAX_ROWS_PER_SEARCH) {
        context.counts.truncatedRows += 1;
        continue;
      }
      context.rows.push(row);
    }
  }

  context.counts.validRows = context.rows.length;
}

function finishResult(context, outcome) {
  context.metrics.totalMs = performance.now() - context.startedAt;
  return {
    query: context.query,
    type: context.type,
    providerId: context.providerId,
    providerName: context.providerName,
    outcome,
    rows: context.rows,
    metrics: {
      totalMs: rounded(context.metrics.totalMs),
      searchLoadMs: rounded(context.metrics.searchLoadMs),
      fallbackLoadMs: rounded(context.metrics.fallbackLoadMs),
      detailLoadMs: rounded(context.metrics.detailLoadMs),
      parseMs: rounded(context.metrics.parseMs),
      requests: context.metrics.requests,
    },
    counts: context.counts,
    errors: context.errors,
  };
}

function emptyResult(query, type, outcome) {
  return {
    query: String(query || '').trim(),
    type: type === 'series' ? 'series' : 'movie',
    outcome,
    rows: [],
    metrics: { totalMs: 0, requests: [] },
    counts: { validRows: 0 },
    errors: [{ code: outcome.toUpperCase() }],
  };
}

function classifyErrorOutcome(code) {
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'unavailable';
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return 'unavailable';
  return 'unavailable';
}

function tagRequests(requests = [], stage) {
  return requests.map(req => ({ ...req, stage }));
}

function remainingBudget(context) {
  return context.maxTotalMs - (performance.now() - context.startedAt);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeDetailPageLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DETAIL_LIMIT;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function isListingSeasonCompatible(title, requestedSeason) {
  if (!Number.isInteger(requestedSeason)) return true;
  const text = String(title || '');
  const seasonMatch = text.match(/\bS(?:eason)?\s*0*(\d{1,2})\b/i)
    || text.match(/\b(\d{1,2})\s*(?:ª|º|a)?\s*(?:temporada|season)\b/i)
    || text.match(/\b(?:temporada|season)\s*0*(\d{1,2})\b/i);
  if (!seasonMatch) return true;
  const explicitSeason = Number(seasonMatch[1]);
  return !Number.isInteger(explicitSeason) || explicitSeason === requestedSeason;
}

function matchesRequestedSeason(row, context) {
  if (context.type !== 'series') return true;
  return !Number.isInteger(context.season)
    || !Number.isInteger(row.imdbSeason)
    || row.imdbSeason === context.season;
}

function positiveIntegerOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function rounded(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}
