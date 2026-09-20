import { EMBEDTV_CACHE_STALE, EMBEDTV_CACHE_TTLS } from './constants.js';
import {
  EmbedTvClient,
  EmbedTvError,
  isResolutionRefreshStatus,
  isSafeUpstreamUrl,
} from './client.js';
import { TtlCache } from './cache.js';
import {
  associateEvents,
  normalizeCatalogPayload,
  normalizeEpgPayload,
  normalizeEventsPayload,
} from './catalog.js';
import { buildM3u, buildXmltv } from './format.js';
import { getManifestResourceUrls, rewriteHlsManifest } from './hls.js';
import { extractNestedManifestUrl, isHlsBody, resolveChannelPage } from './resolver.js';

const FFMPEG_ALLOWED_HLS_EXTENSIONS = new Set([
  '3gp', 'aac', 'ac3', 'avi', 'cmfa', 'cmfv', 'eac3', 'ec3', 'flac',
  'fmp4', 'html', 'm4a', 'm4s', 'm4v', 'mkv', 'mp2', 'mp3', 'mp4',
  'mpeg', 'mpegts', 'mpg', 'mov', 'ogg', 'ogv', 'oga', 'ts', 'vob',
  'vtt', 'wav', 'webvtt',
]);

export class EmbedTvService {
  constructor({ client = new EmbedTvClient(), clock = () => Date.now(), cacheOptions = {} } = {}) {
    this.client = client;
    this.clock = clock;
    this.catalogCache = new TtlCache({
      ttlMs: cacheOptions.channelsTtlMs ?? EMBEDTV_CACHE_TTLS.channels,
      staleMs: cacheOptions.channelsStaleMs ?? EMBEDTV_CACHE_STALE.channels,
      maxEntries: 2,
      clock,
    });
    this.epgCache = new TtlCache({
      ttlMs: cacheOptions.epgTtlMs ?? EMBEDTV_CACHE_TTLS.epg,
      staleMs: cacheOptions.epgStaleMs ?? EMBEDTV_CACHE_STALE.epg,
      maxEntries: 2,
      clock,
    });
    this.eventsCache = new TtlCache({
      ttlMs: cacheOptions.eventsTtlMs ?? EMBEDTV_CACHE_TTLS.events,
      staleMs: cacheOptions.eventsStaleMs ?? EMBEDTV_CACHE_STALE.events,
      maxEntries: 2,
      clock,
    });
    this.resolutionCache = new TtlCache({
      ttlMs: cacheOptions.resolutionTtlMs ?? EMBEDTV_CACHE_TTLS.resolution,
      staleMs: cacheOptions.resolutionStaleMs ?? EMBEDTV_CACHE_STALE.resolution,
      maxEntries: 500,
      clock,
    });
    this.proxyOrigins = new Map();
    this.recentFailures = [];
    this.state = {
      status: 'unknown',
      message: 'Aguardando a primeira verificação.',
      lastProbeAt: undefined,
      lastProbeSuccessAt: undefined,
      lastResolutionAt: undefined,
      lastResolutionChannelId: undefined,
      lastMode: undefined,
    };
    this.metrics = {
      apiRequests: 0,
      manifestRequests: 0,
      proxyRequests: 0,
      resolutionAttempts: 0,
      resolutionRefreshes: 0,
      directManifests: 0,
      proxiedManifests: 0,
    };
  }

  async getCatalog({ force = false } = {}) {
    const result = await this.catalogCache.getOrLoad('catalog', async () => {
      this.metrics.apiRequests += 1;
      return normalizeCatalogPayload(await this.client.fetchChannels());
    }, { force, allowStale: true });
    return result.value;
  }

  async getEpg({ force = false } = {}) {
    const result = await this.epgCache.getOrLoad('epg', async () => {
      this.metrics.apiRequests += 1;
      return normalizeEpgPayload(await this.client.fetchEpg());
    }, { force, allowStale: true });
    return result.value;
  }

  async getEvents({ force = false } = {}) {
    const result = await this.eventsCache.getOrLoad('events', async () => {
      this.metrics.apiRequests += 1;
      return normalizeEventsPayload(await this.client.fetchEvents());
    }, { force, allowStale: true });
    return result.value;
  }

  async getPlaylist({ baseUrl, epgUrl } = {}) {
    const catalog = await this.getCatalog();
    let events = [];
    try {
      events = await this.getEvents();
    } catch (error) {
      this.recordFailure(error, 'events');
    }
    const { entries } = associateEvents(events, catalog.channels);
    return buildM3u({
      channels: catalog.channels,
      eventEntries: entries,
      baseUrl,
      epgUrl,
    });
  }

