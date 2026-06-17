export const SOURCE_DATABASE = 'database';
export const SOURCE_STREMIO = 'stremio';
export const SOURCE_BETOR = 'betor';

export const SOURCE_OPTIONS = [
  {
    key: SOURCE_BETOR,
    label: 'BeTor',
    description: 'Consulta o catálogo público do BeTor e converte os itens para Torznab.',
  },
  {
    key: SOURCE_STREMIO,
    label: 'Stremio',
    description: 'Consulta os streams do addon Torrentio/Torrentio Brazuca.',
  },
  {
    key: SOURCE_DATABASE,
    label: 'Database',
    description: 'Usa tabelas torrents/files compatíveis com o schema do Torrentio.',
  },
];

const VALID_SOURCE_KEYS = new Set(SOURCE_OPTIONS.map(source => source.key));

export function getDefaultSources() {
  const configuredSources = normalizeSources(process.env.TORZNAB_SOURCES);
  if (configuredSources.length) {
    return configuredSources;
  }

  const legacySource = `${process.env.TORZNAB_SOURCE || ''}`.trim().toLowerCase();
  if (VALID_SOURCE_KEYS.has(legacySource)) {
    return [legacySource];
  }

  if (process.env.DATABASE_URI) {
    return [SOURCE_DATABASE];
  }

  return [SOURCE_STREMIO];
}

export function getSourceMode() {
  return getDefaultSources()[0];
}

export function normalizeSources(rawSources) {
  if (Array.isArray(rawSources)) {
    return dedupeSources(rawSources);
  }

  if (typeof rawSources !== 'string') {
    return [];
  }

  return dedupeSources(rawSources.split(','));
}

export function isDatabaseSource() {
  return getSourceMode() === SOURCE_DATABASE;
}

function dedupeSources(values) {
  return Array.from(new Set(
      values
          .map(value => `${value || ''}`.trim().toLowerCase())
          .filter(value => VALID_SOURCE_KEYS.has(value)),
  ));
}
