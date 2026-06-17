import { Pool } from 'pg';
import { Type } from '../lib/types.js';
import { isDatabaseSource } from './source.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const DATABASE_URI = process.env.DATABASE_URI;

if (isDatabaseSource() && !DATABASE_URI) {
  throw new Error('DATABASE_URI is required for Torznab Bridge when the database indexer is enabled');
}

const pool = DATABASE_URI ? new Pool({
  connectionString: DATABASE_URI,
  max: parseInt(process.env.TORZNAB_DB_POOL_MAX || '10', 10),
}) : undefined;

export function closePool() {
  return pool ? pool.end() : Promise.resolve();
}

export async function checkDatabaseHealth() {
  if (!pool) {
    throw new Error('Database source is not configured');
  }
  await pool.query('SELECT 1');
}

export async function searchReleaseRows(options = {}) {
  const {
    type,
    types = [],
    imdbId,
    query,
    season,
    episode,
    categories = [],
    providers = [],
    limit = DEFAULT_LIMIT,
  } = options;

  const sqlLimit = Math.min(Math.max(parseInt(limit || DEFAULT_LIMIT, 10), 1), MAX_LIMIT);
  const values = [];
  const where = [];

  if (Array.isArray(types) && types.length) {
    const placeholders = types.map(nextType => {
      values.push(nextType);
      return `$${values.length}`;
    });
    where.push(`t.type IN (${placeholders.join(', ')})`);
  } else if (type) {
    values.push(type);
    where.push(`t.type = $${values.length}`);
  } else {
    const inferredTypes = inferTypesFromCategories(categories);
    if (inferredTypes.length) {
      const placeholders = inferredTypes.map(nextType => {
        values.push(nextType);
        return `$${values.length}`;
      });
      where.push(`t.type IN (${placeholders.join(', ')})`);
    }
  }

  if (providers.length) {
    values.push(providers);
    where.push(`LOWER(t.provider) = ANY($${values.length})`);
  }

  if (imdbId) {
    values.push(imdbId);
    where.push(`f."imdbId" = $${values.length}`);
  }

  if (Number.isInteger(season)) {
    values.push(season);
    where.push(`f."imdbSeason" = $${values.length}`);
  }

  if (Number.isInteger(episode)) {
    values.push(episode);
    where.push(`f."imdbEpisode" = $${values.length}`);
  }

  if (query) {
    const searchTokens = query
        .trim()
        .split(/\s+/)
        .map(token => token.replace(/[^\p{L}\p{N}]+/gu, ''))
        .filter(Boolean);

    if (searchTokens.length) {
      const tokenClauses = searchTokens.map(token => {
        values.push(`%${token}%`);
        return `(t.title ILIKE $${values.length} OR f.title ILIKE $${values.length})`;
      });
      where.push(tokenClauses.join(' AND '));
    } else {
      values.push(`%${query.trim()}%`);
      where.push(`(t.title ILIKE $${values.length} OR f.title ILIKE $${values.length})`);
    }
  }

  const orderBy = [
    't.seeders DESC NULLS LAST',
    't."uploadDate" DESC',
    't."infoHash"',
    'f."fileIndex" NULLS FIRST',
  ];

  values.push(sqlLimit);
  const sql = `
    SELECT
      t."infoHash",
      t.provider,
      t."torrentId",
      t.title AS "torrentTitle",
      t.size AS "torrentSize",
      t.type,
      t."uploadDate",
      t.seeders,
      t.trackers,
      t.languages,
      t.resolution,
      f.id AS "fileId",
      f."fileIndex",
      f.title AS "fileTitle",
      f.size AS "fileSize",
      f."imdbId",
      f."imdbSeason",
      f."imdbEpisode",
      f."kitsuId",
      f."kitsuEpisode"
    FROM torrents t
    JOIN files f ON f."infoHash" = t."infoHash"
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderBy.join(', ')}
    LIMIT $${values.length}
  `;

  const result = await pool.query(sql, values);
  return result.rows;
}

export async function getReleaseRowByGuid(infoHash, fileIndex) {
  const sql = `
    SELECT
      t."infoHash",
      t.provider,
      t."torrentId",
      t.title AS "torrentTitle",
      t.size AS "torrentSize",
      t.type,
      t."uploadDate",
      t.seeders,
      t.trackers,
      t.languages,
      t.resolution,
      f.id AS "fileId",
      f."fileIndex",
      f.title AS "fileTitle",
      f.size AS "fileSize",
      f."imdbId",
      f."imdbSeason",
      f."imdbEpisode",
      f."kitsuId",
      f."kitsuEpisode"
    FROM torrents t
    JOIN files f ON f."infoHash" = t."infoHash"
    WHERE LOWER(t."infoHash") = LOWER($1)
      AND COALESCE(f."fileIndex", 0) = $2
    LIMIT 1
  `;
  const result = await pool.query(sql, [infoHash, fileIndex]);
  return result.rows[0];
}

function inferTypesFromCategories(categories) {
  if (!categories.length) {
    return [];
  }
  const hasTv = categories.some(category => `${category}`.startsWith('5'));
  const hasMovie = categories.some(category => `${category}`.startsWith('2'));
  const types = [];
  if (hasMovie) {
    types.push(Type.MOVIE);
  }
  if (hasTv) {
    types.push(Type.SERIES, Type.ANIME);
  }
  return Array.from(new Set(types));
}
