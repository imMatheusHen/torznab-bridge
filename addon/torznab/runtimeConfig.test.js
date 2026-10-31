import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'torznab-runtime-config-'));
process.env.TORZNAB_RUNTIME_CONFIG_PATH = path.join(configDirectory, 'torznab-ui.json');
process.env.TORZNAB_CONFIGURATION = 'brazuca';

const { getAdapterConfiguration, getDefaultRuntimeConfiguration, saveRuntimeConfig } = await import('./runtimeConfig.js');
const { renderConfigurePage } = await import('./configurePage.js');

test('preserves an explicitly empty provider and source selection', () => {
  saveRuntimeConfig({ providers: [], sources: [] });

  const configuration = getAdapterConfiguration();
  assert.deepEqual(configuration.providers, []);
  assert.deepEqual(configuration.sources, []);
});

test('normalizes and persists selected providers and sources', () => {
  saveRuntimeConfig({ providers: [' Comando ', 'COMANDO', 'unknown'], sources: ['STREMIO'] });

  const configuration = getAdapterConfiguration();
  assert.deepEqual(configuration.providers, ['comando']);
  assert.deepEqual(configuration.sources, ['stremio']);
});

test('persists the IPTV enablement flag alongside the existing configuration', () => {
  saveRuntimeConfig({ providers: [], sources: [], iptv: { enabled: false } });

  const configuration = getAdapterConfiguration();
  assert.deepEqual(configuration.iptv, { enabled: false });
});

test('preserves an explicitly empty Scraper provider selection', () => {
  saveRuntimeConfig({
    providers: [],
    sources: ['detour'],
    detour: { enabled: true, providers: [] },
  });

  assert.deepEqual(getAdapterConfiguration().detour, { enabled: true, providers: [] });
});

test('provides the configured defaults for the reset control', () => {
  const defaults = getDefaultRuntimeConfiguration();

  assert.ok(defaults.providers.length > 0);
  assert.deepEqual(defaults.sources, ['betor', 'stremio']);
  assert.equal(defaults.iptvEnabled, true);
  assert.deepEqual(defaults.detourProviders, ['hdrtorrent']);
});

test('preserves hidden source selections during autosave and reset', () => {
  const currentSelection = renderConfigurePage({
    selectedSources: ['database'],
    defaultConfiguration: { providers: [], sources: ['database'], iptvEnabled: true, detourEnabled: false, detourProviders: [] },
  });
  assert.match(currentSelection, /id="unlisted-source-selections" hidden[\s\S]*name="sources" value="database" checked/);
  assert.doesNotMatch(currentSelection, /data-source-key="database"/);

  const resetSelection = renderConfigurePage({
    selectedSources: ['betor'],
    defaultConfiguration: { providers: [], sources: ['database'], iptvEnabled: true, detourEnabled: false, detourProviders: [] },
  });
  assert.match(resetSelection, /id="unlisted-source-selections" hidden[\s\S]*name="sources" value="database"(?! checked)/);
});

test('renders BeTor, Torrentio and Scraper once and keeps their controls together', () => {
  const page = renderConfigurePage({
    selectedSources: ['betor', 'stremio', 'detour'],
    detourConfig: { enabled: true, providers: ['hdrtorrent'] },
  });
  const betor = page.indexOf('data-source-key="betor"');
  const streaming = page.indexOf('data-source-key="stremio"');
  const scraper = page.indexOf('data-source-key="detour"');
  const iptv = page.indexOf('IPTV / EmbedTV');

  assert.ok(betor >= 0 && betor < streaming && streaming < scraper && scraper < iptv);
  assert.equal((page.match(/data-source-key="detour"/g) || []).length, 1);
  assert.doesNotMatch(page, /data-source-key="database"/);
  assert.match(page.slice(streaming, scraper), /Providers Torrentio/);
  assert.match(page.slice(scraper, iptv), /Provedores do Scraper/);
  assert.match(page, /id=\"stat-search-today\">0<\/strong> hoje/);
  assert.match(page, /Atividade de consultas <span>120 dias<\/span>/);
  assert.match(page, /Copiar magnet/);
  assert.doesNotMatch(page, /Consultas hoje|stat-search-24h|cada quadrado = 1 dia|O histórico é mantido/);
  const stats = page.match(/<div class=\"stats\">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.doesNotMatch(stats, /stat-alerts/);
  const activityStart = page.indexOf('class=\"search-activity\"');
  const activityEnd = page.indexOf('</section>', activityStart);
  assert.match(page.slice(activityStart, activityEnd), /id=\"search-activity-days\"/);
  assert.match(page.slice(activityStart, activityEnd), /role=\"grid\"/);
  const indexerGrid = page.match(/\.indexer-grid \{([^}]+)\}/)?.[1] || '';
  assert.match(indexerGrid, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(page, /@media \(max-width: 1100px\)/);
  assert.match(page, /grid-template-columns: repeat\(24, var\(--activity-cell\)\)/);
  assert.match(page, /grid-template-rows: repeat\(5, var\(--activity-cell\)\)/);
  assert.match(page, /id="config-reset"/);
  assert.doesNotMatch(page, /Salvar configuração|Selecionar providers|Limpar providers/);
  assert.doesNotMatch(page, /brand-mark|Busca e integra metadados para seus indexadores/);
  assert.match(page, /data-default-config=/);
  assert.match(page, /data-detour-probe=\"hdrtorrent\"/);
  assert.match(page, /target=\"_blank\" rel=\"noopener noreferrer\"/);
  const ids = Array.from(page.matchAll(/\bid=\"([^\"]+)\"/g), match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const clientScript = page.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(clientScript);
  assert.doesNotThrow(() => new Function(clientScript[1]));
});
