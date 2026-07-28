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
  api/
    login/route.ts         POST: valida senha do tenant, cria cookie de sessão
    logout/route.ts        POST: encerra sessão
    leads/route.ts         GET: lê os leads do tenant logado
    leads/[id]/route.ts    PATCH: grava status/anotação
    webhook/[slug]/route.ts POST: recebe leads (Google Ads nativo / Meta / JSON livre)
components/
  Painel.tsx               a interface (client) - filtros, pills, grade, auto-refresh
  LeadCard.tsx             o card de um lead
lib/
  google.ts                cliente Sheets API (service account)
  sheets.ts                leitura/gravação + webhook (porta do Codigo.gs)
  tenants.ts               quem é cada cliente -> qual planilha
  auth.ts                  sessão por cookie assinado (HMAC)
  format.ts / types.ts     utilitários e tipos de cliente
```

## Configuração

### 1. Service Account do Google

1. Em [console.cloud.google.com](https://console.cloud.google.com): crie um projeto,
   ative a **Google Sheets API** e crie uma **Conta de serviço** com uma **chave JSON**.
2. Copie `client_email` e `private_key` do JSON para o `.env` (ver `.env.example`).
3. **Compartilhe cada planilha de cliente** (como Editor) com o `client_email`.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` e `SESSION_SECRET`.

### 3. Tenants (clientes)

Cadastre os clientes em `tenants.json` (dev — copie de `tenants.example.json`) ou
na variável de ambiente `TENANTS` (produção). Cada item aponta o `slug` e a senha
para o `spreadsheetId` daquele cliente.

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

## Conversões de volta para Meta e Google

Quando o cliente muda o status de um lead no painel, a ferramenta envia a
conversão de volta para as plataformas de anúncio, para elas otimizarem as
campanhas. O envio é feito direto pela API (`lib/conversoes.ts`), acionado no
`PATCH /api/leads/[id]`, e o resultado é gravado na coluna **Conversão** da
planilha (auditoria).

**Pré-requisito — o identificador do lead precisa estar na planilha.** Sem ele,
a plataforma não sabe qual lead converteu:

- **Meta**: coluna `Lead ID` (o `lead_id` do Lead Ad). Se você usa automação
  (Make/Zapier) para trazer o lead do Meta, mapeie o `lead_id` para essa coluna.
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
