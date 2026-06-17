# Instalação com Docker Compose

Use o arquivo [compose.yml](/home/matheus/torrentio-torznab-repo/compose.yml).

## Passos

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

## Variáveis mais importantes

- `TORZNAB_BASE_URL=http://192.168.1.100:9699`
- `TORZNAB_SOURCES=stremio,betor`
- `TORZNAB_STREMIO_URL=https://torrentio.strem.fun/brazuca`
- `TORZNAB_BETOR_URL=https://catalogo.betor.top`
- `TORZNAB_RUNTIME_CONFIG_PATH=/config/torznab-ui.json`

## Endereços após subir

- Web UI: `http://192.168.1.100:9699/`
- Caps: `http://192.168.1.100:9699/api?t=caps`
- Status: `http://192.168.1.100:9699/status`
