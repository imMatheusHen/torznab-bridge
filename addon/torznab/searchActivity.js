import { promises as fs } from 'node:fs';
import path from 'node:path';

const ACTIVITY_TIME_ZONE = 'America/Sao_Paulo';
const ACTIVITY_DAY_LIMIT = 120;
const SEARCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEARCH_MINUTE_MS = 60 * 1000;
const PERSIST_DELAY_MS = 500;
const activityByDay = new Map();
const activityMetricsByDay = new Map();
const activityByMinute = new Map();
const activityDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACTIVITY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
let activityStartedAt = Date.now();
let activityDemoData = false;
let activityStoragePath = resolveActivityStoragePath();
let activityStorageReady = false;
let activityStorageDisabled = false;
let pendingSaveTimeout;
let saveQueue = Promise.resolve();

export async function initializeSearchActivity({
  filePath = resolveActivityStoragePath(),
  now = Date.now(),
} = {}) {
  if (activityStorageReady) await flushSearchActivity();
  if (pendingSaveTimeout) {
    clearTimeout(pendingSaveTimeout);
    pendingSaveTimeout = undefined;
  }
  await saveQueue;
  resetSearchActivity(now);
  activityStoragePath = filePath;
  activityStorageDisabled = false;

  let contents;
  try {
    contents = await fs.readFile(activityStoragePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      activityStorageReady = true;
      return;
    }
    disableActivityStorage(error);
    return;
  }

  try {
    const state = JSON.parse(contents);
    if (!restoreSearchActivityState(state, now)) {
      throw new Error('unsupported or invalid activity history format');
    }
    activityStorageReady = true;
    if (pruneSearchActivity(now)) scheduleSearchActivitySave();
  } catch (error) {
    disableActivityStorage(error);
  }
}

export function recordSearchActivity(timestamp, {
  resultCount = 0,
  durationMs,
  outcome = 'success',
} = {}) {
  const occurredAt = normalizeTimestamp(timestamp);
  const minute = Math.floor(occurredAt / SEARCH_MINUTE_MS);
  const day = getActivityDayKey(occurredAt);
  const metrics = activityMetricsByDay.get(day) || createDailyMetrics();

  activityByMinute.set(minute, (activityByMinute.get(minute) || 0) + 1);
  activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
  metrics.searchCount += 1;
  if (outcome === 'failure') {
    metrics.failureCount += 1;
  } else {
    metrics.successCount += 1;
    metrics.resultCount += Math.max(0, Number(resultCount) || 0);
  }
  if (isValidDuration(durationMs)) {
    metrics.durationTotalMs += Number(durationMs);
    metrics.durationSampleCount += 1;
  }
  activityMetricsByDay.set(day, metrics);
  pruneSearchActivity(occurredAt);
  scheduleSearchActivitySave();
}

export function buildSearchActivitySnapshot(now = Date.now()) {
  if (pruneSearchActivity(now)) scheduleSearchActivitySave();
  const dates = getActivityDayKeys(now, ACTIVITY_DAY_LIMIT);
  const today = dates[dates.length - 1];
  const cutoff = now - SEARCH_WINDOW_MS;
  const totals = dates.reduce((total, date) => {
    const daily = activityMetricsByDay.get(date);
    if (!daily) return total;
    addDailyMetrics(total, daily);
    return total;
  }, createDailyMetrics());
  const last24HoursCount = Array.from(activityByMinute.entries())
    .filter(([minute]) => minute * SEARCH_MINUTE_MS >= cutoff)
    .reduce((total, [, count]) => total + count, 0);
  const firstObservedDate = getActivityDayKey(activityStartedAt);

  return {
    timeZone: ACTIVITY_TIME_ZONE,
    historyStartedAt: new Date(activityStartedAt).toISOString(),
    demoData: activityDemoData,
    todayCount: activityByDay.get(today) || 0,
    last24HoursCount,
    totalSearchCount: totals.searchCount,
    successfulSearchCount: totals.successCount,
    failedSearchCount: totals.failureCount,
    resultSampleCount: totals.successCount,
    durationSampleCount: totals.durationSampleCount,
    averageResults: totals.successCount ? totals.resultCount / totals.successCount : null,
    averageDurationMs: totals.durationSampleCount
      ? totals.durationTotalMs / totals.durationSampleCount
      : null,
    days: dates.map(date => {
      const daily = activityMetricsByDay.get(date) || createDailyMetrics();
      return {
        date,
        count: activityByDay.get(date) || 0,
        successCount: daily.successCount,
        failureCount: daily.failureCount,
        observed: date >= firstObservedDate,
      };
    }),
  };
}

export async function flushSearchActivity() {
  if (pendingSaveTimeout) {
    clearTimeout(pendingSaveTimeout);
    pendingSaveTimeout = undefined;
  }
  if (!activityStorageReady || activityStorageDisabled) return;
  await persistSearchActivity();
}

function resolveActivityStoragePath() {
  const configPath = process.env.TORZNAB_RUNTIME_CONFIG_PATH || '/config/torznab-ui.json';
  return process.env.TORZNAB_SEARCH_ACTIVITY_PATH
    || path.join(path.dirname(configPath), 'search-activity.json');
}

function resetSearchActivity(now) {
  activityByDay.clear();
  activityMetricsByDay.clear();
  activityByMinute.clear();
  activityStartedAt = normalizeTimestamp(now);
  activityDemoData = false;
  activityStorageReady = false;
}

