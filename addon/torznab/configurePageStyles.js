export const CONFIGURE_PAGE_BASE_STYLES = `  <style>
    :root {
      color-scheme: dark;
      --bg: #090d11;
      --surface: #0e141a;
      --surface-raised: #131b22;
      --surface-hover: #182129;
      --line: #27313a;
      --line-soft: #202830;
      --text: #e6edf3;
      --muted: #9aa7b3;
      --subtle: #75818c;
      --accent: #42c99a;
      --accent-soft: rgba(66, 201, 154, .12);
      --blue: #6cb6ff;
      --warn: #e3b341;
      --danger: #f47067;
      --radius: 12px;
      --font-ui: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html { background: var(--bg); scroll-behavior: smooth; }
    body {
      min-width: 320px;
      min-height: 100vh;
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-ui);
      font-size: 14px;
      line-height: 1.45;
      text-rendering: optimizeLegibility;
    }
    a { color: var(--blue); text-decoration: none; }
    a:hover { color: #a5d1ff; text-decoration: underline; }
    a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 3px;
    }
    code { color: #c9d7e2; font-family: var(--font-mono); font-size: .88em; overflow-wrap: anywhere; }
    .wrap { width: min(1420px, calc(100% - 40px)); margin: 24px auto 40px; display: grid; gap: 18px; }
    .hero, .panel { min-width: 0; border: 1px solid var(--line-soft); border-radius: var(--radius); background: var(--surface); }
    .hero { padding: 20px 22px 16px; }
    .hero-topline, .brand-lockup, .brand-title-row, .panel-heading, .actions, .panel-footer { display: flex; align-items: center; }
    .hero-topline { justify-content: space-between; gap: 18px; }
    .brand-lockup { min-width: 0; gap: 13px; }
    .source-icon, .metric-icon {
      display: inline-grid;
      flex: 0 0 auto;
      place-items: center;
      color: var(--accent);
      background: var(--accent-soft);
    }
    .brand-copy { min-width: 0; }
    .brand-title-row { flex-wrap: wrap; gap: 9px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(1.45rem, 2vw, 1.9rem); font-weight: 680; letter-spacing: -.035em; line-height: 1.18; }
    .brand-link { color: var(--text); }
    .brand-link:hover { color: #fff; text-decoration: none; }
    .version-tag {
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: .68rem;
      font-weight: 550;
      line-height: 1.4;
    }
    .metric-icon svg, .source-icon svg, .btn-verify svg, .source-details summary svg, .event-empty svg { width: 18px; height: 18px; }
    button { min-height: 34px; border: 1px solid transparent; border-radius: 8px; padding: 7px 11px; font: inherit; font-size: .82rem; font-weight: 590; cursor: pointer; transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease; }
    button:hover:not(:disabled) { transform: translateY(-1px); }
    button:disabled { cursor: wait; opacity: .58; }
    .btn-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-color: var(--line); background: var(--surface-raised); color: var(--text); }
    .btn-secondary:hover:not(:disabled) { background: var(--surface-hover); border-color: #3a4651; }
    .btn-primary { background: var(--accent); color: #062c21; font-weight: 700; }
    .btn-primary:hover:not(:disabled) { background: #5bd8aa; }
    .btn-verify { flex: 0 0 auto; min-height: 36px; }
    .hero-status { margin-top: 12px; color: var(--accent); font-size: .82rem; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 18px; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); }
    .stat { display: flex; min-width: 0; align-items: center; gap: 10px; padding: 12px 14px; border-right: 1px solid var(--line-soft); }
    .stat:last-child { border-right: 0; }
    .metric-icon { width: 28px; height: 28px; border-radius: 8px; color: var(--muted); background: var(--surface-raised); }
    .metric-icon svg { width: 16px; height: 16px; }
    .metric-status-icon i { width: 8px; height: 8px; border: 1.5px solid var(--subtle); border-radius: 50%; }
    .stat-copy { display: grid; min-width: 0; gap: 1px; }
    .stat-copy strong { font-family: var(--font-mono); font-size: 1rem; font-weight: 620; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .stat-copy > span { color: var(--muted); font-size: .75rem; }
    .stat-copy small { color: var(--subtle); font-size: .67rem; }
    [data-overview-health][data-status="online"] .metric-status-icon i { border-color: var(--accent); background: var(--accent); }
    [data-overview-health][data-status="partial"] .metric-status-icon i,
    [data-overview-health][data-status="unstable"] .metric-status-icon i,
    [data-overview-health][data-status="degraded"] .metric-status-icon i { border-color: var(--warn); background: var(--warn); }
    [data-overview-health][data-status="unavailable"] .metric-status-icon i { border-color: var(--danger); background: var(--danger); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(270px, 310px); align-items: start; gap: 18px; }
    .panel { padding: 18px 20px; }
    .panel-heading { justify-content: space-between; gap: 14px; margin-bottom: 13px; }
    .panel-heading > div:first-child { min-width: 0; }
    h2 { font-size: 1rem; font-weight: 640; letter-spacing: -.015em; }
    .eyebrow { margin-bottom: 3px; color: var(--accent); font-size: .64rem; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
    .section-copy { margin-top: 3px; color: var(--muted); font-size: .78rem; }
    .actions { justify-content: flex-end; flex-wrap: wrap; gap: 7px; }
    .actions button { white-space: nowrap; }
    .config-save-status { min-height: 1em; color: var(--subtle); font-size: .68rem; }
    .config-save-status[data-state="saving"] { color: var(--muted); }
    .config-save-status[data-state="saved"] { color: var(--accent); }
    .config-save-status[data-state="error"] { color: var(--danger); }
    .endpoint-meta { margin: 2px 0 7px; color: var(--muted); font-size: .74rem; }
    .endpoint-meta a { margin-left: 4px; }
    .indexer-grid { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
    .indexer-card { min-width: 0; padding: 14px 0; border-top: 1px solid var(--line-soft); }
    .indexer-card:last-child { border-bottom: 1px solid var(--line-soft); }
    .indexer-main-row { display: grid; grid-template-columns: minmax(160px, 1.1fr) minmax(125px, .85fr) minmax(250px, 1.6fr) 32px; align-items: center; gap: 12px; }
    .source-identity { display: grid; grid-template-columns: 30px 30px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; }
    .source-toggle { position: relative; display: block; width: 30px; height: 19px; cursor: pointer; }
    .source-toggle input { position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    .source-switch { position: absolute; inset: 1px 0; display: block; border: 1px solid #4b5661; border-radius: 999px; background: #242d35; transition: background-color 140ms ease, border-color 140ms ease; }
    .source-switch > span { position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: #aab4bd; transition: transform 140ms ease, background-color 140ms ease; }
    .source-toggle input:checked + .source-switch { border-color: var(--accent); background: #174b3c; }
    .source-toggle input:checked + .source-switch > span { transform: translateX(11px); background: #7ce0b7; }
    .source-toggle input:focus-visible + .source-switch { outline: 2px solid var(--blue); outline-offset: 3px; }
    .source-icon { width: 28px; height: 28px; border: 1px solid var(--line-soft); border-radius: 8px; color: var(--muted); background: var(--surface-raised); }
    .source-icon svg { width: 16px; height: 16px; }
    .source-copy { display: grid; min-width: 0; gap: 1px; }
    .indexer-name { overflow: hidden; color: var(--text); font-size: .91rem; font-weight: 640; text-overflow: ellipsis; white-space: nowrap; }
    .indexer-description { overflow: hidden; color: var(--muted); font-size: .69rem; text-overflow: ellipsis; white-space: nowrap; }
    .indexer-operational { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 7px; }
    .health-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--subtle); }
    .indexer-operational[data-status="online"] .health-dot { background: var(--accent); }
    .indexer-operational[data-status="unstable"] .health-dot,
    .indexer-operational[data-status="partial"] .health-dot { background: var(--warn); }
    .indexer-operational[data-status="unavailable"] .health-dot { background: var(--danger); }
    .status-badge { display: inline-flex; min-width: 0; align-items: center; gap: 5px; padding: 3px 0; border: 0; border-radius: 0; color: var(--muted); font-size: .72rem; font-weight: 610; white-space: nowrap; }
    .status-online { color: var(--accent); }
    .status-unstable, .status-partial { color: var(--warn); }
    .status-unavailable { color: var(--danger); }
    .status-unknown, .status-disabled { color: var(--muted); }
    .configuration-state { color: var(--subtle); font-size: .65rem; white-space: nowrap; }
    .source-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .source-metric { display: grid; min-width: 0; gap: 2px; }
    .source-metric strong { overflow: hidden; color: var(--text); font-family: var(--font-mono); font-size: .8rem; font-weight: 580; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
    .source-metric small { overflow: hidden; color: var(--subtle); font-size: .64rem; text-overflow: ellipsis; white-space: nowrap; }
    .source-details { justify-self: end; }
    .source-details[open] { grid-column: 1 / -1; justify-self: stretch; }
    .source-details summary { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid transparent; border-radius: 7px; color: var(--muted); cursor: pointer; list-style: none; }
    .source-details summary::-webkit-details-marker { display: none; }
    .source-details summary:hover { border-color: var(--line); background: var(--surface-raised); color: var(--text); }
    .source-details summary svg { width: 17px; height: 17px; transition: transform 140ms ease; }
    .source-details[open] summary svg { transform: rotate(180deg); }
    .source-detail-grid { display: grid; min-width: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 14px; padding: 12px 0 2px 38px; }
    .source-detail-grid > div { display: grid; min-width: 0; gap: 2px; }
    .source-detail-grid span { color: var(--subtle); font-size: .65rem; }
    .source-detail-grid strong { overflow: hidden; color: var(--muted); font-size: .75rem; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }
    .source-detail-grid > p { grid-column: 1 / -1; color: var(--muted); font-size: .72rem; }
    .source-extra { min-width: 0; margin: 12px 0 0 38px; }
    .provider-extra { overflow: hidden; border-top: 1px solid var(--line-soft); }
    .provider-extra > summary { list-style: none; cursor: pointer; }
    .provider-extra > summary::-webkit-details-marker { display: none; }
    .source-extra-trigger { display: flex; min-height: 38px; align-items: center; gap: 9px; padding: 6px 0; }
    .filter-icon { width: 16px; height: 16px; flex: 0 0 auto; fill: none; stroke: var(--accent); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
    .source-extra-copy { display: grid; gap: 1px; }
    .source-extra-copy strong { color: var(--text); font-size: .77rem; font-weight: 590; }
    .source-extra-copy small { color: var(--muted); font-size: .66rem; }
    .source-extra-chevron { width: 16px; height: 16px; flex: 0 0 auto; margin-left: auto; fill: none; stroke: var(--muted); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; transition: transform 140ms ease; }
    .provider-extra[open] .source-extra-chevron { transform: rotate(180deg); }
    .source-extra-expand { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 180ms ease; }
    .provider-extra[open] .source-extra-expand { grid-template-rows: 1fr; }
    .source-extra-inner { min-height: 0; overflow: hidden; padding: 0; }
    .provider-extra[open] .source-extra-inner { padding: 0 0 10px; }
    .source-extra-inner > p { margin: 0 0 5px; color: var(--muted); font-size: .7rem; }
    .provider-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 3px 9px; margin-top: 5px; }
    .provider-pill { display: flex; min-width: 0; min-height: 32px; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 6px; color: var(--muted); cursor: pointer; user-select: none; }
    .provider-pill:hover, .provider-pill.active { color: var(--text); background: var(--surface-raised); }
    .provider-pill input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
    .provider-pill span:not(.flag) { overflow: hidden; font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
    .flag { color: var(--subtle); font-size: .65rem; }
    .module-divider { display: flex; align-items: center; gap: 12px; margin: 22px 0 12px; color: var(--subtle); font-size: .64rem; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; }
    .module-divider::before, .module-divider::after { height: 1px; flex: 1; background: var(--line-soft); content: ''; }
    .panel-footer { justify-content: space-between; flex-wrap: wrap; gap: 8px 14px; margin-top: 13px; color: var(--subtle); font-size: .68rem; }
    .events-panel { position: sticky; top: 16px; }
    .events-panel .panel-heading { margin-bottom: 7px; }
    .events { display: grid; }
    .event-empty { display: grid; justify-items: start; gap: 6px; padding: 13px 2px; color: var(--muted); }
    .event-empty svg { margin-bottom: 2px; color: var(--subtle); }
    .event-empty strong { color: var(--text); font-size: .78rem; font-weight: 590; }
    .event-empty span { color: var(--subtle); font-size: .7rem; }
    .event-error strong { color: var(--danger); }
    .event { min-width: 0; padding: 12px 0; border-top: 1px solid var(--line-soft); }
    .event-level-error { padding-left: 9px; border-left: 2px solid var(--danger); }
    .event-level-warn { padding-left: 9px; border-left: 2px solid var(--warn); }
    .event-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 9px; margin-bottom: 5px; }
    .event-title-group { display: inline-flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 6px; }
    .event-kind { color: var(--muted); font-size: .65rem; font-weight: 620; text-transform: uppercase; letter-spacing: .055em; }
    .event time { flex: 0 0 auto; font-size: .64rem; }
    .event > p { color: var(--text); font-size: .75rem; overflow-wrap: anywhere; }
    .event-requester-details { margin-top: 5px; color: var(--muted); font-size: .66rem; }
    .event-requester-details summary { width: max-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .event-requester-details p { margin-top: 4px; color: var(--subtle); font-size: .62rem; overflow-wrap: anywhere; }
    .event-search-group { padding-left: 9px; border-left: 2px solid var(--accent); }
    .event-requests, .event-source-breakdown { margin-top: 7px; color: var(--muted); font-size: .67rem; }
    .event-requests summary, .event-source-breakdown summary { cursor: pointer; }
    .event-requests > ol, .event-source-breakdown > ul { display: grid; gap: 7px; margin: 6px 0 0; padding-left: 17px; }
    .event-request-item { padding: 5px 0; border-top: 1px solid var(--line-soft); }
    .event-request-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .event-request-head strong { color: var(--text); font-size: .66rem; font-weight: 600; }
    .event-request-item > p, .event-source-breakdown li { margin-top: 3px; color: var(--subtle); font-size: .64rem; overflow-wrap: anywhere; }
    .event-source-breakdown ul { margin: 4px 0 0; padding-left: 15px; }
    .event-releases { margin-top: 8px; color: var(--muted); font-size: .7rem; }
    .event-releases summary { cursor: pointer; }
    .event-releases ol { margin: 6px 0 0; padding-left: 18px; }
    .event-releases li { margin: 7px 0; }
    .event-release-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .event-release-row > span { min-width: 0; overflow-wrap: anywhere; }
    .copy-magnet { flex: 0 0 auto; min-height: 27px; padding: 4px 7px; border-color: var(--line); background: var(--surface-raised); color: var(--text); font-size: .65rem; }
    .imdb-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; border: 1px solid rgba(227,179,65,.45); border-radius: 4px; color: var(--warn); font-size: .61rem; font-weight: 760; }
    .imdb-badge::after { content: '↗'; font-size: .63rem; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; } }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: minmax(0, 1fr); }
      .events-panel { position: static; }
      .events { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; }
    }
    @media (max-width: 760px) {
      .wrap { width: min(100% - 24px, 680px); margin: 12px auto 26px; gap: 12px; }
      .hero { padding: 15px 15px 13px; }
      .panel { padding: 15px; }
      .hero-topline { align-items: flex-start; }
      .brand-lockup { gap: 0; }
      .btn-verify { min-height: 32px; padding: 6px 8px; font-size: .72rem; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 13px; }
      .stat { padding: 9px 8px; }
      .stat:nth-child(2) { border-right: 0; }
      .stat:nth-child(-n+2) { border-bottom: 1px solid var(--line-soft); }
      .activity-heading { align-items: flex-start; flex-direction: column; gap: 7px; }
      .activity-totals { gap: 10px; }
      .activity-footer { align-items: flex-start; flex-direction: column; margin-left: 0; }
      .panel-heading { align-items: flex-start; flex-direction: column; }
      .actions { justify-content: flex-start; }
      .indexer-main-row { grid-template-columns: minmax(0, 1fr) auto; gap: 10px 8px; }
      .source-identity { grid-column: 1; grid-row: 1; }
      .indexer-operational { grid-column: 2; grid-row: 1; justify-content: flex-end; }
      .source-metrics { grid-column: 1 / -1; grid-row: 2; padding: 8px 0; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); }
      .source-details { grid-column: 1 / -1; grid-row: 3; justify-self: end; }
      .source-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 6px 0 2px; }
      .source-extra { margin-left: 0; }
      .events { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 480px) {
      .wrap { width: calc(100% - 16px); margin-top: 8px; }
      .hero { padding: 13px 12px 11px; }
      .brand-title-row { gap: 6px; }
      h1 { font-size: 1.3rem; }
      .version-tag { padding: 2px 5px; font-size: .61rem; }
      .btn-verify { width: 34px; min-width: 34px; padding: 0; font-size: 0; }
      .btn-verify svg { width: 17px; height: 17px; }
      .stat { gap: 7px; }
      .metric-icon { width: 24px; height: 24px; }
      .stat-copy strong { font-size: .88rem; }
      .stat-copy > span { font-size: .67rem; }
      .stat-copy small { font-size: .6rem; }
      .activity-totals { gap: 8px; font-size: .66rem; }
      .activity-legend { gap: 8px; font-size: .61rem; }
      .panel { padding: 13px 12px; }
      .actions { width: 100%; }
      .actions button { flex: 1 1 auto; font-size: .69rem; padding-inline: 7px; }
      .indexer-card { padding: 12px 0; }
      .source-identity { grid-template-columns: 26px 27px minmax(0, 1fr); gap: 6px; }
      .source-toggle { width: 26px; }
      .source-toggle input:checked + .source-switch > span { transform: translateX(9px); }
      .source-icon { width: 25px; height: 25px; }
      .indexer-operational { gap: 5px; }
      .configuration-state { display: none; }
      .source-metric strong { font-size: .73rem; }
      .source-metric small { font-size: .6rem; }
      .event-release-row { flex-direction: column; }
    }
  </style>`;
