import * as cheerio from 'cheerio';
import magnetUri from 'magnet-uri';
import titleParser from 'parse-torrent-title';
import {
  DEFAULT_BASE_URL,
  DEFAULT_PROVIDER_ID,
  DETOUR_SOURCE,
  getProviderConfig,
  validateProviderUrl,
} from './constants.js';

const MAX_MAGNET_CANDIDATES_PER_DETAIL = 200;
const MAX_MAGNET_URL_CHARS = 4096;
const MAX_TEXT_FIELD_CHARS = 512;
const MAX_LANGUAGES = 16;
const PROMOTIONAL_TITLE_WORDS = new Set([
  'baixar', 'download', 'downloads', 'filme', 'filmes', 'movie', 'movies',
  'serie', 'series', 'exclusivo', 'exclusivos', 'gratis', 'gratuito',
  'torrent', 'torrents', 'url', 'link',
]);

const FIELD_LABELS = new Map([
  ['titulo-original', 'originalTitle'],
  ['nome-original', 'originalTitle'],
  ['titulo', 'originalTitle'],
  ['titulo-traduzido', 'translatedTitle'],
  ['nome-traduzido', 'translatedTitle'],
  ['titilo-original', 'originalTitle'],
  ['lancamento', 'year'],
  ['ano-de-lancamento', 'year'],
  ['estreia-em', 'year'],
  ['ano', 'year'],
  ['qualidade', 'quality'],
  ['qualidade-de-video', 'quality'],
  ['qualidade-do-audio', 'audioQuality'],
  ['resolucao-qualidade', 'quality'],
  ['idioma', 'languages'],
  ['idiomas', 'languages'],
  ['audio', 'languages'],
  ['idioma-audio', 'languages'],
  ['tamanho', 'size'],
  ['tamanho-do-arquivo', 'size'],
  ['genero', 'genre'],
  ['generos', 'genre'],
  ['imdb', 'imdb'],
  ['formato', 'format'],
  ['formato-do-arquivo', 'format'],
]);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'o', 'os', 'the',
  'em', 'um', 'uma', 'para', 'com', 'no', 'na', 'nos', 'nas', 'por', 'of', 'in', 'to', 'for',
]);

export function extractProviderListing(html, providerId = DEFAULT_PROVIDER_ID, baseUrl) {
  const provider = getProviderConfig(providerId);
  const rootUrl = baseUrl || provider.baseUrl;
  const $ = cheerio.load(html || '');
  let nodes = [];
  for (const selector of provider.listingSelectors) {
    nodes = $(selector).toArray();
    if (nodes.length) break;
  }

  const entries = [];
  const seenUrls = new Set();
  for (const node of nodes) {
    const anchor = $(node);
    const title = normalizeSpace(
      anchor.attr('title')
      || anchor.text()
      || anchor.attr('aria-label')
      || anchor.find('img[alt]').first().attr('alt')
      || '',
    );
    const href = String(anchor.attr('href') || '').trim();
    if (!title || !href) continue;
    let url;
    try {
      url = validateProviderUrl(new URL(href, rootUrl).toString(), providerId).toString();
    } catch {
      continue;
    }
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    entries.push({ title, url });
  }

  const bodyText = normalizeSpace($('body').text()).toLowerCase();
  const hasEmptyMarker = Boolean(
    $('div.empty-state').length
    || /nenhum conte[uú]do encontrado|nenhum resultado|n[aã]o encontramos|no results|sem resultados/i.test(bodyText)
  );
  const recognizable = Boolean(
    provider.listingMarkers.some(selector => $(selector).length)
    || hasEmptyMarker,
  );
  return { entries, recognizable, empty: entries.length === 0 && hasEmptyMarker };
}

export function scoreTitleMatch(query, title) {
  const queryTokens = titleTokens(query);
  const titleTokenSet = new Set(titleTokens(title));
  if (!queryTokens.length) return 0;
  const matched = queryTokens.filter(token => titleTokenSet.has(token)).length;
  return matched / queryTokens.length;
}

