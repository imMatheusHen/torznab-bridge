import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSearchActivitySnapshot,
  flushSearchActivity,
  initializeSearchActivity,
  recordSearchActivity,
} from './searchActivity.js';

test('starts with 120 chronological days and unknown averages', () => {
  const snapshot = buildSearchActivitySnapshot();
  assert.equal(snapshot.days.length, 120);
  assert.equal(snapshot.days.at(-1).observed, true);
  assert.ok(snapshot.days.slice(1).every((day, index) => {
    const previous = Date.parse(snapshot.days[index].date + 'T00:00:00Z');
    return Date.parse(day.date + 'T00:00:00Z') - previous === 24 * 60 * 60 * 1000;
  }));
  assert.equal(snapshot.averageResults, null);
  assert.equal(snapshot.averageDurationMs, null);
  assert.equal(snapshot.resultSampleCount, 0);
});

test('counts real searches while averaging only successful result samples', () => {
  const now = Date.now();
  recordSearchActivity(now - 2_000, { resultCount: 2, durationMs: 1000 });
  recordSearchActivity(now - 1_000, { resultCount: 0, durationMs: 500 });
  recordSearchActivity(now - 500, { resultCount: 99, durationMs: 2000, outcome: 'failure' });
  recordSearchActivity(now - 250, { resultCount: 9, durationMs: -1 });

  const snapshot = buildSearchActivitySnapshot(now);
  assert.equal(snapshot.last24HoursCount, 4);
  assert.equal(snapshot.totalSearchCount, 4);
  assert.equal(snapshot.successfulSearchCount, 3);
  assert.equal(snapshot.failedSearchCount, 1);
  assert.equal(snapshot.resultSampleCount, 3);
  assert.equal(snapshot.averageResults, 11 / 3);
  assert.equal(snapshot.durationSampleCount, 3);
  assert.equal(snapshot.averageDurationMs, 3500 / 3);
});


test('persists the 120-day activity across an application restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'torznab-activity-'));
  const filePath = path.join(directory, 'search-activity.json');
  const now = Date.now();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await initializeSearchActivity({ filePath, now });
  recordSearchActivity(now - 30_000, { resultCount: 4, durationMs: 1200 });
  recordSearchActivity(now - 20_000, { resultCount: 0, durationMs: 800, outcome: 'failure' });
  await flushSearchActivity();
  const beforeRestart = buildSearchActivitySnapshot(now);

  await initializeSearchActivity({ filePath, now });
  const afterRestart = buildSearchActivitySnapshot(now);
  assert.deepEqual(afterRestart, beforeRestart);
  const storedState = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(storedState.version, 1);

  storedState.demoData = true;
  const demoFilePath = path.join(directory, 'demo-search-activity.json');
  await fs.writeFile(demoFilePath, JSON.stringify(storedState));
  await initializeSearchActivity({ filePath: demoFilePath, now });
  assert.equal(buildSearchActivitySnapshot(now).demoData, true);
});
