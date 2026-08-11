-- Banco de leads e atribuição (spec §19).
--
-- Tudo aqui é idempotente: rodar `npm run migrar` de novo não estraga nada.
-- A planilha continua sendo o que o painel lê hoje; este banco é o que guarda
-- o que a planilha não consegue guardar — cada mensagem, cada evento de
-- atribuição, e a trava de idempotência do §22.

CREATE TABLE IF NOT EXISTS clients (
  id               BIGSERIAL PRIMARY KEY,
  -- o slug é o mesmo do tenants.json: é ele que amarra o banco ao cadastro
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL DEFAULT '',
  meta_business_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id                     BIGSERIAL PRIMARY KEY,
  client_id              BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  waba_id                TEXT,
  -- é o phone_number_id que roteia o webhook para o cliente certo; dois
  -- clientes não podem dividir o mesmo número
  phone_number_id        TEXT NOT NULL UNIQUE,
  display_phone_number   TEXT,
  business_name          TEXT,
  -- nunca em texto puro (§20). Fica nulo enquanto o Embedded Signup não
  -- existir: hoje o token vem do ambiente, não do onboarding.
  access_token_encrypted TEXT,
  status                 TEXT NOT NULL DEFAULT 'ativo',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id                  BIGSERIAL PRIMARY KEY,
  client_id           BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  whatsapp_account_id BIGINT REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,

  -- 'whatsapp' | 'meta_lead_ads' | 'manual' (§29: mesma tabela, muda a origem)
  source              TEXT NOT NULL DEFAULT 'whatsapp',
  name                TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL DEFAULT '',
  whatsapp_user_id    TEXT,
  conversation_id     TEXT,

  -- atribuição (§12)
  attribution_source     TEXT NOT NULL DEFAULT 'unknown',  -- meta_ads | organic | unknown
  attribution_status     TEXT NOT NULL DEFAULT 'unknown',  -- attributed | organic | unknown | pending (§35)
  attribution_method     TEXT,                              -- whatsapp_referral | meta_lead_ads | none
  attribution_confidence TEXT,                              -- high | medium | low
  source_type            TEXT,                              -- referral.source_type: 'ad' | 'post'
  source_url             TEXT,
  campaign_id            TEXT,
  campaign_name          TEXT,
  adset_id               TEXT,
  adset_name             TEXT,
  ad_id                  TEXT,
  ad_name                TEXT,
  ctwa_clid              TEXT,

  -- a primeira mensagem é o que decide a atribuição (§15, §24)
  first_message_id    TEXT,
  first_message_text  TEXT,
  first_message_at    TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ,

  -- controle do enriquecimento pela Graph API (§37): o lead entra primeiro,
  -- os nomes de campanha/conjunto/anúncio chegam depois
  enrich_attempts     INT NOT NULL DEFAULT 0,
  enrich_error        TEXT,
  enriched_at         TIMESTAMPTZ,

  -- id da linha espelhada na planilha do cliente, para atualizar campanha/
  -- conjunto/anúncio lá quando o enriquecimento terminar
  sheet_lead_id       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- §23: o telefone é o identificador lógico do contato DENTRO do cliente.
  -- É esta restrição que impede a segunda mensagem de virar um lead novo.
  CONSTRAINT leads_cliente_telefone UNIQUE (client_id, phone)
);

