import magnet from 'magnet-uri';
import titleParser from 'parse-torrent-title';
import { Type } from '../lib/types.js';
import { getAdapterConfiguration as getRuntimeAdapterConfiguration } from './runtimeConfig.js';
import { SOURCE_DATABASE } from './source.js';

export const CATEGORY = {
  MOVIE: 2000,
  MOVIE_HD: 2040,
  MOVIE_UHD: 2045,
  MOVIE_WEBDL: 2080,
  MOVIE_X265: 2090,
  TV: 5000,
  TV_WEBDL: 5010,
  TV_HD: 5040,
  TV_UHD: 5045,
  TV_OTHER: 5050,
  TV_ANIME: 5070,
  TV_X265: 5090,
};

const DEFAULT_PROTOCOL = process.env.TORZNAB_PROTOCOL || 'http';
const DEFAULT_HOST = process.env.TORZNAB_HOST || 'localhost';
const DEFAULT_PORT = process.env.PORT || process.env.TORZNAB_PORT || '9699';
const DEFAULT_BASE_URL = process.env.TORZNAB_BASE_URL
    || `${DEFAULT_PROTOCOL}://${DEFAULT_HOST}:${DEFAULT_PORT}`;

export function getAdapterConfiguration() {
  return getRuntimeAdapterConfiguration();
}

export function normalizeQueryLimit(rawLimit) {
  const parsed = parseInt(rawLimit || '100', 10);
  return Number.isInteger(parsed) ? parsed : 100;
}

export function parseCategories(rawCategory) {
  if (!rawCategory) {
    return [];
  }
  return `${rawCategory}`
      .split(',')
      .map(part => parseInt(part.trim(), 10))
      .filter(Number.isInteger);
}

export function normalizeImdbId(rawImdbId) {
  if (!rawImdbId) {
    return undefined;
  }
  const imdbDigits = `${rawImdbId}`.replace(/^tt/i, '');
  return /^\d+$/.test(imdbDigits) ? `tt${imdbDigits}` : undefined;
}

