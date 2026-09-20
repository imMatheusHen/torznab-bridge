# EmbedTV: descoberta e resolução segura de HLS

Este guia descreve uma metodologia reproduzível para investigar páginas
EmbedTV, localizar uma origem HLS pública e decidir entre rewrite direto e
proxy adaptativo. Ele é aplicável a um servidor Linux ou a outro projeto Node;
não depende de um host específico.

O objetivo é diagnosticar o fluxo público normal. Este procedimento não é um
mecanismo para contornar CAPTCHA, Turnstile, DRM, autenticação, paywall ou
controles de acesso.

## 1. O problema real

Uma API de canais normalmente fornece metadados, não necessariamente o
manifesto que o player usa. A cadeia pode ser:

```text
API de catálogo
  → página/player do canal
  → JavaScript/HTML que apresenta uma ou mais origens
  → manifesto HLS (.m3u8, .txt ou MIME não óbvio)
  → master/media playlist
  → playlists filhas, chaves, maps e segmentos
```

Um backend que extrai a primeira URL `.m3u8`, usa somente um hash antigo de
CDN ou assume que todo 403 é uma falha externa pode escolher uma URL
intermediária, expirada ou genérica. O primeiro passo é observar a cadeia real.

## 2. Como a solução está organizada

No Torznab Bridge, o módulo está em `addon/torznab/iptv/embedtv/`:

| Responsabilidade | Arquivo |
|---|---|
| HTTP, timeout, retry e segurança de URLs | `client.js` |
| Catálogo, EPG e eventos | `catalog.js` |
| TTL, stale e deduplicação | `cache.js` |
| descoberta e escolha da origem | `resolver.js` |
| parsing/rewrite de manifestos | `hls.js` |
| serviço, modo direct/proxy e métricas | `service.js` |
| M3U e XMLTV | `format.js` |
| endpoints Express | `routes.js` |

As ferramentas de investigação ficam fora do runtime em:

- `tools/embedtv-probe.mjs`;
- `tools/embedtv-probe-http.mjs`;
- `tools/embedtv-probe-hls.mjs`.

Elas são executadas manualmente e não são importadas pelo servidor.

## 3. Executar o probe

O probe usa Node.js e APIs padrão, sem Flask e sem dependências adicionais:

```bash
node tools/embedtv-probe.mjs \
  --channels afazenda,ae,amc,bandsports,cartoonnetwork
```

Opções úteis incluem `--timeout-ms`, `--max-candidates`, `--allow-fewer`,
`--base-url` e `--legacy-path`. O resultado JSON inclui, por canal:

- página e URL final após redirects;
- markers de `startPlayer`, `data-stream`, `fetch`, XHR e `loadSource`;
- candidatos `.m3u8`, `.txt` e URLs apresentadas como `src`/`url`;
- método que resolveu, host mascarado e tempo;
- status, MIME, cookies somente por nome/presença e headers resumidos;
- validade `#EXTM3U`, master/media e referências absolutas/relativas;
- HEAD e matriz de headers;
- primeiro recurso filho ou segmento usando apenas `Range: bytes=0-1023`;
- conclusão provisória direct versus proxy.

O probe lê no máximo uma amostra limitada e cancela o corpo de segmentos. Não
deve ser usado para baixar ou arquivar streams completas.

## 4. API, página e HLS são camadas diferentes

Consulte a API de catálogo primeiro:

```text
GET https://embedtv.lat/api/channels
GET https://embedtv.lat/api/epg_all
GET https://embedtv.lat/api/events
```

O catálogo pode conter ID, nome, imagem, categorias e URL da página, mas o
manifesto precisa ser descoberto na página do canal. Analise HTML e scripts
públicos em busca de:

```text
startPlayer(...)
data-stream="..."
src = "..."
fetch(...)
XMLHttpRequest
hls.loadSource(...)
.m3u8
.txt
iframe/source
```

Não trate qualquer URL encontrada como resolvida. Uma origem só deve ser
considerada funcional depois de um GET limitado e validação do corpo.

## 5. Método legado e por que não depender dele

Uma implementação antiga usava:

```text
GET /24h_chaves
  → regex https://([a-f0-9]{20,}).s21-cloudfront-net.lat
  → https://<hash>.s21-cloudfront-net.lat/ss/<channel>.txt
```

Ela enviava User-Agent e Referer à página, e Origin/Referer ao manifesto. Esse
algoritmo é útil como hipótese de comparação, mas não é uma regra atual:
`/24h_chaves` retornou 404 durante a investigação e não forneceu hash. Hosts
s21 observados em tentativas antigas chegaram a responder 403 mesmo com
headers equivalentes.

O resolver atual deve preferir a origem legitimamente apresentada pela página
atual. Não fixe hash, subdomínio ou geração de CDN no código.

