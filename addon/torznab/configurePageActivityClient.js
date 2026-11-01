import { groupSearchEvents } from './searchEventGrouping.js';

export const CONFIGURE_PAGE_ACTIVITY_CLIENT_SCRIPT = `  <script>
    window.groupSearchEvents = ${groupSearchEvents.toString()};

    window.applySearchActivity = function(activity) {
      if (!activity) return;
      const days = Array.isArray(activity.days) ? activity.days : [];
      const today = document.getElementById('stat-search-today');
      const total = document.getElementById('stat-search-total');
      const failures = document.getElementById('stat-search-failures');
      const period = document.getElementById('activity-period');
      const note = document.getElementById('activity-history-note');
      const demoBadge = document.getElementById('activity-demo-badge');
      const grid = document.getElementById('search-activity-days');
      const months = document.getElementById('search-activity-months');
      const chart = document.querySelector('.activity-chart');
      const tooltip = document.getElementById('activity-tooltip');

      if (today) today.textContent = String(activity.todayCount ?? 0);
      if (total) total.textContent = String(activity.totalSearchCount ?? 0);
      if (failures) failures.textContent = String(activity.failedSearchCount ?? 0);
      if (demoBadge) demoBadge.hidden = activity.demoData !== true;
      if (period) period.textContent = activity.historyStartedAt
        ? 'Desde ' + formatActivityDate(activity.historyStartedAt, activity.timeZone)
        : 'Histórico da instância atual';
      if (note) note.textContent = activity.demoData === true
        ? 'Valores sintéticos para demonstração; podem incluir consultas reais anteriores.'
        : activity.totalSearchCount
          ? 'Histórico agregado de consultas desta instância.'
          : 'Nenhuma consulta registrada desde a inicialização desta instância.';
      if (!grid) return;
      if (!days.length) {
        grid.innerHTML = '';
        if (months) months.innerHTML = '';
        if (tooltip) tooltip.hidden = true;
        return;
      }

      const byDate = new Map(days.map(day => [day.date, day]));
      const finalDate = parseActivityDate(days[days.length - 1].date);
      const completeDays = Array.from({ length: 120 }, (_, index) => {
        const date = new Date(finalDate);
        date.setUTCDate(finalDate.getUTCDate() - 119 + index);
        const key = date.toISOString().slice(0, 10);
        return byDate.get(key) || {
          date: key,
          count: 0,
          successCount: 0,
          failureCount: 0,
          observed: false,
        };
      });

      if (tooltip) {
        tooltip.hidden = true;
        delete tooltip.dataset.visible;
      }
      const maximumCount = completeDays.reduce(
        (maximum, day) => Math.max(maximum, Math.max(0, Number(day.count) || 0)),
        0,
      );
      grid.innerHTML = completeDays.map(day => renderActivityDay(day, maximumCount)).join('');
      grid.setAttribute(
        'aria-label',
        'Atividade nos últimos 120 dias, com hoje na última célula. '
          + activity.totalSearchCount + ' consultas registradas nesta instância.',
      );
      if (months) months.innerHTML = renderActivityMonths(completeDays);
      bindActivityTooltip(grid, chart, tooltip);
    };

    function renderActivityDay(day, maximumCount) {
      const count = Math.max(0, Number(day.count) || 0);
      const observed = day.observed !== false;
      const dateLabel = formatActivityDayLabel(day.date);
      const label = observed
        ? dateLabel + ' · ' + count + ' consultas'
        : dateLabel + ' · Sem histórico';
      const level = getActivityLevel(count, maximumCount);
      return '<span class="activity-day" role="gridcell" tabindex="0" data-date="'
        + escapeActivityHtml(day.date)
        + '" data-count="' + count
        + '" data-observed="' + observed
        + '" data-level="' + level
        + '" aria-label="' + escapeActivityHtml(label) + '"></span>';
    }

    function renderActivityMonths(days) {
      const months = [];
      const seen = new Set();
      days.forEach((day, index) => {
        const date = parseActivityDate(day.date);
        const key = day.date.slice(0, 7);
        if (date.getUTCDate() !== 1) return;
        if (seen.has(key)) return;
        seen.add(key);
        months.push({
          column: Math.floor(index / 5) + 1,
          label: date.toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'short' }).replace('.', ''),
        });
      });
      return months.map((month, index) => {
        const endColumn = months[index + 1]?.column || 25;
        return '<span style="grid-column:' + month.column + ' / ' + endColumn + '">'
          + escapeActivityHtml(month.label) + '</span>';
      }).join('');
    }

    function bindActivityTooltip(grid, chart, tooltip) {
      if (!chart || !tooltip || grid.dataset.tooltipBound) return;
      grid.dataset.tooltipBound = 'true';
      let activeCell;
      const hide = () => {
        if (activeCell) activeCell.removeAttribute('aria-describedby');
        activeCell = undefined;
        tooltip.hidden = true;
        delete tooltip.dataset.visible;
      };
      const show = cell => {
        if (!cell) return;
        activeCell = cell;
        cell.setAttribute('aria-describedby', 'activity-tooltip');
        const date = document.createElement('span');
        date.className = 'activity-tooltip-date';
        const dateParts = String(cell.dataset.date || '').split('-');
        date.textContent = dateParts.length === 3
          ? dateParts[2] + '/' + dateParts[1] + '/' + dateParts[0]
          : 'Data indisponível';
        const count = document.createElement('strong');
        count.textContent = cell.dataset.observed === 'false'
          ? 'Sem histórico'
          : cell.dataset.count + (cell.dataset.count === '1' ? ' consulta' : ' consultas');
        tooltip.replaceChildren(date, count);
        tooltip.hidden = false;
        tooltip.dataset.visible = 'true';

        const cellBounds = cell.getBoundingClientRect();
        const chartBounds = chart.getBoundingClientRect();
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        const left = Math.max(6, Math.min(
          cellBounds.left - chartBounds.left + cellBounds.width / 2 - width / 2,
          chartBounds.width - width - 6,
        ));
        let top = cellBounds.top - chartBounds.top - height - 7;
        if (top < 0) top = cellBounds.bottom - chartBounds.top + 7;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      };
      const findCell = target => target?.closest?.('.activity-day');

      grid.addEventListener('pointerover', event => show(findCell(event.target)));
      grid.addEventListener('pointerout', event => {
        if (!findCell(event.relatedTarget)) hide();
      });
      grid.addEventListener('focusin', event => show(findCell(event.target)));
      grid.addEventListener('focusout', event => {
        if (!findCell(event.relatedTarget)) hide();
      });
    }

    function getActivityLevel(count, maximumCount) {
      if (count <= 0) return 0;
      if (maximumCount <= 7) {
        if (count === 1) return 1;
        if (count <= 3) return 2;
        if (count <= 7) return 3;
        return 4;
      }
      const relativeCount = count / maximumCount;
      if (relativeCount <= 0.25) return 1;
      if (relativeCount <= 0.45) return 2;
      if (relativeCount <= 0.7) return 3;
      return 4;
    }

    function parseActivityDate(value) {
      return new Date(String(value || '') + 'T12:00:00Z');
    }

    function formatActivityDayLabel(value) {
      return parseActivityDate(value)
        .toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
        .replace(/\./g, '');
    }

    function formatActivityDate(value, timeZone) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Histórico da instância atual';
      return date.toLocaleString('pt-BR', {
        timeZone: timeZone || 'America/Sao_Paulo',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function escapeActivityHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  </script>`;
