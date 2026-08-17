/**
 * Gravação dos leads do WhatsApp no banco.
 *
 * O coração daqui é `gravarMensagem`: lead + mensagem + evento de atribuição
 * numa transação só, com a restrição única de `messages.whatsapp_message_id`
 * como juiz. É isso que atende o §22 de verdade — se o Meta reenviar o mesmo
 * evento (e ele reenvia), o INSERT da mensagem não pega, a transação inteira
 * volta atrás e nenhum lead é criado nem tocado duas vezes.
 *
 * A outra regra que mora aqui é o §23/§24: o telefone identifica o contato
 * dentro do cliente, e é a **primeira** mensagem que decide a atribuição. Da
 * segunda em diante o lead só ganha `last_message_at` e uma linha em `messages`.
 */

import type { PoolClient } from "pg";
import { consultar, emTransacao, MensagemDuplicada } from "./db";
import type { Atribuicao } from "./atribuicao";
import type { EstruturaAnuncio } from "./atribuicao";
import type { MensagemWhatsApp } from "./whatsapp";
import { FUSO_PADRAO, type Tenant } from "./tenants";
import type { AtribuicaoLead, MensagemLead, Lead } from "./types";
import { registrar, mascararTelefone } from "./registro";

/** Ids saem como texto: BIGINT em JS viraria número impreciso acima de 2^53. */
type Id = string;

/**
 * Lê antes de escrever, de propósito.
 *
 * O óbvio aqui seria um `INSERT ... ON CONFLICT DO UPDATE`, mas ele pega lock de
 * escrita na linha do cliente a cada mensagem — e como a transação só termina no
 * fim do processamento, todas as mensagens daquele cliente passariam a esperar
 * uma pela outra. O cliente e a conta praticamente nunca mudam; o caso comum
 * tem que ser um SELECT.
 */
async function garantirCliente(c: PoolClient, tenant: Tenant): Promise<Id> {
  const achado = await c.query<{ id: Id }>(`SELECT id::text AS id FROM clients WHERE slug = $1`, [
    tenant.slug,
  ]);
  if (achado.rows.length) return achado.rows[0].id;

  const criado = await c.query<{ id: Id }>(
    `INSERT INTO clients (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO NOTHING
       RETURNING id::text AS id`,
    [tenant.slug, tenant.nome]
  );
  if (criado.rows.length) return criado.rows[0].id;

  // outra requisição criou entre o SELECT e o INSERT
  const denovo = await c.query<{ id: Id }>(`SELECT id::text AS id FROM clients WHERE slug = $1`, [
    tenant.slug,
  ]);
  return denovo.rows[0].id;
}

async function garantirContaWhatsapp(
  c: PoolClient,
  clienteId: Id,
  dados: { wabaId: string; phoneNumberId: string; displayPhoneNumber: string }
): Promise<Id | null> {
  if (!dados.phoneNumberId) return null;

  const achado = await c.query<{ id: Id; waba_id: string | null }>(
    `SELECT id::text AS id, waba_id FROM whatsapp_accounts WHERE phone_number_id = $1`,
    [dados.phoneNumberId]
  );
  if (achado.rows.length) {
    // o WABA só chega quando a primeira mensagem chega: o cadastro no /admin
    // tem só o phone_number_id. Preenche uma vez e não escreve mais.
    if (!achado.rows[0].waba_id && dados.wabaId) {
      await c.query(
        `UPDATE whatsapp_accounts
            SET waba_id              = $2::text,
                display_phone_number = COALESCE(display_phone_number, NULLIF($3::text,'')),
                updated_at           = now()
          WHERE id = $1::bigint`,
        [achado.rows[0].id, dados.wabaId, dados.displayPhoneNumber]
      );
    }
    return achado.rows[0].id;
  }

  const criado = await c.query<{ id: Id }>(
    `INSERT INTO whatsapp_accounts (client_id, waba_id, phone_number_id, display_phone_number)
          VALUES ($1::bigint, NULLIF($2::text,''), $3, NULLIF($4::text,''))
     ON CONFLICT (phone_number_id) DO NOTHING
       RETURNING id::text AS id`,
    [clienteId, dados.wabaId, dados.phoneNumberId, dados.displayPhoneNumber]
  );
  if (criado.rows.length) return criado.rows[0].id;

  const denovo = await c.query<{ id: Id }>(
    `SELECT id::text AS id FROM whatsapp_accounts WHERE phone_number_id = $1`,
    [dados.phoneNumberId]
  );
  return denovo.rows.length ? denovo.rows[0].id : null;
}

