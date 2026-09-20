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
- `TORZNAB_IPTV_ENABLED=0` para desabilitar o EmbedTV por padrão
- `TORZNAB_EMBEDTV_BASE_URL` para apontar a uma origem compatível em testes
- `TORZNAB_EMBEDTV_HLS_PROXY=1` para forçar o proxy de manifesto/segmentos HLS
- `DATABASE_URI`

## Endpoints úteis

- `/api?t=caps`
- `/health`
- `/status`
- `/configure`
- `/iptv/embedtv/playlist.m3u`
- `/iptv/embedtv/epg.xml`
- `/iptv/embedtv/events`
- `/iptv/embedtv/status?probe=1`

## IPTV / EmbedTV

A seção `IPTV / EmbedTV` da configuração permite habilitar ou desabilitar o
módulo. Para usar em um player IPTV, informe a playlist
`http://IP_DO_SERVIDOR:9699/iptv/embedtv/playlist.m3u` e o EPG
`http://IP_DO_SERVIDOR:9699/iptv/embedtv/epg.xml`. O bridge resolve as páginas
dinâmicas e os manifestos HLS sem transcodificar vídeo; quando o CDN aceita
acesso direto, os segmentos permanecem fora do servidor.

## Observação

O bridge adapta metadados de indexadores configurados; ele não implementa scraping próprio de todos os trackers.

Para a metodologia reproduzível de investigação e resolução HLS do EmbedTV,
consulte [../../docs/EMBEDTV-STREAM-RESOLUTION.md](../../docs/EMBEDTV-STREAM-RESOLUTION.md).
