const SAMPLE_SERIES = [
  { title: 'Arquivo Aurora', year: 2025, season: 1 },
  { title: 'Margem Norte', year: 2024, season: 2 },
  { title: 'Ecos de Mercúrio', year: 2026, season: 1 },
  { title: 'Cidade de Vidro', year: 2025, season: 3 },
  { title: 'A Quinta Estação', year: 2024, season: 1 },
  { title: 'Maré de Inverno', year: 2026, season: 2 },
];

const SAMPLE_CLIENTS = [
  { name: 'Prowlarr', userAgent: 'Prowlarr/2.3.0' },
  { name: 'Sonarr', userAgent: 'Sonarr/4.0.0' },
  { name: 'Radarr', userAgent: 'Radarr/5.0.0' },
];

const SAMPLE_SOURCES = [
  { key: 'stremio', provider: 'Torrentio' },
  { key: 'betor', provider: 'BeTor' },
  { key: 'detour', provider: 'HDRTorrent' },
];

const SAMPLE_QUALITIES = ['1080p WEB-DL', '2160p WEB-DL', '1080p BluRay', '720p WEB-DL'];
const SAMPLE_EVENT_COUNT = 30;
const SAMPLE_EVENT_INTERVAL_MS = 53 * 60 * 1000;

export function buildSampleSearchEvents(now = Date.now()) {
  return Array.from({ length: SAMPLE_EVENT_COUNT }, (_, index) => {
    const series = SAMPLE_SERIES[index % SAMPLE_SERIES.length];
    const client = SAMPLE_CLIENTS[index % SAMPLE_CLIENTS.length];
    const source = SAMPLE_SOURCES[index % SAMPLE_SOURCES.length];
    const episode = (index % 8) + 1;
    const resultCount = index % 13 === 12 ? 0 : 2 + (index % 5);
    const durationMs = 720 + ((index * 683) % 12_400);
    const timestamp = new Date(now - (index * SAMPLE_EVENT_INTERVAL_MS)).toISOString();
    const level = resultCount > 0 ? 'info' : 'warn';
    const releases = Array.from({ length: Math.min(resultCount, 3) }, (_, releaseIndex) => ({
      title: series.title + '.S' + String(series.season).padStart(2, '0')
        + 'E' + String(episode).padStart(2, '0') + '.'
        + SAMPLE_QUALITIES[(index + releaseIndex) % SAMPLE_QUALITIES.length].replaceAll(' ', '.'),
      provider: source.provider,
      source: source.key,
    }));

    return {
      timestamp,
      level,
      kind: 'search',
      message: resultCount
        ? series.title + ' T' + series.season + 'E' + String(episode).padStart(2, '0')
          + ' retornou ' + resultCount + ' resultado(s) em ' + formatDuration(durationMs) + '.'
        : series.title + ' T' + series.season + 'E' + String(episode).padStart(2, '0')
          + ' terminou sem resultados em ' + formatDuration(durationMs) + '.',
      durationMs,
      search: {
        action: 'tvsearch',
        title: series.title,
        year: series.year,
        season: series.season,
        episode,
        sourceBreakdown: [{
          source: source.key,
          candidateCount: resultCount + 2,
          returnedCount: resultCount,
          providers: [{
            id: source.key,
            name: source.provider,
            outcome: resultCount ? 'success' : 'no_results',
            foundCount: resultCount + 1,
            returnedCount: resultCount,
            duplicateCount: 0,
            omittedByLimit: 0,
          }],
        }],
      },
      requester: {
        label: client.name,
        client: client.name,
        userAgent: client.userAgent,
      },
      releases,
    };
  });
}

function formatDuration(durationMs) {
  return durationMs < 1_000
    ? durationMs + ' ms'
    : (durationMs / 1_000).toFixed(1) + ' s';
}
