# Torznab Bridge

`Torznab Bridge` converte metadados e links magnet de fontes configuradas para uma API compatível com Torznab.

O projeto não faz scraping próprio do zero. Ele atua como adaptador entre fontes já existentes, como:

- `Stremio` com catálogo Torrentio/Torrentio Brazuca
- `BeTor`
- um banco compatível com o schema `torrents/files` do Torrentio

## Status

- licença raiz: `Apache-2.0`
- avisos de terceiros preservados em [THIRD_PARTY_NOTICES.md](/home/matheus/torrentio-torznab-repo/THIRD_PARTY_NOTICES.md)
- base upstream registrada: `TheBeastLT/torrentio-scraper@e99fedb`
- imagem pública: `ghcr.io/immatheushen/torznab-bridge:latest`

## Como funciona

1. O bridge consulta um ou mais indexadores habilitados.
2. Normaliza os resultados em um modelo comum.
3. Filtra os providers Torrentio configurados.
4. Expõe `/api` em formato Torznab para Prowlarr, Sonarr e Radarr.

## Indexadores suportados

- `betor`: consulta `catalogo.betor.top` e converte os itens publicados.
- `stremio`: consulta um addon Torrentio remoto ou local.
- `database`: lê um PostgreSQL com tabelas `torrents` e `files`.

## Recursos atuais

- saúde separada por indexador em `/health` e `/status`
- falhas temporárias do BeTor não derrubam o bridge nem bloqueiam resultados do Stremio
- Web UI com status dos indexadores e histórico dos 10 eventos mais recentes
- configuração persistida em `torznab-ui.json`

## Início rápido

```bash
cp .env.example .env
docker compose up -d
```

Depois abra:

- Web UI: `http://192.168.1.100:9699/`
- Caps: `http://192.168.1.100:9699/api?t=caps`
- Status: `http://192.168.1.100:9699/status`

## Estrutura

- [addon/torznab](/home/matheus/torrentio-torznab-repo/addon/torznab): runtime principal do bridge
- [compose.yml](/home/matheus/torrentio-torznab-repo/compose.yml): stack principal para Docker Compose
- [deploy](/home/matheus/torrentio-torznab-repo/deploy): arquivos prontos para CasaOS, Portainer e Compose
- [docs](/home/matheus/torrentio-torznab-repo/docs): instalação e integração

## Documentação

- [INSTALL_DOCKER.md](/home/matheus/torrentio-torznab-repo/docs/INSTALL_DOCKER.md)
- [INSTALL_CASAOS.md](/home/matheus/torrentio-torznab-repo/docs/INSTALL_CASAOS.md)
- [INSTALL_PORTAINER.md](/home/matheus/torrentio-torznab-repo/docs/INSTALL_PORTAINER.md)
- [PROWLARR.md](/home/matheus/torrentio-torznab-repo/docs/PROWLARR.md)

## Aviso legal

Este projeto só adapta e reexpõe metadados de fontes configuradas pelo operador. O operador é responsável por validar licenças, termos de uso e conformidade das fontes conectadas.
