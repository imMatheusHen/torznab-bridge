import { isIP } from 'node:net';

import {
  EMBEDTV_API_PATHS,
  EMBEDTV_DEFAULT_USER_AGENT,
  EMBEDTV_TRUSTED_PAGE_DOMAINS,
  getEmbedTvBaseUrl,
  getEmbedTvUserAgent,
} from './constants.js';

export class EmbedTvError extends Error {
  constructor(message, {
    statusCode,
    code,
    url,
    retryable = false,
    temporary = false,
    cause,
    method,
    stage,
    responseUrl,
    redirected,
    contentType,
    refererHost,
    cookiePresent,
  } = {}) {
    super(message);
    this.name = 'EmbedTvError';
    this.statusCode = statusCode;
    this.code = code;
    this.url = url;
    this.retryable = retryable;
    this.temporary = temporary;
    this.cause = cause;
    this.method = method;
    this.stage = stage;
    this.responseUrl = responseUrl;
    this.redirected = redirected;
    this.contentType = contentType;
    this.refererHost = refererHost;
    this.cookiePresent = cookiePresent;
  }
}

export class EmbedTvClient {
  constructor({
    baseUrl = getEmbedTvBaseUrl(),
    fetchFn = globalThis.fetch,
    timeoutMs = parseInt(process.env.TORZNAB_EMBEDTV_TIMEOUT_MS || '12000', 10),
    retryAttempts = parseInt(process.env.TORZNAB_EMBEDTV_RETRY_MAX_ATTEMPTS || '2', 10),
    retryBaseDelayMs = parseInt(process.env.TORZNAB_EMBEDTV_RETRY_BASE_DELAY_MS || '250', 10),
    userAgent = getEmbedTvUserAgent() || EMBEDTV_DEFAULT_USER_AGENT,
  } = {}) {
    if (typeof fetchFn !== 'function') {
      throw new TypeError('EmbedTV client requires a fetch implementation');
    }
    this.baseUrl = `${baseUrl}`.replace(/\/$/, '');
    this.fetchFn = fetchFn;
    this.timeoutMs = Math.max(250, timeoutMs);
    this.retryAttempts = Math.max(1, retryAttempts);
    this.retryBaseDelayMs = Math.max(0, retryBaseDelayMs);
    this.userAgent = userAgent;
  }

