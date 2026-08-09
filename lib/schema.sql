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
