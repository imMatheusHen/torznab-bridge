export const CONFIGURE_PAGE_ACTIVITY_STYLES = `<style>
    .search-activity {
      --activity-cell: 15px;
      --activity-gap: 3px;
      --activity-month-height: 18px;
      margin-top: 14px;
      padding-top: 2px;
    }
    .activity-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .activity-heading h2 { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; font-size: .9rem; font-weight: 630; }
    .activity-heading h2 span { color: var(--muted); font-size: .71rem; font-weight: 500; }
    .activity-heading h2 .activity-demo-badge { padding: 3px 7px; border: 1px solid rgba(245, 190, 91, .32); border-radius: 999px; color: #f3c66f; background: rgba(245, 190, 91, .09); font-size: .61rem; font-weight: 600; }
    .activity-heading h2 .activity-demo-badge[hidden] { display: none; }
    .activity-heading p { margin-top: 3px; color: var(--subtle); font-size: .7rem; }
    .activity-totals { display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: .72rem; }
    .activity-totals strong { margin-right: 3px; color: var(--text); font-family: var(--font-mono); font-weight: 620; font-variant-numeric: tabular-nums; }
    .activity-chart { position: relative; min-width: 0; }
    .activity-grid-wrap { width: max-content; max-width: 100%; overflow: visible; }
    .activity-months {
      display: grid;
      grid-template-columns: repeat(24, var(--activity-cell));
      column-gap: var(--activity-gap);
      width: max-content;
      height: var(--activity-month-height);
      color: var(--muted);
      font-size: .64rem;
      line-height: 1;
    }
    .activity-months span { min-width: 0; overflow: visible; white-space: nowrap; }
    .activity-days {
      display: grid;
      grid-auto-flow: column;
      grid-template-columns: repeat(24, var(--activity-cell));
      grid-template-rows: repeat(5, var(--activity-cell));
      gap: var(--activity-gap);
      width: max-content;
    }
    .activity-day {
      display: block;
      width: var(--activity-cell);
      height: var(--activity-cell);
      border: 1px solid #2b3740;
      border-radius: 3px;
      background: #192128;
      transition: border-color 100ms ease, background-color 100ms ease, transform 100ms ease;
    }
    .activity-day[data-observed="true"][data-level="0"] { border-color: #394650; background: #25313a; }
    .activity-day[data-observed="true"][data-level="1"] { border-color: #24563f; background: #214b37; }
    .activity-day[data-observed="true"][data-level="2"] { border-color: #23764c; background: #21714a; }
    .activity-day[data-observed="true"][data-level="3"] { border-color: #39aa68; background: #31975d; }
    .activity-day[data-observed="true"][data-level="4"] { border-color: #6be39a; background: #43bd75; }
    .activity-day:hover, .activity-day:focus-visible {
      z-index: 2;
      border-color: #a5f3c5;
      outline: none;
      transform: scale(1.12);
    }
    .activity-tooltip {
      position: absolute;
      z-index: 5;
      display: grid;
      gap: 2px;
      min-width: 116px;
      padding: 7px 10px;
      border: 1px solid #34414a;
      border-radius: 9px;
      background: #11191f;
      box-shadow: 0 7px 20px rgba(0, 0, 0, .28);
      pointer-events: none;
      transition: opacity 100ms ease, transform 100ms ease;
    }
    .activity-tooltip[hidden] { display: none; }
    .activity-tooltip:not([data-visible="true"]) { opacity: 0; transform: translateY(3px); }
    .activity-tooltip-date { color: var(--muted); font-size: .68rem; white-space: nowrap; }
    .activity-tooltip strong { color: var(--text); font-size: .76rem; font-weight: 620; }
    .activity-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 9px 0 0; }
    .activity-footer > p { color: var(--subtle); font-size: .68rem; }
    .activity-legend { display: flex; flex-wrap: wrap; gap: 10px; color: var(--muted); font-size: .63rem; }
    .activity-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .activity-legend i { width: 9px; height: 9px; border: 1px solid #2b3740; border-radius: 2px; background: #192128; }
    .activity-legend i[data-level="0"] { border-color: #394650; background: #25313a; }
    .activity-legend i[data-level="4"] { border-color: #6be39a; background: #43bd75; }
    .activity-legend i[data-level="unknown"] { border-color: #2b3740; background: #192128; }
    @media (max-width: 760px) {
      .activity-heading { align-items: flex-start; flex-direction: column; gap: 7px; }
      .activity-totals { gap: 10px; }
      .activity-footer { align-items: flex-start; flex-direction: column; gap: 7px; }
    }
    @media (max-width: 480px) { .search-activity { --activity-cell: 12px; --activity-gap: 2px; --activity-month-height: 18px; } }
    @media (max-width: 420px) { .search-activity { --activity-cell: 11px; } }
    @media (max-width: 360px) { .search-activity { --activity-cell: 10px; --activity-gap: 1px; } }
  </style>`;
