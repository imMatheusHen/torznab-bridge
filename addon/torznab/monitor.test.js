import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchActivitySnapshot, recordSearchActivity } from './searchActivity.js';
import {
  buildStatusSnapshot,
  recordDownloadEvent,
  recordSearchEvent,
  recordSourceFailure,
  recordSourceSearch,
} from './monitor.js';
import { SOURCE_BETOR, SOURCE_DATABASE, SOURCE_STREMIO } from './source.js';

const requester = {
  ip: '172.20.0.10',
  userAgent: 'Prowlarr/1.37.0',
};

const release = {
  _source: SOURCE_BETOR,
  provider: 'Comando Torrents',
  torrentTitle: 'Rick.and.Morty.S09E04.1080p.WEB-DL.DUAL',
  infoHash: 'ab11aa287817ffef77391bce6a9d358ef22390e8',
};

test('records requester and torrents returned by searches and downloads', () => {
  recordSearchEvent({
    action: 'tvsearch',
    query: { q: 'Rick and Morty', season: '9', ep: '4' },
    count: 1,
    requester,
    releases: [release],
    durationMs: 1250,
    limit: 2,
    searchBreakdown: [{
      source: 'detour',
      candidateCount: 2,
      returnedCount: 2,
      providers: [
        { id: 'hdrtorrent', name: 'HDRTorrent', outcome: 'success', foundCount: 2, returnedCount: 1, duplicateCount: 0, omittedByLimit: 1 },
        { id: 'comando-torrents', name: 'Comando Torrents', outcome: 'pending', foundCount: 0, returnedCount: 0, duplicateCount: 0, omittedByLimit: 0 },
      ],
    }],
  });
  recordDownloadEvent({ row: release, requester });

  const { events } = buildStatusSnapshot([SOURCE_BETOR]);
  const searchEvent = events.find(event => event.kind === 'search');
  const downloadEvent = events.find(event => event.kind === 'download');

  assert.equal(searchEvent.requester.client, 'Prowlarr');
  assert.equal(searchEvent.search.season, 9);
  assert.equal(searchEvent.search.episode, 4);
  assert.equal(searchEvent.search.limit, 2);
  assert.equal(searchEvent.durationMs, 1250);
  assert.match(searchEvent.message, /S09E04/);
  assert.deepEqual(searchEvent.search.sourceBreakdown[0].providers.map(provider => provider.returnedCount), [1, 0]);
  assert.equal(searchEvent.search.sourceBreakdown[0].providers[1].outcome, 'pending');
  assert.equal(searchEvent.releases[0].infoHash, release.infoHash);
  assert.match(searchEvent.releases[0].magnetUrl, /^magnet:\?/);
  assert.equal(downloadEvent.releases[0].title, release.torrentTitle);
});

test('records concise diagnostics for unavailable sources', () => {
  const error = new Error('timeout of 20000ms exceeded');
  error.code = 'ECONNABORTED';
  error.config = { url: 'https://torrentio.strem.fun/brazuca/manifest.json?apikey=secret' };

  recordSourceFailure(SOURCE_STREMIO, error, { kind: 'health', temporary: true });
  const snapshot = buildStatusSnapshot([SOURCE_STREMIO]);
  const failureEvent = snapshot.events.find(event => event.source === SOURCE_STREMIO);

  assert.match(failureEvent.message, /ECONNABORTED/);
  assert.match(failureEvent.message, /torrentio\.strem\.fun\/brazuca\/manifest\.json/);
  assert.doesNotMatch(failureEvent.message, /secret/);
  assert.equal(snapshot.indexers.find(indexer => indexer.key === SOURCE_STREMIO).status, 'unavailable');
});

test('exposes the latest source search details in the status snapshot', () => {
  const timestamp = Date.parse('2026-10-23T15:00:00.000Z');
  recordSourceSearch(SOURCE_BETOR, {
    query: 'Interestelar',
    count: 3,
    durationMs: 1250,
    timestamp,
  });

  const snapshot = buildStatusSnapshot([SOURCE_BETOR]);
  assert.deepEqual(snapshot.indexers.find(indexer => indexer.key === SOURCE_BETOR).lastSearch, {
    query: 'Interestelar',
    count: 3,
    durationMs: 1250,
    outcome: 'success',
    completedAt: new Date(timestamp).toISOString(),
  });
});

test('keeps a 120-day daily count and a rolling 24-hour count', () => {
  const now = Date.now();
  const before = buildSearchActivitySnapshot(now);
  recordSearchActivity(now - 1_000);
  recordSearchActivity(now - 500);

  const current = buildSearchActivitySnapshot(now);
  assert.equal(current.todayCount, before.todayCount + 2);
  assert.equal(current.last24HoursCount, before.last24HoursCount + 2);
  assert.equal(current.days.length, 120);

  const afterWindow = now + 24 * 60 * 60_000 + 2 * 60_000;
  recordSearchActivity(afterWindow);
  const nextSnapshot = buildSearchActivitySnapshot(afterWindow);
  assert.equal(nextSnapshot.last24HoursCount, 1);
  assert.equal(nextSnapshot.days.length, 120);
});


test('keeps source averages unknown until valid samples and excludes failed result counts', () => {
  const empty = buildStatusSnapshot([SOURCE_DATABASE]);
  const emptyIndexer = empty.indexers.find(indexer => indexer.key === SOURCE_DATABASE);
  assert.equal(emptyIndexer.searchMetrics.averageResults, null);
  assert.equal(emptyIndexer.searchMetrics.averageDurationMs, null);
  assert.equal(empty.health.unknown, 1);
  assert.equal(empty.health.online, 0);
  assert.equal(empty.health.dependenciesOk, null);

  recordSourceSearch(SOURCE_DATABASE, { query: 'Zero', count: 0, durationMs: 100 });
  recordSourceSearch(SOURCE_DATABASE, { query: 'Two', count: 2, durationMs: 300 });
  recordSourceSearch(SOURCE_DATABASE, { query: 'Failed', count: 99, durationMs: 5000, outcome: 'failure' });
  recordSourceSearch(SOURCE_DATABASE, { query: 'Pending', count: 77, durationMs: 600, outcome: 'inconclusive' });

  const metrics = buildStatusSnapshot([SOURCE_DATABASE]).indexers
    .find(indexer => indexer.key === SOURCE_DATABASE).searchMetrics;
  assert.equal(metrics.periodDays, 120);
  assert.equal(metrics.searchCount, 4);
  assert.equal(metrics.successfulSearchCount, 2);
  assert.equal(metrics.failedSearchCount, 1);
  assert.equal(metrics.resultSampleCount, 2);
  assert.equal(metrics.averageResults, 1);
  assert.equal(metrics.durationSampleCount, 4);
  assert.equal(metrics.averageDurationMs, 1500);
});