function restoreSearchActivityState(state, now) {
  if (!state || state.version !== 1 || !Array.isArray(state.days) || !Array.isArray(state.minutes)) {
    return false;
  }
  const startedAt = Date.parse(state.historyStartedAt || '');
  if (!Number.isFinite(startedAt) || startedAt > now || typeof state.demoData !== 'boolean') return false;

  const restoredDays = new Map();
  for (const entry of state.days) {
    const metrics = normalizeStoredDay(entry);
    if (!metrics || restoredDays.has(entry.date)) return false;
    restoredDays.set(entry.date, metrics);
  }

  const restoredMinutes = new Map();
  for (const entry of state.minutes) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [minute, count] = entry;
    if (!Number.isSafeInteger(minute) || !Number.isSafeInteger(count) || count < 1) return false;
    if (minute * SEARCH_MINUTE_MS > now + SEARCH_MINUTE_MS) return false;
    if (restoredMinutes.has(minute)) return false;
    restoredMinutes.set(minute, count);
  }

  activityStartedAt = startedAt;
  activityDemoData = state.demoData;
  for (const [date, metrics] of restoredDays) {
    activityMetricsByDay.set(date, metrics);
    activityByDay.set(date, metrics.searchCount);
  }
  for (const [minute, count] of restoredMinutes) activityByMinute.set(minute, count);
  return true;
}

function normalizeStoredDay(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.date !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return null;
  const dateTimestamp = Date.parse(`${entry.date}T12:00:00.000Z`);
  if (!Number.isFinite(dateTimestamp) || getActivityDayKey(dateTimestamp) !== entry.date) return null;
  const searchCount = readStoredCount(entry.searchCount);
  const successCount = readStoredCount(entry.successCount);
  const failureCount = readStoredCount(entry.failureCount);
  const resultCount = readStoredTotal(entry.resultCount);
  const durationTotalMs = readStoredTotal(entry.durationTotalMs);
  const durationSampleCount = readStoredCount(entry.durationSampleCount);
  if ([searchCount, successCount, failureCount, resultCount, durationTotalMs, durationSampleCount].includes(null)) return null;
  if (searchCount !== successCount + failureCount || durationSampleCount > searchCount) return null;
  return { searchCount, successCount, failureCount, resultCount, durationTotalMs, durationSampleCount };
}

function readStoredCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readStoredTotal(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function scheduleSearchActivitySave() {
  if (!activityStorageReady || activityStorageDisabled || pendingSaveTimeout) return;
  pendingSaveTimeout = setTimeout(() => {
    pendingSaveTimeout = undefined;
    persistSearchActivity().catch(error => {
      console.error('Failed to persist Torznab search activity', error);
    });
  }, PERSIST_DELAY_MS);
  pendingSaveTimeout.unref?.();
}

function persistSearchActivity() {
  if (!activityStorageReady || activityStorageDisabled) return Promise.resolve();
  const payload = `${JSON.stringify(buildSearchActivityState(), null, 2)}\n`;
  const temporaryPath = `${activityStoragePath}.tmp-${process.pid}`;
  const write = saveQueue.then(async () => {
    await fs.mkdir(path.dirname(activityStoragePath), { recursive: true });
    await fs.writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, activityStoragePath);
  });
  saveQueue = write.catch(error => {
    console.error('Failed to persist Torznab search activity', error);
  });
  return write;
}

function buildSearchActivityState() {
  const now = Date.now();
  pruneSearchActivity(now);
  return {
    version: 1,
    historyStartedAt: new Date(activityStartedAt).toISOString(),
    demoData: activityDemoData,
    days: Array.from(activityMetricsByDay.entries()).map(([date, metrics]) => ({ date, ...metrics })),
    minutes: Array.from(activityByMinute.entries()),
  };
}

function disableActivityStorage(error) {
  activityStorageDisabled = true;
  activityStorageReady = false;
  console.error(`Torznab search activity persistence disabled: ${error.message}`);
}

function createDailyMetrics() {
  return {
    searchCount: 0,
    successCount: 0,
    failureCount: 0,
    resultCount: 0,
    durationTotalMs: 0,
    durationSampleCount: 0,
  };
}

function addDailyMetrics(total, daily) {
  total.searchCount += daily.searchCount;
  total.successCount += daily.successCount;
  total.failureCount += daily.failureCount;
  total.resultCount += daily.resultCount;
  total.durationTotalMs += daily.durationTotalMs;
  total.durationSampleCount += daily.durationSampleCount;
  return total;
}

function isValidDuration(value) {
  return value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function normalizeTimestamp(value) {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
    ? Number(value)
    : Date.now();
}

function pruneSearchActivity(now) {
  let changed = false;
  const minuteCutoff = now - SEARCH_WINDOW_MS;
  for (const minute of activityByMinute.keys()) {
    if (minute * SEARCH_MINUTE_MS < minuteCutoff) {
      activityByMinute.delete(minute);
      changed = true;
    }
  }

  const retainedDays = new Set(getActivityDayKeys(now, ACTIVITY_DAY_LIMIT));
  for (const day of activityByDay.keys()) {
    if (!retainedDays.has(day)) {
      activityByDay.delete(day);
      activityMetricsByDay.delete(day);
      changed = true;
    }
  }
  return changed;
}

function getActivityDayKeys(timestamp, count) {
  const todayKey = getActivityDayKey(timestamp);
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - count + index + 1);
    return date.toISOString().slice(0, 10);
  });
}

function getActivityDayKey(timestamp) {
  const parts = activityDayFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
