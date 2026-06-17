import axios from 'axios';
import magnet from 'magnet-uri';
import titleParser from 'parse-torrent-title';
import * as cheerio from 'cheerio';
import { SOURCE_BETOR } from './source.js';

const BETOR_BASE_URL = (process.env.TORZNAB_BETOR_URL || 'https://catalogo.betor.top').replace(/\/$/, '');
const BETOR_TIMEOUT = parseInt(process.env.TORZNAB_BETOR_TIMEOUT_MS || '20000', 10);
const RELEASE_CACHE_TTL_MS = parseInt(process.env.TORZNAB_RELEASE_CACHE_TTL_MS || `${60 * 60 * 1000}`, 10);
const BETOR_HEADERS = {
  'User-Agent': process.env.TORZNAB_BETOR_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const releaseCache = new Map();

export function isTemporaryBetorError(error) {
  return Boolean(error?.temporary && error?.source === SOURCE_BETOR);
}

export async function checkBetorHealth() {
  await fetchHtml('/');
}

export async function searchBetorReleaseRows(options = {}) {
  const {
    type,
    types = [],
    imdbId,
    query,
    season,
    episode,
    limit = 100,
  } = options;

  const searchPlan = buildSearchPlan({ type, types, imdbId, query, season });
  const rows = [];

  for (const path of searchPlan) {
    const html = await fetchHtml(path);
    rows.push(...parseReleaseRows(html, { query, season, episode }));
    if (rows.length >= limit * 3) {
      break;
    }
  }

  const filteredRows = applyEpisodeFilter(rows, season, episode).slice(0, limit);
  return cacheRows(filteredRows);
}

export async function getBetorReleaseRowByGuid(guid) {
  const parts = decodeURIComponent(`${guid || ''}`).split(':');
  const infoHash = parts.length >= 3 ? parts[1] : parts[0];
  const fileIndex = parseInt(parts.length >= 3 ? parts[2] : parts[1] || '0', 10) || 0;
  pruneCache();
  return releaseCache.get(cacheKey(infoHash.toLowerCase(), fileIndex))?.row;
}

async function fetchHtml(path) {
  const url = `${BETOR_BASE_URL}${path}`;

  try {
    const response = await axios.get(url, {
      timeout: BETOR_TIMEOUT,
      responseType: 'text',
      headers: BETOR_HEADERS,
    });
    return response.data || '';
  } catch (error) {
    const statusCode = error?.response?.status;
    if ((statusCode >= 500 && statusCode < 600) || statusCode === 429) {
      throw createTemporaryBetorError(statusCode);
    }
    if (!error?.response) {
      throw createTemporaryBetorError(undefined, error?.code || 'network');
    }
    throw error;
  }
}

function buildSearchPlan({ type, types, imdbId, query, season }) {
  const encodedQuery = encodeURIComponent(`${query || ''}`.trim());
  const wantsSeries = types.includes('series') || types.includes('anime') || Number.isInteger(season);
  const paths = [];

  if (wantsSeries && imdbId && Number.isInteger(season)) {
    paths.push(`/imdb/${encodeURIComponent(imdbId)}/season/${season}/`);
  }
  if (imdbId) {
    paths.push(`/imdb/${encodeURIComponent(imdbId)}/`);
  }
  if (encodedQuery) {
    paths.push(`/search/?q=${encodedQuery}`);
  }
  if (type === 'movie' && !paths.length) {
    paths.push('/filmes/');
  }

  return Array.from(new Set(paths));
}

function parseReleaseRows(html, context = {}) {
  const $ = cheerio.load(html);
  const rows = [];

  $('[data-torrent]').each((_, element) => {
    const node = $(element);
    const magnetUrl = node.attr('data-torrent-magnet-uri') || '';
    const infoHash = extractInfoHash(magnetUrl);
    if (!infoHash) {
      return;
    }

    const torrentTitle = node.attr('data-torrent-name') || '';
    const files = `${node.attr('data-torrent-files') || ''}`
        .split(';')
        .map(file => file.trim())
        .filter(Boolean);
    const fileTitle = files[0] || torrentTitle;
    const parsed = titleParser.parse(fileTitle || torrentTitle);
    const itemType = node.attr('data-item-type') === 'movie' ? 'movie' : 'series';
    const providerName = node.closest('.provider').find('.header .name').first().text().trim() || 'BeTor';
    const imdbSeason = parseInt(`${context.season ?? parsed.season ?? ''}`, 10);
    const imdbEpisode = inferEpisode(parsed, torrentTitle, fileTitle);

    rows.push({
      _source: SOURCE_BETOR,
      infoHash,
      provider: providerName,
      torrentId: infoHash,
      torrentTitle,
      torrentSize: parseInt(node.attr('data-torrent-size') || '0', 10) || 0,
      type: itemType,
      uploadDate: node.attr('data-torrent-inserted-at') || new Date().toISOString(),
      seeders: parseInt(node.attr('data-torrent-num-seeds') || '0', 10) || 0,
      trackers: extractTrackers(magnetUrl).join(','),
      languages: JSON.stringify(parseLanguages(node.attr('data-torrent-languages') || '')),
      resolution: parsed.resolution,
      fileId: infoHash,
      fileIndex: 0,
      fileTitle,
      fileSize: parseInt(node.attr('data-torrent-size') || '0', 10) || 0,
      imdbId: node.attr('data-item-imdb-id') || undefined,
      imdbSeason: Number.isInteger(imdbSeason) ? imdbSeason : undefined,
      imdbEpisode,
      canonicalTitle: node.closest('.item').find('.details > .title').first().text().trim() || context.query || undefined,
      magnetUrl,
    });
  });

  return rows;
}

function applyEpisodeFilter(rows, season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) {
    return rows;
  }

  const exact = rows.filter(row => row.imdbSeason === season && row.imdbEpisode === episode);
  if (exact.length) {
    return exact;
  }

  return rows.filter(row => row.imdbSeason === season);
}

