const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export function buildCapsXml(baseUrl) {
  const sanitizedBaseUrl = baseUrl.replace(/\/$/, '');
  return `${XML_DECLARATION}
<caps>
  <server title="Torznab Bridge" version="1.0" url="${escapeXml(sanitizedBaseUrl)}" />
  <limits max="200" default="100" />
  <registration available="no" open="no" />
  <searching>
    <search available="yes" supportedParams="q,cat,imdbid" />
    <tv-search available="yes" supportedParams="q,cat,season,ep,imdbid" />
    <movie-search available="yes" supportedParams="q,cat,imdbid" />
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2040" name="Movies/HD" />
      <subcat id="2045" name="Movies/UHD" />
      <subcat id="2080" name="Movies/WEB-DL" />
      <subcat id="2090" name="Movies/x265" />
    </category>
    <category id="5000" name="TV">
      <subcat id="5010" name="TV/WEB-DL" />
      <subcat id="5040" name="TV/HD" />
      <subcat id="5045" name="TV/UHD" />
      <subcat id="5050" name="TV/Other" />
      <subcat id="5070" name="TV/Anime" />
      <subcat id="5090" name="TV/x265" />
    </category>
  </categories>
</caps>`;
}

export function buildErrorXml(code, description) {
  return `${XML_DECLARATION}
<error code="${escapeXml(String(code))}" description="${escapeXml(description)}" />`;
}

export function buildRssXml(channelTitle, items) {
  const itemXml = items.map(item => buildItemXml(item)).join('\n');
  return `${XML_DECLARATION}
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <description>${escapeXml(channelTitle)}</description>
    <language>en-us</language>
    ${itemXml}
  </channel>
</rss>`;
}

function buildItemXml(item) {
  const categories = item.category
      .map(category => `      <category>${escapeXml(String(category))}</category>`)
      .join('\n');
  const attrs = item.attrs
      .map(([name, value]) => `      <torznab:attr name="${escapeXml(String(name))}" value="${escapeXml(String(value))}" />`)
      .join('\n');

  return `    <item>
      <title>${escapeXml(item.title)}</title>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <link>${escapeXml(item.link)}</link>
      <comments>${escapeXml(item.comments)}</comments>
      <pubDate>${escapeXml(item.pubDate)}</pubDate>
      <size>${escapeXml(String(item.size))}</size>
      <description>${escapeXml(item.description)}</description>
      <enclosure url="${escapeXml(item.enclosureUrl)}" length="${escapeXml(String(item.enclosureLength))}" type="${escapeXml(item.enclosureType)}" />
${categories}
${attrs}
    </item>`;
}

function escapeXml(value) {
  return `${value}`
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&apos;');
}
