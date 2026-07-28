# Painel de Leads (Next + React)

Versão em Next.js/React do painel de leads, com a **planilha do Google como banco**
(via Google Sheets API) e **multi-tenant**: um único deploy serve vários clientes,
cada um no seu endereço `/<slug>` com senha própria.

Fluxo mantido do painel original: **Meta / Google Ads → planilha → painel em cards**
(WhatsApp, status do funil, anotações, busca e filtros).

## Estrutura

```
app/
  page.tsx                 landing
  [slug]/page.tsx          painel de um cliente (server) -> <Painel/>
  admin/page.tsx           tela da agência: cadastro de clientes -> <Admin/>
  api/
    login/route.ts         POST: valida senha do tenant, cria cookie de sessão
    logout/route.ts        POST: encerra sessão
    leads/route.ts         GET: lê os leads do tenant logado
    leads/[id]/route.ts    PATCH: grava status/anotação (+ devolve a conversão)
    webhook/[slug]/route.ts POST: recebe leads (Google Ads nativo / Meta / JSON livre)
    meta/route.ts          webhook de leadgen do Meta
    whatsapp/route.ts      webhook do WhatsApp Cloud API (Click-to-WhatsApp)
    admin/...              login e CRUD de clientes (protegido por ADMIN_SENHA)
components/
  Painel.tsx               a interface (client) - filtros, pills, grade, auto-refresh
  LeadCard.tsx             o card de um lead
  Admin.tsx                a tela de cadastro de clientes
lib/
  google.ts                cliente Sheets API (service account)
  sheets.ts                leitura/gravação + webhook (porta do Codigo.gs)
  tenants.ts               quem é cada cliente -> qual planilha (+ CRUD do admin)
  auth.ts                  sessão por cookie assinado (HMAC), cliente e admin
  conversoes.ts            devolve a conversão para Meta (CAPI) e Google Ads
  metaLeadgen.ts           Graph API + validação de assinatura dos webhooks
  whatsapp.ts              traduz o payload do WhatsApp em colunas de lead
  rateLimit.ts             freio de tentativas de senha
  format.ts / types.ts     utilitários e tipos de cliente
```

## Configuração

### 1. Service Account do Google