type LinhaLead = {
  id: Id;
  ad_id: string | null;
  campaign_name: string | null;
  attribution_status: string;
  sheet_lead_id: string | null;
};

export type ResultadoGravacao =
  | { estado: "duplicada" }
  | {
      estado: "criado" | "atualizado";
      leadId: Id;
      /** o anúncio de origem do lead, venha desta mensagem ou de uma anterior */
      adId: string;
      /** já sabemos o anúncio, mas ainda não o nome dele: é a fila do §37 */
      precisaEnriquecer: boolean;
      /** id da linha espelhada na planilha, quando já existe */
      sheetLeadId: string | null;
    };

export type ContextoEvento = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
};

/**
 * Grava uma mensagem recebida e o lead correspondente.
 *
 * Devolve `duplicada` quando aquele `message.id` já tinha sido processado —
 * sem tocar em nada. Nunca cria um segundo lead para o mesmo telefone dentro
 * do mesmo cliente.
 */
export async function gravarMensagem(
  tenant: Tenant,
  ctx: ContextoEvento,
  m: MensagemWhatsApp,
  atrib: Atribuicao
): Promise<ResultadoGravacao> {
  try {
    return await emTransacao(async (c) => {
      const clienteId = await garantirCliente(c, tenant);
      const contaId = await garantirContaWhatsapp(c, clienteId, ctx);

      const em = m.em ?? new Date();

      // 1) o lead. ON CONFLICT DO NOTHING para saber, sem corrida, se é novo:
      // duas mensagens simultâneas do mesmo número não criam dois leads.
      const inserido = await c.query<LinhaLead>(
        `INSERT INTO leads (
             client_id, whatsapp_account_id, source, name, phone, whatsapp_user_id,
             attribution_source, attribution_status, attribution_method, attribution_confidence,
             source_type, source_url, ad_id, ctwa_clid,
             gclid, campaign_name, adset_name, ad_name, web_click_id,
             first_message_id, first_message_text, first_message_at, last_message_at
           ) VALUES (
             $1::bigint, $2::bigint, 'whatsapp', $3, $4, NULLIF($5::text,''),
             $6, $7, $8, $9,
             NULLIF($10::text,''), NULLIF($11::text,''), NULLIF($12::text,''), NULLIF($13::text,''),
             NULLIF($17::text,''), NULLIF($18::text,''), NULLIF($19::text,''), NULLIF($20::text,''),
             NULLIF($21::text,'')::bigint,
             $14, NULLIF($15::text,''), $16::timestamptz, $16::timestamptz
           )
         ON CONFLICT ON CONSTRAINT leads_cliente_telefone DO NOTHING
           RETURNING id::text AS id, ad_id, campaign_name, attribution_status, sheet_lead_id`,
        [
          clienteId,
          contaId,
          m.nomePerfil,
          m.telefone,
          m.waId,
          atrib.fonte,
          atrib.status,
          atrib.metodo,
          atrib.confianca,
          atrib.sourceType,
          atrib.sourceUrl,
          atrib.adId,
          atrib.ctwaClid,
          m.id,
          m.texto,
          em,
          atrib.gclid || "",
          atrib.campanha || "",
          atrib.conjunto || "",
          atrib.anuncio || "",
          atrib.cliqueId || "",
        ]
      );

      let lead: LinhaLead;
      let novo: boolean;

      if (inserido.rows.length) {
        lead = inserido.rows[0];
        novo = true;
      } else {
        novo = false;
        // FOR UPDATE: segura a linha até o fim da transação, para duas
        // mensagens do mesmo contato não se sobrescreverem
        const atual = await c.query<LinhaLead>(
          `SELECT id::text AS id, ad_id, campaign_name, attribution_status, sheet_lead_id
             FROM leads
            WHERE client_id = $1 AND phone = $2
              FOR UPDATE`,
          [clienteId, m.telefone]
        );
        lead = atual.rows[0];

        // §24: a primeira mensagem já decidiu a atribuição — não sobrescreve.
        // Mas se o lead entrou orgânico e ainda não tem anúncio nenhum, um
        // referral que chegue agora é informação nova, não conflito.
        const podeAtribuir = !lead.ad_id && lead.attribution_status !== "attributed";
        await c.query(
          `UPDATE leads
              SET last_message_at        = GREATEST(COALESCE(last_message_at, $3::timestamptz), $3::timestamptz),
                  name                   = CASE WHEN name = '' THEN $4::text ELSE name END,
                  whatsapp_account_id    = COALESCE(whatsapp_account_id, $5::bigint),
                  attribution_source     = CASE WHEN $6::boolean THEN $7::text  ELSE attribution_source     END,
                  attribution_status     = CASE WHEN $6::boolean THEN $8::text  ELSE attribution_status     END,
                  attribution_method     = CASE WHEN $6::boolean THEN $9::text  ELSE attribution_method     END,
                  attribution_confidence = CASE WHEN $6::boolean THEN $10::text ELSE attribution_confidence END,
                  source_type            = COALESCE(source_type, NULLIF($11::text,'')),
                  source_url             = COALESCE(source_url,  NULLIF($12::text,'')),
                  ad_id                  = COALESCE(ad_id,       NULLIF($13::text,'')),
                  ctwa_clid              = COALESCE(ctwa_clid,   NULLIF($14::text,'')),
                  gclid                  = COALESCE(gclid,       NULLIF($15::text,'')),
                  campaign_name          = COALESCE(campaign_name, NULLIF($16::text,'')),
                  adset_name             = COALESCE(adset_name,    NULLIF($17::text,'')),
                  ad_name                = COALESCE(ad_name,       NULLIF($18::text,'')),
                  web_click_id           = COALESCE(web_click_id,  NULLIF($19::text,'')::bigint),
                  updated_at             = now()
            WHERE id = $1::bigint AND client_id = $2::bigint`,
          [
            lead.id,
            clienteId,
            em,
            m.nomePerfil,
            contaId,
            podeAtribuir && atrib.fonte !== "organic" && atrib.fonte !== "unknown",
            atrib.fonte,
            atrib.status,
            atrib.metodo,
            atrib.confianca,
            atrib.sourceType,
            atrib.sourceUrl,
            atrib.adId,
            atrib.ctwaClid,
            atrib.gclid || "",
            atrib.campanha || "",
            atrib.conjunto || "",
            atrib.anuncio || "",
            atrib.cliqueId || "",
          ]
        );
        if (podeAtribuir && atrib.adId) lead.ad_id = atrib.adId;
      }

      // 2) a mensagem. Esta é a trava do §22: se o id já existe, o INSERT não
      // devolve linha e a transação inteira é desfeita — inclusive o lead.
      const msg = await c.query<{ id: Id }>(
        `INSERT INTO messages (lead_id, whatsapp_message_id, direction, message_type, message_text, "timestamp", raw_payload)
              VALUES ($1::bigint, $2, 'in', $3, NULLIF($4::text,''), $5::timestamptz, $6::jsonb)
         ON CONFLICT (whatsapp_message_id) DO NOTHING
           RETURNING id::text AS id`,
        [lead.id, m.id, m.tipo, m.texto, em, JSON.stringify(m.bruto ?? null)]
      );
      if (!msg.rows.length) throw new MensagemDuplicada(m.id);

      // 3) o evento de atribuição (§19). Guardamos todo referral que chega,
      // mesmo quando o lead já estava atribuído: é o histórico que permite ver
      // depois que o mesmo contato voltou por outro anúncio.
      if (atrib.adId || atrib.ctwaClid || atrib.sourceUrl) {
        await c.query(
          `INSERT INTO attribution_events (lead_id, source, ad_id, ctwa_clid, raw_payload)
                VALUES ($1::bigint, $2, NULLIF($3::text,''), NULLIF($4::text,''), $5::jsonb)`,
          [lead.id, atrib.fonte, atrib.adId, atrib.ctwaClid, JSON.stringify(m.referral ?? null)]
        );
        registrar("atribuicao_salva", {
          leadId: lead.id,
          fonte: atrib.fonte,
          status: atrib.status,
          adId: atrib.adId || null,
        });
      }

      registrar(novo ? "lead_criado" : "lead_atualizado", {
        cliente: tenant.slug,
        leadId: lead.id,
        telefone: mascararTelefone(m.telefone),
        atribuicao: atrib.status,
      });

      return {
        estado: novo ? "criado" : "atualizado",
        leadId: lead.id,
        adId: lead.ad_id || "",
        precisaEnriquecer: !!(lead.ad_id && !lead.campaign_name),
        sheetLeadId: lead.sheet_lead_id,
      } as ResultadoGravacao;
    });
  } catch (e) {
    if (e instanceof MensagemDuplicada) {
      registrar("mensagem_duplicada", { messageId: m.id, cliente: tenant.slug });
      return { estado: "duplicada" };
    }
    throw e;
  }
}

