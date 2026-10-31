import express from 'express';
import { EmbedTvError } from './client.js';
import { decodeProxyTarget } from './hls.js';
import { streamToResponse } from './stream.js';

export function createEmbedTvRouter({
  service,
  isEnabled = () => true,
  getBaseUrl = req => `${req.protocol}://${req.get('host')}`,
} = {}) {
  if (!service) throw new TypeError('EmbedTV router requires a service');
  const router = express.Router();

  router.get('/playlist.m3u', async (req, res) => {
    if (!ensureEnabled(isEnabled, res)) return;
    try {
      const baseUrl = normalizeBaseUrl(getBaseUrl(req));
      const text = await service.getPlaylist({
        baseUrl,
        epgUrl: `${baseUrl}/iptv/embedtv/epg.xml`,
      });
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
      res.type('application/x-mpegurl').send(text);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/epg.xml', async (req, res) => {
    if (!ensureEnabled(isEnabled, res)) return;
    try {
      const xml = await service.getXmltv();
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
      res.type('application/xml').send(xml);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/events', async (req, res) => {
    if (!ensureEnabled(isEnabled, res)) return;
    try {
      const snapshot = await service.getEventSnapshot();
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
      res.json({
        count: snapshot.count,
        mappedCount: snapshot.mappedCount,
        unmappedCount: snapshot.unmappedCount,
        events: snapshot.events.map(event => ({
          id: event.id,
          slug: event.slug,
          title: event.title,
          league: event.league,
          leagueImage: event.leagueImage,
          home: event.home,
          away: event.away,
          start: event.start,
          stop: event.stop,
          channelIds: snapshot.entries
              .filter(entry => entry.event.id === event.id)
              .map(entry => entry.channel.id),
        })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/status', async (req, res) => {
    try {
      if (req.query.probe === '1' && isEnabled()) {
        await service.probe();
      }
      res.json(service.getStatus({ enabled: isEnabled() }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/channel/:id/index.m3u8', async (req, res) => {
    if (!ensureEnabled(isEnabled, res)) return;
    const channelId = validateChannelId(req.params.id);
    if (!channelId) {
      sendError(res, new EmbedTvError('ID de canal inválido', { statusCode: 400, code: 'invalid_channel_id' }));
      return;
    }
    try {
      const result = await service.getChannelManifest(channelId, { baseUrl: normalizeBaseUrl(getBaseUrl(req)) });
      res.set('Cache-Control', 'no-store');
      res.type('application/vnd.apple.mpegurl').send(result.text);
    } catch (error) {
      sendError(res, error);
    }
  });

  const handleProxyResource = async (req, res) => {
    if (!ensureEnabled(isEnabled, res)) return;
    const channelId = validateChannelId(req.params.id);
    const target = decodeProxyTarget(`${req.query.u || ''}`);
    if (!channelId || !target || target.length > 4096) {
      sendError(res, new EmbedTvError('Destino HLS inválido', { statusCode: 400, code: 'invalid_proxy_target' }));
      return;
    }
    try {
      const result = await service.openProxyResource(channelId, target);
      if (result.kind === 'manifest') {
        res.set('Cache-Control', 'no-store');
        res.type('application/vnd.apple.mpegurl').send(result.text);
        return;
      }
      copyStreamHeaders(result.response, res);
      req.on('close', () => {
        const cancel = result.response.body?.cancel?.();
        if (cancel) cancel.catch(() => {});
      });
      streamToResponse(result.response, res);
    } catch (error) {
      sendError(res, error);
    }
  };

  // Keep the extensionless route for clients that already received it from a
  // cached manifest, while new manifests use hls.ts for FFmpeg compatibility.
  router.get('/channel/:id/hls.ts', handleProxyResource);
  router.get('/channel/:id/hls', handleProxyResource);

  return router;
}

function ensureEnabled(isEnabled, res) {
  if (isEnabled()) return true;
  res.status(503).json({ error: 'IPTV EmbedTV está desabilitado', code: 'iptv_disabled' });
  return false;
}

function validateChannelId(value) {
  const id = `${value || ''}`;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id) ? id : undefined;
}

function normalizeBaseUrl(value) {
  return `${value || ''}`.replace(/\/$/, '');
}

function copyStreamHeaders(upstream, res) {
  for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) res.set(name, value);
  }
}

function sendError(res, error) {
  if (res.headersSent) {
    res.destroy(error);
    return;
  }
  const upstreamStatus = error?.statusCode;
  const status = error?.code === 'channel_not_found' ? 404
    : error?.code === 'invalid_channel_id' || error?.code === 'invalid_proxy_target' ? 400
      : error?.code === 'proxy_target_denied' ? 403
        : error?.code === 'browser_challenge_required' ? 424
        : upstreamStatus && [401, 403, 404, 410].includes(upstreamStatus) ? 502
          : error?.code === 'timeout' ? 504
            : 502;
  res.status(status).json({
    error: status >= 500 ? 'Falha ao resolver o stream EmbedTV' : `${error?.message || 'Requisição IPTV inválida'}`,
    code: error?.code || 'embedtv_error',
    upstreamStatus: status === 502 ? upstreamStatus : undefined,
  });
}
