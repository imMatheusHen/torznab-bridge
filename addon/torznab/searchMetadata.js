const MAX_SEARCH_TEXT_LENGTH = 120;

export function buildSearchDetails(action, query = {}) {
  const titleValue = normalizeSearchText(query?.q);
  const imdbId = normalizeImdbId(query?.imdbid) || normalizeImdbId(titleValue);
  const title = normalizeImdbId(titleValue) ? undefined : titleValue;
  const year = normalizeSearchYear(query?.year);
  const coordinates = extractSearchCoordinates(query, titleValue);
  return {
    action,
    ...(title ? { title } : {}),
    ...(imdbId ? { imdbId } : {}),
    ...(year ? { year } : {}),
    ...(coordinates.season ? { season: coordinates.season } : {}),
    ...(coordinates.episode ? { episode: coordinates.episode } : {}),
  };
}

export function buildSearchLabel(action, query) {
  const details = buildSearchDetails(action, query);
  const title = details.title || (details.imdbId ? 'consulta IMDb' : 'geral');
  const year = details.year && !details.title?.includes(String(details.year)) ? ' (' + details.year + ')' : '';
  const lookup = title + year;
  const coordinates = formatSearchCoordinates(details);
  const hasCoordinates = /\bS0*\d{1,2}(?:E0*\d{1,3})?|\b\d{1,2}x\d{1,3}\b/i.test(lookup);
  const subject = coordinates && !hasCoordinates ? lookup + ' ' + coordinates : lookup;
  if (action === 'tvsearch') return 'Busca de série: ' + subject;
  if (action === 'movie') return 'Busca de filme: ' + subject;
  return 'Busca geral: ' + subject;
}

function extractSearchCoordinates(query, title) {
  const text = String(title || '');
  const seasonMatch = text.match(/\bS(?:eason)?\s*0*(\d{1,2})(?:[ ._-]*E(?:P(?:ISODE)?)?0*(\d{1,3}))?\b/i)
    || text.match(/\b(\d{1,2})\s*(?:ª|º|a)?\s*(?:temporada|season)\b/i)
    || text.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const episodeMatch = text.match(/\bS(?:eason)?\s*0*\d{1,2}[ ._-]*E(?:P(?:ISODE)?)?0*(\d{1,3})\b/i)
    || text.match(/\b(\d{1,2})x(\d{1,3})\b/i)
    || text.match(/\b0*(\d{1,3})\s*(?:º|o|ª|a)?\s*(?:epis[oó]dio|episode|ep\.?)\b/i)
    || text.match(/\b(?:epis[oó]dio|episode|ep\.?)\s*0*(\d{1,3})\b/i);
  const seasonFromTitle = seasonMatch ? Number(seasonMatch[1]) : undefined;
  const episodeFromTitle = seasonMatch?.[2] ? Number(seasonMatch[2]) : (episodeMatch ? Number(episodeMatch[1]) : undefined);
  return {
    season: normalizePositiveInteger(query?.season) || seasonFromTitle,
    episode: normalizePositiveInteger(query?.ep ?? query?.episode) || episodeFromTitle,
  };
}

function normalizePositiveInteger(value) {
  const parsed = Number(normalizeSearchText(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatSearchCoordinates(details) {
  if (!details.season) return '';
  const season = String(details.season).padStart(2, '0');
  const episode = details.episode ? 'E' + String(details.episode).padStart(2, '0') : '';
  return 'S' + season + episode;
}

export function normalizeImdbId(value) {
  const id = normalizeSearchText(value);
  return id && /^tt\d{4,12}$/i.test(id) ? id.toLowerCase() : undefined;
}

export function normalizeSearchYear(value) {
  const year = Number(normalizeSearchText(value));
  const currentYear = new Date().getFullYear();
  return Number.isInteger(year) && year >= 1888 && year <= currentYear + 5 ? year : undefined;
}

function normalizeSearchText(value) {
  const text = Array.isArray(value) ? value[0] : value;
  const normalized = `${text || ''}`.trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_SEARCH_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_SEARCH_TEXT_LENGTH - 1)}…`
    : normalized;
}
