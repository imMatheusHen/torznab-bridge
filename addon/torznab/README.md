# Torznab Bridge Runtime

Este diretório contém o runtime atual do Torznab Bridge.

## Modos de indexador

- `TORZNAB_SOURCES=stremio,betor`
- `TORZNAB_SOURCES=database`
- fallback legado: `TORZNAB_SOURCE`

## Variáveis principais

- `TORZNAB_BASE_URL`
- `TORZNAB_CONFIGURATION`
- `TORZNAB_STREMIO_URL`
- `TORZNAB_BETOR_URL`
- `TORZNAB_API_KEY`
- `DATABASE_URI`

## Endpoints úteis

- `/api?t=caps`
- `/health`
- `/status`
- `/configure`

## Observação

O bridge adapta metadados de indexadores configurados; ele não implementa scraping próprio de todos os trackers.
