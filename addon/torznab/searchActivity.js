const ACTIVITY_TIME_ZONE = 'America/Sao_Paulo';
const ACTIVITY_DAY_LIMIT = 120;
const SEARCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEARCH_MINUTE_MS = 60 * 1000;
const activityStartedAt = Date.now();
const activityByDay = new Map();
const activityMetricsByDay = new Map();
const activityByMinute = new Map();
const activityDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ACTIVITY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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
}

export function buildSearchActivitySnapshot(now = Date.now()) {
  pruneSearchActivity(now);
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
  const minuteCutoff = now - SEARCH_WINDOW_MS;
  for (const minute of activityByMinute.keys()) {
    if (minute * SEARCH_MINUTE_MS < minuteCutoff) {
      activityByMinute.delete(minute);
    }
  }

  const retainedDays = new Set(getActivityDayKeys(now, ACTIVITY_DAY_LIMIT));
  for (const day of activityByDay.keys()) {
    if (!retainedDays.has(day)) {
      activityByDay.delete(day);
      activityMetricsByDay.delete(day);
    }
  }
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