export function isRelevantTitleMatch(query, title, threshold = 0.65) {
  const qTokens = titleTokens(query);
  if (!qTokens.length) return false;
  const tTokens = titleTokens(title);
  const tTokenSet = new Set(tTokens);

  // If query contains 2 or more distinct tokens, ensure key informative tokens match
  // e.g. "Avatar Os Sete Refúgios" -> "sete" and "refugios" must match to avoid "Avatar: A Lenda de Aang"
  const distinctInformativeTokens = qTokens.filter(t => t.length >= 4);
  if (distinctInformativeTokens.length >= 2) {
    const informativeMatches = distinctInformativeTokens.filter(t => tTokenSet.has(t)).length;
    if (informativeMatches < Math.ceil(distinctInformativeTokens.length * 0.7)) {
      return false;
    }
  }

  return scoreTitleMatch(query, title) >= threshold;
}

export function parseProviderDetailHtml(html, options = {}) {
  const providerId = options.providerId || DEFAULT_PROVIDER_ID;
  const provider = getProviderConfig(providerId);
  const providerUrl = options.providerUrl;
  const listingTitle = options.listingTitle || '';
  const $ = cheerio.load(html || '');

  const rawTitle = firstText($, provider.titleSelectors) || normalizeSpace(listingTitle);
  const fields = extractInfoFields($, provider.infoSelectors);
  const jsonLd = extractJsonLd($);
  const titleData = parseTorrentTitle(rawTitle || listingTitle);

  const seriesEvidence = isSeriesEvidence(rawTitle, listingTitle, fields, jsonLd, options.type);
  const type = seriesEvidence ? 'series' : (options.type === 'series' ? 'series' : 'movie');

  const imdbId = extractImdbId($, fields, jsonLd, provider.imdbSelectors);
  const year = parseYear(fields.year)
    || parseYear(titleData.year)
    || parseYear(jsonLd?.copyrightYear)
    || parseYear(jsonLd?.datePublished)
    || extractYearFromTitle(rawTitle)
    || extractYearFromTitle(listingTitle);

  const rawSizeString = String(fields.size || '').trim();
  const summarySizeIsAmbiguous = rawSizeString.includes('/') || (rawSizeString.match(/\b(?:GB|MB|TB|KB)\b/gi) || []).length > 1;
  const unambiguousSummarySize = (!summarySizeIsAmbiguous && rawSizeString) ? parseSizeToBytes(rawSizeString) : 0;

  const context = {
    providerId,
    providerName: provider.name,
    providerUrl,
    query: normalizeSpace(options.query || ''),
    listingTitle,
    rawTitle,
    type,
    fields,
    titleData,
    jsonLd,
    imdbId,
    year,
    summarySizeIsAmbiguous,
    unambiguousSummarySize,
  };

  const extracted = extractMagnetCandidatesWithContext($, providerId);
  const normalized = normalizeMagnetsWithContext(extracted.candidates, context);

  return {
    results: normalized.results,
    fields,
    magnetCandidates: extracted.candidates.length + extracted.invalidLength,
    invalidMagnets: normalized.invalidMagnets + extracted.invalidLength,
    duplicateMagnets: normalized.duplicateMagnets,
    truncatedMagnetCandidates: extracted.limitReached,
  };
}

