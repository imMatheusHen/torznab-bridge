export const CONFIGURE_PAGE_INDEXER_STYLES = `<style>
    .indexer-search-query { min-width: 0; }
    .search-query-output { display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; color: var(--text); font-size: 0.9rem; font-weight: 700; }
    .search-query-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search-query-year { flex: 0 0 auto; color: var(--muted); font-size: 0.76rem; font-weight: 500; }
    .imdb-badge {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 3px;
      padding: 2px 6px;
      border: 1px solid rgba(245, 197, 24, 0.48);
      border-radius: 4px;
      background: rgba(245, 197, 24, 0.13);
      color: #f5c518;
      font-size: 0.66rem;
      font-weight: 800;
      letter-spacing: 0.025em;
      line-height: 1.35;
      text-decoration: none;
      transition: background 140ms ease, border-color 140ms ease;
    }
    .imdb-badge::after { content: '↗'; font-size: 0.7rem; }
    .imdb-badge:hover, .imdb-badge:focus-visible { border-color: #f5c518; background: rgba(245, 197, 24, 0.24); text-decoration: none; }
    .imdb-badge:focus-visible { outline: 2px solid #f5c518; outline-offset: 2px; }
    .provider-extra { padding: 0; overflow: hidden; }
    .provider-extra > summary { list-style: none; cursor: pointer; }
    .provider-extra > summary::-webkit-details-marker { display: none; }
    .source-extra-trigger { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
    .filter-icon { width: 17px; height: 17px; flex: 0 0 auto; fill: none; stroke: var(--accent); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
    .source-extra-copy { display: grid; gap: 2px; min-width: 0; }
    .source-extra-copy strong { color: var(--text); font-size: 0.84rem; }
    .source-extra-copy small { color: var(--muted); font-size: 0.74rem; }
    .source-extra-chevron { width: 16px; height: 16px; flex: 0 0 auto; margin-left: auto; fill: none; stroke: var(--muted); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; transition: transform 200ms ease; }
    .provider-extra[open] .source-extra-chevron { transform: rotate(180deg); }
    .source-extra-expand { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 220ms ease; }
    .provider-extra[open] .source-extra-expand { grid-template-rows: 1fr; }
    .source-extra-inner { min-height: 0; overflow: hidden; padding: 0 12px; }
    .provider-extra[open] .source-extra-inner { padding: 0 12px 12px; }
    .source-extra-inner > p { margin: 0 0 6px; font-size: 0.8rem; }
    .source-extra-inner .provider-grid { margin-top: 0; }
    .event-title-group { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 7px; min-width: 0; }
</style>`;