  async getXmltv() {
    const [catalog, programs] = await Promise.all([this.getCatalog(), this.getEpg()]);
    const channelIdByEpgId = new Map(catalog.channels.map(channel => [channel.id, channel.id]));
    for (const channel of catalog.channels) {
      if (channel.epgId && !channelIdByEpgId.has(channel.epgId)) {
        channelIdByEpgId.set(channel.epgId, channel.id);
      }
    }
    return buildXmltv({
      channels: catalog.channels,
      programs: programs
          .map(program => ({ ...program, channelId: channelIdByEpgId.get(program.channelId) }))
          .filter(program => program.channelId),
    });
  }

  async getEventSnapshot() {
    const [catalog, events] = await Promise.all([this.getCatalog(), this.getEvents()]);
    const association = associateEvents(events, catalog.channels);
    return {
      events,
      count: events.length,
      mappedCount: association.entries.length,
      unmappedCount: association.unmapped.length,
      entries: association.entries,
    };
  }

  async resolveChannel(channelId, { force = false } = {}) {
    const catalog = await this.getCatalog();
    const channel = catalog.channels.find(item => item.id === channelId);
    if (!channel) {
      throw new EmbedTvError('Canal não encontrado no catálogo EmbedTV', {
        statusCode: 404,
        code: 'channel_not_found',
      });
    }
    const result = await this.resolutionCache.getOrLoad(channelId, async () => {
      this.metrics.resolutionAttempts += 1;
      return resolveChannelPage(channel, this.client);
    }, { force, allowStale: true });
    return result.value;
  }

  invalidateResolution(channelId) {
    this.resolutionCache.invalidate(channelId);
    this.proxyOrigins.delete(channelId);
  }

