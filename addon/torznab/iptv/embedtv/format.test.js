import assert from 'node:assert/strict';
import test from 'node:test';
import { buildM3u, buildXmltv, formatXmltvDate } from './format.js';

test('builds stable local M3U URLs and separates explicitly mapped events', () => {
  const output = buildM3u({
    baseUrl: 'http://bridge:9699',
    epgUrl: 'http://bridge:9699/iptv/embedtv/epg.xml',
    channels: [{
      id: 'espn',
      name: 'ESPN & Brasil',
      logo: 'https://img.example/espn.png',
      categoryNames: ['Todos', 'Esportes'],
    }],
    eventEntries: [{
      event: { id: '42', title: 'Brasil x Chile', leagueImage: '' },
      channel: { id: 'espn', name: 'ESPN', logo: '' },
    }],
  });

  assert.match(output, /#EXTM3U url-tvg="http:\/\/bridge:9699\/iptv\/embedtv\/epg\.xml"/);
  assert.match(output, /tvg-id="espn"/);
  assert.match(output, /group-title="Esportes"/);
  assert.match(output, /group-title="Eventos ao vivo"/);
  assert.equal((output.match(/http:\/\/bridge:9699\/iptv\/embedtv\/channel\/espn\/index\.m3u8/g) || []).length, 2);
  assert.doesNotMatch(output, /https:\/\/cdn\.example/);
});

test('builds XMLTV with UTF-8 escaping and inferred stop from next program', () => {
  const xml = buildXmltv({
    channels: [{ id: 'espn', name: 'ESPN & Brasil', logo: 'https://img.example/a&b.png' }],
    programs: [
      { channelId: 'espn', title: 'A < B', description: 'x & y', start: '2026-09-19T08:30:00-03:00' },
      { channelId: 'espn', title: 'Próximo', start: '2026-09-19T10:00:00-03:00' },
    ],
  });
  assert.match(xml, /encoding="UTF-8"/);
  assert.match(xml, /generator-info-url="https:\/\/embedtv\.cc"/);
  assert.match(xml, /<display-name>ESPN &amp; Brasil<\/display-name>/);
  assert.match(xml, /title lang="pt">A &lt; B<\/title>/);
  assert.match(xml, /desc lang="pt">x &amp; y<\/desc>/);
  assert.match(xml, /start="20260919083000 -0300" stop="20260919100000 -0300"/);
  assert.equal(formatXmltvDate('2026-09-19T08:30:00-03:00'), '20260919083000 -0300');
});
