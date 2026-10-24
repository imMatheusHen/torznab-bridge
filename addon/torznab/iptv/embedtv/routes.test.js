import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { createEmbedTvRouter } from './routes.js';

test('serves stable playlist/EPG routes and rejects malformed channel/proxy targets', async () => {
  const receivedRanges = [];
  const service = {
    async getPlaylist() { return '#EXTM3U\n'; },
    async getXmltv() { return '<?xml version="1.0"?><tv />\n'; },
    async getEventSnapshot() { return { count: 0, mappedCount: 0, unmappedCount: 0, events: [], entries: [] }; },
    getStatus() { return { enabled: true, status: 'online' }; },
    async getChannelManifest() { return { text: '#EXTM3U\n', mode: 'direct' }; },
    async openProxyResource(_channelId, targetUrl, { range } = {}) {
      if (targetUrl === 'https://cdn.example/segment.js') {
        receivedRanges.push(range);
        return {
          kind: 'stream',
          response: new Response(new Uint8Array([0x47, 0x47, 0x47, 0x47]), {
            status: 206,
            headers: {
              'content-type': 'application/javascript',
              'content-range': 'bytes 0-3/1000',
              'accept-ranges': 'bytes',
            },
          }),
        };
      }
      throw Object.assign(new Error('denied'), { statusCode: 403, code: 'proxy_target_denied' });
    },
  };
  const app = express();
  app.use('/iptv/embedtv', createEmbedTvRouter({
    service,
    isEnabled: () => true,
    getBaseUrl: request => `http://${request.headers.host}`,
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const port = server.address().port;
  try {
    const playlist = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/playlist.m3u`);
    assert.equal(playlist.status, 200);
    assert.match(playlist.headers.get('content-type'), /mpegurl/);
    const epg = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/epg.xml`);
    assert.equal(epg.status, 200);
    assert.match(epg.headers.get('content-type'), /xml/);
    const invalid = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/bad.id/index.m3u8`);
    assert.equal(invalid.status, 400);
    const proxy = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/espn/hls?u=not-base64`);
    assert.equal(proxy.status, 403);
    const ffmpegCompatibleProxy = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/espn/hls.ts?u=not-base64`);
    assert.equal(ffmpegCompatibleProxy.status, 403);
    const target = Buffer.from('https://cdn.example/segment.js').toString('base64url');
    const rangedProxy = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/espn/hls.ts?u=${target}`, {
      headers: { Range: 'bytes=0-3' },
    });
    assert.equal(rangedProxy.status, 206);
    assert.equal(rangedProxy.headers.get('content-range'), 'bytes 0-3/1000');
    assert.deepEqual([...new Uint8Array(await rangedProxy.arrayBuffer())], [0x47, 0x47, 0x47, 0x47]);
    assert.deepEqual(receivedRanges, ['bytes=0-3']);
    const unsupportedRange = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/espn/hls?u=${target}`, {
      headers: { Range: 'bytes=0-1,3-4' },
    });
    assert.equal(unsupportedRange.status, 416);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