function extractMagnetCandidatesWithContext($, providerId) {
  const candidates = [];
  const seenUrls = new Set();
  let invalidLength = 0;
  let limitReached = false;

  const addCandidate = (rawMagnet, optionText = '') => {
    const candidate = String(rawMagnet || '').trim();
    if (!candidate.toLowerCase().startsWith('magnet:?')) return;
    if (candidate.length > MAX_MAGNET_URL_CHARS) {
      invalidLength += 1;
      return;
    }
    if (seenUrls.has(candidate)) return;
    if (candidates.length >= MAX_MAGNET_CANDIDATES_PER_DETAIL) {
      limitReached = true;
      return;
    }
    seenUrls.add(candidate);
    candidates.push({ magnetUrl: candidate, optionText: normalizeSpace(optionText) });
  };

  // 1. Check download rows (used by HDRTorrent: .download-row)
  $('.download-row').each((_, node) => {
    const row = $(node);
    const optionName = row.find('.download-name').text().trim() || row.text().trim();
    row.find('a[href^="magnet:"]').each((_, a) => {
      addCandidate($(a).attr('href'), optionName);
    });
  });

  // 2. Check enclosing paragraphs / headings (used by Comando Torrents and general WP)
  $('article div[itemprop="text"] p, article div.entry-content p, .entry-content p').each((_, node) => {
    const p = $(node);
    const pText = p.text().trim();
    p.find('a[href^="magnet:"]').each((_, a) => {
      const anchorText = $(a).text().trim();
      const combinedContext = [pText, anchorText].filter(Boolean).join(' ');
      addCandidate($(a).attr('href'), combinedContext);
    });
  });

  // 3. Any remaining magnet links
  $('a[href^="magnet:"]').each((_, node) => {
    const a = $(node);
    const parent = a.parent();
    const contextText = [parent.text().trim(), a.text().trim(), a.attr('title')].filter(Boolean).join(' ');
    addCandidate(a.attr('href'), contextText);
  });

  return { candidates, invalidLength, limitReached };
}

function normalizeMagnetsWithContext(candidates, context) {
  const results = [];
  const seenHashes = new Set();
  let invalidMagnets = 0;
  let duplicateMagnets = 0;

  for (const { magnetUrl, optionText } of candidates) {
    const decoded = decodeValidatedMagnet(magnetUrl);
    if (!decoded) {
      invalidMagnets += 1;
      continue;
    }
    if (seenHashes.has(decoded.infoHash)) {
      duplicateMagnets += 1;
      continue;
    }
    seenHashes.add(decoded.infoHash);
    results.push(normalizeReleaseRow(decoded, magnetUrl, optionText, context));
  }

  return { results, invalidMagnets, duplicateMagnets };
}

function normalizeReleaseRow(decoded, magnetUrl, optionText, context) {
  const { fields, titleData, type } = context;

  // Resolve size:
  // Prioritize option-specific size if present in optionText
  let size = 0;
  const optionSize = extractSizeFromText(optionText);
  if (optionSize > 0) {
    size = optionSize;
  } else if (!context.summarySizeIsAmbiguous && context.unambiguousSummarySize > 0) {
    size = context.unambiguousSummarySize;
  } else {
    size = 0; // Missing or ambiguous size kept as 0 (unknown) without guessing
  }

  // Resolve season and episode
  const seasonEpisode = extractSeasonEpisodeFromEvidence(
    optionText,
    decoded.name,
    context.rawTitle,
    context.listingTitle,
  );

  const isSeasonPack = type === 'series'
    && seasonEpisode.season != null
    && (seasonEpisode.episode == null || /\b(?:completa|complete|pack)\b/i.test(optionText));

  // Resolve languages / audio
  const optionLanguages = extractLanguagesFromText(optionText) || [];
  const fieldLanguages = fields.languages || [];
  const titleLanguages = Array.isArray(titleData.languages) ? titleData.languages : [];
  const languages = uniqueStrings([
    ...optionLanguages,
    ...fieldLanguages,
    ...titleLanguages,
  ]);

  // Resolve quality / resolution
  const quality = extractQualityFromOption(optionText, decoded.name, fields.quality, titleData.resolution)
    || extractQualityFromTitle(context.rawTitle);

  // Construct canonical title
  const canonicalName = buildReleaseTitle(context, decoded, optionText, quality, seasonEpisode, isSeasonPack);

  return {
    _source: DETOUR_SOURCE,
    provider: context.providerName,
    providerUrl: context.providerUrl,
    torrentTitle: canonicalName,
    fileTitle: canonicalName,
    infoHash: decoded.infoHash,
    magnetUrl,
    trackers: (Array.isArray(decoded.announce) ? decoded.announce.join(',') : String(decoded.announce || ''))
      .slice(0, MAX_MAGNET_URL_CHARS),
    fileSize: size,
    torrentSize: size,
    seeders: 0,
    type,
    imdbId: context.imdbId,
    year: context.year,
    resolution: quality,
    quality,
    languages: languages.slice(0, MAX_LANGUAGES),
    language: languages.join(', '),
    imdbSeason: type === 'series' ? seasonEpisode.season : undefined,
    imdbEpisode: type === 'series' && !isSeasonPack && !hasMultipleExplicitEpisodes(decoded.name)
      ? seasonEpisode.episode
      : undefined,
    isSeasonPack,
    fileIndex: 0,
  };
}

