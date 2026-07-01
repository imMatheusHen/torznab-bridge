# Torznab Bridge Agent Notes

## Architecture

- The Torznab runtime lives in `addon/torznab`; `addon/torznab/index.js` exposes the HTTP API.
- Source adapters are `addon/torznab/betor.js`, `stremio.js`, and `repository.js`.
- Runtime configuration is persisted outside the image at `/config/torznab-ui.json`.
- The production image is `ghcr.io/immatheushen/torznab-bridge:latest` and the CasaOS compose file is `/var/lib/casaos/apps/torznab-bridge/docker-compose.yml`.
- Persistent host data is `/DATA/AppData/torznab-bridge/config`.

## Commands

- Run Node commands from `addon` with Node.js 22 or the current image toolchain.
- Start locally: `npm run start:torznab`.
- Build: `docker build -f addon/Dockerfile.torznab -t torznab-bridge:test addon`.
- Production rebuild: `docker compose -f /var/lib/casaos/apps/torznab-bridge/docker-compose.yml pull && docker compose -f /var/lib/casaos/apps/torznab-bridge/docker-compose.yml up -d --force-recreate`.

## Validation

- Run `node --check` for every changed JavaScript file.
- Validate targeted source/cache behavior before building the image.
- After deployment, check `docker compose ps`, bounded logs, `/health`, `/status`, and a real `/api` query.

## Constraints

- Preserve support for both `TORZNAB_SOURCES` and the legacy `TORZNAB_SOURCE` fallback.
- Never commit runtime configuration, API keys, tokens, or credentials.
- Keep Torznab XML output compatible with Prowlarr and Arr clients.
