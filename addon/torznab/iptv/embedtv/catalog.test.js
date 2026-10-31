import assert from 'node:assert/strict';
import test from 'node:test';
import {
  associateEvents,
  extractEmbedTvChannelId,
  normalizeCatalogPayload,
  normalizeEpgPayload,
  normalizeEventsPayload,
} from './catalog.js';

test('normalizes the live EmbedTV channels envelope and category ids', () => {
  const catalog = normalizeCatalogPayload({
    categories: [{ id: 0, name: 'Todos' }, { id: 1, name: 'Esportes' }],
    channels: [{
      id: 'espn',
      image: 'https://img.example/espn.png',
      name: 'ESPN',
      categories: [0, 1],
      url: 'https://dynamic.embedtv.lat/espn',
    }],
  });

  assert.deepEqual(catalog.categories, [{ id: 0, name: 'Todos' }, { id: 1, name: 'Esportes' }]);
  assert.deepEqual(catalog.channels[0].categoryNames, ['Todos', 'Esportes']);
  assert.equal(catalog.channels[0].pageUrl, 'https://dynamic.embedtv.lat/espn');
  assert.equal(catalog.channels[0].epgId, 'espn');
});

test('normalizes EPG envelopes keyed by channel and preserves explicit offsets', () => {
  const epg = normalizeEpgPayload([
    {
      id: 'espn',
      data: [{
        title: 'Jogo',
        desc: 'Descrição',
        start_date: '2026-09-19T08:30:00-03:00',
      }],
    },
  ]);
  assert.equal(epg.length, 1);
  assert.deepEqual(epg[0], {
    channelId: 'espn',
    title: 'Jogo',
    description: 'Descrição',
    start: '2026-09-19T08:30:00-03:00',
    stop: undefined,
  });
});

test('maps events only from explicit EmbedTV player channel paths', () => {
  const events = normalizeEventsPayload([{
    id: 42,
    title: 'Brasil x Chile',
    time_start: '2026-09-19T10:00:00-03:00',
    time_end: '2026-09-19T12:00:00-03:00',
    players: [
      'https://dynamic.embedtv.cc/sportv',
      'https://dynamic.embedtv.lat/sportv',
      'https://unknown.example/sportv',
    ],
  }]);
  const channels = [{ id: 'sportv', name: 'SporTV' }];
  const associated = associateEvents(events, channels);
  assert.equal(extractEmbedTvChannelId(events[0].players[0]), 'sportv');
  assert.equal(extractEmbedTvChannelId(events[0].players[1]), 'sportv');
  assert.equal(extractEmbedTvChannelId(events[0].players[2]), undefined);
  assert.equal(associated.entries.length, 1);
  assert.equal(associated.entries[0].channel.id, 'sportv');
  assert.equal(associated.unmapped.length, 0);
});