export function normalizeEpisodeNumber(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }
  const parsed = parseInt(rawValue, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function toTorznabItem(row, requestBaseUrl = DEFAULT_BASE_URL) {
  const parsedTorrent = titleParser.parse(row.torrentTitle || '');
  const parsedFile = titleParser.parse(row.fileTitle || '');
  const infoHash = row.infoHash?.toLowerCase();
  const fileIndex = Number.isInteger(row.fileIndex) ? row.fileIndex : 0;
  const guid = buildReleaseGuid(row._source, infoHash, fileIndex);
  const title = buildReleaseTitle(row, parsedTorrent, parsedFile);
  const size = row.fileSize || row.torrentSize || 0;
  const categories = inferCategories(row, parsedTorrent, parsedFile);
  const magnetUrl = buildMagnetUrl(row);
  const link = `${requestBaseUrl.replace(/\/$/, '')}/download/${encodeURIComponent(guid)}`;

  return {
    guid,
    title,
    link,
    comments: `${requestBaseUrl.replace(/\/$/, '')}/details/${encodeURIComponent(guid)}`,
    pubDate: coercePubDate(row.uploadDate),
    size,
    category: categories,
    description: buildDescription(row, parsedTorrent, parsedFile),
    enclosureUrl: link,
    enclosureLength: size,
    enclosureType: 'application/x-bittorrent;x-scheme-handler/magnet',
    attrs: buildTorznabAttributes(row, categories, magnetUrl, parsedTorrent, parsedFile),
  };
}

export function buildReleaseGuid(source, infoHash, fileIndex = 0) {
  if (!source || source === SOURCE_DATABASE) {
    return `${infoHash}:${fileIndex}`;
  }
  return `${source}:${infoHash}:${fileIndex}`;
}

export function parseReleaseGuid(rawGuid) {
  const parts = decodeURIComponent(`${rawGuid || ''}`).split(':');
  if (parts.length >= 3) {
    return {
      source: parts[0],
      infoHash: parts[1],
      fileIndex: normalizeEpisodeNumber(parts[2]) || 0,
    };
  }

  return {
    source: SOURCE_DATABASE,
    infoHash: parts[0],
    fileIndex: normalizeEpisodeNumber(parts[1]) || 0,
  };
}

export function buildMagnetUrl(row) {
  if (row.magnetUrl && !row.isSeasonPack) {
    return row.magnetUrl;
  }
  return buildMagnetUrlFromParts(
      row.infoHash?.toLowerCase(),
      row.torrentTitle || row.fileTitle,
      row.trackers || '',
  );
}

export function buildMagnetUrlFromParts(infoHash, title, rawTrackers) {
  const trackers = `${rawTrackers || ''}`
      .split(',')
      .map(tracker => tracker.trim())
      .filter(Boolean);
  return magnet.encode({
    infoHash,
    name: title,
    announce: trackers,
  });
}

export function parseSizeToBytes(rawSize) {
  const normalized = `${rawSize || ''}`.trim().replace(',', '.');
  const match = normalized.match(/^([0-9.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) {
    return 0;
  }
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return Math.round(value * multipliers[unit]);
}

function buildReleaseTitle(row, parsedTorrent, parsedFile) {
  const parts = [];
  const fileName = row.fileTitle || row.torrentTitle || row.infoHash;
  const canonicalName = buildCanonicalReleaseName(row, parsedTorrent, parsedFile);
  parts.push(canonicalName || fileName);
  const quality = parsedFile.resolution || parsedTorrent.resolution || row.resolution;
  if (quality && !(canonicalName || fileName).includes(quality)) {
    parts.push(quality);
  }
  const source = parsedFile.source || parsedTorrent.source;
  if (source && !(canonicalName || fileName).toLowerCase().includes(`${source}`.toLowerCase())) {
    parts.push(source);
  }
  if (row.provider && !(canonicalName || fileName).includes(row.provider)) {
    parts.push(row.provider);
  }
  return parts.join(' - ');
}

function buildCanonicalReleaseName(row, parsedTorrent, parsedFile) {
  const canonicalTitle = `${row.canonicalTitle || ''}`.trim();
  if (!canonicalTitle) {
    return '';
  }

  const normalizedTitle = canonicalTitle.replace(/\s+/g, ' ').trim();
  const sourceName = row.fileTitle || row.torrentTitle || '';
  const dualMarker = /\b(dual|dual[ ._-]?audio|dublado|pt-br|portugu[eê]s)\b/i.test(sourceName) ? ' DUAL' : '';

  if (row.isSeasonPack && Number.isInteger(row.imdbSeason)) {
    return `${normalizedTitle} S${String(row.imdbSeason).padStart(2, '0')} COMPLETE${dualMarker}`.trim();
  }

  if (Number.isInteger(row.imdbSeason) && Number.isInteger(row.imdbEpisode)) {
    return `${normalizedTitle} S${String(row.imdbSeason).padStart(2, '0')}E${String(row.imdbEpisode).padStart(2, '0')}${dualMarker}`.trim();
  }

  const year = parsedFile.year || parsedTorrent.year;
  if (year && !normalizedTitle.includes(`${year}`)) {
    return `${normalizedTitle} (${year})${dualMarker}`.trim();
  }

  return `${normalizedTitle}${dualMarker}`.trim();
}

function buildDescription(row, parsedTorrent, parsedFile) {
  const languages = Array.from(new Set([
    ...(parsedFile.languages || []),
    ...(parsedTorrent.languages || []),
  ]));
  const lines = [
    row.torrentTitle,
    row.fileTitle !== row.torrentTitle ? row.fileTitle : undefined,
    `Provider: ${row.provider}`,
    row.seeders != null ? `Seeders: ${row.seeders}` : undefined,
    languages.length
      ? `Languages: ${languages.join(', ')}`
      : undefined,
  ];
  return lines.filter(Boolean).join('\n');
}

function coercePubDate(uploadDate) {
  const parsedDate = uploadDate ? new Date(uploadDate) : undefined;
  if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toUTCString();
  }
  return new Date(0).toUTCString();
}

function buildTorznabAttributes(row, categories, magnetUrl, parsedTorrent, parsedFile) {
  const attrs = [
    ['category', categories[0]],
    ['size', row.fileSize || row.torrentSize || 0],
    ['seeders', row.seeders || 0],
    ['peers', row.seeders || 0],
    ['grabs', 0],
    ['downloadvolumefactor', 0],
    ['uploadvolumefactor', 1],
    ['infohash', row.infoHash?.toLowerCase()],
    ['magneturl', magnetUrl],
    ['imdbid', row.imdbId],
    ['imdb', row.imdbId?.replace(/^tt/i, '')],
    ['season', row.imdbSeason],
    ['episode', row.isSeasonPack ? undefined : row.imdbEpisode],
    ['files', row.packFileCount || 1],
  ];

  const codec = parsedFile.codec || parsedTorrent.codec;
  const resolution = parsedFile.resolution || parsedTorrent.resolution || row.resolution;
  if (resolution) {
    attrs.push(['resolution', resolution]);
  }
  if (codec) {
    attrs.push(['codec', codec]);
  }
  return attrs.filter(([, value]) => value !== undefined && value !== null && value !== '');
}

function inferCategories(row, parsedTorrent, parsedFile) {
  const categories = [];
  const resolution = (parsedFile.resolution || parsedTorrent.resolution || row.resolution || '').toLowerCase();
  const source = (parsedFile.source || parsedTorrent.source || '').toLowerCase();
  const codec = (parsedFile.codec || parsedTorrent.codec || '').toLowerCase();

  if (row.type === Type.MOVIE) {
    categories.push(CATEGORY.MOVIE);
    if (source === 'web-dl' || source === 'webrip') {
      categories.push(CATEGORY.MOVIE_WEBDL);
    }
    if (resolution.includes('2160') || resolution.includes('4k')) {
      categories.push(CATEGORY.MOVIE_UHD);
    } else if (resolution.includes('720') || resolution.includes('1080')) {
      categories.push(CATEGORY.MOVIE_HD);
    }
    if (codec.includes('x265') || codec.includes('hevc') || codec.includes('h265')) {
      categories.push(CATEGORY.MOVIE_X265);
    }
  } else {
    categories.push(row.type === Type.ANIME ? CATEGORY.TV_ANIME : CATEGORY.TV);
    if (source === 'web-dl' || source === 'webrip') {
      categories.push(CATEGORY.TV_WEBDL);
    }
    if (resolution.includes('2160') || resolution.includes('4k')) {
      categories.push(CATEGORY.TV_UHD);
    } else if (resolution.includes('720') || resolution.includes('1080')) {
      categories.push(CATEGORY.TV_HD);
    } else {
      categories.push(CATEGORY.TV_OTHER);
    }
    if (codec.includes('x265') || codec.includes('hevc') || codec.includes('h265')) {
      categories.push(CATEGORY.TV_X265);
    }
  }

  return Array.from(new Set(categories));
}