/* ---------- enriquecimento (nível 3 da atribuição) ---------- */

export type LeadAEnriquecer = {
  id: Id;
  slug: string;
  adId: string;
  sheetLeadId: string | null;
  tentativas: number;
};

/**
 * A fila do §37: leads que já sabem de qual anúncio vieram, mas ainda sem o
 * nome da campanha.
 *
 * Sai da fila por `enriched_at`, não por `campaign_name`: uma consulta que deu
 * certo mas voltou sem nome de campanha (anúncio cuja campanha foi apagada, por
 * exemplo) está resolvida — se a saída fosse só o nome preenchido, esse lead
 * voltaria para a fila em toda rodada, para sempre.
 *
 * Desiste depois de 5 tentativas para não ficar batendo eternamente num
 * anúncio que não existe mais.
 */
export async function leadsAEnriquecer(limite = 50, slug?: string): Promise<LeadAEnriquecer[]> {
  const rows = await consultar<{
    id: Id;
    slug: string;
    ad_id: string;
    sheet_lead_id: string | null;
    enrich_attempts: number;
  }>(
    `SELECT l.id::text AS id, c.slug, l.ad_id, l.sheet_lead_id, l.enrich_attempts
       FROM leads l
       JOIN clients c ON c.id = l.client_id
      WHERE l.ad_id IS NOT NULL
        AND l.campaign_name IS NULL
        AND l.enriched_at IS NULL
        AND l.enrich_attempts < 5
        AND ($2::text IS NULL OR c.slug = $2)
      ORDER BY l.enrich_attempts ASC, l.created_at ASC
      LIMIT $1`,
    [limite, slug ?? null]
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    adId: r.ad_id,
    sheetLeadId: r.sheet_lead_id,
    tentativas: r.enrich_attempts,
  }));
}

