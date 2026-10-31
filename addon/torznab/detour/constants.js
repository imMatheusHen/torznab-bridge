import { isIP } from 'node:net';

export const DETOUR_SOURCE = 'detour';
export const PROVIDER_HDRTORRENT = 'hdrtorrent';
export const PROVIDER_COMANDO = 'comando-torrents';

export const PROVIDERS = {
  [PROVIDER_HDRTORRENT]: {
    id: PROVIDER_HDRTORRENT,
    name: 'HDRTorrent',
    baseUrl: 'https://hdrtorrents.net',
    hosts: ['hdrtorrents.net', 'hdrtorrent.com'],
    searchPath: '/index.php',
    searchParam: 'busca',
    fallbackSearchPaths: ['/'],
    listingSelectors: [
      'div.col a.media-card-link[href]',
      'div.capa-img h2 a[href]',
    ],
    listingMarkers: [
      'div.col a.media-card-link[href]',
      'div.capa-img h2 a[href]',
      'div.empty-state',
    ],
    titleSelectors: ['h1.item-h1', 'div.infos h1', 'h1'],
    infoSelectors: ['dl.item-specs div', 'div.infos p', 'div.item-specs'],
    imdbSelectors: ['dl.item-specs a[href*="imdb.com"]', 'div.infos a[href*="imdb.com"]'],
  },
  [PROVIDER_COMANDO]: {
    id: PROVIDER_COMANDO,
    name: 'Comando Torrents',
    baseUrl: 'https://comando1.com',
    hosts: ['comando1.com', 'comando.la', 'comandotorrents.to'],
    searchPath: '/',
    searchParam: 's',
    fallbackSearchPaths: [],
    listingSelectors: [
      'article header h2.entry-title a[href]',
      'h2.entry-title a[href]',
      'article header h2 a[href]',
    ],
    listingMarkers: [
      'article',
      '.entry-title',
      '.archive-title',
      '.empty-state',
    ],
    titleSelectors: [
      'article header h1.entry-title a',
      'article header h1.entry-title',
      'h1.entry-title',
      'h1',
    ],
    infoSelectors: [
      "article div[itemprop='text'] p",
      'article div.entry-content p',
      "article div[itemprop='text']",
    ],
    imdbSelectors: [
      "article div[itemprop='text'] a[href*='imdb.com']",
      "article div.entry-content a[href*='imdb.com']",
    ],
  },
};

for (const provider of Object.values(PROVIDERS)) {
  for (const value of Object.values(provider)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  Object.freeze(provider);
}
Object.freeze(PROVIDERS);

export const DEFAULT_PROVIDER_ID = PROVIDER_HDRTORRENT;
export const DEFAULT_BASE_URL = PROVIDERS[DEFAULT_PROVIDER_ID].baseUrl;
export const DETOUR_PROVIDERS = Object.freeze(Object.keys(PROVIDERS));
export const PROVIDER_CONFIGS = Object.freeze(PROVIDERS);

export class DetourScrapeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'DetourScrapeError';
    this.code = code;
  }
}

export function getProviderConfig(providerId = DEFAULT_PROVIDER_ID) {
  const config = PROVIDERS[providerId];
  if (!config) throw new DetourScrapeError('UNKNOWN_PROVIDER', `Unknown provider: ${providerId}`);
  return config;
}

export function validateProviderUrl(input, providerId = DEFAULT_PROVIDER_ID) {
  const provider = getProviderConfig(providerId);
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new DetourScrapeError('INVALID_PROVIDER_URL', `Malformed provider URL: ${input}`);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.href.length > 2048 ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    isIP(host) ||
    !provider.hosts.includes(host)
  ) {
    throw new DetourScrapeError('INVALID_PROVIDER_URL', `Host or URL rejected for ${providerId}: ${input}`);
  }
  return url;
}

export function buildSearchUrl(baseUrl, query, providerId = DEFAULT_PROVIDER_ID) {
  const provider = getProviderConfig(providerId);
  const url = validateProviderUrl(baseUrl, providerId);
  url.pathname = provider.searchPath;
  url.search = '';
  url.hash = '';
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length > 200) {
    throw new DetourScrapeError('QUERY_TOO_LONG', 'Search query exceeds 200 characters');
  }
  url.searchParams.set(provider.searchParam, normalizedQuery);
  return url.toString();
}

export function buildProviderSearchUrl(providerId, query, baseUrl) {
  const provider = getProviderConfig(providerId);
  return buildSearchUrl(baseUrl || provider.baseUrl, query, providerId);
}

export function buildProviderFallbackUrls(providerId, baseUrl) {
  const provider = getProviderConfig(providerId);
  const root = validateProviderUrl(baseUrl || provider.baseUrl, providerId);
  return (provider.fallbackSearchPaths || []).map(path =>
    validateProviderUrl(new URL(path, root).toString(), providerId).toString()
  );
}
