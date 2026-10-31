export const CONFIGURE_PAGE_CLIENT_SCRIPT = `  <script>
    const providerCheckboxes = Array.from(document.querySelectorAll('input[name="providers"]'));
    const sourceCheckboxes = Array.from(document.querySelectorAll('input[name="sources"]'));
    const detourProviderBoxes = Array.from(document.querySelectorAll('input[name="detourProviders"]'));
    let statusRefreshInFlight = false;
    const configForm = document.querySelector('form[action="/configure"]');
    const configSaveStatus = document.getElementById('config-save-status');
    let configSaveTimer;
    let configSaveInFlight = false;
    let configSaveQueued = false;

    function escapeHtml(value) {
      return String(value ?? '')
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
        const card = checkbox.closest('.indexer-card');
        card?.classList.toggle('active', checkbox.checked);
        const badge = card?.querySelector('[data-enabled-badge]');
        if (badge) badge.textContent = checkbox.checked ? 'Habilitado' : 'Desabilitado';
      }
      for (const checkbox of detourProviderBoxes) {
        checkbox.closest('.detour-provider-row')?.classList.toggle('active', checkbox.checked);
      }
      const iptvCheckbox = document.querySelector('input[name="iptvEnabled"]');
      document.querySelector('[data-iptv-panel]')?.classList.toggle('active', Boolean(iptvCheckbox?.checked));
    }

    function setConfigSaveStatus(message, state) {
      if (!configSaveStatus) return;
      configSaveStatus.textContent = message;
      configSaveStatus.dataset.state = state;
    }

    function scheduleConfigSave() {
      if (!configForm) return;
      window.clearTimeout(configSaveTimer);
      setConfigSaveStatus('Alterações pendentes', 'pending');
      configSaveTimer = window.setTimeout(saveConfiguration, 300);
    }

    async function saveConfiguration() {
      if (!configForm) return;
      window.clearTimeout(configSaveTimer);
      if (configSaveInFlight) {
        configSaveQueued = true;
        return;
      }

      configSaveInFlight = true;
      do {
        configSaveQueued = false;
        setConfigSaveStatus('Salvando…', 'saving');
        try {
          const body = new URLSearchParams(new FormData(configForm));
          const response = await fetch(configForm.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
            body: body.toString(),
            credentials: 'same-origin',
          });
          if (!response.ok) throw new Error('Falha ao salvar a configuração.');
          if (!configSaveQueued) setConfigSaveStatus('Salvo automaticamente', 'saved');
        } catch (error) {
          setConfigSaveStatus('Falha ao salvar. Tente novamente.', 'error');
          console.error(error);
          break;
        }
      } while (configSaveQueued);
      configSaveInFlight = false;
      if (configSaveQueued) {
        configSaveQueued = false;
        scheduleConfigSave();
      }
    }

    function setCheckboxSelection(checkboxes, selectedValues) {
      const selected = new Set(Array.isArray(selectedValues) ? selectedValues : []);
      for (const checkbox of checkboxes) checkbox.checked = selected.has(checkbox.value);
    }

    function applyDefaultConfiguration() {
      if (!configForm || !window.confirm('Restaurar os padrões e salvar esta configuração?')) return;
      let defaults;
      try {
        defaults = JSON.parse(configForm.dataset.defaultConfig || '{}');
      } catch (error) {
        setConfigSaveStatus('Não foi possível carregar os padrões.', 'error');
        return;
      }
      setCheckboxSelection(providerCheckboxes, defaults.providers);
      const defaultSources = Array.isArray(defaults.sources) ? [...defaults.sources] : [];
      if (defaults.detourEnabled && !defaultSources.includes('detour')) defaultSources.push('detour');
      setCheckboxSelection(sourceCheckboxes, defaultSources);
      setCheckboxSelection(detourProviderBoxes, defaults.detourProviders);
      const iptvCheckbox = configForm.querySelector('input[name="iptvEnabled"]');
      if (iptvCheckbox) iptvCheckbox.checked = defaults.iptvEnabled !== false;
      syncSelections();
      saveConfiguration();
    }

    function applyStatusSnapshot(payload) {
      const indexers = Array.isArray(payload?.indexers) ? payload.indexers : [];
      const events = Array.isArray(payload?.events) ? payload.events : [];
      updateIndexerCards(indexers);
      updateOverviewStats(indexers, payload?.activity, payload?.health, payload?.probe);
      window.applySearchActivity?.(payload?.activity);
      applyIptvStatus(payload?.iptv);
      applyDetourStatus(payload?.detour);
      window.renderSearchEvents?.(events, { escapeHtml, formatDateTime, displaySourceLabel, renderImdbBadge });
    }

    function updateIndexerCards(indexers) {
      for (const indexer of indexers) {
        const card = document.querySelector('[data-source-key="' + indexer.key + '"]');
        if (!card) continue;

        const badge = card.querySelector('[data-status-badge]');
        const health = card.querySelector('[data-indexer-health]');
        const message = card.querySelector('[data-status-message]');
        const lastSearch = indexer.lastSearch;
        const metrics = indexer.searchMetrics || {};
        const query = card.querySelector('[data-last-search-query]');
        const searchedAt = card.querySelector('[data-last-search-at]');
        const checkedAt = card.querySelector('[data-last-check-at]');
        const searchAge = card.querySelector('[data-last-search-age]');
        const averageResults = card.querySelector('[data-average-results]');
        const averageDuration = card.querySelector('[data-average-duration]');

        if (query) query.textContent = lastSearch?.query || 'Nenhuma consulta registrada';
        if (searchedAt) searchedAt.textContent = lastSearch?.completedAt ? formatDateTime(lastSearch.completedAt) : '—';
        if (checkedAt) checkedAt.textContent = indexer.lastCheckAt ? formatDateTime(indexer.lastCheckAt) : '—';
        if (searchAge) {
          searchAge.textContent = lastSearch?.completedAt ? formatRelativeTime(lastSearch.completedAt) : '—';
          searchAge.title = lastSearch?.completedAt ? formatDateTime(lastSearch.completedAt) : 'Sem consultas nesta instância';
        }
        if (averageResults) averageResults.textContent = formatResults(metrics.averageResults);
        if (averageDuration) averageDuration.textContent = formatLatency(metrics.averageDurationMs);
        setText(card, '[data-search-successes]', metrics.successfulSearchCount ?? 0);
        setText(card, '[data-search-failures]', metrics.failedSearchCount ?? 0);
        if (badge) {
          badge.textContent = indexer.statusLabel || 'Sem teste';
          badge.className = 'status-badge status-' + (indexer.status || 'unknown');
        }
        if (health) health.dataset.status = indexer.status || 'unknown';
        if (message) message.textContent = indexer.message || 'Sem detalhes adicionais.';
      }
    }

    function updateOverviewStats(indexers, activity, health, probe) {
      const enabledCount = indexers.filter(indexer => indexer.enabled).length;
      const testedCount = health?.tested ?? indexers.filter(indexer => indexer.enabled && indexer.status !== 'unknown').length;
      const onlineCount = health?.online ?? indexers.filter(indexer => indexer.enabled && indexer.status === 'online').length;
      const unknownCount = health?.unknown ?? Math.max(0, enabledCount - testedCount);
      setText(document, '#stat-enabled', enabledCount);

      const online = document.getElementById('stat-healthy');
      const onlineNote = document.getElementById('stat-healthy-note');
      const overview = document.querySelector('[data-overview-health]');
      if (online) online.textContent = testedCount ? String(onlineCount) : '—';
      if (onlineNote) {
        const baseNote = testedCount
          ? testedCount + ' verificados' + (unknownCount ? ' · ' + unknownCount + ' sem teste' : '')
          : (enabledCount ? 'Aguardando verificação' : 'Nenhuma fonte habilitada');
        onlineNote.textContent = probe?.state === 'cooldown'
          ? baseNote + ' · novo teste em ' + formatAge(probe.retryAfterMs)
          : baseNote;
      }
      if (overview) overview.dataset.status = health?.status || (testedCount ? 'partial' : 'unknown');

      setText(document, '#stat-average-results', formatResults(activity?.averageResults));
      setText(document, '#stat-average-duration', formatLatency(activity?.averageDurationMs));
    }

    function applyDetourStatus(detour) {
      if (!detour) return;
      for (const provider of detour.providers || []) {
        const badge = document.querySelector('[data-detour-status="' + provider.id + '"]');
        const row = document.querySelector('[data-detour-row="' + provider.id + '"]');
        const history = provider.history || {};
        if (badge) {
          badge.textContent = provider.statusLabel || 'Sem teste';
          badge.className = 'status-badge status-' + (provider.status || 'unknown');
        }
        if (row) row.dataset.status = provider.status || 'unknown';
        const inconclusive = ['pending', 'busy'].includes(history.lastOutcome);
        setText(document, '[data-detour-count="' + provider.id + '"]', inconclusive ? '—' : (history.lastCount ?? '—'));
        setText(document, '[data-detour-duration="' + provider.id + '"]', inconclusive ? '—' : formatLatency(history.lastDurationMs));
        setText(document, '[data-detour-source="' + provider.id + '"]', labelDetourSource(history.lastSource));
        setText(document, '[data-detour-last-query="' + provider.id + '"]', history.lastSearchQuery || 'Nenhum teste');
        setText(document, '[data-detour-last-at="' + provider.id + '"]', provider.lastCheckAt ? formatRelativeTime(provider.lastCheckAt) : '—');
        setText(document, '[data-detour-error="' + provider.id + '"]', describeProviderOutcome(history));
      }
    }

    function describeProviderOutcome(history) {
      if (history.lastError) return history.lastError;
      if (history.lastOutcome === 'no_results') return 'Sem resultados; resposta válida';
      if (history.lastOutcome === 'success') return 'Sem falhas';
      if (history.lastOutcome === 'pending') return 'Busca ainda em andamento';
      if (history.lastOutcome === 'busy') return 'Limite de concorrência atingido';
      if (['inconclusive', 'unrecognized', 'no_valid_results'].includes(history.lastOutcome)) return 'Resposta inconclusiva';
      if (history.lastOutcome) return history.lastOutcome;
      return 'Sem teste';
    }

    function labelDetourSource(source) {
      const labels = { network: 'rede', fresh_cache: 'cache recente', stale_cache: 'cache antigo', background_in_flight: 'em andamento', queue: 'fila', circuit_open: 'circuito aberto' };
      return labels[source] || '—';
    }

    function applyIptvStatus(iptv) {
      if (!iptv) return;
      const badge = document.querySelector('[data-iptv-status-badge]');
      const message = document.querySelector('[data-iptv-status-message]');
      if (badge) {
        badge.textContent = iptv.statusLabel || 'Sem teste';
        badge.className = 'status-badge status-' + (iptv.status || 'unknown');
      }
      if (message) message.textContent = iptv.message || 'Sem detalhes adicionais.';
      setText(document, '[data-iptv-channels]', iptv.channelCount ?? '—');
      setText(document, '[data-iptv-events]', iptv.eventCount ?? '—');
      setText(document, '[data-iptv-cache]', formatAge(iptv.cacheAgeMs));
      setText(document, '[data-iptv-resolution]', iptv.lastResolutionAt || iptv.lastTestAt
        ? formatDateTime(iptv.lastResolutionAt || iptv.lastTestAt) : '—');
      setText(document, '[data-iptv-upstream]', iptv.upstream || 'não testado');
      setText(document, '[data-iptv-catalog-at]', iptv.catalogCachedAt
        ? formatDateTime(iptv.catalogCachedAt) : 'não atualizado');
      const failure = document.querySelector('[data-iptv-last-failure]');
      if (failure) {
        failure.textContent = iptv.lastFailure?.message || '—';
        failure.dataset.failed = String(Boolean(iptv.lastFailure?.message));
      }
    }

    function setText(root, selector, value) {
      const node = typeof root === 'string' ? document.querySelector(root) : root.querySelector(selector);
      if (node) node.textContent = String(value ?? '—');
    }

    function displaySourceLabel(source) {
      const labels = { betor: 'BeTor', stremio: 'Torrentio', detour: 'Scraper', database: 'Database' };
      return labels[String(source || '').toLowerCase()] || source;
    }

    function formatResults(value) {
      const number = Number(value);
      return value === null || value === undefined || !Number.isFinite(number)
        ? '—'
        : number.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    }

    function formatLatency(value) {
      const number = Number(value);
      return value === null || value === undefined || !Number.isFinite(number) || number < 0
        ? '—'
        : Math.round(number).toLocaleString('pt-BR') + ' ms';
    }

    function formatAge(value) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
      const seconds = Math.max(0, Math.round(Number(value) / 1000));
      if (seconds < 60) return seconds + ' s';
      if (seconds < 3600) return Math.round(seconds / 60) + ' min';
      return Math.round(seconds / 3600) + ' h';
    }

    function formatRelativeTime(value) {
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) return '—';
      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
      if (seconds < 60) return 'agora';
      if (seconds < 3600) return Math.floor(seconds / 60) + ' min';
      if (seconds < 86400) return Math.floor(seconds / 3600) + ' h';
      return Math.floor(seconds / 86400) + ' d';
    }

    function formatDateTime(value) {
      const timestamp = new Date(value);
      return Number.isNaN(timestamp.getTime()) ? '—' : timestamp.toLocaleString('pt-BR');
    }

    function renderImdbBadge(value) {
      const imdbId = String(value || '').trim();
      if (!/^tt\\d{4,12}$/i.test(imdbId)) return '';
      const url = 'https://www.imdb.com/title/' + encodeURIComponent(imdbId.toLowerCase()) + '/';
      return '<a class="imdb-badge" href="' + url + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir título no IMDb">IMDb</a>';
    }

    async function refreshStatus({ probeSources = false, probeIptv = false } = {}) {
      if (statusRefreshInFlight) return;
      statusRefreshInFlight = true;
      try {
        const query = probeSources ? '?probe_sources=1' : (probeIptv ? '?probe_iptv=1' : '');
        const response = await fetch('/status' + query, { cache: 'no-store' });
        if (!response.ok) throw new Error('Falha ao buscar o status.');
        applyStatusSnapshot(await response.json());
      } catch (error) {
        const eventsNode = document.getElementById('events');
        window.resetSearchEventRenderCache?.();
        if (eventsNode) eventsNode.innerHTML = '<div class="event-empty event-error"><strong>Falha ao atualizar</strong><span>' + escapeHtml(error.message || 'Falha ao carregar status.') + '</span></div>';
      } finally {
        statusRefreshInFlight = false;
      }
    }

    document.getElementById('config-reset')?.addEventListener('click', applyDefaultConfiguration);
    document.getElementById('refresh-status')?.addEventListener('click', () => refreshStatus({ probeSources: true }));
    document.getElementById('refresh-iptv-status')?.addEventListener('click', () => refreshStatus({ probeIptv: true }));

    for (const button of document.querySelectorAll('[data-detour-probe]')) {
      button.addEventListener('click', async () => {
        const providerId = button.getAttribute('data-detour-probe');
        let probeNote;
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = 'Testando…';
        try {
          const response = await fetch('/detour/probe/' + encodeURIComponent(providerId), { method: 'POST' });
          if (!response.ok) throw new Error('O teste do provedor falhou.');
          const result = await response.json();
          if (result.outcome === 'cooldown') {
            probeNote = 'Teste recente; tente novamente em ' + formatAge(result.retryAfterMs) + '.';
            return;
          }
          if (result.outcome === 'pending' || result.outcome === 'busy') {
            probeNote = result.outcome === 'pending' ? 'Busca ainda em andamento.' : 'Limite de concorrência atingido.';
          }
        } catch (error) {
          probeNote = error.message;
        } finally {
          button.disabled = false;
          button.textContent = originalText;
          await refreshStatus();
          if (probeNote) {
            const outcome = document.querySelector('[data-detour-error="' + providerId + '"]');
            if (outcome) outcome.textContent = probeNote;
          }
        }
      });
    }

    document.getElementById('events')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-copy-magnet]');
      if (!button) return;
      const magnet = button.getAttribute('data-copy-magnet');
      const originalText = button.textContent;
      button.disabled = true;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(magnet);
        } else {
          const input = document.createElement('textarea');
          input.value = magnet;
          input.setAttribute('readonly', '');
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.appendChild(input);
          input.select();
          const copied = document.execCommand('copy');
          input.remove();
          if (!copied) throw new Error('Não foi possível copiar o magnet.');
        }
        button.textContent = 'Copiado';
      } catch (error) {
        button.textContent = 'Falha ao copiar';
        console.error(error);
      } finally {
        window.setTimeout(() => {
          button.disabled = false;
          button.textContent = originalText;
        }, 1400);
      }
    });

    configForm?.addEventListener('change', event => {
      if (!event.target?.matches?.('input[type="checkbox"]')) return;
      syncSelections();
      scheduleConfigSave();
    });
    configForm?.addEventListener('submit', event => {
      event.preventDefault();
      saveConfiguration();
    });
    syncSelections();
    refreshStatus({ probeSources: true });
    window.setInterval(() => refreshStatus(), 30000);
  </script>`;