  async getChannelManifest(channelId, { baseUrl } = {}) {
    this.metrics.manifestRequests += 1;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const resolution = await this.resolveChannel(channelId, { force: attempt > 0 });
        const loaded = await this.loadManifest(resolution);
        const resourceUrls = getManifestResourceUrls(loaded.text, loaded.url);
        const mode = await this.chooseManifestMode(resourceUrls, resolution);
        this.registerProxyOrigins(channelId, loaded.url, resourceUrls);
        const rewritten = rewriteHlsManifest(loaded.text, loaded.url, {
          mode,
          proxyUrl: target => this.buildProxyUrl(baseUrl, channelId, target),
        });
        this.state.lastResolutionAt = new Date(this.clock()).toISOString();
        this.state.lastResolutionChannelId = channelId;
        this.state.lastMode = mode;
        if (mode === 'proxy') this.metrics.proxiedManifests += 1;
        else this.metrics.directManifests += 1;
        return { text: `${rewritten}${rewritten.endsWith('\n') ? '' : '\n'}`, mode, sourceUrl: loaded.url };
      } catch (error) {
        lastError = error;
        this.recordFailure(error, `channel:${channelId}`);
        if (attempt === 0 && isResolutionRefreshStatus(error.statusCode)) {
          this.metrics.resolutionRefreshes += 1;
          this.invalidateResolution(channelId);
          continue;
        }
        throw error;
      }
    }
    throw lastError || new EmbedTvError('Não foi possível resolver o manifesto HLS', { code: 'manifest_failed' });
  }

  async openProxyResource(channelId, targetUrl) {
    if (!this.isAllowedProxyTarget(channelId, targetUrl)) {
      throw new EmbedTvError('Destino HLS não autorizado', { statusCode: 403, code: 'proxy_target_denied' });
    }
    this.metrics.proxyRequests += 1;
    const resolution = await this.resolveChannel(channelId);
    const response = await this.client.fetchStream(targetUrl, {
      retry: false,
      stage: 'resource',
      headers: resolution.headers,
    });
    if (!response.ok) {
      const cancel = response.body?.cancel?.();
      if (cancel) await cancel.catch(() => {});
      if (isResolutionRefreshStatus(response.status)) {
        this.metrics.resolutionRefreshes += 1;
        this.invalidateResolution(channelId);
      }
      throw new EmbedTvError(`CDN respondeu HTTP ${response.status}`, {
        statusCode: response.status,
        code: `cdn_${response.status}`,
        url: targetUrl,
      });
    }
    const contentType = response.headers.get('content-type') || '';
    const isManifest = /\.(?:m3u8|txt)(?:$|\?)/i.test(new URL(targetUrl).pathname)
      || contentType.toLowerCase().includes('mpegurl');
    if (isManifest) {
      const text = await response.text();
      if (isHlsBody(text, contentType)) {
        const resourceUrls = getManifestResourceUrls(text, targetUrl);
        this.registerProxyOrigins(channelId, targetUrl, resourceUrls);
        const rewritten = rewriteHlsManifest(text, targetUrl, {
          mode: 'proxy',
          proxyUrl: target => this.buildProxyUrl(undefined, channelId, target),
        });
        return { kind: 'manifest', text: `${rewritten}${rewritten.endsWith('\n') ? '' : '\n'}`, contentType: 'application/vnd.apple.mpegurl' };
      }
    }
    return { kind: 'stream', response };
  }

  getStatus({ enabled = true } = {}) {
    const catalog = this.catalogCache.peek('catalog');
    const events = this.eventsCache.peek('events');
    const cachedAt = catalog?.cachedAt;
    const status = !enabled ? 'disabled' : this.state.status;
    const statusLabel = status === 'online' ? 'Online'
      : status === 'unstable' ? 'Instável'
        : status === 'unavailable' ? 'Indisponível'
          : status === 'disabled' ? 'Desativado' : 'Aguardando';
    return {
      enabled,
      status,
      statusLabel,
      message: !enabled ? 'IPTV desativado nesta configuração.' : this.state.message,
      upstream: status === 'online' ? 'online' : status === 'unavailable' ? 'indisponível' : 'não testado',
      channelCount: catalog?.value?.channels?.length,
      categoryCount: catalog?.value?.categories?.length,
      eventCount: events?.value?.length,
      cacheAgeMs: cachedAt == null ? undefined : Math.max(0, this.clock() - cachedAt),
      catalogCachedAt: cachedAt == null ? undefined : new Date(cachedAt).toISOString(),
      epgCachedAt: this.epgCache.peek('epg')?.cachedAt == null
        ? undefined
        : new Date(this.epgCache.peek('epg').cachedAt).toISOString(),
      eventsCachedAt: events?.cachedAt == null ? undefined : new Date(events.cachedAt).toISOString(),
      cacheState: catalog?.state,
      lastProbeAt: this.state.lastProbeAt,
      lastProbeSuccessAt: this.state.lastProbeSuccessAt,
      lastResolutionAt: this.state.lastResolutionAt,
      lastResolutionChannelId: this.state.lastResolutionChannelId,
      lastMode: this.state.lastMode,
      lastTestAt: this.state.lastProbeAt,
      lastFailure: this.recentFailures[0],
      recentFailures: this.recentFailures.slice(0, 8),
      metrics: { ...this.metrics },
      caches: {
        catalog: this.catalogCache.stats(),
        epg: this.epgCache.stats(),
        events: this.eventsCache.stats(),
        resolution: this.resolutionCache.stats(),
      },
    };
  }

  async probe() {
    const startedAt = new Date(this.clock()).toISOString();
    this.metrics.apiRequests += 3;
    const results = await Promise.allSettled([
      this.client.fetchChannels(),
      this.client.fetchEpg(),
      this.client.fetchEvents(),
    ]);
    const [channels, epg, events] = results;
    if (channels.status === 'fulfilled') this.catalogCache.set('catalog', normalizeCatalogPayload(channels.value));
    if (epg.status === 'fulfilled') this.epgCache.set('epg', normalizeEpgPayload(epg.value));
    if (events.status === 'fulfilled') this.eventsCache.set('events', normalizeEventsPayload(events.value));
    for (const result of results) {
      if (result.status === 'rejected') this.recordFailure(result.reason, 'probe');
    }
    const channelOk = channels.status === 'fulfilled';
    const allOk = results.every(result => result.status === 'fulfilled');
    this.state.lastProbeAt = startedAt;
    if (channelOk && allOk) {
      this.state.status = 'online';
      this.state.lastProbeSuccessAt = startedAt;
      this.state.message = 'Catálogo, EPG e eventos responderam normalmente.';
    } else if (channelOk) {
      this.state.status = 'unstable';
      this.state.lastProbeSuccessAt = startedAt;
      this.state.message = 'Catálogo disponível, mas uma fonte auxiliar falhou.';
    } else {
      this.state.status = 'unavailable';
      this.state.message = this.recentFailures[0]?.message || 'EmbedTV indisponível no momento.';
    }
    return this.getStatus();
  }

  buildProxyUrl(baseUrl, channelId, target) {
    const root = `${baseUrl || ''}`.replace(/\/$/, '');
    const encoded = Buffer.from(target, 'utf8').toString('base64url');
    // Jellyfin's FFmpeg rejects HLS resources whose URL has no allowed media
    // extension before it makes the request. Keep the upstream target opaque
    // while exposing a harmless, allowed suffix on the bridge URL.
    return `${root}/iptv/embedtv/channel/${encodeURIComponent(channelId)}/hls.ts?u=${encoded}`;
  }

  isAllowedProxyTarget(channelId, targetUrl) {
    if (!isSafeUpstreamUrl(targetUrl)) return false;
    try {
      const target = new URL(targetUrl);
      const allowed = this.proxyOrigins.get(channelId);
      return Boolean(allowed?.origins.has(target.origin));
    } catch {
      return false;
    }
  }

  async loadManifest(resolution) {
    let url = resolution.streamUrl;
    for (let depth = 0; depth < 3; depth += 1) {
      const result = await this.client.fetchText(url, { retry: false, stage: 'manifest', headers: resolution.headers });
      if (isHlsBody(result.text, result.contentType)) {
        return { text: result.text, url, contentType: result.contentType };
      }
      const nested = extractNestedManifestUrl(result.text, url);
      if (!nested) {
        throw new EmbedTvError('A origem EmbedTV não entregou um manifesto HLS', {
          code: 'not_hls_manifest',
          url,
        });
      }
      url = nested;
    }
    throw new EmbedTvError('Limite de redirecionamentos de manifesto excedido', { code: 'manifest_loop', url });
  }

  async chooseManifestMode(resourceUrls, resolution) {
    if (process.env.TORZNAB_EMBEDTV_HLS_PROXY === '1') return 'proxy';
    const mediaResourceUrls = resourceUrls.filter(url => !isManifestResourceUrl(url));
    const probeUrl = mediaResourceUrls[0];
    if (!probeUrl) return 'direct';
    if (mediaResourceUrls.some(url => !isFfmpegAllowedHlsResource(url))) return 'proxy';
    try {
      const response = await this.client.fetchStream(probeUrl, {
        retry: false,
        stage: 'resource-probe',
        headers: { 'User-Agent': resolution.headers['User-Agent'] },
      });
      const direct = response.status >= 200 && response.status < 400;
      const cancel = response.body?.cancel?.();
      if (cancel) await cancel.catch(() => {});
      return direct ? 'direct' : 'proxy';
    } catch {
      return 'proxy';
    }
  }

  registerProxyOrigins(channelId, manifestUrl, resourceUrls) {
    const origins = new Set();
    for (const value of [manifestUrl, ...resourceUrls]) {
      try {
        origins.add(new URL(value).origin);
      } catch {
        // Ignore malformed manifest entries; they are not proxyable.
      }
    }
    this.proxyOrigins.set(channelId, { origins, updatedAt: this.clock() });
  }

  recordFailure(error, context) {
    const status = error?.statusCode || error?.response?.status;
    const message = `${error?.message || 'falha desconhecida'}`.split('?')[0].slice(0, 220);
    const diagnostic = buildFailureDiagnostic(error);
    this.recentFailures.unshift({
      at: new Date(this.clock()).toISOString(),
      context,
      statusCode: status,
      code: error?.code,
      message,
      ...diagnostic,
    });
    this.recentFailures.splice(8);
    console.warn(`[EmbedTV] channel=${context.split(':')[1] || '-'} stage=${diagnostic.stage || context} hostname=${diagnostic.hostname || '-'} status=${status || '-'} redirect=${diagnostic.redirected ? 'true' : 'false'} content-type=${diagnostic.contentType || '-'} referer-host=${diagnostic.refererHost || '-'} cookie-present=${diagnostic.cookiePresent ? 'true' : 'false'}`);
  }
}

function isManifestResourceUrl(value) {
  try {
    return /\.(?:m3u8|txt)$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function isFfmpegAllowedHlsResource(value) {
  try {
    const match = new URL(value).pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    return Boolean(match && FFMPEG_ALLOWED_HLS_EXTENSIONS.has(match[1]));
  } catch {
    return false;
  }
}

function buildFailureDiagnostic(error) {
  const url = error?.responseUrl || error?.url;
  let hostname;
  try {
    hostname = url ? new URL(url).hostname : undefined;
  } catch {
    hostname = undefined;
  }
  return {
    stage: error?.stage,
    hostname,
    method: error?.method,
    redirected: Boolean(error?.redirected),
    contentType: error?.contentType,
    refererHost: error?.refererHost,
    cookiePresent: Boolean(error?.cookiePresent),
  };
}

export function createEmbedTvService(options) {
  return new EmbedTvService(options);
}
