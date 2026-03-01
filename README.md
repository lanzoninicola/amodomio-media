# A Modo Mio Media Uploader

Microservico para upload de imagens e videos com persistencia em volume de host (`/data`) e entrega publica via Nginx.

## Resumo rapido (o que cada servico faz)

Pense em dois blocos trabalhando juntos:

- `media-api` e a REST API para fazer upload de imagem ou video. Ele recebe imagem/video, valida tipo e tamanho, exige `x-api-key`, organiza os arquivos em `/data` e devolve a URL publica final.
- `media-nginx` e a vitrine publica desses arquivos. Ele nao faz upload; apenas serve o que ja esta salvo em `/data` no dominio `media.amodomio.com.br`.

Em outras palavras: a API grava, o Nginx entrega.

## Fluxo resumido

- cliente envia `POST /upload` para `media-api`;
- `media-api` valida e salva em `/data`;
- `media-nginx` so serve/publica esse arquivo no dominio `media.amodomio.com.br`.

## Deploy no Dokploy (passo a passo)

Importante: sao 2 servicos diferentes.

1. `media-api` (REST API de upload)
- esse servico usa este repositorio no GitHub
- e a REST API que recebe upload de imagem ou video
- endpoint publico: `media-api.amodomio.com.br`
- porta interna da app: `3001`

2. `media-nginx` (origin estatico)
- esse servico NAO usa este repositorio
- usar imagem Docker: `nginx:alpine`
- endpoint publico: `media.amodomio.com.br`
- porta interna do nginx: `80`

### 1) Configurar `media-api` no Dokploy

1. Criar servico `media-api`.
2. `Provider`: `GitHub`.
3. `Repository`: `amodomio-media-uploader`.
4. `Build Type`: `Dockerfile`.
5. Campos de build:
- `Docker File`: `Dockerfile`
- `Docker Context Path`: `.`
- `Docker Build Stage`: vazio
6. `Domains`:
- dominio: `media-api.amodomio.com.br`
- `Path`: `/`
- `Port`: `3001`
- HTTPS + LetsEncrypt
7. `Environment`:
- `UPLOAD_API_KEY` (obrigatoria)
- `MEDIA_BASE_URL=https://media.amodomio.com.br`
- opcionais: `TRUST_PROXY_HOPS`, `RATE_LIMIT_*`, `REQUEST_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, `KEEP_ALIVE_TIMEOUT_MS`
8. `Volumes / Mounts`:
- tipo: `Bind Mount`
- `Host Path`: `/home/ubuntu/media/data`
- `Mount Path`: `/data`
- modo: `RW`
9. Deploy e testar:
- `https://media-api.amodomio.com.br/health` -> `{ "ok": true }`

### 2) Configurar `media-nginx` no Dokploy

1. Criar servico `media-nginx`.
2. `Provider`: `Docker`.
3. Imagem: `nginx:alpine`.
4. `Domains`:
- dominio: `media.amodomio.com.br`
- `Path`: `/`
- `Port`: `80`
- HTTPS + LetsEncrypt
5. `Volumes / Mounts` (2 mounts):
- mount 1 (tipo `Bind Mount`):
  - `Host Path`: `/home/ubuntu/media/data`
  - `Mount Path`: `/data`
  - modo: `RO`
- mount 2 (tipo `Bind Mount`):
  - `Host Path`: `/home/ubuntu/media/nginx/default.conf`
  - `Mount Path`: `/etc/nginx/conf.d/default.conf`
  - modo: `RO`
6. Redeploy.
7. Testar:
- `https://media.amodomio.com.br/health` -> `ok`

### Erros comuns (que geram Bad Gateway)

- Configurar `media-nginx` com `Provider GitHub` apontando para este repo.
- Colocar dominio `media.amodomio.com.br` com porta `3001` (o correto e `80`).
- Esquecer de montar `/etc/nginx/conf.d/default.conf`.
- Usar `File Mount` inline quando queria montar arquivo do host. Para esse caso, usar `Bind Mount`.

## Variaveis de ambiente

- `UPLOAD_API_KEY` (obrigatoria): chave esperada no header `x-api-key`.
- `MEDIA_BASE_URL` (opcional): base publica para retorno da URL final. Default: `https://media.amodomio.com.br`.
- `PORT` (opcional): porta HTTP da API. Default: `3001`.
- `TRUST_PROXY_HOPS` (opcional): numero de proxies confiaveis para obter IP real. Default: `1`.
- `RATE_LIMIT_WINDOW_MS` (opcional): janela de rate limit em ms. Default: `60000`.
- `RATE_LIMIT_MAX` (opcional): maximo de requests por IP na janela (global). Default: `120`.
- `RATE_LIMIT_UPLOAD_MAX` (opcional): maximo de uploads por IP na janela. Default: `20`.
- `REQUEST_TIMEOUT_MS` (opcional): timeout de request para mitigar conexoes lentas. Default: `30000`.
- `HEADERS_TIMEOUT_MS` (opcional): timeout de headers HTTP. Default: `35000`.
- `KEEP_ALIVE_TIMEOUT_MS` (opcional): keep-alive timeout de conexoes. Default: `5000`.

