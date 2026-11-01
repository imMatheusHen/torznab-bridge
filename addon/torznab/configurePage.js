import { Providers } from '../lib/filter.js';
import { SOURCE_BETOR, SOURCE_DETOUR, SOURCE_OPTIONS, SOURCE_STREMIO } from './source.js';
import { renderEmbedTvPanel, renderEmbedTvStyles } from './iptvUi.js';
import { renderDetourPanel, renderDetourStyles } from './detour/detourUi.js';
import { createRequire } from 'node:module';
import { CONFIGURE_PAGE_CLIENT_SCRIPT } from './configurePageClient.js';
import { CONFIGURE_PAGE_ACTIVITY_CLIENT_SCRIPT } from './configurePageActivityClient.js';
import { CONFIGURE_PAGE_EVENTS_CLIENT_SCRIPT } from './configurePageEventsClient.js';
import { CONFIGURE_PAGE_BASE_STYLES } from './configurePageStyles.js';
import { CONFIGURE_PAGE_ACTIVITY_STYLES } from './configurePageActivityStyles.js';
import { CONFIGURE_PAGE_INDEXER_STYLES } from './configurePageIndexerStyles.js';

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../package.json');
const GITHUB_REPOSITORY_URL = 'https://github.com/imMatheusHen/torznab-bridge';

export function renderConfigurePage({
  selectedProviders = [],
  selectedSources = [],
  iptvEnabled = true,
  detourConfig = { enabled: false, providers: ['hdrtorrent'] },
  baseUrl = '',
  saved = false,
  configPath = '',
  defaultConfiguration = {
    providers: [],
    sources: [],
    iptvEnabled: true,
    detourEnabled: false,
    detourProviders: ['hdrtorrent'],
  },
} = {}) {
  const providerButtons = renderProviderButtons(selectedProviders);
  const indexerCards = renderIndexerCards(selectedSources, detourConfig, providerButtons);
  const hiddenSourceInputs = renderHiddenSourceInputs(selectedSources, defaultConfiguration.sources);
  const styles = [
    CONFIGURE_PAGE_BASE_STYLES,
    CONFIGURE_PAGE_INDEXER_STYLES,
    CONFIGURE_PAGE_ACTIVITY_STYLES,
    renderEmbedTvStyles(),
    renderDetourStyles(),
  ].join('\n');
  const body = renderPageContent({
    saved,
    baseUrl,
    configPath,
    iptvEnabled,
    indexerCards,
    hiddenSourceInputs,
    defaultConfiguration,
  });
  return renderPageDocument({ styles, body });
}

function renderProviderButtons(selectedProviders) {
  const selectedSet = new Set(selectedProviders);
  return Providers.options.map(provider => {
    const isSelected = selectedSet.has(provider.key);
    const badge = provider.foreign ? `<span class="flag">${escapeHtml(provider.foreign)}</span>` : '';
    return `
      <label class="provider-pill${isSelected ? ' active' : ''}">
        <input type="checkbox" name="providers" value="${escapeHtml(provider.key)}"${isSelected ? ' checked' : ''}>
        ${badge}<span>${escapeHtml(provider.label)}</span>
      </label>
    `;
  }).join('');
}

function renderIndexerCards(selectedSources, detourConfig, providerButtons) {
  const selectedSet = new Set(selectedSources);
  const sourceByKey = new Map(SOURCE_OPTIONS.map(source => [source.key, source]));
  const visibleSources = [SOURCE_BETOR, SOURCE_STREMIO, SOURCE_DETOUR]
    .map(key => sourceByKey.get(key))
    .filter(Boolean);
  const torrentioProviders = `
    <details class="source-extra provider-extra">
      <summary class="source-extra-trigger">
        <svg class="filter-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14l-5.5 6.2v4.1l-3 1.7v-5.8L3 4Z" /></svg>
        <span class="source-extra-copy"><strong>Filtros de busca</strong><small>Providers Torrentio</small></span>
        <svg class="source-extra-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </summary>
      <div class="source-extra-expand"><div class="source-extra-inner">
        <p class="indexer-description">Escolha quais providers do Torrentio podem aparecer nos resultados.</p>
        <div class="provider-grid">${providerButtons}</div>
      </div></div>
    </details>
  `;

  return visibleSources.map(source => renderIndexerCard({
    source,
    selected: selectedSet.has(source.key)
      || (source.key === SOURCE_DETOUR && Boolean(detourConfig.enabled)),
    detourConfig,
    torrentioProviders,
  })).join('');
}

function renderHiddenSourceInputs(selectedSources = [], defaultSources = []) {
  const visibleSourceKeys = new Set([SOURCE_BETOR, SOURCE_STREMIO, SOURCE_DETOUR]);
  const validSourceKeys = new Set(SOURCE_OPTIONS.map(source => source.key));
  const selectedSet = new Set(selectedSources);
  const hiddenKeys = Array.from(new Set([...selectedSources, ...defaultSources]))
    .filter(key => validSourceKeys.has(key) && !visibleSourceKeys.has(key));

  if (!hiddenKeys.length) return '';
  return `<div id="unlisted-source-selections" hidden>${hiddenKeys.map(key => `
    <input type="checkbox" name="sources" value="${escapeHtml(key)}"${selectedSet.has(key) ? ' checked' : ''}>
  `).join('')}</div>`;
}

