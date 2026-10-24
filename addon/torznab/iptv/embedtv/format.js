import { EMBEDTV_BASE_URL } from './constants.js';

export function buildM3u({ channels = [], eventEntries = [], baseUrl, epgUrl } = {}) {
  const normalizedBaseUrl = `${baseUrl || ''}`.replace(/\/$/, '');
  const lines = [`#EXTM3U${epgUrl ? ` url-tvg="${escapeAttribute(epgUrl)}"` : ''}`];
  for (const channel of channels) {
    lines.push(buildM3uEntry({
      id: channel.id,
      name: channel.name,
      logo: channel.logo,
      group: channel.categoryNames?.find(name => name !== 'Todos') || 'Outros',
      url: `${normalizedBaseUrl}/iptv/embedtv/channel/${encodeURIComponent(channel.id)}/index.m3u8`,
    }));
  }
  for (const { event, channel } of eventEntries) {
    const eventId = `event-${event.id}-${channel.id}`;
    const eventName = channel.name ? `${event.title} — ${channel.name}` : event.title;
    lines.push(buildM3uEntry({
      id: eventId,
      name: eventName,
      logo: event.leagueImage || channel.logo,
      group: 'Eventos ao vivo',
      url: `${normalizedBaseUrl}/iptv/embedtv/channel/${encodeURIComponent(channel.id)}/index.m3u8`,
    }));
  }
  return `${lines.join('\n')}\n`;
}

export function buildM3uEntry({ id, name, logo = '', group = 'Outros', url } = {}) {
  const attributes = [
    `tvg-id="${escapeAttribute(id)}"`,
    `tvg-name="${escapeAttribute(name)}"`,
    logo ? `tvg-logo="${escapeAttribute(logo)}"` : '',
    `group-title="${escapeAttribute(group)}"`,
  ].filter(Boolean).join(' ');
  return `#EXTINF:-1 ${attributes},${escapeText(name)}\n${url}`;
}

export function escapeAttribute(value) {
  return `${value ?? ''}`
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/\r?\n/g, ' ');
}

function escapeText(value) {
  return `${value ?? ''}`.replace(/\r?\n/g, ' ').trim();
}

export function buildXmltv({ channels = [], programs = [] } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tv generator-info-name="Torznab Bridge EmbedTV" generator-info-url="${escapeXml(EMBEDTV_BASE_URL)}">`,
  ];
  for (const channel of channels) {
    lines.push(`  <channel id="${escapeXml(channel.id)}">`);
    lines.push(`    <display-name>${escapeXml(channel.name)}</display-name>`);
    if (channel.logo) {
      lines.push(`    <icon src="${escapeXml(channel.logo)}" />`);
    }
    lines.push('  </channel>');
  }

  const grouped = groupPrograms(programs);
  for (const [channelId, channelPrograms] of grouped) {
    for (let index = 0; index < channelPrograms.length; index += 1) {
      const program = channelPrograms[index];
      const next = channelPrograms[index + 1];
      const start = formatXmltvDate(program.start);
      if (!start) continue;
      const explicitStop = parseDate(program.stop);
      const nextStart = parseDate(next?.start);
      const stop = explicitStop && explicitStop > parseDate(program.start)
        ? formatXmltvDate(program.stop)
        : nextStart && nextStart > parseDate(program.start) && nextStart - parseDate(program.start) <= 24 * 60 * 60 * 1000
          ? formatXmltvDate(next.start)
          : '';
      lines.push(`  <programme channel="${escapeXml(channelId)}" start="${start}"${stop ? ` stop="${stop}"` : ''}>`);
      lines.push(`    <title lang="pt">${escapeXml(program.title || 'Programação')}</title>`);
      if (program.description) {
        lines.push(`    <desc lang="pt">${escapeXml(program.description)}</desc>`);
      }
      lines.push('  </programme>');
    }
  }
  lines.push('</tv>');
  return `${lines.join('\n')}\n`;
}

export function formatXmltvDate(value) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:([+-])(\d{2}):?(\d{2})|Z)?$/);
    if (match) {
      const [, year, month, day, hour, minute, second = '00', sign, offsetHour = '00', offsetMinute = '00'] = match;
      const offset = sign ? `${sign}${offsetHour}${offsetMinute}` : '+0000';
      return `${year}${month}${day}${hour}${minute}${second} ${offset}`;
    }
  }
  const date = parseDate(value);
  if (!date) return '';
  const pad = number => `${number}`.padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

export function escapeXml(value) {
  return `${value ?? ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

function groupPrograms(programs) {
  const grouped = new Map();
  for (const program of programs) {
    if (!program?.channelId || !parseDate(program.start)) continue;
    const list = grouped.get(program.channelId) || [];
    list.push(program);
    grouped.set(program.channelId, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => parseDate(left.start) - parseDate(right.start));
  }
  return grouped;
}

function parseDate(value) {
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