function buildReleaseTitle(context, decoded, optionText, quality, seasonEpisode, isSeasonPack) {
  const baseName = chooseReleaseBaseTitle(context, decoded);
  const cleanBase = baseName
    .replace(/\s*[-·]\s*(?:Torrent|Download|Baixar|Dublado|Dual Áudio|Legendado).*$/i, '')
    .replace(/\s*\(\d{4}\).*$/, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasExplicitEpisode = /\bS\d{1,2}E\d{1,3}(?:(?:-E?|E)\d{1,3})*/i.test(cleanBase)
    || /\b\d{1,2}x\d{1,2}(?:-\d{1,3})?\b/i.test(cleanBase);
  const hasSeasonMarker = /\bS(?:eason)?\s*0?\d{1,2}\b/i.test(cleanBase)
    || /\b\d{1,2}\s*(?:ª|º|a)?\s*(?:temporada|season)\b/i.test(cleanBase);
  const completeEvidence = /\b(?:completa|completo|complete|full[ ._-]?season|season[ ._-]?pack)\b/i
    .test(`${cleanBase} ${optionText}`);

  const parts = [cleanBase];

  if (context.type === 'series' && seasonEpisode.season != null && isSeasonPack) {
    const s = String(seasonEpisode.season).padStart(2, '0');
    if (!hasSeasonMarker) parts.push(`S${s}`);
    if (completeEvidence && !/\b(?:complete|completa|completo)\b/i.test(cleanBase)) {
      parts.push('COMPLETE');
    }
  } else if (context.type === 'series' && seasonEpisode.season != null && !hasExplicitEpisode) {
    const s = String(seasonEpisode.season).padStart(2, '0');
    if (seasonEpisode.episode != null) {
      const e = String(seasonEpisode.episode).padStart(2, '0');
      parts.push(`S${s}E${e}`);
    } else if (!hasSeasonMarker) {
      parts.push(`S${s}`);
    }
  }

  if (context.year && !cleanBase.includes(String(context.year))) {
    parts.push(`(${context.year})`);
  }

  if (quality && !parts.join(' ').toLowerCase().includes(quality.toLowerCase())) {
    parts.push(quality);
  }

  const audioMarkers = [];
  if (/\b(?:dual|dual[ ._-]?audio|dublado)\b/i.test(`${optionText} ${decoded.name} ${context.rawTitle}`)) {
    audioMarkers.push('DUAL');
  } else if (/\blegendado\b/i.test(`${optionText} ${decoded.name} ${context.rawTitle}`)) {
    audioMarkers.push('LEGENDADO');
  }
  if (audioMarkers.length && !parts.join(' ').toLowerCase().includes(audioMarkers.join(' ').toLowerCase())) {
    parts.push(audioMarkers.join(' '));
  }

  return parts.join(' ').trim().slice(0, MAX_TEXT_FIELD_CHARS);
}

function chooseReleaseBaseTitle(context, decoded) {
  const candidates = [
    decoded.name,
    context.fields.originalTitle,
    context.rawTitle,
    context.listingTitle,
  ].map(normalizeSpace).filter(Boolean);
  const magnetTitle = candidates[0];
  if (magnetTitle && !isPromotionalTitle(magnetTitle)) return magnetTitle;

  const pageCandidates = candidates.slice(1);
  const query = context.query;
  const matching = pageCandidates.find((candidate) => (
    !isPromotionalTitle(candidate)
    && (!query || isRelevantTitleMatch(query, candidate, 0.5))
  ));
  if (matching) return matching;
  return pageCandidates.find((candidate) => !isPromotionalTitle(candidate)) || magnetTitle || '';
}

function isPromotionalTitle(value) {
  if (/^baixarapido(?:\.com)?(?:\s|[-_]|$)/i.test(normalizeSpace(value))) {
    return true;
  }
  const tokens = titleTokens(value);
  return tokens.length > 0 && tokens.every((token) => PROMOTIONAL_TITLE_WORDS.has(token));
}

function hasMultipleExplicitEpisodes(value) {
  const normalized = normalizeSpace(value).replace(/[._]+/g, ' ');
  return /\bS\d{1,2}E\d{1,3}(?:(?:-E?|E)\d{1,3})+/i.test(normalized)
    || /\b\d{1,2}x\d{1,3}-\d{1,3}\b/i.test(normalized);
}

function isSeriesEvidence(rawTitle, listingTitle, fields, jsonLd, requestedType) {
  if (requestedType === 'series') return true;
  const combined = `${rawTitle} ${listingTitle} ${fields.originalTitle || ''}`.toLowerCase();
  if (/\b(?:temporada|season|epis[oó]dio|episode|s\d{1,2}|s\d{1,2}e\d{1,2})\b/i.test(combined)) {
    return true;
  }
  const ldType = jsonLd?.['@type'];
  if (ldType === 'TVSeries' || (Array.isArray(ldType) && ldType.includes('TVSeries'))) {
    return true;
  }
  return false;
}

function extractInfoFields($, selectors) {
  const fields = { languages: [] };
  const selector = selectors.join(', ');
  let currentField;

  $(selector).each((_, node) => {
    const html = String($(node).html() || '').replace(/<br\s*\/?>/gi, '\n');
    const fragment = cheerio.load(html, null, false);
    const lines = fragment.root().text().split(/\n+/).map(normalizeSpace).filter(Boolean);
    for (const line of lines) {
      const colonAt = line.indexOf(':');
      if (colonAt > 0) {
        const key = fieldKey(line.slice(0, colonAt));
        if (key) {
          currentField = key;
          addFieldValue(fields, key, line.slice(colonAt + 1));
          continue;
        }
      }
      const label = fieldKey(line.replace(/:$/, ''));
      if (label) {
        currentField = label;
        continue;
      }
      if (currentField) addFieldValue(fields, currentField, line);
    }
  });

  return fields;
}

function addFieldValue(fields, field, value) {
  const clean = normalizeSpace(value).replace(/^[:-]+/, '').trim();
  if (!clean) return;
  if (field === 'languages' || field === 'genre') {
    const values = clean.split(/[,|/]/).map(normalizeSpace).filter(Boolean);
    if (field === 'languages') fields.languages.push(...values);
    else fields.genre = uniqueStrings([...(fields.genre || []), ...values]);
    return;
  }
  if (field === 'year') {
    const year = parseYear(clean);
    if (year) fields.year = year;
    return;
  }
  if (field === 'imdb') {
    fields.imdb = clean;
    return;
  }
  fields[field] = clean;
}

function fieldKey(value) {
  const key = normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return FIELD_LABELS.get(key);
}

function extractImdbId($, fields, jsonLd, selectors = []) {
  const structuredValues = Array.isArray(jsonLd?.sameAs) ? jsonLd.sameAs : [jsonLd?.sameAs];
  for (const value of [fields.imdb, ...structuredValues]) {
    const id = normalizeImdbReference(value);
    if (id) return id;
  }
  for (const selector of selectors) {
    let found;
    $(selector).each((_, node) => {
      found ||= normalizeImdbReference($(node).attr('href'));
    });
    if (found) return found;
  }
  return undefined;
}

function normalizeImdbReference(value) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const looksLikeUri = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[:/?#]|$))/i.test(text);
  if (looksLikeUri) {
    try {
      const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('/')
        ? text
        : `https://${text}`;
      const url = new URL(candidate, 'https://invalid-reference.local');
      const host = url.hostname.toLowerCase();
      if (!['http:', 'https:'].includes(url.protocol)
        || (host !== 'imdb.com' && !host.endsWith('.imdb.com'))) return undefined;
    } catch {
      return undefined;
    }
  }
  const match = text.match(/\btt\d{7,}\b/i);
  return match ? match[0].toLowerCase() : undefined;
}

function extractJsonLd($) {
  for (const node of $('script[type="application/ld+json"]').toArray()) {
    const raw = String($(node).text() || '').trim();
    if (!raw || raw.length > 128 * 1024) continue;
    try {
      const parsed = JSON.parse(raw);
      const found = findMovieOrSeries(parsed);
      if (found) return found;
    } catch {
      // Ignore malformed structured data
    }
  }
  return undefined;
}

function findMovieOrSeries(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMovieOrSeries(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some(type => ['Movie', 'TVSeries'].includes(type))) return value;
  return findMovieOrSeries(value['@graph']);
}

function extractSeasonEpisodeFromEvidence(...titles) {
  let season;
  let episode;
  for (const title of titles) {
    const parsed = extractSeasonEpisode(title);
    if (season == null && parsed.season != null) {
      season = parsed.season;
    }
    if (episode == null && parsed.episode != null) {
      episode = parsed.episode;
    }
    if (season != null && episode != null) {
      break;
    }
  }
  return { season, episode };
}

function extractSeasonEpisode(title) {
  const text = String(title || '');
  let match = text.match(/\bS(?:EASON)?\s*0?(\d{1,2})(?:[ ._-]*E(?:P(?:ISODE)?)?0?(\d{1,3}))?\b/i);
  if (match) return { season: Number(match[1]), episode: match[2] ? Number(match[2]) : undefined };

  match = text.match(/\b(\d{1,2})\s*(?:ª|a|º|o)?\s*(?:temporada|season)\b/i)
    || text.match(/\b(?:temporada|season)\s*(\d{1,2})\b/i);
  if (match) {
    const season = Number(match[1]);
    const afterSeason = text.slice(match.index + match[0].length);
    const episode = afterSeason.match(/\b0?(\d{1,3})\s*(?:º|o|ª|a)?\s*(?:epis[oó]dio|episode|ep\.?)\b/i)
      || afterSeason.match(/\b(?:epis[oó]dio|episode|ep\.?)\s*0?(\d{1,3})\b/i);
    return { season, episode: episode ? Number(episode[1]) : undefined };
  }

  match = text.match(/\b0?(\d{1,3})\s*(?:º|o|ª|a)?\s*(?:epis[oó]dio|episode|ep\.?)\b/i);
  if (match) {
    return { season: undefined, episode: Number(match[1]) };
  }

  match = text.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };

  return { season: undefined, episode: undefined };
}

