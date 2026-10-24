import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedTvError } from './client.js';
import { EmbedTvService } from './service.js';
import { decodeProxyTarget } from './hls.js';

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

test('uses an FFmpeg-compatible suffix for proxied HLS resources', () => {
  const service = new EmbedTvService({ client: new FakeClient() });
  const url = service.buildProxyUrl(
    'http://bridge:9699',
    'espn',
    'https://cdn.example/live/segment.png',
  );
  assert.match(url, /\/channel\/espn\/hls\.ts\?u=/);
  assert.equal(decodeProxyTarget(new URL(url).searchParams.get('u')), 'https://cdn.example/live/segment.png');
});

test('proxies direct HLS resources with extensions that FFmpeg rejects', async () => {
  const client = new FakeClient();
  client.fetchStream = async () => ({
    status: 206,
    headers: new Headers({ 'content-type': 'text/css' }),
    body: { cancel: async () => {} },
  });
  const service = new EmbedTvService({ client });
  const resolution = { headers: { 'User-Agent': client.userAgent } };

  assert.equal(
    await service.chooseManifestMode('css', ['https://cdn.example/assets/segment.css'], resolution),
    'proxy',
  );
  assert.equal(
    await service.chooseManifestMode('ts', ['https://cdn.example/assets/segment.ts'], resolution),
    'direct',
  );
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


test('active probe validates a media playlist and reads the first bytes of a .js MPEG-TS segment', async () => {
  const client = new FakeClient();
  const requests = [];
  client.fetchText = async url => ({
    response: { status: 200 },
    contentType: 'application/vnd.apple.mpegurl',
    text: url.endsWith('first.m3u8')
      ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant.m3u8\n'
      : '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.js\n',
  });
  client.fetchStream = async (url, options) => {
    requests.push({ url, options });
    const bytes = new Uint8Array(384);
    bytes[0] = 0x47;
    bytes[188] = 0x47;
    bytes[376] = 0x47;
    return new Response(bytes, { headers: { 'content-type': 'application/javascript' } });
  };
  const service = new EmbedTvService({ client });
  const status = await service.probe();
  assert.equal(status.status, 'online');
  assert.equal(status.playback.ok, true);
  assert.equal(status.playback.bytesRead, 384);
  assert.equal(status.lastPlaybackChannelId, 'espn');
  assert.equal(status.lastPlaybackContentType, 'application/javascript');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /segment\.js$/);
  assert.equal(requests[0].options.headers.Range, 'bytes=0-383');
  assert.equal(service.getStatus().metrics.playbackProbeBytes, 384);
});

test('active probe marks EmbedTV unavailable when the first segment returns HTTP 502', async () => {
  const client = new FakeClient();
  client.fetchText = async () => ({
    response: { status: 200 },
    contentType: 'application/vnd.apple.mpegurl',
    text: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.js\n',
  });
  client.fetchStream = async () => {
    throw new EmbedTvError('EmbedTV upstream respondeu HTTP 502', {
      statusCode: 502,
      code: 'http_502',
      stage: 'playback-segment',
    });
  };
  const service = new EmbedTvService({ client });
  const status = await service.probe();
  assert.equal(status.status, 'unavailable');
  assert.equal(status.statusLabel, 'Indisponível');
  assert.equal(status.playback.ok, false);
  assert.equal(status.playback.error.statusCode, 502);
  assert.equal(status.lastFailure.statusCode, 502);
});

test('proxy forwards a single byte range and marks the service unavailable on HTTP 502', async () => {
  const client = new FakeClient();
  let receivedRange;
  client.fetchStream = async (_url, options) => {
    receivedRange = options.headers.Range;
    return new Response(new Uint8Array([0x47, 0x47]), {
      status: 502,
      headers: { 'content-type': 'application/javascript' },
    });
  };
  const service = new EmbedTvService({ client });
  await service.resolveChannel('espn');
  service.proxyOrigins.set('espn', { origins: new Set(['https://cdn.example']), updatedAt: 0 });
  await assert.rejects(
    service.openProxyResource('espn', 'https://cdn.example/segment.js', { range: 'bytes=0-383' }),
    error => error.statusCode === 502,
  );
  assert.equal(receivedRange, 'bytes=0-383');
  assert.equal(service.getStatus().status, 'unavailable');
});