function inferEpisode(parsed, torrentTitle, fileTitle) {
  if (Number.isInteger(parsed.episode)) {
    return parsed.episode;
  }

  const blob = `${torrentTitle} ${fileTitle}`;
  const match = blob.match(/\bS\d{1,2}E(\d{1,3})\b/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function parseLanguages(rawLanguages) {
  const mapping = {
    en: 'english',
    'pt-br': 'brazilian',
    pt: 'portuguese',
  };

  return `${rawLanguages || ''}`
      .split(',')
      .map(language => language.trim().toLowerCase())
      .filter(Boolean)
      .map(language => mapping[language] || language);
}

function extractInfoHash(magnetUrl) {
  try {
    const parsed = magnet.decode(magnetUrl);
    return `${parsed.infoHash || ''}`.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function extractTrackers(magnetUrl) {
  try {
    const parsed = magnet.decode(magnetUrl);
    return parsed.announce || [];
  } catch {
    return [];
  }
}

function cacheRows(rows) {
  pruneCache();
  const expiresAt = Date.now() + RELEASE_CACHE_TTL_MS;
  rows.forEach(row => {
    releaseCache.set(cacheKey(row.infoHash, row.fileIndex || 0), { row, expiresAt });
  });
  return rows;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, value] of releaseCache.entries()) {
    if (value.expiresAt <= now) {
      releaseCache.delete(key);
    }
  }
}

function cacheKey(infoHash, fileIndex) {
  return `${infoHash}:${fileIndex}`;
}

function createTemporaryBetorError(statusCode, code) {
  const suffix = statusCode ? ` (${statusCode})` : '';
  const error = new Error(`BeTor temporariamente indisponível${suffix}.`);
  error.name = 'TemporaryIndexerUnavailableError';
  error.source = SOURCE_BETOR;
  error.temporary = true;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