function renderIndexerCard({ source, selected, detourConfig, torrentioProviders }) {
  const sourceExtra = source.key === SOURCE_STREMIO
    ? torrentioProviders
    : (source.key === SOURCE_DETOUR ? renderDetourPanel({ detourConfig }) : '');
  const icon = source.key === SOURCE_BETOR ? 'catalog'
    : (source.key === SOURCE_STREMIO ? 'streaming' : 'scraper');
  const description = source.key === SOURCE_BETOR ? 'Catálogo público'
    : (source.key === SOURCE_STREMIO ? 'Torrentio e Torrentio Brazuca' : 'Provedores independentes');

  return `
    <article class="indexer-card" data-source-key="${escapeHtml(source.key)}">
      <div class="indexer-main-row">
        <div class="source-identity">
          <label class="source-toggle" title="Habilitar ${escapeHtml(source.label)}">
            <input type="checkbox" name="sources" value="${escapeHtml(source.key)}"${selected ? ' checked' : ''}>
            <span class="source-switch" aria-hidden="true"><span></span></span>
            <span class="sr-only">Habilitar ${escapeHtml(source.label)}</span>
          </label>
          <span class="source-icon">${renderIcon(icon)}</span>
          <span class="source-copy">
            <strong class="indexer-name">${escapeHtml(source.label)}</strong>
            <small class="indexer-description">${description}</small>
          </span>
        </div>
        <div class="indexer-operational" data-indexer-health="${escapeHtml(source.key)}">
          <span class="health-dot" aria-hidden="true"></span>
          <span class="status-badge status-${selected ? 'unknown' : 'disabled'}" data-status-badge>${selected ? 'Sem teste' : 'Desativado'}</span>
          <span class="configuration-state" data-enabled-badge>${selected ? 'Habilitado' : 'Desabilitado'}</span>
        </div>
        <div class="source-metrics">
          <div class="source-metric">
            <strong data-average-results>—</strong>
            <small>média / busca · 120 d</small>
          </div>
          <div class="source-metric">
            <strong data-average-duration>—</strong>
            <small>média · 120 d</small>
          </div>
          <div class="source-metric">
            <strong data-last-search-age>—</strong>
            <small>última consulta</small>
          </div>
        </div>
        <details class="source-details">
          <summary aria-label="Detalhes de ${escapeHtml(source.label)}" title="Detalhes">
            ${renderIcon('chevron')}
          </summary>
          <div class="source-detail-grid">
            <div><span>Última consulta</span><strong data-last-search-query>—</strong></div>
            <div><span>Horário da busca</span><strong data-last-search-at>—</strong></div>
            <div><span>Último contato</span><strong data-last-check-at>—</strong></div>
            <div><span>Consultas válidas</span><strong data-search-successes>0</strong></div>
            <div><span>Falhas</span><strong data-search-failures>0</strong></div>
            <p data-status-message>${selected ? 'Ainda não houve uma consulta ou verificação.' : 'Indexador desativado nesta configuração.'}</p>
          </div>
        </details>
      </div>
      ${sourceExtra}
    </article>
  `;
}

function renderPageContent({ saved, baseUrl, configPath, iptvEnabled, indexerCards, hiddenSourceInputs, defaultConfiguration }) {
  return `
    ${renderHero(saved)}
    <div class="layout">
      ${renderConfigurationPanel({ baseUrl, configPath, iptvEnabled, indexerCards, hiddenSourceInputs, defaultConfiguration })}
      ${renderEventsPanel()}
    </div>
  `;
}

