import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { EMBEDTV_UPSTREAM_DISPATCHER, EmbedTvClient, isEmbedTvPageUrl } from './client.js';

test('accepts current and legacy EmbedTV page hosts without accepting lookalikes', () => {
  assert.equal(isEmbedTvPageUrl('https://random.embedtv.cc/ae'), true);
  assert.equal(isEmbedTvPageUrl('https://embedtv.cc/ae'), true);
  assert.equal(isEmbedTvPageUrl('https://random.embedtv.lat/ae'), true);
  assert.equal(isEmbedTvPageUrl('https://embedtv.cc.attacker.example/ae'), false);
  assert.equal(isEmbedTvPageUrl('http://random.embedtv.cc/ae'), false);
  assert.equal(isEmbedTvPageUrl('https://user@random.embedtv.cc/ae'), false);
});

test('times out while reading a stalled text response', async () => {
  const client = new EmbedTvClient({
    timeoutMs: 250,
    retryAttempts: 1,
    fetchFn: async () => ({
      ok: true,
      url: 'https://cdn.example/live.txt',
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => new Promise(() => {}),
      body: { cancel: async () => {} },
    }),
  });

  await assert.rejects(
    client.fetchText('https://cdn.example/live.txt'),
    error => error.code === 'timeout' && error.statusCode === 504,
  );
});

test('attaches redacted-safe request diagnostics to upstream HTTP errors', async () => {
  const client = new EmbedTvClient({
    retryAttempts: 1,
    fetchFn: async () => new Response('denied', {
      status: 403,
      headers: { 'content-type': 'text/html' },
    }),
  });

  await assert.rejects(
    client.fetchText('https://cdn.example/live.m3u8', {
      stage: 'manifest',
      headers: {
        Referer: 'https://dynamic.embedtv.lat/afazenda',
        Cookie: 'referer=secret-value',
      },
    }),
    error => error.code === 'http_403'
      && error.stage === 'manifest'
      && error.method === 'GET'
      && error.contentType === 'text/html'
      && error.refererHost === 'dynamic.embedtv.lat'
      && error.cookiePresent === true,
  );
});

test('caller abort continues to cancel a streaming response body', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.write(Buffer.from([0x47]));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const client = new EmbedTvClient({ timeoutMs: 2_000, retryAttempts: 1 });
  const controller = new AbortController();
  try {
    const response = await client.fetchStream(`http://127.0.0.1:${port}/segment`, {
      retry: false,
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await assert.rejects(reader.read(), error => error.name === 'AbortError');
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
});

test('reuses upstream connections across the HLS segment idle interval', { timeout: 10_000 }, async () => {
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  server.keepAliveTimeout = 60_000;
  server.headersTimeout = 65_000;
  server.on('connection', socket => sockets.add(socket));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const client = new EmbedTvClient({ timeoutMs: 2_000, retryAttempts: 1 });
  try {
    await client.fetchText(`http://127.0.0.1:${port}/segment`);
    await new Promise(resolve => setTimeout(resolve, 5_500));
    await client.fetchText(`http://127.0.0.1:${port}/segment`);
    assert.equal(sockets.size, 1);
  } finally {
    await EMBEDTV_UPSTREAM_DISPATCHER.close();
    await new Promise(resolve => server.close(resolve));
  }
});
