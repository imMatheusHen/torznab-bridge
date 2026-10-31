import titleParser from 'parse-torrent-title';
import { normalizeImdbId } from '../release.js';
import { PROVIDER_HDRTORRENT } from './constants.js';

/**
 * Build a provider query from Torznab text or from the title already resolved
 * by BeTor for an IMDb-only request. Episode searches intentionally query the
 * season, so a season pack can match the requested episode.
 */
export function buildDetourSearchOptions(options = {}, betorRows = []) {
  const textCoordinates = extractSeriesCoordinates(options.query);
  const season = toPositiveInteger(options.season) || textCoordinates.season;
  const episode = toPositiveInteger(options.episode) || textCoordinates.episode;
  const isSeries = options.type === 'series'
    || options.types?.includes('series')
    || options.types?.includes('anime')
    || season !== undefined;
  const imdbId = normalizeImdbId(options.imdbId);

  const textTitle = extractTitle(options.query);
  const rowTitle = textTitle ? '' : findResolvedTitle(betorRows, { imdbId, season, isSeries });
  const title = textTitle || rowTitle;
  if (!title) return undefined;

  const query = isSeries && season !== undefined
    ? `${title} S${String(season).padStart(2, '0')}`
    : title;

  return {
    ...options,
    type: isSeries ? 'series' : 'movie',
    query: query.slice(0, 200),
    searchTitle: title,
    imdbId,
    season,
    episode,
  };
}

/**
 * HDRTorrent indexes Brazilian season names better than Sxx notation. Keep
 * the existing query for other providers, whose search syntax differs.
 */
export function buildDetourProviderQuery(providerId, options = {}) {
  const query = String(options.query || '').trim();
  const season = toPositiveInteger(options.season);
  if (providerId !== PROVIDER_HDRTORRENT || options.type !== 'series' || season === undefined) {
    return query;
  }

  const title = String(options.searchTitle || '').trim() || stripSeasonSuffix(query);
  return title ? `${title} ${season}ª Temporada`.slice(0, 200) : query;
}

function extractSeriesCoordinates(value) {
  const text = String(value || '').trim();
  if (!text) return {};

  let parsed = {};
  try {
    parsed = titleParser.parse(text) || {};
  } catch {
    // Use the explicit coordinate patterns below for unusual title text.
  }

  const seasonMatch = text.match(/\bS(?:eason)?\s*0*(\d{1,2})(?:[ ._-]*E(?:P(?:ISODE)?)?0*(\d{1,3}))?\b/i)
    || text.match(/\b(\d{1,2})\s*(?:ª|º|a)?\s*(?:temporada|season)\b/i)
    || text.match(/\b(?:temporada|season)\s*0*(\d{1,2})\b/i)
    || text.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const episodeMatch = text.match(/\bS(?:eason)?\s*0*\d{1,2}[ ._-]*E(?:P(?:ISODE)?)?0*(\d{1,3})\b/i)
    || text.match(/\b\d{1,2}x(\d{1,3})\b/i);

  return {
    season: toPositiveInteger(parsed.season ?? parsed.seasons?.[0])
      || (seasonMatch ? toPositiveInteger(seasonMatch[1]) : undefined),
    episode: toPositiveInteger(parsed.episode ?? parsed.episodes?.[0])
      || (seasonMatch?.[2] ? toPositiveInteger(seasonMatch[2]) : undefined)
      || (episodeMatch ? toPositiveInteger(episodeMatch[1]) : undefined),
  };
}

function findResolvedTitle(rows, { imdbId, season, isSeries }) {
  const candidates = (Array.isArray(rows) ? rows : []).filter(row => {
    if (isSeries && row.type === 'movie') return false;
    const rowImdbId = normalizeImdbId(row.imdbId);
    if (imdbId && rowImdbId && rowImdbId !== imdbId) return false;
    if (season !== undefined && Number.isInteger(row.imdbSeason) && row.imdbSeason !== season) return false;
    return true;
  });

  candidates.sort((left, right) => {
    const leftIdMatch = imdbId && normalizeImdbId(left.imdbId) === imdbId ? 1 : 0;
    const rightIdMatch = imdbId && normalizeImdbId(right.imdbId) === imdbId ? 1 : 0;
    const leftSeasonMatch = season !== undefined && left.imdbSeason === season ? 1 : 0;
    const rightSeasonMatch = season !== undefined && right.imdbSeason === season ? 1 : 0;
    return (rightIdMatch + rightSeasonMatch) - (leftIdMatch + leftSeasonMatch);
  });

  for (const row of candidates) {
    for (const value of [row.canonicalTitle, row.torrentTitle, row.fileTitle]) {
      const title = extractTitle(value);
      if (title) return title;
    }
  }
  return '';
}

function extractTitle(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  let parsedTitle = '';
  try {
    parsedTitle = String(titleParser.parse(normalized).title || '').trim();
  } catch {
    // Keep the fallback parser below for unusual but valid localized titles.
  }

  const title = (parsedTitle || normalized)
    .replace(/\bS\d{1,2}(?:E\d{1,3}(?:[-E]\d{1,3})*)?\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}(?:-\d{1,3})?\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(?:ª|º|a)?\s*(?:temporada|season)\b/gi, ' ')
    .replace(/\b(?:temporada|season)\s*\d{1,2}\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[\p{L}]{2}/u.test(title) || /^(?:season|temporada|complete|pack)$/i.test(title)) {
    return '';
  }
  return title;
}

function stripSeasonSuffix(value) {
  return String(value || '')
    .replace(/\s+S\d{1,2}(?:E\d{1,3}(?:[-E]\d{1,3})*)?\b.*$/i, '')
    .replace(/\s+\d{1,2}\s*(?:ª|º|a)?\s*(?:temporada|season)\b.*$/i, '')
    .replace(/\s+(?:temporada|season)\s*\d{1,2}\b.*$/i, '')
    .trim();
}

function toPositiveInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