/**
 * Grava a estrutura que a Graph API devolveu em todos os leads daquele anúncio
 * — um anúncio que está rodando gera vários leads, e uma consulta resolve
 * todos. Sempre preso ao cliente: o token de um cliente não escreve no lead de
 * outro, nem por acidente de ad_id repetido (§43).
 */
export async function salvarEstruturaAnuncio(
  slug: string,
  adId: string,
  e: EstruturaAnuncio
): Promise<number> {
  const rows = await consultar<{ id: Id }>(
    `UPDATE leads
        SET ad_name            = NULLIF($3::text,''),
            adset_id           = NULLIF($4::text,''),
            adset_name         = NULLIF($5::text,''),
            campaign_id        = NULLIF($6::text,''),
            campaign_name      = NULLIF($7::text,''),
            attribution_source = 'meta_ads',
            attribution_status = 'attributed',
            enriched_at        = now(),
            enrich_error       = NULL,
            updated_at         = now()
      WHERE ad_id = $2
        AND campaign_name IS NULL
        AND client_id = (SELECT id FROM clients WHERE slug = $1)
        RETURNING id::text AS id`,
    [slug, adId, e.adName, e.adsetId, e.adsetName, e.campaignId, e.campaignName]
  );
  return rows.length;
}

/** Conta a tentativa que falhou, para o job não repetir para sempre. */
export async function registrarFalhaEnriquecimento(
  slug: string,
  adId: string,
  erro: string
): Promise<void> {
  await consultar(
    `UPDATE leads
        SET enrich_attempts = enrich_attempts + 1,
            enrich_error    = $3,
            updated_at      = now()
      WHERE ad_id = $2
        AND campaign_name IS NULL
        AND enriched_at IS NULL
        AND client_id = (SELECT id FROM clients WHERE slug = $1)`,
    [slug, adId, erro.slice(0, 500)]
  );
}

