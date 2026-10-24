import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedTvClient, isEmbedTvPageUrl } from './client.js';
import { EMBEDTV_BASE_URL } from './constants.js';

test('defaults the catalog API to the current .cc domain', () => {
  assert.equal(EMBEDTV_BASE_URL, 'https://embedtv.cc');
});

test('accepts EmbedTV apex and subdomains for current and legacy roots only', () => {
  for (const url of [
    'https://embedtv.cc/ae',
    'https://ww0.embedtv.cc/ae',
    'https://deep.dynamic.embedtv.cc/ae',
    'https://embedtv.lat/ae',
    'https://dynamic.embedtv.lat/ae',
  ]) {
    assert.equal(isEmbedTvPageUrl(url), true, url);
  }

  for (const url of [
    'http://embedtv.cc/ae',
    'https://user:pass@ww0.embedtv.cc/ae',
    'https://notembedtv.cc/ae',
    'https://embedtv.cc.attacker.example/ae',
    'https://dynamic.embedtv.lat.attacker.example/ae',
    'https://attacker.example/ae',
  ]) {
    assert.equal(isEmbedTvPageUrl(url), false, url);
  }
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