  async fetchJson(path, options = {}) {
    const response = await this.request(`${this.baseUrl}${path}`, {
      ...options,
      stage: options.stage || 'api',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': this.userAgent,
        Referer: `${this.baseUrl}/`,
        Origin: this.baseUrl,
        ...options.headers,
      },
    });
    const body = await readResponseText(response, this.timeoutMs);
    try {
      return JSON.parse(body);
    } catch (cause) {
      throw new EmbedTvError('EmbedTV retornou JSON inválido', {
        code: 'invalid_json',
        url: response.url,
        cause,
      });
    }
  }

  fetchChannels(options) {
    return this.fetchJson(EMBEDTV_API_PATHS.channels, options);
  }

  fetchEpg(options) {
    return this.fetchJson(EMBEDTV_API_PATHS.epg, options);
  }

  fetchEvents(options) {
    return this.fetchJson(EMBEDTV_API_PATHS.events, options);
  }

  async fetchChannelPage(url, options = {}) {
    if (!isEmbedTvPageUrl(url)) {
      throw new EmbedTvError('URL de canal EmbedTV inválida', { code: 'invalid_channel_url', url });
    }
    const pageUrl = new URL(url);
    const result = await this.fetchText(url, {
      ...options,
      stage: 'page',
      headers: {
        Referer: pageUrl.origin,
        Origin: pageUrl.origin,
        ...options.headers,
      },
    });
    return result.text;
  }

  fetchText(url, options = {}) {
    return this.request(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*',
        'User-Agent': this.userAgent,
        ...options.headers,
      },
    }).then(async response => ({
      response,
      text: await readResponseText(response, this.timeoutMs),
      contentType: response.headers.get('content-type') || '',
    }));
  }

  fetchStream(url, options = {}) {
    return this.request(url, {
      ...options,
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': this.userAgent,
        ...options.headers,
      },
    });
  }

  async request(url, { method = 'GET', headers = {}, retry = true, signal, stage = 'request', ...options } = {}) {
    const attempts = retry ? this.retryAttempts : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, { method, headers, signal, ...options });
        if (!response.ok) {
          const error = new EmbedTvError(`EmbedTV upstream respondeu HTTP ${response.status}`, {
            statusCode: response.status,
            code: `http_${response.status}`,
            url: response.url || url,
            retryable: isRetryableStatus(response.status),
            temporary: isTemporaryStatus(response.status),
            method,
            stage,
            responseUrl: response.url || url,
            redirected: response.redirected,
            contentType: response.headers.get('content-type') || undefined,
            refererHost: getHeaderHost(headers, 'referer'),
            cookiePresent: Boolean(getHeader(headers, 'cookie')),
          });
          if (!error.retryable || attempt >= attempts) {
            throw error;
          }
          lastError = error;
          await sleep(this.retryBaseDelayMs * (2 ** (attempt - 1)));
          continue;
        }
        return response;
      } catch (rawError) {
        const error = rawError instanceof EmbedTvError
          ? rawError
          : new EmbedTvError(`Falha de rede no EmbedTV: ${rawError.message}`, {
            code: rawError.name === 'AbortError' ? 'timeout' : (rawError.code || 'network_error'),
            url,
            retryable: true,
            temporary: true,
            cause: rawError,
            method,
            stage,
            refererHost: getHeaderHost(headers, 'referer'),
            cookiePresent: Boolean(getHeader(headers, 'cookie')),
          });
        lastError = error;
        if (!error.retryable || attempt >= attempts) {
          throw error;
        }
        await sleep(this.retryBaseDelayMs * (2 ** (attempt - 1)));
      }
    }
    throw lastError || new EmbedTvError('Falha ao consultar EmbedTV', { url });
  }

  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      return await this.fetchFn(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

export function isTemporaryStatus(statusCode) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

export function isRetryableStatus(statusCode) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

export function isResolutionRefreshStatus(statusCode) {
  return [401, 403, 404, 410].includes(statusCode);
}

export function isEmbedTvPageUrl(url) {
  try {
    const candidate = new URL(url);
    const hostname = candidate.hostname.toLowerCase().replace(/\.$/, '');
    return candidate.protocol === 'https:'
      && !candidate.username
      && !candidate.password
      && EMBEDTV_TRUSTED_PAGE_DOMAINS.some(domain =>
        hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function isSafeUpstreamUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return !isPrivateHost(host);
  } catch {
    return false;
  }
}

function isPrivateHost(host) {
  const normalized = host.replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === 'localhost.localdomain') {
    return true;
  }
  const version = isIP(normalized);
  if (version === 4) {
    const octets = normalized.split('.').map(Number);
    const [first, second] = octets;
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 198 && second === 18)
      || (first === 198 && second === 19);
  }
  if (version === 6) {
    const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/i.test(normalized)
      || Boolean(ipv4Mapped && isPrivateHost(ipv4Mapped[1]));
  }
  return false;
}

async function readResponseText(response, timeoutMs) {
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new EmbedTvError('Tempo limite ao ler resposta do EmbedTV', {
        code: 'timeout',
        statusCode: 504,
        url: response.url,
      })), timeoutMs);
    });
    return await Promise.race([response.text(), timeout]);
  } catch (cause) {
    if (cause instanceof EmbedTvError) {
      const cancel = response.body?.cancel?.();
      if (cancel) await cancel.catch(() => {});
      throw cause;
    }
    throw new EmbedTvError('Falha ao ler resposta do EmbedTV', {
      code: 'response_read_failed',
      statusCode: response.status,
      url: response.url,
      cause,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHeader(headers, name) {
  if (headers instanceof Headers) return headers.get(name);
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function getHeaderHost(headers, name) {
  try {
    const value = getHeader(headers, name);
    return value ? new URL(value).hostname : undefined;
  } catch {
    return undefined;
  }
}
