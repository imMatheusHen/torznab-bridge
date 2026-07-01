import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStatusSnapshot,
  recordDownloadEvent,
  recordSearchEvent,
  recordSourceFailure,
} from './monitor.js';
import { SOURCE_BETOR, SOURCE_STREMIO } from './source.js';

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
  });
  recordDownloadEvent({ row: release, requester });

  const { events } = buildStatusSnapshot([SOURCE_BETOR]);
  const searchEvent = events.find(event => event.kind === 'search');
  const downloadEvent = events.find(event => event.kind === 'download');

  assert.equal(searchEvent.requester.client, 'Prowlarr');
  assert.equal(searchEvent.releases[0].infoHash, release.infoHash);
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
