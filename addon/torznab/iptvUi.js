export function renderEmbedTvStyles() {
  return `
    <style>
      .iptv-section {
        margin: 10px 0 0;
        padding: 13px 0 2px;
        border-top: 1px solid var(--line-soft);
      }
      .iptv-head, .iptv-toolbar, .iptv-links, .iptv-meta {
        display: flex;
        align-items: center;
        gap: 9px 14px;
        flex-wrap: wrap;
      }
      .iptv-head { justify-content: space-between; }
      .iptv-head h2 { font-size: .88rem; }
      .iptv-toggle { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: .75rem; cursor: pointer; }
      .iptv-toggle input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
      .iptv-description { margin-top: 3px; color: var(--muted); font-size: .7rem; }
      .iptv-status-line { justify-content: flex-start; margin-top: 8px; }
      .iptv-status-line .indexer-message { color: var(--subtle); font-size: .69rem; }
      .iptv-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 8px;
        border-top: 1px solid var(--line-soft);
        border-bottom: 1px solid var(--line-soft);
      }
      .iptv-stat { display: grid; min-width: 0; gap: 2px; padding: 8px 11px; border-right: 1px solid var(--line-soft); }
      .iptv-stat:first-child { padding-left: 0; }
      .iptv-stat:last-child { padding-right: 0; border-right: 0; }
      .iptv-stat strong { overflow: hidden; color: var(--text); font-family: var(--font-mono); font-size: .8rem; font-weight: 580; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
      .iptv-stat span { overflow: hidden; color: var(--subtle); font-size: .63rem; text-overflow: ellipsis; white-space: nowrap; }
      .iptv-links { margin-top: 9px; }
      .iptv-links a { display: inline-flex; min-width: 0; align-items: baseline; gap: 5px; font-size: .69rem; }
      .iptv-links a > span { color: var(--muted); }
      .iptv-links code { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
      .iptv-meta { margin-top: 8px; color: var(--subtle); font-size: .64rem; }
      .iptv-meta > span { min-width: 0; overflow-wrap: anywhere; }
      .iptv-meta [data-iptv-last-failure][data-failed="true"] { color: var(--danger); }
      @media (max-width: 480px) {
        .iptv-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .iptv-stat { padding: 7px 8px; }
        .iptv-stat:nth-child(2) { border-right: 0; }
        .iptv-stat:nth-child(-n+2) { border-bottom: 1px solid var(--line-soft); }
        .iptv-stat:nth-child(3) { padding-left: 0; }
        .iptv-links { display: grid; align-items: start; gap: 6px; }
        .iptv-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; }
      }
    </style>`;
}

export function renderEmbedTvPanel({ baseUrl = '', enabled = true } = {}) {
  const playlistUrl = `${baseUrl}/iptv/embedtv/playlist.m3u`;
  const epgUrl = `${baseUrl}/iptv/embedtv/epg.xml`;
  return `
    <section class="iptv-section" data-iptv-panel>
      <div class="iptv-head">
        <div>
          <h2>IPTV / EmbedTV</h2>
          <p class="iptv-description">Catálogo, EPG e HLS sem transcodificação.</p>
        </div>
        <label class="iptv-toggle">
          <input type="checkbox" name="iptvEnabled" value="1"${enabled ? ' checked' : ''}>
          <span>Habilitado</span>
        </label>
      </div>
      <div class="iptv-toolbar iptv-status-line">
        <span class="status-badge status-unknown" data-iptv-status-badge>${enabled ? 'Sem teste' : 'Desativado'}</span>
        <span class="indexer-message" data-iptv-status-message>${enabled ? 'Aguardando verificação.' : 'IPTV desativado nesta configuração.'}</span>
        <button class="btn-secondary" type="button" id="refresh-iptv-status">Atualizar estado</button>
      </div>
      <div class="iptv-stats">
        <div class="iptv-stat"><strong data-iptv-channels>—</strong><span>Canais</span></div>
        <div class="iptv-stat"><strong data-iptv-events>—</strong><span>Eventos</span></div>
        <div class="iptv-stat"><strong data-iptv-cache>—</strong><span>Idade do cache</span></div>
        <div class="iptv-stat"><strong data-iptv-resolution>—</strong><span>Última resolução/teste</span></div>
      </div>
      <div class="iptv-links">
        <a data-iptv-playlist href="${escapeHtml(playlistUrl)}"><span>Playlist</span><code>${escapeHtml(playlistUrl)}</code></a>
        <a data-iptv-epg href="${escapeHtml(epgUrl)}"><span>EPG</span><code>${escapeHtml(epgUrl)}</code></a>
      </div>
      <div class="iptv-meta">
        <span>Catálogo <span data-iptv-catalog-at>não atualizado</span></span>
        <span>Upstream <span data-iptv-upstream>não testado</span></span>
        <span>Falha recente <span data-iptv-last-failure></span></span>
      </div>
    </section>`;
}

function escapeHtml(value) {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
