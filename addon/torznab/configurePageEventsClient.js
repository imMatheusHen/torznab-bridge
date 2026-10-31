export const CONFIGURE_PAGE_EVENTS_CLIENT_SCRIPT = `  <script>
    (() => {
      let lastEventsSignature;
      let escapeHtml = value => String(value ?? '');
      let formatDateTime = value => String(value ?? '—');
      let displaySourceLabel = value => String(value ?? '');
      let renderImdbBadge = () => '';

      window.renderSearchEvents = function(events, helpers = {}) {
        escapeHtml = helpers.escapeHtml || escapeHtml;
        formatDateTime = helpers.formatDateTime || formatDateTime;
        displaySourceLabel = helpers.displaySourceLabel || displaySourceLabel;
        renderImdbBadge = helpers.renderImdbBadge || renderImdbBadge;
        renderEvents(events);
      };
      window.resetSearchEventRenderCache = function() {
        lastEventsSignature = undefined;
      };

      function renderEvents(events) {
        const eventsNode = document.getElementById('events');
        if (!eventsNode) return;
        const safeEvents = Array.isArray(events) ? events : [];
        const signature = JSON.stringify(safeEvents);
        if (signature === lastEventsSignature) return;

        const openDetails = new Set(Array.from(
          eventsNode.querySelectorAll('details[data-event-detail-key][open]'),
          details => details.dataset.eventDetailKey,
        ));
        const entries = window.groupSearchEvents
          ? window.groupSearchEvents(safeEvents)
          : safeEvents.map(event => ({ kind: 'event', id: createEventKey(event), event }));
        eventsNode.innerHTML = entries.length
          ? entries.map(entry => entry.kind === 'group'
            ? renderGroupedSearchCard(entry)
            : renderEventCard(entry.event, entry.id)).join('')
          : '<div class="event-empty"><strong>Nenhuma atividade nesta instância</strong><span>Os eventos reiniciam junto com o serviço.</span></div>';
        for (const details of eventsNode.querySelectorAll('details[data-event-detail-key]')) {
          if (openDetails.has(details.dataset.eventDetailKey)) details.open = true;
        }
        lastEventsSignature = signature;
      }

      function renderEventCard(event, eventId) {
        const timestamp = formatDateTime(event.timestamp || Date.now());
        const levelClass = event.level ? 'event-level-' + event.level : '';
        const source = event.source ? ' · ' + escapeHtml(displaySourceLabel(event.source)) : '';
        const imdbBadge = event.kind === 'search' ? renderImdbBadge(event.search?.imdbId) : '';
        const key = eventId || createEventKey(event);
        const requester = renderRequesterDetails(event.requester, key + ':requester');
        const releases = Array.isArray(event.releases) ? event.releases : [];
        const releaseList = renderReleaseList(releases, key + ':releases');
        const searchBreakdown = event.kind === 'search' ? renderSearchBreakdown(event, key) : '';
        return '<article class="event ' + levelClass + '">' +
          '<div class="event-head">' +
            '<div class="event-title-group"><span class="event-kind">' + escapeHtml(event.kind || 'evento') + source + '</span>' + imdbBadge + '</div>' +
            '<time class="muted">' + escapeHtml(timestamp) + '</time>' +
          '</div>' +
          '<p>' + escapeHtml(event.message || 'Sem mensagem') + '</p>' +
          requester + searchBreakdown + releaseList +
        '</article>';
      }

      function renderGroupedSearchCard(group) {
        const events = group.events || [];
        const newest = events[0] || {};
        const title = displaySearchTitle(newest.search);
        const season = Number(newest.search?.season) || 0;
        const episodes = Array.from(new Set(events.map(event => Number(event.search?.episode)).filter(Number.isInteger)))
          .sort((left, right) => left - right);
        const episodeLabel = episodes.length
          ? episodes.map(episode => 'E' + String(episode).padStart(2, '0')).join(', ')
          : events.length + ' consultas';
        const uniqueReleases = uniqueEventReleases(events);
        const requester = renderRequesterDetails(newest.requester, group.id + ':requester');
        const requestItems = events.map(event => {
          const key = createEventKey(event);
          const action = event.search?.action ? '/' + event.search.action : 'Consulta';
          const coordinate = formatEventCoordinate(event.search);
          const releases = Array.isArray(event.releases) ? event.releases : [];
          const requestBreakdown = renderSearchBreakdown(event, key);
          const requestReleases = renderReleaseList(releases, key + ':releases', releases.length + ' resultado(s) desta resposta');
          return '<li class="event-request-item"><div class="event-request-head"><strong>' + escapeHtml(action + (coordinate ? ' · ' + coordinate : '')) + '</strong>' +
            '<time class="muted">' + escapeHtml(formatDateTime(event.timestamp)) + '</time></div>' +
            '<p>' + escapeHtml(event.message || releases.length + ' resultado(s)') + '</p>' +
            requestBreakdown + requestReleases + '</li>';
        }).join('');
        const titleLine = title ? '<strong>' + escapeHtml(title) + '</strong>' : 'Busca de série';
        const seasonLine = season ? ' · temporada ' + season : '';
        const imdbBadge = renderImdbBadge(newest.search?.imdbId);
        return '<article class="event event-search-group">' +
          '<div class="event-head">' +
            '<div class="event-title-group"><span class="event-kind">' + events.length + ' chamadas agrupadas</span>' + imdbBadge + '</div>' +
            '<time class="muted">' + escapeHtml(formatDateTime(newest.timestamp)) + '</time>' +
          '</div>' +
          '<p>' + titleLine + escapeHtml(seasonLine + ' · ' + episodeLabel + ' · ' + uniqueReleases.length + ' torrent(s) único(s) nas respostas') + '</p>' +
          requester +
          '<details class="event-requests" data-event-detail-key="' + escapeHtml(group.id + ':requests') + '"><summary>Ver respostas individuais (' + events.length + ')</summary><ol>' + requestItems + '</ol></details>' +
          renderReleaseList(uniqueReleases, group.id + ':releases', uniqueReleases.length + ' torrent(s) únicos') +
        '</article>';
      }

      function renderRequesterDetails(requester, key) {
        if (!requester?.label) return '';
        return '<details class="event-requester-details" data-event-detail-key="' + escapeHtml(key) + '"><summary>Cliente: ' + escapeHtml(requester.label) + '</summary>' +
          (requester.userAgent ? '<p>User-Agent: ' + escapeHtml(requester.userAgent) + '</p>' : '') + '</details>';
      }

      function renderSearchBreakdown(event, eventId) {
        const sources = event.search?.sourceBreakdown;
        if (!Array.isArray(sources) || !sources.length) return '';
        const summary = sources.map(source => displaySourceLabel(source.source) + ' ' +
          (source.returnedCount || 0) + '/' + (source.candidateCount || 0)).join(' · ');
        const rows = sources.map(source => {
          const sourceName = escapeHtml(displaySourceLabel(source.source));
          const sourceCounts = (source.returnedCount || 0) + ' retornado(s) de ' + (source.candidateCount || 0) + ' candidato(s)';
          const providers = (Array.isArray(source.providers) ? source.providers : []).map(provider => {
            const status = provider.outcome || 'desconhecido';
            const counts = (provider.foundCount || 0) + ' encontrado(s), ' + (provider.returnedCount || 0) + ' retornado(s)';
            const duplicates = provider.duplicateCount ? ', ' + provider.duplicateCount + ' duplicado(s)' : '';
            const omitted = provider.omittedByLimit ? ', ' + provider.omittedByLimit + ' fora do limite' : '';
            return '<li><strong>' + escapeHtml(provider.name || provider.id || 'Provider') + ':</strong> ' +
              escapeHtml(status + ' · ' + counts + duplicates + omitted) + '</li>';
          }).join('');
          return '<li><strong>' + sourceName + ':</strong> ' + escapeHtml(sourceCounts) +
            (providers ? '<ul>' + providers + '</ul>' : '') + '</li>';
        }).join('');
        return '<details class="event-source-breakdown" data-event-detail-key="' + escapeHtml(eventId + ':sources') + '"><summary>Fontes: ' + escapeHtml(summary) + '</summary><ul>' + rows + '</ul></details>';
      }

      function renderReleaseList(releases, detailKey, label) {
        if (!releases.length) return '';
        const items = releases.map(release => {
          const details = escapeHtml(release.title || 'Sem título') +
            ' · ' + escapeHtml(displaySourceLabel(release.source || 'fonte desconhecida')) +
            ' · ' + escapeHtml(release.provider || 'provider desconhecido') +
            (release.infoHash ? ' · ' + escapeHtml(release.infoHash) : '');
          const copyButton = release.magnetUrl
            ? '<button class="copy-magnet" type="button" data-copy-magnet="' + escapeHtml(release.magnetUrl) + '">Copiar magnet</button>'
            : '';
          return '<li><div class="event-release-row"><span>' + details + '</span>' + copyButton + '</div></li>';
        }).join('');
        return '<details class="event-releases" data-event-detail-key="' + escapeHtml(detailKey || 'releases') + '"><summary>' + escapeHtml(label || (releases.length + ' torrent(s)')) + '</summary><ol>' + items + '</ol></details>';
      }

      function uniqueEventReleases(events) {
        const seen = new Set();
        const releases = [];
        for (const event of events) {
          for (const release of Array.isArray(event.releases) ? event.releases : []) {
            const key = release.infoHash
              ? String(release.infoHash).toLowerCase()
              : [release.title || '', release.provider || '', release.source || ''].join('|').toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            releases.push(release);
          }
        }
        return releases;
      }

      function displaySearchTitle(search = {}) {
        const title = String(search.title || (search.imdbId ? 'consulta IMDb' : 'Busca de série'))
          .replace(/\bS(?:eason)?\s*0*\d{1,2}(?:[ ._-]*E(?:P(?:ISODE)?)?0*\d{1,3})?\b/gi, ' ')
          .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
          .replace(/\b(?:19|20)\d{2}\b/g, ' ')
          .replace(/[._]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return title || 'Busca de série';
      }

      function formatEventCoordinate(search = {}) {
        const season = Number(search.season) || 0;
        const episode = Number(search.episode) || 0;
        if (!season && !episode) return '';
        return (season ? 'T' + String(season).padStart(2, '0') : '') +
          (episode ? 'E' + String(episode).padStart(2, '0') : '');
      }

      function createEventKey(event) {
        const search = event?.search || {};
        return [event?.kind || 'event', event?.timestamp || 'unknown-time', search.action || '', search.title || search.imdbId || '', search.season || '', search.episode || '', event?.requester?.ip || ''].join(':');
      }

    })();
  </script>`;
