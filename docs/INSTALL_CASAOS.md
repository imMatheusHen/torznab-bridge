# Instalação com CasaOS

Use o arquivo [deploy/casaos/docker-compose.yml](/home/matheus/torrentio-torznab-repo/deploy/casaos/docker-compose.yml).

## Passos

1. Abra o CasaOS.
2. Clique em `+`.
3. Escolha `Adicionar um aplicativo personalizado`.
4. Selecione `Importar`.
5. Cole o conteúdo do compose de CasaOS.
6. Ajuste pelo menos `TORZNAB_BASE_URL` e o bind de `/config`.
7. Clique em `Instalar`.

## Recomendações

- mantenha `TORZNAB_SOURCES=betor,stremio`
- use um diretório persistente, por exemplo `/DATA/AppData/torznab-bridge/config`
- confirme que a URL pública aponta para o IP e porta reais do servidor

## Endereços após instalar

- Web UI: `http://IP_DO_SERVIDOR:9699/`
- Caps: `http://IP_DO_SERVIDOR:9699/api?t=caps`
- Status: `http://IP_DO_SERVIDOR:9699/status`
