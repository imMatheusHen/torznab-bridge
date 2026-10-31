import { isEmbedTvPageUrl } from './client.js';

export function normalizeCatalogPayload(payload) {
  const rawCategories = Array.isArray(payload?.categories) ? payload.categories : [];
  const categories = rawCategories
      .map(category => normalizeCategory(category))
      .filter(Boolean);
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const rawChannels = Array.isArray(payload?.channels)
    ? payload.channels
    : Array.isArray(payload) ? payload : [];
  const channels = rawChannels
      .map(channel => normalizeChannel(channel, categoryById))
      .filter(Boolean);
  return { categories, channels };
}

export function normalizeCategory(category) {
  if (!category || typeof category !== 'object') {
    return undefined;
  }
  const id = Number.isInteger(Number(category.id)) ? Number(category.id) : String(category.id || '').trim();
  const name = `${category.name || category.label || ''}`.trim();
  if (id === '' || !name) {
    return undefined;
  }
  return { id, name };
}

export function normalizeChannel(channel, categoryById = new Map()) {
  if (!channel || typeof channel !== 'object') {
    return undefined;
  }
  const id = normalizeId(channel.id ?? channel.channel_id ?? channel.channelId);
  if (!id) {
    return undefined;
  }
  const categories = normalizeCategoryIds(channel.categories ?? channel.category_ids ?? channel.categoryIds);
  const categoryNames = categories
      .map(categoryId => categoryById.get(categoryId)?.name)
      .filter(Boolean);
  const pageUrl = `${channel.url || channel.page_url || channel.pageUrl || ''}`.trim();
  return {
    id,
    name: `${channel.name || channel.title || channel.channel_name || `Canal ${id}`}`.trim(),
    logo: normalizeOptionalUrl(channel.image || channel.logo || channel.channel_logo),
    preview: normalizeOptionalUrl(channel.preview),
    categories,
    categoryNames,
    pageUrl,
    epgId: normalizeId(channel.epg_id ?? channel.epgId ?? channel.tvg_id) || id,
  };
}

export function normalizeEpgPayload(payload) {
  const result = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (item && Array.isArray(item.data) && item.id != null) {
        result.push(...normalizeProgramList(item.data, item.id));
      } else {
        const program = normalizeProgram(item, item?.channel_id ?? item?.channelId ?? item?.channel);
        if (program) result.push(program);
      }
    }
  } else if (payload && typeof payload === 'object') {
    const source = payload.epg || payload.channels || payload.data;
    if (Array.isArray(source)) {
      return normalizeEpgPayload(source);
    }
    for (const [channelId, programs] of Object.entries(source || {})) {
      if (Array.isArray(programs)) result.push(...normalizeProgramList(programs, channelId));
    }
  }
  return result;
}

export function normalizeEventsPayload(payload) {
  const rawEvents = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
  return rawEvents.map(normalizeEvent).filter(Boolean);
}

export function associateEvents(events, channels) {
  const channelById = new Map(channels.map(channel => [channel.id, channel]));
  const entries = [];
  const unmapped = [];
  for (const event of events) {
    const players = event.players.filter(Boolean);
    const eventChannels = [];
    for (const player of players) {
      const channelId = extractEmbedTvChannelId(player);
      const channel = channelId ? channelById.get(channelId) : undefined;
      if (channel && !eventChannels.some(item => item.id === channel.id)) {
        eventChannels.push(channel);
        entries.push({ event, channel });
      }
    }
    if (!eventChannels.length) {
      unmapped.push(event);
    }
  }
  return { entries, unmapped };
}

export function extractEmbedTvChannelId(playerUrl) {
  try {
    const parsed = new URL(playerUrl);
    if (!isEmbedTvPageUrl(parsed.href)) {
      return undefined;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    const id = parts.at(-1) || '';
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function isPlayableChannel(channel, baseUrl) {
  return Boolean(channel?.pageUrl && isEmbedTvPageUrl(channel.pageUrl, baseUrl));
}

function normalizeProgram(item, channelId) {
  if (!item || typeof item !== 'object') return undefined;
  const normalizedChannelId = normalizeId(channelId);
  const start = item.start_date ?? item.start ?? item.start_time ?? item.startTime;
  if (!normalizedChannelId || !start || Number.isNaN(Date.parse(start))) return undefined;
  const stop = item.stop_date ?? item.stop ?? item.end_date ?? item.end_time ?? item.endTime;
  return {
    channelId: normalizedChannelId,
    title: `${item.title || item.name || 'Programação'}`.trim(),
    description: item.desc ?? item.description ?? '',
    start: `${start}`,
    stop: stop ? `${stop}` : undefined,
  };
}

function normalizeProgramList(programs, channelId) {
  return programs.map(program => normalizeProgram(program, channelId)).filter(Boolean);
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || event.id == null) return undefined;
  const start = event.time_start ?? event.start ?? event.start_time;
  const end = event.time_end ?? event.stop ?? event.end_time;
  return {
    id: String(event.id),
    slug: `${event.slug || ''}`,
    title: `${event.title || 'Evento ao vivo'}`.trim(),
    league: event.league?.name ? `${event.league.name}` : '',
    leagueImage: normalizeOptionalUrl(event.league?.image),
    home: event.teams?.home?.name ? `${event.teams.home.name}` : '',
    away: event.teams?.away?.name ? `${event.teams.away.name}` : '',
    start: start ? `${start}` : undefined,
    stop: end ? `${end}` : undefined,
    players: Array.isArray(event.players) ? event.players.map(value => `${value}`).filter(Boolean) : [],
  };
}

function normalizeCategoryIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => Number.isInteger(Number(item)) ? Number(item) : String(item)).filter(item => item !== '')));
}

function normalizeId(value) {
  const normalized = `${value ?? ''}`.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(normalized) ? normalized : undefined;
}

function normalizeOptionalUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(`${value}`);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}