function renderHero(saved) {
  return `
    <header class="hero">
      <div class="hero-topline">
        <div class="brand-lockup">
          <div class="brand-copy">
            <div class="brand-title-row">
              <h1><a class="brand-link" href="${GITHUB_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">Torznab Bridge</a></h1>
              <span class="version-tag">v${escapeHtml(APP_VERSION)}</span>
            </div>
          </div>
        </div>
        <button class="btn-secondary btn-verify" type="button" id="refresh-status" aria-label="Verificar fontes">
          ${renderIcon('refresh')}<span>Verificar fontes</span>
        </button>
      </div>
      ${saved ? '<div class="hero-status" role="status">Configuração salva.</div>' : ''}
      <div class="stats" aria-label="Indicadores operacionais">
        <div class="stat">
          <span class="metric-icon">${renderIcon('nodes')}</span>
          <span class="stat-copy"><strong id="stat-enabled">—</strong><span>habilitados</span></span>
        </div>
        <div class="stat" data-overview-health="unknown">
          <span class="metric-icon metric-status-icon"><i></i></span>
          <span class="stat-copy"><strong id="stat-healthy">—</strong><span>online</span><small id="stat-healthy-note">Aguardando verificação</small></span>
        </div>
        <div class="stat">
          <span class="metric-icon">${renderIcon('results')}</span>
          <span class="stat-copy"><strong id="stat-average-results">—</strong><span>resultados / consulta · 120 d</span></span>
        </div>
        <div class="stat">
          <span class="metric-icon">${renderIcon('clock')}</span>
          <span class="stat-copy"><strong id="stat-average-duration">—</strong><span>latência média · 120 d</span></span>
        </div>
      </div>
      <section class="search-activity" aria-label="Atividade de consultas">
        <div class="activity-heading">
          <div>
            <h2>Atividade de consultas <span>120 dias</span><span id="activity-demo-badge" class="activity-demo-badge" hidden>Dados de demonstração</span></h2>
            <p id="activity-period">Histórico desde a inicialização desta instância</p>
          </div>
          <div class="activity-totals">
            <span><strong id="stat-search-today">0</strong> hoje</span>
            <span><strong id="stat-search-total">0</strong> consultas</span>
            <span><strong id="stat-search-failures">0</strong> falhas</span>
          </div>
        </div>
        <div class="activity-chart">
          <div class="activity-grid-wrap">
            <div class="activity-months" id="search-activity-months" aria-hidden="true"></div>
            <div class="activity-days" id="search-activity-days" role="grid" aria-label="Consultas por dia nos últimos 120 dias"></div>
          </div>
          <div class="activity-tooltip" id="activity-tooltip" role="tooltip" hidden></div>
        </div>
        <div class="activity-footer">
          <p id="activity-history-note">Dias anteriores ao início desta instância não têm histórico disponível.</p>
          <div class="activity-legend" aria-label="Legenda do heatmap">
            <span><i data-level="unknown"></i>Sem histórico</span>
            <span><i data-level="0"></i>Sem consultas</span>
            <span><i data-level="4"></i>Com consultas</span>
          </div>
        </div>
      </section>
    </header>
  `;
}

function renderConfigurationPanel({ baseUrl, configPath, iptvEnabled, indexerCards, hiddenSourceInputs, defaultConfiguration }) {
  const defaultConfigAttribute = escapeHtml(JSON.stringify(defaultConfiguration));
  return `
    <section class="panel configuration-panel">
      <form method="post" action="/configure" data-default-config="${defaultConfigAttribute}">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Configuração</p>
            <h2>Fontes de busca</h2>
            <p class="section-copy">Habilitação e disponibilidade são indicadores separados.</p>
          </div>
          <div class="actions">
            <span class="config-save-status" id="config-save-status" role="status" aria-live="polite"></span>
            <button class="btn-secondary" type="button" id="config-reset">Restaurar padrões</button>
          </div>
        </div>
        ${hiddenSourceInputs}
        <div class="endpoint-meta">Endpoint Torznab <a href="${escapeHtml(baseUrl)}/api?t=caps"><code>${escapeHtml(baseUrl)}/api</code></a></div>
        <div class="indexer-grid">${indexerCards}</div>
        <div class="module-divider"><span>Televisão</span></div>
        ${renderEmbedTvPanel({ baseUrl, enabled: iptvEnabled })}
        <footer class="panel-footer">
          <a href="${GITHUB_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">Código-fonte</a>
          <span>Configuração persistida em <code>${escapeHtml(configPath || 'não configurado')}</code></span>
        </footer>
      </form>
    </section>
  `;
}

function renderEventsPanel() {
  return `
    <aside class="panel events-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Observabilidade</p>
          <h2>Atividade recente</h2>
          <p class="section-copy">Até 30 consultas, falhas e entregas.</p>
        </div>
      </div>
      <div class="events" id="events">
        <div class="event-empty">
          ${renderIcon('activity')}
          <strong>Nenhuma atividade nesta instância</strong>
          <span>Os eventos são mantidos em memória e reiniciam com o serviço.</span>
        </div>
      </div>
    </aside>
  `;
}

function renderPageDocument({ styles, body }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Torznab Bridge v${escapeHtml(APP_VERSION)}</title>
  ${styles}
</head>
<body>
  <main class="wrap">
    ${body}
  </main>
  ${CONFIGURE_PAGE_ACTIVITY_CLIENT_SCRIPT}
  ${CONFIGURE_PAGE_EVENTS_CLIENT_SCRIPT}
  ${CONFIGURE_PAGE_CLIENT_SCRIPT}
</body>
</html>`;
}

function renderIcon(name) {
  const paths = {
    bridge: '<path d="M4 19V9l8-5 8 5v10M4 11h16M8 19v-5h8v5M2 19h20" />',
    catalog: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 5.5v15M8 7h8M8 11h7" />',
    streaming: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z" />',
    scraper: '<path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6M8 12h8" />',
    nodes: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><path d="m8 8 2.7 6.9M16 8l-2.7 6.9M8 7h8" />',
    results: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" />',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" />',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4" />',
    chevron: '<path d="m8 10 4 4 4-4" />',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
}

function escapeHtml(value) {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