export type LeadSemEspelho = {
  id: Id;
  slug: string;
  nome: string;
  telefone: string;
  primeiraMensagem: string;
  ctwaClid: string;
  gclid: string;
  /** rótulo do canal para a coluna "Origem" */
  origem: string;
  campanha: string;
  conjunto: string;
  anuncio: string;
};

/**
 * Leads que estão no banco mas não têm linha na planilha — acontece quando a
 * Sheets API estava fora no momento em que a mensagem chegou. Sem isso o lead
 * existiria só no banco e o cliente nunca o veria no painel. Só olha os
 * recentes: linha de meses atrás aparecendo do nada confunde mais do que ajuda.
 */
export async function leadsSemEspelho(limite = 25, slug?: string): Promise<LeadSemEspelho[]> {
  const rows = await consultar<{
    id: Id;
    slug: string;
    name: string;
    phone: string;
    first_message_text: string | null;
    ctwa_clid: string | null;
    gclid: string | null;
    attribution_source: string;
    campaign_name: string | null;
    adset_name: string | null;
    ad_name: string | null;
  }>(
    `SELECT l.id::text AS id, c.slug, l.name, l.phone, l.first_message_text,
            l.ctwa_clid, l.gclid, l.attribution_source,
            l.campaign_name, l.adset_name, l.ad_name
       FROM leads l
       JOIN clients c ON c.id = l.client_id
      WHERE l.sheet_lead_id IS NULL
        AND l.source = 'whatsapp'
        AND l.created_at > now() - interval '7 days'
        AND ($2::text IS NULL OR c.slug = $2)
      ORDER BY l.created_at ASC
      LIMIT $1`,
    [limite, slug ?? null]
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nome: r.name,
    telefone: r.phone,
    primeiraMensagem: r.first_message_text || "",
    ctwaClid: r.ctwa_clid || "",
    gclid: r.gclid || "",
    origem: origemDaFonte(r.attribution_source),
    campanha: r.campaign_name || "",
    conjunto: r.adset_name || "",
    anuncio: r.ad_name || "",
  }));
}

/**
 * O rótulo de "Origem" a partir da fonte guardada.
 *
 * Duplica de propósito o que `processarWhatsapp` faz na hora do webhook: aqui é
 * o caminho do job, que só tem a linha do banco na mão. Uma função só serviria
 * se as duas partissem do mesmo tipo, e não partem.
 */
function origemDaFonte(fonte: string): string {
  if (fonte === "meta_ads") return "WhatsApp (anúncio)";
  if (fonte === "google_ads") return "Google Ads";
  if (fonte === "google_organico") return "Google orgânico";
  if (fonte === "busca_organica") return "Busca orgânica";
  if (fonte === "social") return "Redes sociais";
  if (fonte === "referencia") return "Indicação de site";
  return "WhatsApp";
}

