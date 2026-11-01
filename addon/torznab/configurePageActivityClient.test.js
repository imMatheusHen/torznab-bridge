import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURE_PAGE_ACTIVITY_CLIENT_SCRIPT } from './configurePageActivityClient.js';
import { groupSearchEvents } from './searchEventGrouping.js';

test('renders a complete 5 by 24 activity grid with today in the final cell', () => {
  const script = CONFIGURE_PAGE_ACTIVITY_CLIENT_SCRIPT.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, 'activity client script is present');

  const ids = [
    'stat-search-today',
    'stat-search-total',
    'stat-search-failures',
    'activity-period',
    'activity-history-note',
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, { textContent: '' }]));
  nodes['search-activity-days'] = {
    style: { setProperty() {} },
    dataset: {},
    setAttribute() {},
    innerHTML: '',
  };
  nodes['search-activity-months'] = {
    style: { setProperty() {} },
    innerHTML: '',
  };

  const window = {};
  const document = {
    getElementById: id => nodes[id] || null,
    querySelector: () => null,
  };
  new Function('window', 'document', script)(window, document);

  const days = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 5, 30 + index));
    return {
      date: date.toISOString().slice(0, 10),
      count: index === 1 ? 1 : (index === 2 ? 4 : (index === 3 ? 6 : (index === 119 ? 12 : 0))),
      observed: true,
    };
  });
  const missingDate = days[5].date;
  days.splice(5, 1);
  assert.doesNotThrow(() => window.applySearchActivity({
    days,
    totalSearchCount: 13,
    todayCount: 12,
    failedSearchCount: 0,
    timeZone: 'America/Sao_Paulo',
  }));

  const html = nodes['search-activity-days'].innerHTML;
  assert.equal((html.match(/class="activity-day"/g) || []).length, 120);
  assert.doesNotMatch(html, /placeholder|title=/);
  assert.match(html, /data-date="2026-07-01" data-count="1" data-observed="true"/);
  assert.match(html, new RegExp('data-date="' + missingDate + '" data-count="0" data-observed="false"'));
  assert.match(html, /data-count="1" data-observed="true" data-level="1"/);
  assert.match(html, /data-count="4" data-observed="true" data-level="2"/);
  assert.match(html, /data-count="6" data-observed="true" data-level="3"/);
  assert.match(html, /data-count="12" data-observed="true" data-level="4"/);
  assert.ok(html.indexOf('data-date="2026-10-27"') > html.indexOf('data-date="2026-06-30"'));
  assert.match(nodes['search-activity-months'].innerHTML, /jul/);
  assert.match(nodes['search-activity-months'].innerHTML, /out/);
  const monthColumns = Array.from(
    nodes['search-activity-months'].innerHTML.matchAll(/grid-column:(\d+) \/ (\d+)/g),
    match => match[1],
  );
  assert.equal(new Set(monthColumns).size, monthColumns.length);
});


test('groups burst episode searches by requester, title, and season', () => {
  const requester = { ip: '172.28.0.1', client: 'Prowlarr', label: 'Prowlarr (172.28.0.1)' };
  const events = [
    {
      kind: 'search',
      timestamp: '2026-10-28T02:06:16.265Z',
      requester,
      search: { action: 'tvsearch', title: 'VisionQuest', season: 1, episode: 6 },
    },
    {
      kind: 'search',
      timestamp: '2026-10-28T02:06:16.120Z',
      requester,
      search: { action: 'tvsearch', title: 'VisionQuest', season: 1, episode: 5 },
    },
    {
      kind: 'search',
      timestamp: '2026-10-28T02:06:15.900Z',
      requester: { ...requester, ip: '172.28.0.2' },
      search: { action: 'tvsearch', title: 'VisionQuest', season: 1, episode: 4 },
    },
    {
      kind: 'search',
      timestamp: '2026-10-28T02:06:13.000Z',
      requester,
      search: { action: 'tvsearch', title: 'VisionQuest', season: 2, episode: 1 },
    },
    {
      kind: 'search',
      timestamp: '2026-10-28T02:06:10.000Z',
      requester,
      search: { action: 'search', title: 'VisionQuest 2026 S01E03', season: 1, episode: 3 },
    },
  ];

  const grouped = groupSearchEvents(events, 1500);
  assert.equal(grouped.length, 4);
  assert.equal(grouped[0].kind, 'group');
  assert.deepEqual(grouped[0].events.map(event => event.search.episode), [6, 5]);
  assert.equal(grouped[1].event.requester.ip, '172.28.0.2');
  assert.equal(grouped[2].event.search.season, 2);
  assert.equal(grouped[3].event.search.episode, 3);
});

test('exposes the burst grouper to the configure page client script', () => {
  const script = CONFIGURE_PAGE_ACTIVITY_CLIENT_SCRIPT.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  const window = {};
  new Function('window', 'document', script)(window, {});
  assert.equal(typeof window.groupSearchEvents, 'function');
  assert.equal(window.groupSearchEvents([
    { kind: 'search', timestamp: '2026-10-28T02:06:16.265Z', requester: { ip: 'x', client: 'Prowlarr' }, search: { title: 'VisionQuest S01E06', season: 1, episode: 6 } },
    { kind: 'search', timestamp: '2026-10-28T02:06:16.120Z', requester: { ip: 'x', client: 'Prowlarr' }, search: { title: 'VisionQuest S01E05', season: 1, episode: 5 } },
  ])[0].kind, 'group');
});
