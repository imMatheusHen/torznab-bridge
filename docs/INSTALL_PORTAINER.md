# Instalação com Portainer

Use o arquivo [deploy/portainer/docker-compose.yml](/home/matheus/torrentio-torznab-repo/deploy/portainer/docker-compose.yml).

## Passos

1. Abra o Portainer.
2. Vá em `Stacks`.
3. Clique em `Add stack`.
4. Use o nome `torznab-bridge`.
5. Cole o conteúdo do compose do Portainer.
6. Ajuste `TORZNAB_BASE_URL` para o endereço público do servidor.
7. Clique em `Deploy the stack`.

## Mapeamentos importantes

- porta `9699/tcp`
- volume `/config`
- variáveis `TORZNAB_BASE_URL`, `TORZNAB_SOURCES`, `TORZNAB_STREMIO_URL` e `TORZNAB_BETOR_URL`

## Endereços após subir

- Web UI: `http://IP_DO_SERVIDOR:9699/`
- Caps: `http://IP_DO_SERVIDOR:9699/api?t=caps`
- Status: `http://IP_DO_SERVIDOR:9699/status`