/** Guarda o id da linha espelhada na planilha, para poder atualizá-la depois. */
export async function salvarSheetLeadId(leadId: Id, sheetLeadId: string): Promise<void> {
  await consultar(`UPDATE leads SET sheet_lead_id = $2, updated_at = now() WHERE id = $1::bigint`, [
    leadId,
    sheetLeadId,
  ]);
}

/**
 * Garante a linha do cliente fora de uma transação.
 *
 * O `clients` nasce na primeira mensagem que chega. Mas o clique no site vem
 * antes da mensagem — é o que o gera — então quem registra clique precisa poder
 * criar o cliente também, senão o primeiro lead de Google de um cliente novo
 * perderia a origem justamente por ser o primeiro.
 */
export async function garantirClientePorSlug(slug: string, nome = ""): Promise<Id> {
  const achado = await consultar<{ id: Id }>(
    `SELECT id::text AS id FROM clients WHERE slug = $1`,
    [slug]
  );
  if (achado.length) return achado[0].id;

  const criado = await consultar<{ id: Id }>(
    `INSERT INTO clients (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO NOTHING
       RETURNING id::text AS id`,
    [slug, nome]
  );
  if (criado.length) return criado[0].id;

  const denovo = await consultar<{ id: Id }>(
    `SELECT id::text AS id FROM clients WHERE slug = $1`,
    [slug]
  );
  return denovo[0].id;
}

/* ---------- leitura para o painel ---------- */

/**
 * A atribuição de todos os leads de um cliente, indexada por telefone.
 *
 * O painel lê a planilha (é lá que moram status, anotação, valor e as respostas
 * do formulário). Isto é o que a planilha não tem: de qual anúncio o contato
 * veio, com que confiança, e quantas mensagens já trocou.
 *
 * O casamento é por telefone porque é o identificador lógico do contato (§23).
 * Tentamos o número completo primeiro; se a planilha guardou sem DDI — o caso de
 * lead antigo, digitado à mão — caímos para os últimos 10 dígitos (DDD + número).
 * Não descemos abaixo disso: 8 dígitos casariam contatos de cidades diferentes.
 */
export async function atribuicaoPorTelefone(
  slug: string
): Promise<Map<string, AtribuicaoLead>> {
  const rows = await consultar<{
    phone: string;
    attribution_status: string;
    attribution_source: string;
    attribution_method: string | null;
    attribution_confidence: string | null;
    ad_id: string | null;
    ctwa_clid: string | null;
    campaign_name: string | null;
    adset_name: string | null;
    ad_name: string | null;
    first_message_at: Date | null;
    last_message_at: Date | null;
    mensagens: string;
  }>(
    `SELECT l.phone, l.attribution_status, l.attribution_source, l.attribution_method,
            l.attribution_confidence, l.ad_id, l.ctwa_clid,
            l.campaign_name, l.adset_name, l.ad_name,
            l.first_message_at, l.last_message_at,
            (SELECT count(*) FROM messages m WHERE m.lead_id = l.id)::text AS mensagens
       FROM leads l
       JOIN clients c ON c.id = l.client_id
      WHERE c.slug = $1`,
    [slug]
  );

  const mapa = new Map<string, AtribuicaoLead>();
  for (const r of rows) {
    const a: AtribuicaoLead = {
      status: r.attribution_status,
      fonte: r.attribution_source,
      metodo: r.attribution_method || "",
      confianca: r.attribution_confidence || "",
      adId: r.ad_id || "",
      ctwaClid: r.ctwa_clid || "",
      campanha: r.campaign_name || "",
      conjunto: r.adset_name || "",
      anuncio: r.ad_name || "",
      primeiraMensagemEm: r.first_message_at ? r.first_message_at.toISOString() : "",
      ultimaMensagemEm: r.last_message_at ? r.last_message_at.toISOString() : "",
      mensagens: Number(r.mensagens) || 0,
    };
    const d = r.phone.replace(/\D/g, "");
    mapa.set(d, a);
    // chave secundária, só se ninguém a ocupou: evita que dois contatos
    // diferentes disputem o mesmo sufixo
    const curto = d.slice(-10);
    if (curto.length === 10 && !mapa.has(curto)) mapa.set(curto, a);
  }
  return mapa;
}

