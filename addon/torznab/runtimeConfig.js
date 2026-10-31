import fs from 'fs';
import path from 'path';
import { parseConfiguration } from '../lib/configuration.js';
import { Providers } from '../lib/filter.js';
import { getDefaultSources, normalizeSources, SOURCE_OPTIONS } from './source.js';

const CONFIG_PATH = process.env.TORZNAB_RUNTIME_CONFIG_PATH || '/config/torznab-ui.json';
const DEFAULT_CONFIGURATION = process.env.TORZNAB_CONFIGURATION || 'brazuca';
const DEFAULT_IPTV_ENABLED = process.env.TORZNAB_IPTV_ENABLED !== '0';
const DEFAULT_DETOUR_ENABLED = process.env.TORZNAB_DETOUR_ENABLED === '1';
const DEFAULT_DETOUR_PROVIDERS = ['hdrtorrent'];
const VALID_DETOUR_PROVIDERS = new Set(['hdrtorrent', 'comando-torrents']);
const VALID_PROVIDER_KEYS = new Set(Providers.options.map(provider => provider.key.toLowerCase()));
const VALID_SOURCE_KEYS = new Set(SOURCE_OPTIONS.map(source => source.key.toLowerCase()));

export function getRuntimeConfigPath() {
  return CONFIG_PATH;
}

export function getAdapterConfiguration() {
  const baseConfig = parseConfiguration(DEFAULT_CONFIGURATION) || {};
  const runtimeConfig = readRuntimeConfig();
  return {
    ...baseConfig,
    providers: runtimeConfig.configured ? runtimeConfig.providers : baseConfig.providers,
    sources: runtimeConfig.configured ? runtimeConfig.sources : getDefaultSources(),
    iptv: runtimeConfig.configured ? runtimeConfig.iptv : { enabled: DEFAULT_IPTV_ENABLED },
    detour: runtimeConfig.configured ? runtimeConfig.detour : { enabled: DEFAULT_DETOUR_ENABLED, providers: DEFAULT_DETOUR_PROVIDERS },
  };
}

export function getDefaultRuntimeConfiguration() {
  const baseConfig = parseConfiguration(DEFAULT_CONFIGURATION) || {};
  const detourEnabled = DEFAULT_DETOUR_ENABLED;
  const sources = [...getDefaultSources()];
  if (detourEnabled && !sources.includes('detour')) {
    sources.push('detour');
  }
  return {
    providers: normalizeProviders(baseConfig.providers),
    sources,
    iptvEnabled: DEFAULT_IPTV_ENABLED,
    detourEnabled,
    detourProviders: [...DEFAULT_DETOUR_PROVIDERS],
  };
}

export function getSavedProviders() {
  return readRuntimeConfig().providers || [];
}

export function getSavedSources() {
  return readRuntimeConfig().sources || [];
}

export function getSavedDetour() {
  return readRuntimeConfig().detour || { enabled: DEFAULT_DETOUR_ENABLED, providers: DEFAULT_DETOUR_PROVIDERS };
}

export function saveRuntimeConfig({ providers = [], sources = [], iptv, detour } = {}) {
  const normalizedProviders = normalizeProviders(providers);
  const normalizedSources = normalizeRuntimeSources(sources);
  const normalizedIptv = normalizeIptv(iptv);
  const normalizedDetour = normalizeDetour(detour);
  const payload = {
    providers: normalizedProviders,
    sources: normalizedSources,
    iptv: normalizedIptv,
    detour: normalizedDetour,
    savedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function readRuntimeConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      configured: true,
      providers: normalizeProviders(parsed.providers),
      sources: normalizeRuntimeSources(parsed.sources),
      iptv: normalizeIptv(parsed.iptv),
      detour: normalizeDetour(parsed.detour),
    };
  } catch (error) {
    console.error('Failed to read runtime config', error);
    return {};
  }
}

function normalizeProviders(providers) {
  if (!Array.isArray(providers)) {
    return [];
  }

  return Array.from(new Set(
      providers
          .map(provider => `${provider || ''}`.trim().toLowerCase())
          .filter(provider => VALID_PROVIDER_KEYS.has(provider)),
  ));
}

function normalizeRuntimeSources(sources) {
  return normalizeSources(sources)
      .filter(source => VALID_SOURCE_KEYS.has(source));
}

function normalizeIptv(value) {
  if (typeof value === 'boolean') {
    return { enabled: value };
  }
  if (!value || typeof value !== 'object') {
    return { enabled: DEFAULT_IPTV_ENABLED };
  }
  return { enabled: value.enabled !== false };
}

function normalizeDetour(value) {
  if (typeof value === 'boolean') {
    return { enabled: value, providers: DEFAULT_DETOUR_PROVIDERS };
  }
  if (!value || typeof value !== 'object') {
    return { enabled: DEFAULT_DETOUR_ENABLED, providers: DEFAULT_DETOUR_PROVIDERS };
  }
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_DETOUR_ENABLED;
  const rawProviders = Array.isArray(value.providers)
    ? value.providers
    : (typeof value.providers === 'string' ? [value.providers] : DEFAULT_DETOUR_PROVIDERS);
  const providers = Array.from(new Set(
    rawProviders
      .map(p => `${p || ''}`.trim().toLowerCase())
      .filter(p => VALID_DETOUR_PROVIDERS.has(p)),
  ));
  return {
    enabled,
    providers,
  };
}