## 6. Challenge markers não provam que a página é inutilizável

Uma página pode conter simultaneamente:

```javascript
startPlayer(data.url)
// markers de token/challenge
var src = "https://<hash>.s23-cloudfront-net.lat/ss/afazenda.txt";
```

O marker indica que existe um fluxo dinâmico, mas não prova que a origem
estática pública precisa de Turnstile. A origem `.txt` deve ser selecionada se
ela for uma candidata não genérica e seu manifesto funcionar. Só retorne
`browser_challenge_required` quando nenhuma origem pública legítima permanecer.

Essa distinção evita o erro de descartar uma candidata `var src` apenas porque
a mesma página possui `startPlayer(data.url)`.

## 7. `.txt` pode ser um manifesto HLS

Extensão não é tipo de conteúdo. Um `.txt` pode retornar:

```text
Content-Type: application/vnd.apple.mpegurl

#EXTM3U
#EXT-X-TARGETDURATION:...
...
```

Reconheça HLS por MIME e pelo corpo (`#EXTM3U` ou `#EXT-X-*`). Preserve
UTF-8, trate `text/plain` que contenha HLS como HLS e responda ao cliente com
`application/vnd.apple.mpegurl`. Se o corpo for um ponteiro JSON/textual,
desembrulhe uma quantidade limitada de níveis e imponha um limite para evitar
loops.

## 8. Master, media e recursos internos

Classifique o manifesto:

- **master playlist**: contém variantes (`#EXT-X-STREAM-INF`) que apontam para
  outras playlists;
- **media playlist**: contém segmentos ou referências de mídia diretamente.

Para cada URL não-comentário e para atributos `URI="..."`, resolva URLs
relativas contra a URL do manifesto. Em master, teste uma variante; em media,
teste um único segmento. Também considere:

- `EXT-X-KEY` e `EXT-X-MAP`;
- segmentos `.ts`, `.m4s` ou extensões enganosas;
- redirects 301/302/307/308;
- host final diferente do host inicial;
- playlists que mudam de origem entre refreshes.

Não conclua sucesso apenas porque o manifesto principal retornou 200.

## 9. Teste controlado de headers

Use a mesma URL e compare uma variável por vez:

| Variante | Headers |
|---|---|
| A | nenhum |
| B | User-Agent |
| C | User-Agent + Referer |
| D | User-Agent + Referer + Origin |
| E | somente headers de navegador demonstrados como necessários |

Registre status, MIME, redirect, hostname final e se houve `Set-Cookie`. Não
copie indiscriminadamente todos os `Sec-Fetch-*` do Chrome. Se A já funciona,
não aumente o acoplamento sem motivo.

Teste GET e HEAD separadamente. Um CDN pode aceitar GET e rejeitar HEAD; o
runtime deve preferir GET para obter o corpo HLS. Um 403 persistente em todas as
variantes, inclusive GET, é evidência de outro problema: URL errada/expirada,
host intermediário, origem não pública ou controle de acesso upstream.

No cenário validado do Torznab Bridge, a origem s23 respondeu 200 sem headers
especiais e HEAD também respondeu 200. Isso não deve ser generalizado para
todo CDN: a matriz continua sendo necessária.

## 10. Cookies, tokens e URLs temporárias

Capture somente cookies públicos emitidos durante a resolução, em um jar
isolado por sessão/resolução. Registre nomes e presença, nunca valores.
Verifique se o domínio/path do cookie realmente cobre o host CDN; não envie
cookies de conta do usuário.

Inspecione parâmetros de `token`, `expires`, `exp`, `sig`, `signature`, `auth`,
`Policy`, `Signature` e `Key-Pair-Id`. Se a URL tiver validade curta:

1. descubra quando ela é gerada;
2. estime a validade sem imprimir o valor;
3. não mantenha a URL além da expiração;
4. prefira cachear a página/origem e regenerar a URL final;
5. invalide e resolva novamente após 401/403/404/410.

No fluxo s23 observado, o `.txt` público não exigiu token/cookie para o teste
de manifesto e segmento, mas o candidato dinâmico da página não foi tratado
como confiável só por existir.

## 11. Range e validação mínima de segmento

Use GET, não baixe o arquivo todo:

```bash
curl -sS --range 0-1023 -o /dev/null \
  -w '%{http_code} %{content_type} %{size_download}\n' \
  'https://host-validado.example/path/resource'
```

Quando possível, leia poucos bytes para identificar:

- sync byte `0x47` e padrões MPEG-TS;
- box `ftyp`/`moof` de fMP4;
- HTML de erro em vez de mídia.

HTTP 206 e bytes de mídia indicam que o recurso foi alcançado; não provam que
um player específico aceitará o MIME ou a extensão. O fluxo validado mostrou
segmentos `.js` com MIME `application/javascript` contendo MPEG-TS. Essa
peculiaridade deve ser monitorada, não corrigida com FFmpeg.