/**
 * Os leads que existem no banco, no formato que o painel consome.
 *
 * Serve para o buraco entre as duas fontes: um lead salvo no banco cuja linha na
 * planilha não existe — porque a Sheets API estava fora naquele momento, ou
 * porque o cliente não tem planilha configurada. Sem isto ele ficaria invisível,
 * o que é o pior resultado possível: o lead entrou, foi cobrado no anúncio, e
 * ninguém o atende.
 *
 * Vêm marcados como somente-leitura: etapa e anotação moram na planilha, e não
 * há linha onde gravá-las. O painel mostra o motivo em vez de oferecer um botão
 * que falharia.
 */
export async function leadsDoBanco(
  slug: string,
  ddiPadrao = "55",
  tz = FUSO_PADRAO
): Promise<Lead[]> {
  const rows = await consultar<{
    id: Id;
    name: string;
    phone: string;
    email: string;
    first_message_text: string | null;
    first_message_at: Date | null;
    last_message_at: Date | null;
    attribution_status: string;
    attribution_source: string;
    attribution_method: string | null;
    attribution_confidence: string | null;
    ad_id: string | null;
    ctwa_clid: string | null;
    campaign_name: string | null;
    adset_name: string | null;
    ad_name: string | null;
    mensagens: string;
  }>(
    `SELECT l.id::text AS id, l.name, l.phone, l.email,
            l.first_message_text, l.first_message_at, l.last_message_at,
            l.attribution_status, l.attribution_source, l.attribution_method,
            l.attribution_confidence, l.ad_id, l.ctwa_clid,
            l.campaign_name, l.adset_name, l.ad_name,
            (SELECT count(*) FROM messages m WHERE m.lead_id = l.id)::text AS mensagens
       FROM leads l
       JOIN clients c ON c.id = l.client_id
      WHERE c.slug = $1
      ORDER BY l.created_at DESC`,
    [slug]
  );

  return rows.map((r, i) => {
    const digitos = r.phone.replace(/\D/g, "");
    const comDdi = digitos.length <= 11 ? ddiPadrao + digitos : digitos;
    return {
      // o prefixo evita colidir com o ID interno da planilha e deixa o
      // /api/leads/[id] recusar a gravação sem precisar adivinhar
      id: `db:${r.id}`,
      nome: r.name || "",
      telefone: r.phone,
      email: r.email || "",
      data: r.first_message_at ? dataBr(r.first_message_at, tz) : "",
      origem: origemDaFonte(r.attribution_source),
      campanha: r.campaign_name || "",
      conjunto: r.adset_name || "",
      anuncio: r.ad_name || "",
      status: "",
      nota: "",
      whatsapp: comDdi.length >= 10 && comDdi.length <= 15 ? `https://wa.me/${comDdi}` : "",
      ordem: i,
      respostas: [],
      valor: 0,
      temperatura: "",
      primeiraMensagem: r.first_message_text || "",
      utm: "",
      atribuicao: {
        status: r.attribution_status,
        fonte: r.attribution_source,
        metodo: r.attribution_method || "",
        confianca: r.attribution_confidence || "",
        adId: r.ad_id || "",
        ctwaClid: r.ctwa_clid || "",
        campanha: r.campaign_name || "",
        conjunto: r.adset_name || "",
        anuncio: r.ad_name || "",
        primeiraMensagemEm: r.first_message_at ? r.first_message_at.toISOString() : "",
        ultimaMensagemEm: r.last_message_at ? r.last_message_at.toISOString() : "",
        mensagens: Number(r.mensagens) || 0,
      },
      somenteLeitura: true,
      leadId: "",
      gclid: "",
      gbraid: "",
      wbraid: "",
    };
  });
}

