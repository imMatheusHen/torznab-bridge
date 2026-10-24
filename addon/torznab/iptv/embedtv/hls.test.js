import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeProxyTarget,
  encodeProxyTarget,
  getFirstMediaSegmentUrl,
  getFirstVariantUrl,
  getManifestResourceUrls,
  isPlausibleMediaSegment,
  rewriteHlsManifest,
} from './hls.js';

test('rewrites relative HLS resources to direct absolute URLs', () => {
  const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\nseg-1.ts\n';
  const resources = getManifestResourceUrls(manifest, 'https://cdn.example/live/index.m3u8');
  assert.deepEqual(resources, [
    'https://cdn.example/live/keys/key.bin',
    'https://cdn.example/live/seg-1.ts',
  ]);
  const rewritten = rewriteHlsManifest(manifest, 'https://cdn.example/live/index.m3u8');
  assert.match(rewritten, /URI="https:\/\/cdn\.example\/live\/keys\/key\.bin"/);
  assert.match(rewritten, /https:\/\/cdn\.example\/live\/seg-1\.ts/);
});

test('rewrites every HLS URI through an opaque local proxy target', () => {
  const manifest = '#EXTM3U\nvariant/index.m3u8\n';
  const rewritten = rewriteHlsManifest(manifest, 'https://cdn.example/master.m3u8', {
    mode: 'proxy',
    proxyUrl: value => `/iptv/embedtv/channel/espn/hls?u=${encodeProxyTarget(value)}`,
  });
  const encoded = rewritten.match(/u=([^\s]+)/)?.[1];
  assert.ok(encoded);
  assert.equal(decodeProxyTarget(encoded), 'https://cdn.example/variant/index.m3u8');
});


test('finds the first variant and media segment in an HLS master/media pair', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvideo/720.m3u8\n';
  const media = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nchunk-1.js\n';
  assert.equal(getFirstVariantUrl(master, 'https://cdn.example/master.m3u8'), 'https://cdn.example/video/720.m3u8');
  assert.equal(getFirstMediaSegmentUrl(media, 'https://cdn.example/video/720.m3u8'), 'https://cdn.example/video/chunk-1.js');
});

test('sniffs MPEG-TS bytes even when the segment uses a .js URL and JavaScript MIME type', () => {
  const ts = Buffer.alloc(384);
  ts[0] = 0x47;
  ts[188] = 0x47;
  ts[376] = 0x47;
  assert.equal(isPlausibleMediaSegment(ts), true);
  assert.equal(isPlausibleMediaSegment(Buffer.from('<html>upstream error</html>')), false);
  assert.equal(isPlausibleMediaSegment(Buffer.from('{\"error\":\"failed\"}')), false);
  assert.equal(isPlausibleMediaSegment(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false);
});
