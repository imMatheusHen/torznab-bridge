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
      url: 'https://ww0.embedtv.cc/espn',
    }],
  });

  assert.deepEqual(catalog.categories, [{ id: 0, name: 'Todos' }, { id: 1, name: 'Esportes' }]);
  assert.deepEqual(catalog.channels[0].categoryNames, ['Todos', 'Esportes']);
  assert.equal(catalog.channels[0].pageUrl, 'https://ww0.embedtv.cc/espn');
  assert.equal(catalog.channels[0].epgId, 'espn');
});

test('keeps legacy page hosts and rejects untrusted catalog page hosts', () => {
  const catalog = normalizeCatalogPayload({
    channels: [
      { id: 'apex', url: 'https://embedtv.cc/apex' },
      { id: 'legacy', url: 'https://dynamic.embedtv.lat/legacy' },
      { id: 'lookalike', url: 'https://embedtv.cc.attacker.example/lookalike' },
      { id: 'external', url: 'https://attacker.example/external' },
      { id: 'insecure', url: 'http://ww0.embedtv.cc/insecure' },
      { id: 'userinfo', url: 'https://user@ww0.embedtv.cc/userinfo' },
    ],
  });

  assert.deepEqual(catalog.channels.map(channel => channel.id), ['apex', 'legacy']);
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
      'https://ww0.embedtv.cc/sportv',
      'https://embedtv.lat/espn',
      'https://unknown.example/sportv',
      'https://embedtv.cc.attacker.example/sportv',
    ],
  }]);
  const channels = [{ id: 'sportv', name: 'SporTV' }, { id: 'espn', name: 'ESPN' }];
  const associated = associateEvents(events, channels);
  assert.equal(extractEmbedTvChannelId(events[0].players[0]), 'sportv');
  assert.equal(extractEmbedTvChannelId(events[0].players[1]), 'espn');
  assert.equal(extractEmbedTvChannelId(events[0].players[2]), undefined);
  assert.equal(extractEmbedTvChannelId(events[0].players[3]), undefined);
  assert.equal(associated.entries.length, 2);
  assert.deepEqual(associated.entries.map(entry => entry.channel.id), ['sportv', 'espn']);
  assert.equal(associated.unmapped.length, 0);
});
