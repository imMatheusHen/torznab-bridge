import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedTvClient, isEmbedTvPageUrl } from './client.js';

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
