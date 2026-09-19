import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedTvError } from './client.js';
import { EmbedTvService } from './service.js';

class FakeClient {
  constructor() {
    this.userAgent = 'test-agent';
    this.channelPageCalls = 0;
    this.manifestCalls = 0;
    this.failFirstManifest = false;
  }

  async fetchChannels() {
    return {
      categories: [{ id: 1, name: 'Esportes' }],
      channels: [{ id: 'espn', name: 'ESPN', categories: [1], url: 'https://dynamic.embedtv.lat/espn' }],
    };
  }

  async fetchEpg() {
    return [{ id: 'espn', data: [{ title: 'Jogo', start_date: '2026-09-19T08:30:00-03:00' }] }];
  }

  async fetchEvents() {
    return [];
  }

  async fetchChannelPage() {
    this.channelPageCalls += 1;
    const stream = this.channelPageCalls === 1
      ? 'https://cdn.example/first.m3u8'
      : 'https://cdn.example/second.m3u8';
    return `<script>startPlayer("${stream}")</script>`;
  }

  async fetchText(url) {
    this.manifestCalls += 1;
    if (this.failFirstManifest && url.endsWith('/first.m3u8')) {
      throw new EmbedTvError('forbidden', { statusCode: 403, code: 'http_403', url });
    }
    return {
      response: { status: 200 },
      contentType: 'text/plain',
      text: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n',
    };
  }

  async fetchStream() {
    throw new Error('no media resource to probe');
  }
}

test('shares one in-flight channel resolution across concurrent callers', async () => {
  const client = new FakeClient();
  const service = new EmbedTvService({ client });
  const [one, two, three] = await Promise.all([
    service.resolveChannel('espn'),
    service.resolveChannel('espn'),
    service.resolveChannel('espn'),
  ]);
  assert.equal(client.channelPageCalls, 1);
  assert.equal(one.streamUrl, two.streamUrl);
  assert.equal(two.streamUrl, three.streamUrl);
});

test('maps an EPG key to the catalog channel id in XMLTV', async () => {
  const client = new FakeClient();
  client.fetchChannels = async () => ({
    categories: [{ id: 1, name: 'Esportes' }],
    channels: [{
      id: 'espn',
      epg_id: 'espn-hd',
      categories: [1],
      url: 'https://dynamic.embedtv.lat/espn',
    }],
  });
  client.fetchEpg = async () => [{
    id: 'espn-hd',
    data: [{ title: 'Jogo', start_date: '2026-09-19T08:30:00-03:00' }],
  }];

  const xml = await new EmbedTvService({ client }).getXmltv();
  assert.match(xml, /<programme channel="espn"/);
  assert.match(xml, />Jogo<\/title>/);
});

test('invalidates a failed resolution and retries once with a fresh page', async () => {
  const client = new FakeClient();
  client.failFirstManifest = true;
  const service = new EmbedTvService({ client });
  const result = await service.getChannelManifest('espn', { baseUrl: 'http://bridge:9699' });
  assert.equal(result.sourceUrl, 'https://cdn.example/second.m3u8');
  assert.equal(client.channelPageCalls, 2);
  assert.equal(client.manifestCalls, 2);
  assert.equal(service.getStatus().metrics.resolutionRefreshes, 1);
});

for (const failureStatus of [403, 404]) {
  test(`invalidates a cached resolution after a proxied CDN returns ${failureStatus}`, async () => {
    const client = new FakeClient();
    client.fetchStream = async () => ({
      ok: false,
      status: failureStatus,
      headers: new Headers(),
      body: { cancel: async () => {} },
    });
    const service = new EmbedTvService({ client });
    await service.resolveChannel('espn');
    service.proxyOrigins.set('espn', { origins: new Set(['https://cdn.example']), updatedAt: 0 });

    await assert.rejects(
      service.openProxyResource('espn', 'https://cdn.example/segment.ts'),
      error => error.statusCode === failureStatus,
    );
    assert.equal(service.resolutionCache.peek('espn'), undefined);
    assert.equal(service.getStatus().metrics.resolutionRefreshes, 1);
  });
}
