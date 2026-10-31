import { DETOUR_PROVIDERS, PROVIDER_CONFIGS } from './constants.js';

export function renderDetourStyles() {
  return `
    <style>
      .scraper-providers { min-width: 0; margin: 12px 0 0 38px; border-top: 1px solid var(--line-soft); }
      .scraper-providers-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 9px 0 5px; }
      .scraper-providers-heading strong { font-size: .75rem; font-weight: 600; }
      .scraper-providers-heading span { color: var(--subtle); font-size: .65rem; }
      .detour-provider-grid { display: grid; }
      .detour-provider-row {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) auto minmax(64px, 78px) minmax(66px, 80px) minmax(48px, 62px) auto auto;
        align-items: center;
        gap: 8px 10px;
        min-width: 0;
        padding: 8px 0;
        border-top: 1px solid var(--line-soft);
      }
      .detour-provider-name { display: flex; min-width: 0; align-items: center; gap: 7px; color: var(--text); font-size: .75rem; font-weight: 590; cursor: pointer; }
      .detour-provider-name input { width: 14px; height: 14px; flex: 0 0 auto; margin: 0; accent-color: var(--accent); }
      .detour-provider-state { min-width: 0; }
      .detour-provider-row .status-badge { font-size: .68rem; }
      .detour-provider-metric { display: grid; min-width: 0; gap: 1px; }
      .detour-provider-metric strong { overflow: hidden; color: var(--text); font-family: var(--font-mono); font-size: .72rem; font-weight: 540; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
      .detour-provider-metric small { overflow: hidden; color: var(--subtle); font-size: .59rem; text-overflow: ellipsis; white-space: nowrap; }
      .detour-provider-actions { display: inline-flex; align-items: center; gap: 7px; }
      .detour-provider-test { min-height: 28px; padding: 4px 8px; font-size: .68rem; }
      .detour-provider-link { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 6px; color: var(--muted); }
      .detour-provider-link:hover { background: var(--surface-raised); color: var(--blue); text-decoration: none; }
      .detour-provider-link svg { width: 15px; height: 15px; }
      .detour-provider-details { grid-column: 1 / -1; min-width: 0; }
      .detour-provider-details summary { width: max-content; color: var(--subtle); font-size: .64rem; cursor: pointer; }
      .detour-provider-details p { margin-top: 5px; color: var(--muted); font-size: .67rem; overflow-wrap: anywhere; }
      @media (max-width: 760px) {
        .scraper-providers { margin-left: 0; }
        .detour-provider-row { grid-template-columns: minmax(0, 1fr) auto; gap: 7px 10px; }
        .detour-provider-name { grid-column: 1; grid-row: 1; }
        .detour-provider-state { grid-column: 2; grid-row: 1; }
        .detour-provider-metric { grid-column: 1; grid-row: 2; }
        .detour-provider-row > .detour-provider-metric:nth-child(3) { grid-column: 1; grid-row: 2; }
        .detour-provider-row > .detour-provider-metric:nth-child(4) { grid-column: 2; grid-row: 2; }
        .detour-provider-row > .detour-provider-metric:nth-child(5) { grid-column: 1; grid-row: 3; }
        .detour-provider-actions { grid-column: 2; grid-row: 3; justify-self: end; }
        .detour-provider-row > .detour-provider-details { grid-row: 4; }
      }
      @media (max-width: 480px) {
        .detour-provider-row { gap: 6px 7px; }
        .detour-provider-metric small { font-size: .56rem; }
      }
    </style>`;
}

export function renderDetourPanel({ detourConfig = { enabled: false, providers: [] } } = {}) {
  const selectedProviders = new Set(detourConfig.providers || []);
  const rows = DETOUR_PROVIDERS.map(providerId => {
    const provider = PROVIDER_CONFIGS[providerId];
    if (!provider) return '';
    const selected = selectedProviders.has(providerId);
    const url = toExternalUrl(provider.baseUrl);
    return `
      <div class="detour-provider-row${selected ? ' active' : ''}" data-detour-row="${escapeHtml(providerId)}">
        <label class="detour-provider-name">
          <input type="checkbox" name="detourProviders" value="${escapeHtml(providerId)}"${selected ? ' checked' : ''}>
          <span>${escapeHtml(provider.name)}</span>
        </label>
        <span class="detour-provider-state">
          <span class="status-badge status-${selected ? 'unknown' : 'disabled'}" data-detour-status="${escapeHtml(providerId)}">${selected ? 'Sem teste' : 'Desativado'}</span>
        </span>
        <span class="detour-provider-metric"><strong data-detour-count="${escapeHtml(providerId)}">—</strong><small>último resultado</small></span>
        <span class="detour-provider-metric"><strong data-detour-duration="${escapeHtml(providerId)}">—</strong><small>latência</small></span>
        <span class="detour-provider-metric"><strong data-detour-last-at="${escapeHtml(providerId)}">—</strong><small>última verificação</small></span>
        <span class="detour-provider-actions">
          <button class="btn-secondary detour-provider-test" type="button" data-detour-probe="${escapeHtml(providerId)}">Testar</button>
          ${url ? `<a class="detour-provider-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir ${escapeHtml(provider.name)} em nova aba" title="Abrir site do provedor">${renderExternalIcon()}</a>` : ''}
        </span>
        <details class="detour-provider-details">
          <summary>Consulta e resultado</summary>
          <p>Consulta: <span data-detour-last-query="${escapeHtml(providerId)}">Nenhum teste</span> · origem: <span data-detour-source="${escapeHtml(providerId)}">—</span> · Resultado: <span data-detour-error="${escapeHtml(providerId)}">Sem teste</span></p>
        </details>
      </div>
    `;
  }).join('');

  return `
    <section class="scraper-providers" aria-label="Provedores do Scraper">
      <div class="scraper-providers-heading"><strong>Provedores</strong><span>Testes isolados</span></div>
      <div class="detour-provider-grid">${rows}</div>
    </section>
  `;
}

function toExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function renderExternalIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>';
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