## 12. Decidir direct versus proxy

Use este fluxo:

```text
manifesto resolvido
  → testar uma referência interna com Range pequeno
  → 2xx/206 sem headers especiais?
       sim → rewrite para URL absoluta direta
       não → testar contexto de headers/cookie
              → ainda exige contexto que o player não envia?
                   sim → proxy adaptativo de manifesto/recursos
                   não → direct
```

Direct é preferível quando os segmentos são realmente públicos: reduz RAM,
CPU, conexões e banda do bridge. Reescreva referências relativas para
absolutas e mantenha o manifesto local estável; não substitua segmentos
públicos por proxy sem necessidade.

Proxy é válido para uma playlist filha, segmento, chave ou map que exija
Referer/Origin/cookie que o player não consegue enviar. Use streams Node,
backpressure, cancelamento quando o cliente fecha a conexão e limites de
timeout. Nunca transcodifique.

## 13. Segurança do proxy

O endpoint de recurso não deve aceitar uma URL arbitrária do usuário. Uma
implementação segura deve:

1. validar ID de canal;
2. aceitar apenas HTTPS sem usuário/senha;
3. rejeitar localhost, loopback, RFC1918, link-local, ULA e IPs privados;
4. registrar os hosts/origins derivados da resolução e dos manifests válidos;
5. permitir somente destinos registrados para aquele canal;
6. resolver recursos relativos contra a origem legítima;
7. limitar tamanho, redirects, níveis de manifesto e tempo;
8. ocultar query/token em logs.

Não adicione hosts a uma allowlist global só porque alguém os informou na query.
Um host novo precisa ser derivado de redirect/manifesto aceito na resolução do
canal.

## 14. Cache, retry e concorrência

Uma referência prática para o módulo é:

| Dado | TTL | Stale |
|---|---:|---:|
| channels | 5 min | 1 h |
| EPG | 15 min | 1 h |
| events | 60 s | 5 min |
| resolução | 60 s | 5 min |

Compartilhe a promise em andamento para o mesmo canal/chave. Em erro
temporário, stale pode manter catálogo/EPG disponível; não sirva uma URL de
stream claramente inválida por tempo indefinido. Em 401/403/404/410, invalide a
resolução e tente uma vez com a página/origem nova. Não encadeie retries
indefinidamente nem faça retry agressivo de segmentos.

## 15. Observabilidade útil

Logs de falha devem identificar sem segredos:

```text
[EmbedTV] channel=afazenda stage=manifest
hostname=<mascarado> status=403 redirect=false
content-type=... referer-host=... cookie-present=false
```

O status deve separar resolução, manifesto, proxy, refreshes, cache e modo
`direct`/`proxy`. `/health` deve permanecer barato; probes ativos pertencem a
`/status?probe=1` ou a uma execução manual do probe.

## 16. Fallbacks legítimos e limites

É aceitável tentar outra candidata pública encontrada na mesma página e
revalidar após mudança/erro. Não é aceitável:

- burlar CAPTCHA/Turnstile ou executar navegador permanente;
- explorar endpoints privados, autenticação ou DRM;
- reutilizar cookies alheios;
- inventar associação de evento a canal;
- usar hash s21 fixo como verdade atual;
- tratar `.txt` como erro antes de olhar o conteúdo;
- baixar stream completa para “testar”;
- instalar Flask, FFmpeg, systemd ou container auxiliar;
- transformar a rota HLS em open proxy.

## 17. Resultado observado no Torznab Bridge

Na coleta usada para validar a implementação, a API retornou aproximadamente
147 canais e 10 categorias. Foram testados `afazenda`, `ae`, `amc`,
`bandsports` e `cartoonnetwork`. Todos chegaram à origem `.txt` s23, manifesto
HLS 200 e primeiro segmento 206; a decisão foi arquitetura A (rewrite/direct).
O snapshot posterior de deploy exibiu 37 eventos, 43 associações e 4.598
programas EPG; esses números mudam com o upstream e não são contrato fixo.

O fato durável é o método: observar a página atual, validar o corpo HLS,
validar um recurso interno com amostra pequena e só então decidir direct ou
proxy.

## 18. Ferramenta portátil para terceiros

Uma versão Python não foi criada. Os `.mjs` usam apenas Node.js moderno,
`fetch`, `AbortController` e módulos padrão, já permitem selecionar canais,
redigir informações sensíveis e cobrem a comparação legada/atual. Duplicar a
implementação em Python agora criaria duas ferramentas para manter e não
melhoraria a investigação. Se no futuro houver demanda por um binário Python,
ele deve reutilizar esta metodologia, continuar sem dependências pesadas e
manter as mesmas restrições de Range, allowlist, privacidade e ausência de
bypass.