CREATE INDEX IF NOT EXISTS leads_client_created_idx ON leads (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_ad_idx ON leads (ad_id) WHERE ad_id IS NOT NULL;
-- a fila do job de retry (§37): sabemos o anúncio, mas a Graph API ainda não
-- foi consultada com sucesso para trazer campanha/conjunto/anúncio
CREATE INDEX IF NOT EXISTS leads_a_enriquecer_idx
  ON leads (enrich_attempts, created_at)
  WHERE ad_id IS NOT NULL AND campaign_name IS NULL AND enriched_at IS NULL;

CREATE TABLE IF NOT EXISTS messages (
  id                  BIGSERIAL PRIMARY KEY,
  lead_id             BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- §22: a trava de idempotência. O webhook do Meta reenvia; esta restrição é
  -- o que garante que reenvio não vira lead nem mensagem duplicada.
  whatsapp_message_id TEXT NOT NULL UNIQUE,
  direction           TEXT NOT NULL DEFAULT 'in',   -- in | out
  message_type        TEXT,
  message_text        TEXT,
  "timestamp"         TIMESTAMPTZ,
  -- §21: o payload original, para quando o Meta mudar algum campo
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_lead_idx ON messages (lead_id, "timestamp" DESC);

-- Cliques no botão de WhatsApp do site do cliente.
--
-- É o equivalente próprio do ctwa_clid, para o tráfego que não vem de anúncio
-- da Meta: quem chega por busca no Google (paga ou orgânica) e clica no botão
-- do site. O `token` vai na mensagem que a pessoa envia, e é ele que amarra a
-- conversa que chega no webhook à origem que capturamos no site.
CREATE TABLE IF NOT EXISTS web_clicks (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- o código curto que viaja na mensagem pré-preenchida
  token         TEXT NOT NULL UNIQUE,

  channel       TEXT NOT NULL,          -- google_ads | google_organico | ... (lib/canal.ts)
  gclid         TEXT,
  gbraid        TEXT,
  wbraid        TEXT,
  fbclid        TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  -- ValueTrack, quando o template de acompanhamento manda os ids
  campaign_id   TEXT,
  adgroup_id    TEXT,
  creative_id   TEXT,
  referrer      TEXT,
  landing_page  TEXT,

  -- qual lead consumiu este clique, e quando. Nulo = ninguém mandou mensagem
  -- depois de clicar, e é assim que se mede quanto clique não vira conversa.
  lead_id       BIGINT REFERENCES leads(id) ON DELETE SET NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- a busca do webhook: token de um cliente, ainda não usado
CREATE INDEX IF NOT EXISTS web_clicks_token_idx ON web_clicks (client_id, token);
CREATE INDEX IF NOT EXISTS web_clicks_criados_idx ON web_clicks (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attribution_events (
  id          BIGSERIAL PRIMARY KEY,
  lead_id     BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source      TEXT,
  campaign_id TEXT,
  adset_id    TEXT,
  ad_id       TEXT,
  ctwa_clid   TEXT,
  raw_payload JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attribution_events_lead_idx ON attribution_events (lead_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Alterações em tabelas que já existem.
--
-- `CREATE TABLE IF NOT EXISTS` não acrescenta coluna em tabela criada antes, e
-- em banco que já tem lead gravado é justamente esse o caso. Colunas novas
-- entram aqui, sempre com IF NOT EXISTS, para o `npm run migrar` continuar
-- podendo rodar quantas vezes for.
-- ---------------------------------------------------------------------------

-- identificador de clique do Google Ads, para devolver a conversão a eles
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gclid TEXT;
-- qual clique do site originou este lead (rastreio de tráfego que não é da Meta)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS web_click_id BIGINT;

-- Identificador de visitante, em primeira parte (localStorage do site do cliente).
--
-- É o que transforma cliques soltos numa jornada. Sem ele, alguém que clicou no
-- anúncio dia 3, voltou pela busca orgânica dia 7 e mandou mensagem dia 8
-- apareceria como um único clique — e a discussão de primeiro contato contra
-- último contato ficaria sem resposta.
ALTER TABLE web_clicks ADD COLUMN IF NOT EXISTS visitor_id TEXT;
CREATE INDEX IF NOT EXISTS web_clicks_visitante_idx ON web_clicks (client_id, visitor_id);

-- ---------------------------------------------------------------------------
-- Eventos do lead: o que aconteceu com ele depois de entrar.
--
-- A planilha guarda o estado atual, nunca a mudança. Por isso o painel sabia
-- dizer "está qualificado" mas não "quando virou qualificado" nem "há quantos
-- dias está parado nesta etapa" — que é justamente o que o cliente cobra do
-- atendimento.
--
-- Mensagens e cliques NÃO entram aqui: eles já têm tabela própria, e duplicar
-- criaria duas versões da mesma verdade. A linha do tempo do painel junta as
-- três fontes na hora de mostrar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  -- etapa | anotacao | conversao | criado
  tipo       TEXT NOT NULL,
  -- o que aquele tipo de evento precisa guardar (etapa nova, texto, resultado)
  dados      JSONB,
  em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events (lead_id, em);