function extractSizeFromText(text) {
  const match = String(text || '').match(/([0-9]+(?:\.[0-9]+)?)\s*(GB|MB|TB|KB)\b/i);
  return match ? parseSizeToBytes(match[0]) : 0;
}

function extractLanguagesFromText(text) {
  const languages = [];
  if (/\b(?:dual|dual[ ._-]?audio)\b/i.test(text)) {
    languages.push('Português', 'Inglês');
  } else if (/\bdublado\b/i.test(text)) {
    languages.push('Português');
  } else if (/\blegendado\b/i.test(text)) {
    languages.push('Inglês');
  }
  return languages.length ? languages : undefined;
}

function extractQualityFromOption(optionText, dn, fieldQuality, titleResolution) {
  const dnMatch = String(dn || '').match(/\b(?:2160|1440|1080|720|576|480|360)p\b|\b4k\b/i);
  if (dnMatch) return normalizeQuality(dnMatch[0]);

  const text = `${optionText || ''}`.trim();
  const match = text.match(/\b(?:2160|1440|1080|720|576|480|360)p\b|\b4k\b|full\s*hd|web[- ]?dl|web ?rip|blu[- ]?ray|brrip|hdrip|hdtv|dvdrip/i);
  if (match) return normalizeQuality(match[0]);
  if (fieldQuality) return normalizeQuality(fieldQuality);
  if (titleResolution) return normalizeQuality(titleResolution);
  return undefined;
}

