import { Providers } from '../lib/filter.js';
import { SOURCE_OPTIONS } from './source.js';

export function renderConfigurePage({
  selectedProviders = [],
  selectedSources = [],
  baseUrl = '',
  saved = false,
  configPath = '',
} = {}) {
  const selectedProviderSet = new Set(selectedProviders);
  const selectedSourceSet = new Set(selectedSources);
  const providerButtons = Providers.options.map(provider => {
    const isSelected = selectedProviderSet.has(provider.key);
    const badge = provider.foreign ? `<span class="flag">${escapeHtml(provider.foreign)}</span>` : '';
    return `
      <label class="provider-pill${isSelected ? ' active' : ''}">
        <input type="checkbox" name="providers" value="${escapeHtml(provider.key)}"${isSelected ? ' checked' : ''}>
        ${badge}<span>${escapeHtml(provider.label)}</span>
      </label>
    `;
  }).join('');
  const indexerCards = SOURCE_OPTIONS.map(source => {
    const isSelected = selectedSourceSet.has(source.key);
    return `
      <label class="indexer-card${isSelected ? ' active' : ''}" data-source-key="${escapeHtml(source.key)}">
        <div class="indexer-head">
          <div>
            <span class="indexer-name">${escapeHtml(source.label)}</span>
            <span class="indexer-description">${escapeHtml(source.description)}</span>
          </div>
          <span class="status-badge status-unknown" data-status-badge>${isSelected ? 'Aguardando' : 'Desativado'}</span>
        </div>
        <input type="checkbox" name="sources" value="${escapeHtml(source.key)}"${isSelected ? ' checked' : ''}>
        <p class="indexer-message" data-status-message>${isSelected ? 'Aguardando a primeira verificação.' : 'Indexador desativado nesta configuração.'}</p>
      </label>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configuração do Torznab Bridge</title>
  <style>
    :root {
      --bg: #07111b;
      --panel: rgba(11, 23, 38, 0.92);
      --panel-2: #122338;
      --panel-3: #17304d;
      --text: #ecf4ff;
      --muted: #97aac5;
      --line: rgba(255, 255, 255, 0.1);
      --accent: #38d19a;
      --accent-2: #138b63;
      --warn: #f0ad4e;
      --danger: #ff6b6b;
      --shadow: rgba(0, 0, 0, 0.35);
      --font-ui: "Segoe UI", system-ui, sans-serif;
      --font-mono: "SFMono-Regular", Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: var(--font-ui);
      background:
        radial-gradient(circle at top left, rgba(56, 209, 154, 0.18), transparent 26%),
        radial-gradient(circle at top right, rgba(89, 160, 255, 0.16), transparent 24%),
        linear-gradient(180deg, #040b13 0%, var(--bg) 100%);
    }
    a { color: #9edbff; text-decoration: none; }
    code {
      font-family: var(--font-mono);
      color: #d9e6ff;
      word-break: break-all;
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 24px auto;
      display: grid;
      gap: 18px;
    }
    .hero, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: 0 22px 60px var(--shadow);
    }
    .hero {
      padding: 26px 28px 22px;
      background:
        linear-gradient(135deg, rgba(56, 209, 154, 0.16), transparent 46%),
        var(--panel);
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 3.3vw, 2.9rem);
      letter-spacing: -0.03em;
    }
    h2 {
      margin: 0;
      font-size: 1.08rem;
      letter-spacing: 0.01em;
    }
    p {
      margin: 0;
      line-height: 1.55;
    }
    .muted {
      color: var(--muted);
    }
    .hero-status {
      margin-top: 16px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 999px;
      border: 1px solid rgba(56, 209, 154, 0.32);
      background: rgba(56, 209, 154, 0.1);
    }
    .layout {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
    }
    .panel {
      padding: 22px 24px 24px;
    }
    .toolbar, .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .toolbar {
      margin-bottom: 18px;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .meta {
      color: var(--muted);
      font-size: 0.94rem;
    }
    .section-copy {
      margin: 8px 0 18px;
      color: var(--muted);
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 11px 17px;
      font: inherit;
      cursor: pointer;
      transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
    }
    button:hover { transform: translateY(-1px); }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent), #1eb886);
      color: #042617;
      font-weight: 700;
    }
    .btn-secondary {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--line);
    }
    .indexer-grid, .provider-grid {
      display: grid;
      gap: 12px;
    }
    .indexer-grid {
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      margin-bottom: 18px;
    }
    .provider-grid {
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }
    .indexer-card, .provider-pill {
      border-radius: 18px;
      border: 1px solid transparent;
      background: var(--panel-2);
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }
    .indexer-card {
      display: grid;
      gap: 14px;
      padding: 16px;
      cursor: pointer;
    }
    .provider-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 54px;
      padding: 12px 14px;
      cursor: pointer;
      user-select: none;
    }
    .indexer-card:hover, .provider-pill:hover {
      transform: translateY(-1px);
    }
    .indexer-card.active, .provider-pill.active {
      border-color: rgba(56, 209, 154, 0.56);
      background: linear-gradient(135deg, rgba(56, 209, 154, 0.14), rgba(18, 35, 56, 0.94));
      box-shadow: inset 0 0 0 1px rgba(56, 209, 154, 0.16);
    }
    .indexer-card input, .provider-pill input {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: var(--accent);
    }
    .indexer-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .indexer-name {
      display: block;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .indexer-description, .indexer-message {
      color: var(--muted);
      font-size: 0.94rem;
      line-height: 1.4;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 102px;
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 0.84rem;
      font-weight: 700;
      border: 1px solid var(--line);
      white-space: nowrap;
    }
    .status-online {
      color: #b8ffe4;
      background: rgba(56, 209, 154, 0.14);
      border-color: rgba(56, 209, 154, 0.35);
    }
    .status-unstable {
      color: #ffe1af;
      background: rgba(240, 173, 78, 0.13);
      border-color: rgba(240, 173, 78, 0.34);
    }
    .status-unavailable {
      color: #ffd0d0;
      background: rgba(255, 107, 107, 0.13);
      border-color: rgba(255, 107, 107, 0.34);
    }
    .status-disabled, .status-unknown {
      color: #d7e2f6;
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.14);
    }
    .flag {
      opacity: 0.85;
      font-size: 0.95rem;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 16px;
      align-items: end;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .stat {
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .stat strong {
      display: block;
      font-size: 1.4rem;
      margin-bottom: 4px;
    }
    .events {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }
    .event {
      padding: 13px 14px;
      border-radius: 16px;
      background: var(--panel-2);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .event-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 0.9rem;
      margin-bottom: 6px;
    }
    .event-kind {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.76rem;
    }
    .event-level-warn { border-color: rgba(240, 173, 78, 0.34); }
    .event-level-error { border-color: rgba(255, 107, 107, 0.34); }
    .event-empty {
      padding: 16px;
      border-radius: 16px;
      background: var(--panel-2);
      border: 1px dashed rgba(255, 255, 255, 0.12);
      color: var(--muted);
    }
    @media (max-width: 900px) {
      .layout, .hero-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 640px) {
      .wrap {
        width: min(100%, calc(100% - 16px));
        margin: 8px auto 20px;
      }
      .hero, .panel {
        border-radius: 18px;
      }
      .hero, .panel {
        padding-left: 18px;
        padding-right: 18px;
      }
      .stats {
        grid-template-columns: 1fr;
      }
      .indexer-head {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="hero-grid">
        <div>
          <h1>Torznab Bridge</h1>
          <p class="muted">Gerencie indexadores e providers em uma única interface. O bridge continua servindo resultados do Stremio mesmo quando o BeTor estiver temporariamente indisponível.</p>
          ${saved ? '<div class="hero-status">Configuração salva com sucesso.</div>' : ''}
        </div>
        <div class="stats">
          <div class="stat">
            <strong id="stat-enabled">0</strong>
            <span class="muted">Indexadores ativos</span>
          </div>
          <div class="stat">
            <strong id="stat-healthy">0</strong>
            <span class="muted">Online</span>
          </div>
          <div class="stat">
            <strong id="stat-alerts">0</strong>
            <span class="muted">Com alerta</span>
          </div>
        </div>
      </div>
    </section>

    <div class="layout">
      <section class="panel">
        <form method="post" action="/configure">
          <div class="toolbar">
            <div class="meta">
              Endpoint atual:
              <a href="${escapeHtml(baseUrl)}/api?t=caps"><code>${escapeHtml(baseUrl)}/api</code></a>
            </div>
            <div class="actions">
              <button class="btn-secondary" type="button" id="providers-all">Selecionar providers</button>
              <button class="btn-secondary" type="button" id="providers-none">Limpar providers</button>
              <button class="btn-primary" type="submit">Salvar configuração</button>
            </div>
          </div>

          <h2>Indexadores</h2>
          <p class="section-copy">Ative os indexadores desejados. O estado operacional é verificado separadamente para cada um deles.</p>
          <div class="indexer-grid">${indexerCards}</div>

          <h2>Providers Torrentio</h2>
          <p class="section-copy">Filtre os providers aceitos quando o indexador Stremio responder com múltiplas origens.</p>
          <div class="provider-grid">${providerButtons}</div>

          <div class="footer" style="margin-top: 20px;">
            <div class="meta">Arquivo persistido: <code>${escapeHtml(configPath || 'não configurado')}</code></div>
            <button class="btn-primary" type="submit">Salvar configuração</button>
          </div>
        </form>
      </section>

      <aside class="panel">
        <div class="toolbar">
          <div>
            <h2>Últimos eventos</h2>
            <p class="section-copy">As 10 ocorrências mais recentes de buscas, falhas e recuperações.</p>
          </div>
          <button class="btn-secondary" type="button" id="refresh-status">Atualizar agora</button>
        </div>
        <div class="events" id="events">
          <div class="event-empty">Aguardando os primeiros eventos do bridge.</div>
        </div>
      </aside>
    </div>
  </main>

  <script>
    const providerCheckboxes = Array.from(document.querySelectorAll('input[name="providers"]'));
    const sourceCheckboxes = Array.from(document.querySelectorAll('input[name="sources"]'));

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function syncSelections() {
      for (const checkbox of providerCheckboxes) {
        checkbox.closest('.provider-pill')?.classList.toggle('active', checkbox.checked);
      }
      for (const checkbox of sourceCheckboxes) {
        checkbox.closest('.indexer-card')?.classList.toggle('active', checkbox.checked);
      }
    }

    function applyStatusSnapshot(payload) {
      const indexers = Array.isArray(payload?.indexers) ? payload.indexers : [];
      const events = Array.isArray(payload?.events) ? payload.events : [];
      let enabled = 0;
      let healthy = 0;
      let alerts = 0;

      for (const indexer of indexers) {
        const card = document.querySelector('[data-source-key="' + indexer.key + '"]');
        if (!card) {
          continue;
        }

        const badge = card.querySelector('[data-status-badge]');
        const message = card.querySelector('[data-status-message]');
        card.classList.toggle('active', Boolean(indexer.enabled));

        if (badge) {
          badge.textContent = indexer.statusLabel || 'Aguardando';
          badge.className = 'status-badge status-' + (indexer.status || 'unknown');
        }
        if (message) {
          message.textContent = indexer.message || 'Sem detalhes adicionais.';
        }

        if (indexer.enabled) {
          enabled += 1;
        }
        if (indexer.status === 'online') {
          healthy += 1;
        }
        if (indexer.status === 'unstable' || indexer.status === 'unavailable') {
          alerts += 1;
        }
      }

      document.getElementById('stat-enabled').textContent = String(enabled);
      document.getElementById('stat-healthy').textContent = String(healthy);
      document.getElementById('stat-alerts').textContent = String(alerts);

      const eventsNode = document.getElementById('events');
      if (!events.length) {
        eventsNode.innerHTML = '<div class="event-empty">Aguardando os primeiros eventos do bridge.</div>';
        return;
      }

      eventsNode.innerHTML = events.map(event => {
        const timestamp = new Date(event.timestamp || Date.now()).toLocaleString('pt-BR');
        const levelClass = event.level ? 'event-level-' + event.level : '';
        const source = event.source ? ' · ' + escapeHtml(event.source) : '';
        return '<article class="event ' + levelClass + '">' +
          '<div class="event-head">' +
            '<span class="event-kind">' + escapeHtml(event.kind || 'evento') + source + '</span>' +
            '<span class="muted">' + escapeHtml(timestamp) + '</span>' +
          '</div>' +
          '<p>' + escapeHtml(event.message || 'Sem mensagem') + '</p>' +
        '</article>';
      }).join('');
    }

    async function refreshStatus() {
      try {
        const response = await fetch('/status', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Falha ao buscar o status.');
        }
        const payload = await response.json();
        applyStatusSnapshot(payload);
      } catch (error) {
        const eventsNode = document.getElementById('events');
        eventsNode.innerHTML = '<div class="event event-level-error"><div class="event-head"><span class="event-kind">status</span><span class="muted">agora</span></div><p>' + escapeHtml(error.message || 'Falha ao carregar status.') + '</p></div>';
      }
    }

    document.getElementById('providers-all')?.addEventListener('click', () => {
      for (const checkbox of providerCheckboxes) {
        checkbox.checked = true;
      }
      syncSelections();
    });

    document.getElementById('providers-none')?.addEventListener('click', () => {
      for (const checkbox of providerCheckboxes) {
        checkbox.checked = false;
      }
      syncSelections();
    });

    document.getElementById('refresh-status')?.addEventListener('click', refreshStatus);

    for (const checkbox of [...providerCheckboxes, ...sourceCheckboxes]) {
      checkbox.addEventListener('change', syncSelections);
    }

    syncSelections();
    refreshStatus();
    window.setInterval(refreshStatus, 30000);
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return `${value || ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}
