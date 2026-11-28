# Auditoria pontual do stream EmbedTV

**Data:** 23 de outubro de 2026 (America/Sao_Paulo)
**Canal observado:** AE (`ae`)
**Escopo:** comparar a página pública, a origem HLS e o endpoint de playback do Torznab Bridge. Esta é uma amostra curta, não uma certificação de disponibilidade contínua.

## Resultado

- **Origem EmbedTV — FUNCIONANDO na janela observada:** após clicar em **Assistir** na página pública, o Chromium decodificou 622 frames em 20 segundos, chegou a `readyState=4` em 1280×720 e não registrou `waiting`, `stalled` nem erro de mídia. O buffer observado ao final foi de 13,4 s.
- **Bridge para AE — QUEBRADO nesta coleta:** `GET /iptv/embedtv/channel/ae/index.m3u8` retornou HTTP 502. O status interno registrou `invalid_channel_url` para um host terminado em `embedtv.cc`.
- **Causa confirmada:** o catálogo atual entrega páginas em `*.embedtv.cc`, mas o cliente ativo aceita somente `embedtv.lat` e seus subdomínios. A rejeição acontece antes de buscar a página e o manifesto.
- **Usuário ou stream alternativo:** não há evidência de que seja necessário outro usuário, cookie ou origem mais forte. As requisições HTTP da origem funcionaram sem cookies e sem headers especiais.

## Cadeia observada na origem

| Etapa | Resultado observado |
|---|---|
| Catálogo público | HTTP 200; 147 canais. A entrada `ae` aponta para uma página em `*.embedtv.cc`. |
| Página enviada pelo usuário | `https://ww0.embedtv.cc/ae` respondeu HTTP 200. A página oferece um botão **Assistir** e controles de reprodução. |
| Origem do player | Uma URL em `*.s25-cloudfront-net.lat`, com caminho semelhante a `/stream/<id-redigido>/error.txt`, respondeu HTTP 200. O corpo é HLS apesar do sufixo `.txt`. |
| Manifesto | `application/vnd.apple.mpegurl`, `#EXTM3U`, media playlist com seis referências absolutas. |
| Primeiro segmento | URL terminada em `.js`, MIME `application/javascript`, mas a amostra começa com o sync byte MPEG-TS `0x47`. `Range: bytes=0-1023` foi aceito com HTTP 206. |
| Reprodução no navegador | Depois da ação normal no botão **Assistir**, o player carregou manifesto e segmentos diretamente do CDN. Na janela de 20 s: 622 frames, zero eventos `waiting`/`stalled` e nenhum erro de mídia. Duas requisições foram canceladas pelo navegador (`ERR_ABORTED`); não houve erro de mídia associado, mas a causa do cancelamento não foi determinada. |

Três amostras HTTP separadas por oito segundos repetiram a sequência página 200 → manifesto 200 → segmento 206. O tempo mediano foi aproximadamente 289 ms para a página, 362 ms para o manifesto e 262 ms para a amostra do segmento. Esses tempos são desta máquina e desta janela; não representam outras redes nem o cliente IPTV do usuário.

A página também apresenta controles chamados **Modo desempenho — 4 segmentos** e **Modo equilibrado — 2 segmentos**. Eles não foram comparados nesta auditoria; são um bom ponto para um teste A/B posterior, sem assumir que expliquem a diferença observada.

## Evidência no Bridge

O container ativo usa `embedtv.lat` como base efetiva. Em `addon/torznab/iptv/embedtv/client.js`, `isEmbedTvPageUrl()` aceita o hostname base e subdomínios dele. Como `*.embedtv.cc` não pertence a `embedtv.lat`, `fetchChannelPage()` lança `invalid_channel_url` antes de fazer a requisição HTTP.

O endpoint público de manifesto de AE respondeu 502. Ao mesmo tempo, `/iptv/embedtv/status` reportava `online`, porque `service.probe()` verifica catálogo, EPG e eventos, mas não resolve uma página de canal nem busca seu manifesto ou segmento. Portanto, o estado atual pode mostrar **Online** enquanto o playback está falhando.

## Interpretação e recomendações

1. **Corrigir a compatibilidade de domínio do resolver.** Permitir explicitamente `embedtv.lat` e `embedtv.cc` (domínios exatos e subdomínios necessários), mantendo HTTPS, rejeição de userinfo e as validações de destino seguro. Não aceitar qualquer domínio público retornado pelo catálogo.
2. **Atualizar a página do canal após uma rejeição de domínio conhecida.** Fazer uma atualização limitada do catálogo/resolução para absorver mudanças de host, sem repetir tentativas indefinidamente nem seguir destinos fora da lista permitida.
3. **Separar saúde do catálogo e saúde do playback.** Manter `/health` leve, mas expor no status uma condição distinta para resolução do canal e validação do manifesto/primeiro segmento. “Catálogo online” não deve ser apresentado como prova de streaming.
4. **Medir o caminho após corrigir o resolver.** A página toca os segmentos diretamente do CDN. O Bridge atual força proxy quando encontra recursos com extensões fora da lista aceita pelo FFmpeg; `.js` está fora dessa lista. Isso acrescentaria um salto pelo Bridge e pode afetar latência/buffer, mas esta auditoria não conseguiu medir esse caminho porque a validação de domínio bloqueia antes dele.
5. **Comparar os modos da origem e as opções do cliente, separadamente.** No navegador, testar os modos apresentados pelo player EmbedTV; depois da correção do Bridge, medir o playback no cliente IPTV real com o mesmo canal e janela. Registrar tempo até o primeiro frame, buffer, `waiting`/`stalled`, erros e taxa de segmentos. Não presumir que os modos da página se transferem para o Bridge, nem remover o proxy automaticamente: ele pode ser necessário para clientes que rejeitam segmentos com extensão `.js`.

## Limites desta coleta

- Um canal e uma janela de reprodução de 20 segundos; não é um soak longo.
- A reprodução direta foi validada em Chromium headless após clicar no controle normal do site. A estabilidade no aparelho/cliente IPTV do usuário não foi testada.
- O Bridge não chegou ao HLS de AE, então a qualidade do proxy e o comportamento do cliente através do Bridge permanecem **NÃO VALIDADOS**.
- Não foram enviados cookies de conta, não houve tentativa de contornar desafio e não foram baixados streams completos. Hashes de caminho foram redigidos.
- Nenhum código de runtime foi alterado e nenhum container foi reconstruído ou reiniciado.

## Reprodução básica

```bash
node tools/embedtv-probe.mjs \
  --base-url https://embedtv.lat \
  --channels ae \
  --allow-fewer \
  --max-candidates 2

curl -i http://127.0.0.1:9699/iptv/embedtv/channel/ae/index.m3u8
```

O probe do repositório limita a leitura do manifesto e usa `Range` para amostrar o segmento. A reprodução no site requer a ação normal de clicar em **Assistir**; um GET da página sozinho não prova que o player começou.