function normalizeQuality(value) {
  const text = normalizeSpace(value);
  if (!text) return undefined;
  const normalized = text
    .replace(/\bFull\s*HD\b/gi, '1080p')
    .replace(/\b4K\b/gi, '2160p')
    .replace(/\bWEB\b(?!-DL)/gi, 'WEB-DL')
    .replace(/\bSD\b/gi, '480p');
  const resolution = normalized.match(/\b(?:2160|1440|1080|720|576|480|360)p\b/i);
  return resolution ? normalized.replace(resolution[0], resolution[0].toLowerCase()) : normalized;
}

function extractQualityFromTitle(value) {
  const text = normalizeSpace(value);
  const match = text.match(/\b(?:2160|1440|1080|720|576|480|360)p\b|\b4k\b|full\s*hd|web[- ]?dl|web ?rip|blu[- ]?ray|brrip|hdrip|hdtv|dvdrip|cam\b/i);
  return match ? normalizeQuality(match[0]) : undefined;
}

function decodeValidatedMagnet(magnetUrl) {
  try {
    const decoded = magnetUri.decode(magnetUrl);
    const rawHash = String(decoded.infoHash || '').toLowerCase();
    if (!rawHash) return undefined;

    // Support 40-character hex or 32-character base32
    if (/^[a-f0-9]{40}$/.test(rawHash)) {
      return { ...decoded, infoHash: rawHash };
    }

    if (/^[a-z2-7]{32}$/.test(rawHash)) {
      // Decode base32 to 40-char hex
      const hex = base32ToHex(rawHash);
      if (hex && /^[a-f0-9]{40}$/.test(hex)) {
        return { ...decoded, infoHash: hex };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function base32ToHex(base32) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = '';
  for (const char of base32.toLowerCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) return undefined;
    bits += val.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.substr(i, 4), 2).toString(16);
  }
  return hex.slice(0, 40);
}

function parseTorrentTitle(title) {
  try { return titleParser.parse(title || '') || {}; } catch { return {}; }
}

export function parseSizeToBytes(value) {
  const normalized = String(value || '').trim().replace(',', '.');
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB)\b/i);
  if (!match) return 0;
  const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.round(Number(match[1]) * multipliers[match[2].toUpperCase()]);
}

function parseYear(value) {
  const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= 1888 && year <= new Date().getUTCFullYear() + 1 ? year : undefined;
}

function extractYearFromTitle(title) {
  const match = String(title || '').match(/\b(19\d{2}|20\d{2})\b/);
  return match ? parseYear(match[1]) : undefined;
}

function titleTokens(value) {
  return normalizeText(value).split(/\s+/).filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_FIELD_CHARS);
}

function firstText($, selectors) {
  for (const selector of selectors) {
    const value = normalizeSpace($(selector).first().text());
    if (value) return value;
  }
  return '';
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => normalizeSpace(value)).filter(Boolean))];
}

export function isBlockedResponse(statusCode, body) {
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) return true;
  const $ = cheerio.load(String(body || ''));
  const title = normalizeText($('title').first().text());
  const text = normalizeText($('body').text()).slice(0, 12000);
  return title.includes('just a moment')
    || text.includes('verify you are human')
    || text.includes('checking your browser')
    || text.includes('cf chl')
    || text.includes('challenge platform');
}
