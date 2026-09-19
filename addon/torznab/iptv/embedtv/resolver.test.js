import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeUpstreamUrl } from './client.js';
import {
  extractNestedManifestUrl,
  extractStreamCandidates,
  isBrowserChallengeFlow,
  isHlsBody,
  selectStreamCandidate,
  resolveChannelPage,
} from './resolver.js';

test('extracts current startPlayer, data-stream, txt and m3u8 forms without fixed CDN assumptions', () => {
  const html = `
    <script src="https://cdn.example/player.js"></script>
    <div data-stream="https://cdn.example/live.txt"></div>
    <script>
      startPlayer("https://cdn.example/live.m3u8?token=abc");
      startPlayer("https://live-chunks.mediacdn.net/v1/manifest/fallback.m3u8");
    </script>`;
  const candidates = extractStreamCandidates(html, { pageUrl: 'https://dynamic.embedtv.lat/espn' });
  assert.ok(candidates.some(candidate => candidate.url === 'https://cdn.example/live.m3u8?token=abc'));
  assert.ok(candidates.some(candidate => candidate.url === 'https://cdn.example/live.txt'));
  assert.equal(candidates.some(candidate => candidate.url === 'https://cdn.example/player.js'), false);
  assert.equal(selectStreamCandidate(candidates).url, 'https://cdn.example/live.m3u8?token=abc');
});

test('recognizes HLS manifests delivered with text/plain and unwraps JSON/text pointers', () => {
  assert.equal(isHlsBody('#EXTM3U\n#EXTINF:6,\nseg.ts', 'text/plain'), true);
  assert.equal(extractNestedManifestUrl('{"url":"https://cdn.example/master.m3u8"}', 'https://cdn.example/live.txt'), 'https://cdn.example/master.m3u8');
  assert.equal(extractNestedManifestUrl('https://cdn.example/master.m3u8\n', 'https://cdn.example/live.txt'), 'https://cdn.example/master.m3u8');
});

test('accepts HTTPS CDN origins but rejects insecure and private proxy targets', () => {
  assert.equal(isSafeUpstreamUrl('https://cdn.example/live.m3u8'), true);
  assert.equal(isSafeUpstreamUrl('http://cdn.example/live.m3u8'), false);
  assert.equal(isSafeUpstreamUrl('https://127.0.0.1/live.m3u8'), false);
  assert.equal(isSafeUpstreamUrl('https://[fd00::1]/live.m3u8'), false);
});

test('selects a public static HLS source when challenge markers coexist on the page', async () => {
  const html = `
    <script>
      fetch('https://api.cloudflaire.lat/get_token', { method: 'POST' });
      startPlayer(data.url);
      function startPlayer(src) { var src = 'https://cdn.example/static.txt'; }
    </script>`;
  const candidates = extractStreamCandidates(html, { pageUrl: 'https://dynamic.embedtv.lat/afazenda' });
  assert.equal(isBrowserChallengeFlow(html), true);
  assert.equal(candidates[0].fallback, true);
  const resolution = await resolveChannelPage({ id: 'afazenda', pageUrl: 'https://dynamic.embedtv.lat/afazenda' }, {
    async fetchChannelPage() { return html; },
    userAgent: 'test-agent',
  });
  assert.equal(resolution.streamUrl, 'https://cdn.example/static.txt');
  assert.equal(resolution.streamKind, 'txt');
});

test('rejects a challenge page when it exposes only a generic dynamic origin', async () => {
  const html = `
    <script>
      fetch('https://api.cloudflaire.lat/get_token', { method: 'POST' });
      startPlayer(data.url);
      startPlayer('https://live-chunks.mediacdn.net/v1/manifest/fallback.m3u8');
    </script>`;
  await assert.rejects(
    resolveChannelPage({ id: 'afazenda', pageUrl: 'https://dynamic.embedtv.lat/afazenda' }, {
      async fetchChannelPage() { return html; },
      userAgent: 'test-agent',
    }),
    error => error.code === 'browser_challenge_required' && error.statusCode === 424,
  );
});
