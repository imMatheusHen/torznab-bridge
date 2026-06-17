# Prowlarr

Configure o bridge como `Generic Torznab`:

- nome: `Torznab Bridge`
- base URL: `http://192.168.1.100:9699`
- API path: `/api`
- API key: vazia ou a configurada em `TORZNAB_API_KEY`

## Observações sobre os indexadores

- o BeTor é integrado nativamente ao bridge e não precisa mais de definição Cardigann separada
- falhas temporárias do BeTor, como `503` e `521`, passam a ser tratadas como indisponibilidade temporária
- quando o BeTor falha, o bridge continua entregando resultados do Stremio ao Prowlarr

## Catálogo público do BeTor

- [catalogo.betor.top](https://catalogo.betor.top)
