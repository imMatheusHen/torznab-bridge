import axios from 'axios';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { validateProviderUrl } from './constants.js';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function fetchProviderHtml(startUrl, options = {}) {
  const client = options.client || axios;
  const timeoutMs = options.timeoutMs;
  const maxRedirects = options.maxRedirects == null ? 2 : options.maxRedirects;
  let currentUrl;

  try {
    currentUrl = validateProviderUrl(startUrl, options.providerId).toString();
  } catch (error) {
    return { error: { code: error.code || 'INVALID_PROVIDER_URL' }, requests: [] };
  }

  const requests = [];
  let totalLoadMs = 0;
  const requestStartedAt = performance.now();
  const hasTotalTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remainingTimeoutMs = hasTotalTimeout
      ? timeoutMs - elapsedMs(requestStartedAt)
      : timeoutMs;

    if (hasTotalTimeout && remainingTimeoutMs <= 0) {
      return { error: { code: 'ETIMEDOUT' }, requests, loadMs: totalLoadMs };
    }

    const response = await requestOnce(currentUrl, client, remainingTimeoutMs, options.signal);
    requests.push(response.request);
    totalLoadMs += response.loadMs || 0;
    if (response.error) return { error: response.error, requests, loadMs: totalLoadMs };

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers && response.headers.location;
      if (!location) return { error: { code: 'REDIRECT_WITHOUT_LOCATION' }, requests, loadMs: totalLoadMs };
      try {
        currentUrl = validateProviderUrl(new URL(location, currentUrl).toString(), options.providerId).toString();
      } catch {
        return { error: { code: 'REDIRECT_OUTSIDE_PROVIDER' }, requests, loadMs: totalLoadMs };
      }
      if (hop === maxRedirects) return { error: { code: 'REDIRECT_LIMIT' }, requests, loadMs: totalLoadMs };
      continue;
    }

    return {
      statusCode: response.statusCode,
      contentType: String(response.headers && response.headers['content-type'] || ''),
      body: response.body,
      requests,
      loadMs: totalLoadMs,
    };
  }

  return { error: { code: 'REDIRECT_LIMIT' }, requests, loadMs: totalLoadMs };
}

async function requestOnce(url, client, timeoutMs, signal) {
  const timing = {};
  const agent = createTimedAgent(timing);
  const startedAt = performance.now();
  let response;

  try {
    response = await client.get(url, {
      timeout: timeoutMs,
      signal,
      maxRedirects: 0,
      maxContentLength: MAX_HTML_BYTES,
      maxBodyLength: MAX_HTML_BYTES,
      responseType: 'text',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      httpsAgent: agent,
      validateStatus: () => true,
    });
  } catch (error) {
    agent.destroy();
    return {
      error: { code: error.code || 'NETWORK_ERROR' },
      loadMs: elapsedMs(startedAt),
      request: {
        host: safeHostname(url),
        statusCode: null,
        connectMs: rounded(timing.connectMs),
        loadMs: rounded(elapsedMs(startedAt)),
        bytes: 0,
      },
    };
  }
  agent.destroy();

  const body = typeof response.data === 'string' ? response.data : String(response.data || '');
  const loadMs = elapsedMs(startedAt);
  return {
    statusCode: response.status,
    headers: response.headers,
    body,
    loadMs,
    request: {
      host: safeHostname(url),
      statusCode: response.status,
      connectMs: rounded(timing.connectMs),
      loadMs: rounded(loadMs),
      bytes: Buffer.byteLength(body),
    },
  };
}

function createTimedAgent(timing) {
  const agent = new https.Agent({ keepAlive: false });
  const createConnection = agent.createConnection.bind(agent);
  agent.createConnection = (options, callback) => {
    const startedAt = performance.now();
    const socket = createConnection(options, callback);
    socket && socket.once('secureConnect', () => {
      timing.connectMs = elapsedMs(startedAt);
    });
    return socket;
  };
  return agent;
}

function safeHostname(input) {
  try { return new URL(input).hostname; } catch { return undefined; }
}

function elapsedMs(startedAt) { return performance.now() - startedAt; }
function rounded(value) { return value == null ? null : Math.round(value * 100) / 100; }
