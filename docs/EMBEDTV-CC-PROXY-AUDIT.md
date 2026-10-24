# EmbedTV `.cc`: auditoria de saúde e caminho HLS

**Data da medição:** 24/10/2026
**Escopo:** catálogo EmbedTV, resolução HLS e proxy de segmentos no Torznab Bridge.
**Resultado:** implementação validada em containers de laboratório isolados; não certifica todos os canais nem substitui a validação do cliente final.

## O que mudou

- A API padrão agora parte de `https://embedtv.cc`. Páginas `.cc` e `.lat` continuam aceitas; o segundo domínio é mantido como legado.
- A validação aceita o domínio raiz e subdomínios com fronteira DNS correta. Hosts parecidos, HTTP, credenciais na URL e páginas fora dessas raízes são rejeitados.
- Hosts de CDN continuam dinâmicos: o proxy só libera origens descobertas na cadeia de uma página EmbedTV e de manifestos HLS válidos. Não foi criada uma allowlist ampla de CDNs.
- O probe ativo consulta catálogo, EPG e eventos e testa um canal representativo: resolve a página, valida o manifesto, segue até a playlist de mídia e lê até 384 bytes do primeiro segmento com `Range`.
- O segmento é reconhecido pelos bytes, inclusive quando extensão/MIME dizem `.js`/`application/javascript` ou `.png`/`image/png`. Um recurso HTML, JSON, PNG real ou manifesto vazio não pode produzir estado online.
- Uma falha no manifesto ou segmento muda o estado IPTV para `Indisponível`; a WebUI já associa esse estado ao badge vermelho. `/health` e o healthcheck Docker continuam sendo liveness leve.
- O proxy encaminha um único `Range`, devolve status e `Content-Range` da origem e cancela a origem somente quando o cliente encerra a resposta antes do fim.
- O serviço mantém em cache por 30 s a escolha direct/proxy por canal para evitar repetir a sonda de recurso em cada manifesto quando a decisão pode ser reutilizada.

## Medição do proxy

A ferramenta reproduzível `tools/embedtv-proxy-benchmark.mjs` descobre o primeiro segmento por um Bridge iniciado com `TORZNAB_EMBEDTV_HLS_PROXY=1`, solicita a mesma faixa diretamente à CDN e pelo Bridge e lê no máximo a quantidade configurada. Não baixa segmentos completos.

Execução usada no container de laboratório, para comparar origem e proxy no mesmo namespace de rede:

```bash
docker cp tools/embedtv-proxy-benchmark.mjs embedtv-cc-lab-proxy:/tmp/embedtv-proxy-benchmark.mjs
docker exec embedtv-cc-lab-proxy node /tmp/embedtv-proxy-benchmark.mjs \
  --bridge-url http://127.0.0.1:9699 \
  --channel-id ae \
  --runs 4 \
  --range-bytes 65536
```

| Caminho | Respostas | Faixa por amostra | Mediana até headers | Mediana até 64 KiB |
| --- | ---: | ---: | ---: | ---: |
| CDN direta | 4/4 HTTP 206 | 65.536 bytes | 51,2 ms | 64,4 ms |
| Bridge proxy | 4/4 HTTP 206 | 65.536 bytes | 39,5 ms | 44,6 ms |

Em todas as amostras os 65.536 bytes e o hash do corpo coincidiram entre origem e proxy. O recurso medido tinha extensão `.png`, MIME `image/png` e bytes MPEG-TS. Uma segunda amostra de canal apresentou o mesmo comportamento. O prefixo do segmento ativo também mostrou sync byte MPEG-TS nos offsets 0, 188 e 376.

O ensaio não encontrou o `.js` exato nas páginas amostradas hoje; esses segmentos foram `.png`. Há teste de regressão com MIME `application/javascript` e os mesmos bytes MPEG-TS. A comparação rodou no mesmo namespace Docker e usou a mesma URL de origem, mas ainda inclui estado de conexões, cache/edge da CDN e o custo variável da rede; ela não isola apenas custo de CPU do proxy. O resultado mostra que, nesta janela, o caminho proxy não adicionou latência observável e preservou os bytes/Range; uma diferença de alguns milissegundos não deve ser generalizada para outros horários, provedores ou clientes.

## Política 2/4 segmentos do player público

O controle do site ajusta o ponto live do Hls.js (`liveSyncDurationCount`), que é uma política do player. Na sessão curta de 20 s, o modo 2 segmentos iniciou em 1.605 ms e manteve 3,6 s de buffer. O modo 4 terminou com 34,9 s de buffer, mas a troca recriou o media source e deslocou a posição de reprodução; a contagem de frames desse segundo trecho não permite comparar fluidez. O P2P permaneceu habilitado e variou entre as amostras.

O Bridge entrega playlists a clientes que controlam o player (Jellyfin/FFmpeg e outros) e não controla `liveSyncDurationCount`. `EXT-X-START` só sugere um ponto inicial e não reproduz o ajuste contínuo do Hls.js ([RFC 8216, seção EXT-X-START](https://www.rfc-editor.org/rfc/rfc8216#section-4.3.5.2); [API Hls.js](https://github.com/video-dev/hls.js/blob/master/docs/API.md)). Não foi aplicado um deslocamento fixo de quatro segmentos, pois a amostra mostra aumento de atraso/buffer sem evidência de maior estabilidade.

## Limites da validação

- O probe escolhe um canal válido por execução. `Online` significa que esse canal passou manifesto e primeiro segmento, além das fontes auxiliares; não significa que os 147 canais foram testados.
- A medição usa faixas pequenas e não representa uma sessão longa, todos os clientes, P2P, variações da CDN ou qualidade de decodificação.
- Os containers de laboratório usaram configuração temporária somente leitura e portas locais próprias. O container de produção, o arquivo persistente de configuração e o checkout de Web UI em andamento não fizeram parte do teste.