1. Em [console.cloud.google.com](https://console.cloud.google.com): crie um projeto,
   ative a **Google Sheets API** e crie uma **Conta de serviço** com uma **chave JSON**.
2. Copie `client_email` e `private_key` do JSON para o `.env` (ver `.env.example`).
3. **Compartilhe cada planilha de cliente** (como Editor) com o `client_email`.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha. Obrigatórias:
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SESSION_SECRET` e
`ADMIN_SENHA`. As da Meta (`META_APP_SECRET`, `META_VERIFY_TOKEN`,
`META_WHATSAPP_VERIFY_TOKEN`) só fazem falta se você for receber lead direto do
Meta/WhatsApp.

Rode `npm run verificar` para checar ambiente, planilhas e config de cada
cliente antes de subir.

### 3. Tenants (clientes)

Cadastre os clientes pela tela **`/admin`** (senha em `ADMIN_SENHA`) ou à mão em
`tenants.json` (copie de `tenants.example.json`). Cada item aponta o `slug` e a
senha para o `spreadsheetId` daquele cliente.

**Em produção o cadastro não é gravável.** O `/admin` escreve em `tenants.json`,
e em hospedagem serverless (Vercel) o disco é efêmero — o que for cadastrado lá
se perde no próximo deploy. Enquanto não houver um banco, o caminho é: cadastrar
em desenvolvimento, clicar em **Exportar (TENANTS)** no `/admin` e colar o JSON
na variável de ambiente `TENANTS` da hospedagem. Com `TENANTS` definida, a tela
entra em modo somente-leitura e avisa isso. Para tornar gravável de verdade,
trocar `persistir`/`carregar` em [`lib/tenants.ts`](lib/tenants.ts) por um banco
— as demais funções não mudam.

## Rodar

```bash
npm run dev     # http://localhost:3000/<slug>
npm run build
npm start
```

## Webhooks

- **Google Ads** (formato nativo): URL do webhook = `https://SEU-DOMINIO/api/webhook/<slug>`,
  e a "Chave" = `chaveWebhook` do tenant.
- **Meta / n8n / formulário próprio**: `POST` JSON em `/api/webhook/<slug>` com o campo
  `"chave"` igual ao `chaveWebhook`. Cada chave do JSON vira uma coluna; colunas novas
  são criadas automaticamente.

## Como o lead do Meta chega (dois caminhos)

### Recomendado: integração nativa Meta → Google Sheets

O jeito mais simples. No Meta (Business Suite / Ads Manager) você conecta o
formulário instantâneo a uma planilha do Google; a cada lead, o Meta escreve a
linha sozinho. Sem Zapier, sem App Review, sem webhook.

Para usar com o painel:

1. Aponte o `spreadsheetId` (e `aba`) do tenant para **a mesma planilha que o
   Meta preenche**, e compartilhe-a com a service account.
2. O painel entende o cabeçalho sozinho. Ele já reconhece a coluna de id do lead
   que o Meta cria (`id`) e a usa para devolver a conversão. Se sua planilha usa
   outro nome, renomeie para `Lead ID`.
3. Leads que o Meta escreve não têm o `ID` interno do painel — ele preenche esse
   ID sozinho na primeira vez que o painel carrega. Nada a fazer.

### Alternativo: webhook de leadgen (`/api/meta`)

Só se você **não** quiser usar a integração nativa. A ferramenta recebe a
notificação do Meta, busca o lead na Graph API e grava. Exige app do Meta e
App Review para `leads_retrieval`.

Config (uma vez, no app do Meta em developers.facebook.com):

1. Crie/abra um **app do Meta**, adicione o produto **Webhooks** e o **Facebook
   Login** com a permissão `leads_retrieval`.
2. Em Webhooks, assine o objeto **Page**, campo **leadgen**, com:
   - **URL de callback**: `https://SEU-DOMINIO/api/meta`
   - **Token de verificação**: o mesmo valor de `META_VERIFY_TOKEN` (env).
3. No `.env`: `META_VERIFY_TOKEN` (inventado por você) e `META_APP_SECRET`
   (App Secret do app, valida a assinatura das notificações).
4. Por tenant, em `tenants.json`, o bloco `metaLeadgen`:
   - `pageId`: a Página do Facebook daquele cliente (é o que roteia o lead para
     a planilha certa).
   - `pageAccessToken`: token da Página com `leads_retrieval` (buscar o lead).
5. Assine a Página no app (uma vez) para as notificações começarem a chegar.

O `Lead ID`, `Origem` (Facebook/Instagram) e `Campanha` já vêm preenchidos — e o
`Lead ID` é o que fecha o loop de conversão de volta (seção abaixo).

## Leads do WhatsApp (anúncios Click-to-WhatsApp)

Quando alguém clica num anúncio "Enviar mensagem" e manda a 1ª mensagem, o
WhatsApp anexa um bloco `referral` com o anúncio de origem e um `ctwa_clid`
(id do clique). O painel recebe isso em `/api/whatsapp`, descobre de qual
cliente é o número e grava o lead na planilha dele.

Cada mensagem **não** vira um lead novo: se o telefone já está na planilha, a
gravação é ignorada. Isso depende de existir uma coluna de telefone reconhecível
(`Telefone`, `WhatsApp`, `Celular`, `Phone`...) — o `npm run verificar` avisa.

Configuração:

1. No `.env.local`: `META_APP_SECRET`, `META_WHATSAPP_VERIFY_TOKEN`.
   **Em produção, sem o app secret o webhook é recusado (503)** — ele é o que
   impede terceiros de gravar leads falsos na planilha do cliente.
2. No app do Meta (developers.facebook.com), produto **WhatsApp** → Configuração:
   - **URL de callback**: `https://SEU-DOMINIO/api/whatsapp`
   - **Token de verificação**: o mesmo valor de `META_WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages**.
3. Na tela `/admin`, no cliente, preencha **WhatsApp — Phone Number ID** (o ID
   do número na Cloud API, não o número em si). É ele que roteia o lead para a
   planilha certa; dois clientes não podem ter o mesmo.

Colunas gravadas: `Nome`, `Telefone`, `Origem` (`WhatsApp` ou
`WhatsApp (anúncio)`), `Campanha`, `Primeira mensagem` e `ctwa_clid` — criadas
sozinhas se não existirem.

## Conversões de volta para Meta e Google

Quando o cliente muda o status de um lead no painel, a ferramenta envia a
conversão de volta para as plataformas de anúncio, para elas otimizarem as
campanhas. O envio é feito direto pela API (`lib/conversoes.ts`), acionado no
`PATCH /api/leads/[id]`, e o resultado é gravado na coluna **Conversão** da
planilha (auditoria).

**Pré-requisito — o identificador do lead precisa estar na planilha.** Sem ele,
a plataforma não sabe qual lead converteu:

- **Meta (formulário)**: coluna `Lead ID` (o `lead_id` do Lead Ad). Se você usa
  automação (Make/Zapier) para trazer o lead do Meta, mapeie o `lead_id` para
  essa coluna.
- **Meta (Click-to-WhatsApp)**: coluna `ctwa_clid`, preenchida sozinha pelo
  webhook do WhatsApp. O evento vai como `business_messaging` em vez de evento
  de CRM — a diferença é tratada dentro de `lib/conversoes.ts`.
- **Google Ads**: coluna `gclid` (ou `gbraid`/`wbraid`). O webhook nativo do
  Google Ads já preenche `Lead ID` e `gclid` automaticamente.

Essas colunas são técnicas e **não aparecem no card**.

### Credenciais (por tenant, em `tenants.json` / `TENANTS`)

- **Meta** (`conversoes.meta`): `datasetId` (Events Manager) + `accessToken`
  (token de usuário do sistema) + `eventos` (mapa status → nome do evento
  configurado no Events Manager).
- **Google Ads** (`conversoes.google`): `developerToken`, OAuth
  (`clientId`/`clientSecret`/`refreshToken`), `customerId`, e `conversoes` (mapa
  status → resource name da conversion action, ex.
  `customers/123/conversionActions/456`).
- `conversoes.statusConversao`: quais status disparam o envio.

Sem o bloco `conversoes`, o painel apenas grava o status (comportamento normal).
Erros de envio não derrubam o salvamento — ficam registrados na coluna Conversão.

> Nota: os endpoints usam versões fixas das APIs (Graph `v21.0`, Google Ads
> `v18`). Ajuste em `lib/conversoes.ts` se precisar de outra versão. Essa
> integração só funciona depois que as credenciais reais estiverem no lugar;
> não dá para validar sem elas.

## Notas da migração

- A lógica de negócio (mapeamento automático de cabeçalho, link de WhatsApp, criação de
  colunas) foi portada 1:1 do `Codigo.gs` do projeto Apps Script original.
- Melhorias que já vieram de graça: senha/chave fora do código (variáveis de ambiente),
  sessão por cookie em vez de senha em toda chamada, e isolamento por cliente (tenant).
- Limite herdado do original: lê a planilha inteira a cada request (ok até alguns milhares
  de linhas). Para escalar além disso, seria o passo de trocar o banco.
