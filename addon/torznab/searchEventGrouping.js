export function groupSearchEvents(events, windowMs = 1500) {
  const burstWindow = Number.isFinite(Number(windowMs)) ? Math.max(0, Number(windowMs)) : 1500;
  const entries = [];
  const groupsByIdentity = new Map();

  for (const [index, event] of (Array.isArray(events) ? events : []).entries()) {
    const timestamp = Date.parse(event?.timestamp || '');
    const identity = getSearchEventIdentity(event);
    if (event?.kind !== 'search' || !identity || !Number.isFinite(timestamp)) {
      entries.push({
        kind: 'event',
        id: getSearchEventId(event),
        event,
        sortTimestamp: Number.isFinite(timestamp) ? timestamp : 0,
        order: index,
      });
      continue;
    }

    const candidates = groupsByIdentity.get(identity) || [];
    let group = candidates.find(candidate => {
      const earliest = Math.min(candidate.earliestTimestamp, timestamp);
      const latest = Math.max(candidate.latestTimestamp, timestamp);
      return latest - earliest <= burstWindow;
    });

    if (!group) {
      group = {
        id: 'search-group:' + identity + ':' + timestamp,
        identity,
        events: [],
        earliestTimestamp: timestamp,
        latestTimestamp: timestamp,
        sortTimestamp: timestamp,
        order: index,
      };
      candidates.unshift(group);
      groupsByIdentity.set(identity, candidates);
      entries.push(group);
    }

    group.events.push(event);
    group.earliestTimestamp = Math.min(group.earliestTimestamp, timestamp);
    group.latestTimestamp = Math.max(group.latestTimestamp, timestamp);
    group.sortTimestamp = Math.max(group.sortTimestamp, timestamp);
  }

  return entries
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp || left.order - right.order)
    .map(entry => entry.events?.length > 1
      ? { kind: 'group', id: entry.id, events: entry.events }
      : entry.events?.length === 1
        ? { kind: 'event', id: getSearchEventId(entry.events[0]), event: entry.events[0] }
        : entry);

  function getSearchEventIdentity(event) {
    const search = event?.search || {};
    const requester = event?.requester || {};
    const requesterId = [requester.client || '', requester.ip || requester.label || ''].join('|');
    if (!requesterId) return '';

    const rawTitle = String(search.title || '').trim();
    const seasonMatch = rawTitle.match(/\bS(?:eason)?\s*0*(\d{1,2})(?:[ ._-]*E(?:P(?:ISODE)?)?0*\d{1,3})?\b/i)
      || rawTitle.match(/\b(\d{1,2})\s*(?:ª|º|a)?\s*(?:temporada|season)\b/i)
      || rawTitle.match(/\b(\d{1,2})x\d{1,3}\b/i);
    const season = Number(search.season) || (seasonMatch ? Number(seasonMatch[1]) : 0);
    if (!season) return '';

    const title = search.imdbId
      ? 'imdb:' + String(search.imdbId).toLowerCase()
      : rawTitle
        .replace(/\bS(?:eason)?\s*0*\d{1,2}(?:[ ._-]*E(?:P(?:ISODE)?)?0*\d{1,3})?\b/gi, ' ')
        .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
        .replace(/\b(?:ep|episode|epis[oó]dio)\s*0*\d{1,3}\b/gi, ' ')
        .replace(/\b(?:19|20)\d{2}\b/g, ' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (!title) return '';
    return JSON.stringify([requesterId, title, season]);
  }

  function getSearchEventId(event) {
    const search = event?.search || {};
    return [
      'event',
      event?.timestamp || 'unknown-time',
      search.action || event?.kind || 'event',
      search.imdbId || search.title || '',
      search.season || '',
      search.episode || '',
      event?.requester?.ip || '',
    ].join(':');
  }
}
