import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import { createEmbedTvRouter } from './routes.js';
import { encodeProxyTarget } from './hls.js';

test('serves stable playlist/EPG routes and rejects malformed channel/proxy targets', async () => {
  const service = {
    async getPlaylist() { return '#EXTM3U\n'; },
    async getXmltv() { return '<?xml version="1.0"?><tv />\n'; },
    async getEventSnapshot() { return { count: 0, mappedCount: 0, unmappedCount: 0, events: [], entries: [] }; },
    getStatus() { return { enabled: true, status: 'online' }; },
    async getChannelManifest() { return { text: '#EXTM3U\n', mode: 'direct' }; },
    async openProxyResource() { throw Object.assign(new Error('denied'), { statusCode: 403, code: 'proxy_target_denied' }); },
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
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('preserves upstream partial-content status and forwards bounded Range requests', async () => {
  let proxyOptions;
  const service = {
    async openProxyResource(_channelId, _target, options) {
      proxyOptions = options;
      return {
        kind: 'stream',
        response: new Response(new Uint8Array([0x47, 0x00, 0x01]), {
          status: 206,
          headers: {
            'content-type': 'video/mp2t',
            'content-range': 'bytes 0-2/188',
            'accept-ranges': 'bytes',
          },
        }),
      };
    },
  };
  const app = express();
  app.use('/iptv/embedtv', createEmbedTvRouter({ service, isEnabled: () => true }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const port = server.address().port;
  const target = encodeProxyTarget('https://cdn.example/segment.css');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/espn/hls.ts?u=${target}`, {
      headers: { Range: 'bytes=0-2' },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-2/188');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('hex'), '470001');
    assert.equal(proxyOptions.range, 'bytes=0-2');
    assert.equal(proxyOptions.signal instanceof AbortSignal, true);
    assert.equal(proxyOptions.signal.aborted, false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('aborts an upstream stream when the downstream reader disconnects', async () => {
  let upstreamSignal;
  let resolveSourceCancel;
  const sourceCancelled = new Promise(resolve => { resolveSourceCancel = resolve; });
  const service = {
    async openProxyResource(_channelId, _target, options) {
      upstreamSignal = options.signal;
      const body = new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([0x47])); },
        cancel() { resolveSourceCancel(); },
      });
      return { kind: 'stream', response: new Response(body, { status: 200 }) };
    },
  };
  const app = express();
  app.use('/iptv/embedtv', createEmbedTvRouter({ service, isEnabled: () => true }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const port = server.address().port;
  const target = encodeProxyTarget('https://cdn.example/segment.css');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/iptv/embedtv/channel/espn/hls.ts?u=${target}`);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await Promise.race([
      sourceCancelled,
      new Promise((_, reject) => setTimeout(() => reject(new Error('upstream source was not canceled')), 1_000)),
    ]);
    assert.equal(upstreamSignal.aborted, true);
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
});
