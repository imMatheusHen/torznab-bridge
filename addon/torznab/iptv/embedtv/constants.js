export const EMBEDTV_BASE_URL = 'https://embedtv.cc';
export const EMBEDTV_API_PATHS = Object.freeze({
  channels: '/api/channels',
  epg: '/api/epg_all',
  events: '/api/events',
});

export const EMBEDTV_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

export const EMBEDTV_CACHE_TTLS = Object.freeze({
  channels: 5 * 60 * 1000,
  epg: 15 * 60 * 1000,
  events: 60 * 1000,
  resolution: 60 * 1000,
});

export const EMBEDTV_CACHE_STALE = Object.freeze({
  channels: 60 * 60 * 1000,
  epg: 60 * 60 * 1000,
  events: 5 * 60 * 1000,
  resolution: 5 * 60 * 1000,
});

export const HLS_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
];

export function getEmbedTvBaseUrl() {
  return (process.env.TORZNAB_EMBEDTV_BASE_URL || EMBEDTV_BASE_URL).replace(/\/$/, '');
}

export function getEmbedTvUserAgent() {
  return process.env.TORZNAB_EMBEDTV_USER_AGENT || EMBEDTV_DEFAULT_USER_AGENT;
}