/**
 * "08/08/2026 10:31" — o mesmo formato que a planilha usa, para o parseData ler.
 *
 * O fuso é obrigatório e vem do cliente. Sem ele, o Intl usa o relógio do
 * servidor, que na Vercel é UTC: um lead que mandou mensagem às 22h de São
 * Paulo apareceria no painel como 1h do dia seguinte — data errada, e no dia
 * errado, o que estraga também o filtro de período e o gráfico por dia.
 */
function dataBr(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const v: Record<string, string> = {};
  for (const x of p) v[x.type] = x.value;
  return `${v.day}/${v.month}/${v.year} ${v.hour}:${v.minute}`;
}

/** Acha a atribuição de um telefone da planilha, com o fallback de sufixo. */
export function acharAtribuicao(
  mapa: Map<string, AtribuicaoLead>,
  telefone: string
): AtribuicaoLead | null {
  const d = String(telefone || "").replace(/\D/g, "");
  if (!d) return null;
  return mapa.get(d) || mapa.get(d.slice(-10)) || null;
}

/** O id do lead no banco a partir do telefone, dentro do cliente (§43). */
export async function leadIdPorTelefone(slug: string, telefone: string): Promise<string | null> {
  const d = String(telefone || "").replace(/\D/g, "");
  if (!d) return null;
  const rows = await consultar<{ id: Id }>(
    `SELECT l.id::text AS id
       FROM leads l JOIN clients c ON c.id = l.client_id
      WHERE c.slug = $1
        AND (l.phone = $2 OR right(l.phone, 10) = right($2, 10))
      LIMIT 1`,
    [slug, d]
  );
  return rows.length ? rows[0].id : null;
}

/**
 * O histórico da conversa de um contato (§25: "Histórico de mensagens").
 * Sempre preso ao cliente da sessão — um cliente não lê a conversa de outro (§43).
 */
export async function mensagensDoContato(
  slug: string,
  telefone: string,
  limite = 200
): Promise<MensagemLead[]> {
  const d = String(telefone || "").replace(/\D/g, "");
  if (!d) return [];

  const rows = await consultar<{
    whatsapp_message_id: string;
    message_text: string | null;
    message_type: string | null;
    direction: string;
    em: Date | null;
  }>(
    `SELECT m.whatsapp_message_id, m.message_text, m.message_type, m.direction,
            m."timestamp" AS em
       FROM messages m
       JOIN leads l   ON l.id = m.lead_id
       JOIN clients c ON c.id = l.client_id
      WHERE c.slug = $1
        AND (l.phone = $2 OR right(l.phone, 10) = right($2, 10))
      ORDER BY m."timestamp" ASC
      LIMIT $3`,
    [slug, d, limite]
  );

  return rows.map((r) => ({
    id: r.whatsapp_message_id,
    texto: r.message_text || "",
    tipo: r.message_type || "text",
    em: r.em ? r.em.toISOString() : "",
    direcao: r.direction,
  }));
}

/** Os dados de atribuição de um lead, para espelhar na planilha. */
export async function atribuicaoDoLead(leadId: Id): Promise<{
  campaignName: string;
  adsetName: string;
  adName: string;
  sheetLeadId: string | null;
} | null> {
  const rows = await consultar<{
    campaign_name: string | null;
    adset_name: string | null;
    ad_name: string | null;
    sheet_lead_id: string | null;
  }>(
    `SELECT campaign_name, adset_name, ad_name, sheet_lead_id FROM leads WHERE id = $1::bigint`,
    [leadId]
  );
  if (!rows.length) return null;
  return {
    campaignName: rows[0].campaign_name || "",
    adsetName: rows[0].adset_name || "",
    adName: rows[0].ad_name || "",
    sheetLeadId: rows[0].sheet_lead_id,
  };
}