## Endpoint

- `GET /health` -> `{ "ok": true }`
- `POST /upload?kind=image|video&folderPath=<pasta/subpasta>&assetKey=<nome-tecnico>` -> `{ ok, kind, folderPath, assetKey, menuItemId, slot, url }`

Exemplo de resposta da REST API:

```json
{
  "ok": true,
  "kind": "image",
  "folderPath": "campaigns/summer-2026",
  "assetKey": "hero",
  "menuItemId": "campaigns/summer-2026",
  "slot": "hero",
  "url": "https://media.amodomio.com.br/images/campaigns/summer-2026/hero.jpg"
}
```

Campo multipart esperado: `file`.

## Exemplo de upload com curl

```bash
curl -X POST "http://localhost:3001/upload?kind=image&folderPath=campaigns/summer-2026&assetKey=hero" \
  -H "x-api-key: SUA_CHAVE" \
  -F "file=@cover.jpg"
```

```bash
curl -X POST "http://localhost:3001/upload?kind=video&folderPath=reels/instagram&assetKey=mortazza-promo" \
  -H "x-api-key: SUA_CHAVE" \
  -F "file=@promo.mp4"
```

## Compatibilidade legado

Clientes antigos continuam funcionando:

- Se `folderPath` (ou `path`) nao for enviado, a API usa `menuItemId` como pasta alvo.
- Se `folderPath` (ou `path`) for enviado mas invalido, a API retorna `400` (nao cai no fallback legado).
- Se `assetKey` nao for enviado, a API usa `slot` como nome tecnico do arquivo.
- A resposta continua trazendo `{ ok, kind, ..., url }` e inclui tambem os campos legados `menuItemId` e `slot`.

Exemplo legado:

```bash
curl -X POST "http://localhost:3001/upload?kind=image&menuItemId=margherita&slot=cover" \
  -H "x-api-key: SUA_CHAVE" \
  -F "file=@cover.jpg"
```

## Testes de upload em producao (curl)

Defina sua chave:

```bash
export API_KEY="SUA_CHAVE"
```

Healthchecks:

```bash
curl https://media-api.amodomio.com.br/health
curl https://media.amodomio.com.br/health
```

Upload de imagem:

```bash
curl -X POST "https://media-api.amodomio.com.br/upload?kind=image&folderPath=campaigns/summer-2026&assetKey=hero" \
  -H "x-api-key: $API_KEY" \
  -F "file=@cover.jpg"
```

Upload de video mp4:

```bash
curl -X POST "https://media-api.amodomio.com.br/upload?kind=video&folderPath=reels/instagram&assetKey=mortazza-promo" \
  -H "x-api-key: $API_KEY" \
  -F "file=@promo.mp4"
```

Upload legado (regressao):

```bash
curl -X POST "https://media-api.amodomio.com.br/upload?kind=image&menuItemId=margherita&slot=cover" \
  -H "x-api-key: $API_KEY" \
  -F "file=@cover.jpg"
```

Teste sem API key (esperado `401`):

```bash
curl -i -X POST "https://media-api.amodomio.com.br/upload?kind=image&folderPath=campaigns/summer-2026&assetKey=hero" \
  -F "file=@cover.jpg"
```

Teste de mimetype invalido (esperado `415`):

```bash
curl -i -X POST "https://media-api.amodomio.com.br/upload?kind=image&folderPath=campaigns/summer-2026&assetKey=hero" \
  -H "x-api-key: $API_KEY" \
  -F "file=@arquivo.txt"
```

Teste de arquivo grande (esperado `413`):

```bash
curl -i -X POST "https://media-api.amodomio.com.br/upload?kind=image&folderPath=campaigns/summer-2026&assetKey=hero" \
  -H "x-api-key: $API_KEY" \
  -F "file=@imagem-maior-que-10mb.jpg"
```

Teste de path invalido (esperado `400`):

```bash
curl -i -X POST "https://media-api.amodomio.com.br/upload?kind=image&folderPath=../secret&assetKey=hero" \
  -H "x-api-key: $API_KEY" \
  -F "file=@cover.jpg"
```

## Estrutura de paths gerada

- Imagem: `/data/images/<folderPath>/<assetKey>.<ext>`
- Video: `/data/videos/<folderPath>/<assetKey>.<ext>`
- Temporario de upload: `/data/tmp`

URLs publicas retornadas seguem:

- `https://media.amodomio.com.br/images/<folderPath>/<assetKey>.<ext>`
- `https://media.amodomio.com.br/videos/<folderPath>/<assetKey>.<ext>`

Exemplos:

- Imagem: `https://media.amodomio.com.br/images/campaigns/summer-2026/hero.jpg`
- Video: `https://media.amodomio.com.br/videos/reels/instagram/mortazza-promo.mp4`
