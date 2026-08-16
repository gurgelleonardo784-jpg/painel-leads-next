/**
 * Cliques no botão de WhatsApp do site do cliente.
 *
 * O problema que isto resolve: mensagem de WhatsApp vinda de um botão do site
 * não traz `referral`. O `referral` e o `ctwa_clid` são coisa do anúncio da
 * Meta — quem buscou no Google, entrou no site e clicou no botão chega no
 * webhook igual a quem já tinha o número.
 *
 * A solução é um identificador de clique nosso: no clique gravamos a origem e
 * geramos um token curto, o token viaja na mensagem pré-preenchida, e o webhook
 * usa ele para achar de onde a pessoa veio.
 *
 * O token é visível para o visitante e ele pode apagar antes de enviar. Quando
 * isso acontece a atribuição se perde, e o lead entra como não identificado —
 * nunca como orgânico. Casar por horário seria a alternativa, e produziria
 * atribuição errada, que é pior que atribuição faltando.
 */

import crypto from "node:crypto";
import { consultar } from "./db";
import { garantirClientePorSlug } from "./repositorio";
import {
  campanhaDosSinais,
  grupoDosSinais,
  criativoDosSinais,
  resumoUtm,
  hostDoReferrer,
  type Canal,
  type SinaisDeOrigem,
} from "./canal";

/* ---------- o código que viaja na mensagem ---------- */

/**
 * O código carrega a origem no próprio prefixo: `PAG-7K3M`.
 *
 * A alternativa seria um código opaco, resolvido só pela consulta ao banco — e
 * ela quebra junto com o banco. Com a origem no prefixo, se a gravação do
 * clique falhar (Neon hibernando, rede oscilando), a mensagem que chega ainda
 * diz de onde a pessoa veio. É o que permite o redirect não esperar por
 * gravação nenhuma.
 */
export const PREFIXOS = ["PAG", "IG", "FB", "ORG", "REF", "DIR"] as const;
export type Prefixo = (typeof PREFIXOS)[number];

const PREFIXO_POR_CANAL: Record<Canal, Prefixo> = {
  google_ads: "PAG",
  meta_ads: "PAG",
  google_organico: "ORG",
  busca_organica: "ORG",
  social: "REF", // sobrescrito abaixo quando dá para saber se é IG ou FB
  referencia: "REF",
  direto: "DIR",
  // so aparece na volta (prefixo -> canal); na ida o classificador nunca devolve
  pago: "PAG",
  desconhecido: "DIR",
};

/**
 * Alfanumérico maiúsculo sem os pares que se confundem lendo ou ditando:
 * O/0 e I/1. Sobram 32 símbolos.
 */
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Quatro caracteres, não dois.
 *
 * Com dois (1.024 combinações por prefixo), 50 cliques já dão ~70% de chance de
 * dois deles receberem o mesmo código — e aí um lead herda a origem do clique
 * de outra pessoa. Dado errado é pior que dado faltando, porque parece certo.
 * Com quatro (1.048.576) a mesma situação cai para 0,12%.
 */
const SUFIXO = 4;

/** IG e FB só se distinguem olhando de onde a pessoa veio. */
function prefixoDoCanal(canal: Canal, sinais?: SinaisDeOrigem): Prefixo {
  if (canal === "social" && sinais) {
    const onde = `${sinais.utmSource || ""} ${hostDoReferrer(sinais.referrer || "")}`.toLowerCase();
    if (/instagram|\big\b/.test(onde)) return "IG";
    if (/facebook|\bfb\b/.test(onde)) return "FB";
  }
  return PREFIXO_POR_CANAL[canal];
}

export function gerarCodigo(canal: Canal, sinais?: SinaisDeOrigem): string {
  const bytes = crypto.randomBytes(SUFIXO);
  let s = "";
  for (let i = 0; i < SUFIXO; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return `${prefixoDoCanal(canal, sinais)}-${s}`;
}

/** O padrão procurado no texto da mensagem recebida. */
const NO_TEXTO = new RegExp(`\\b(${PREFIXOS.join("|")})-([${ALFABETO}]{${SUFIXO}})\\b`, "i");

/** Acha o código na mensagem que a pessoa enviou, se ele sobreviveu. */
export function codigoNoTexto(texto: string): string {
  const m = String(texto || "").match(NO_TEXTO);
  return m ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : "";
}

/**
 * A origem que dá para deduzir só do prefixo, quando o clique não foi gravado.
 *
 * `PAG` diz que foi mídia paga mas não diz a plataforma — Google e Meta caem no
 * mesmo prefixo. É perda de precisão aceitável para um caso raro (falha de
 * gravação); a linha do clique, quando existe, tem o detalhe todo.
 */
export function canalDoPrefixo(codigo: string): Canal | null {
  const p = codigo.split("-")[0]?.toUpperCase();
  switch (p) {
    case "PAG":
      return "pago";
    case "IG":
    case "FB":
      return "social";
    case "ORG":
      return "busca_organica";
    case "REF":
      return "referencia";
    case "DIR":
      return "desconhecido";
    default:
      return null;
  }
}

export type CliqueGravado = {
  token: string;
  canal: Canal;
};

/**
 * Grava o clique.
 *
 * O código e o canal vêm de fora, já decididos: quem chama precisa deles antes
 * para poder redirecionar sem esperar esta gravação.
 */
export async function registrarClique(
  slug: string,
  sinais: SinaisDeOrigem,
  token: string,
  canal: Canal,
  extras: { nomeCliente?: string; visitanteId?: string; userAgent?: string } = {}
): Promise<CliqueGravado | null> {
  // o clique vem antes da primeira mensagem, então às vezes é ele que cria o
  // cliente no banco
  await garantirClientePorSlug(slug, extras.nomeCliente || "");

  const corta = (v: unknown, n = 500) => {
    const s = String(v ?? "").trim();
    return s ? s.slice(0, n) : null;
  };

  const rows = await consultar<{ token: string }>(
    `INSERT INTO web_clicks (
        client_id, token, channel,
        gclid, gbraid, wbraid, fbclid,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        campaign_id, adgroup_id, creative_id,
        referrer, landing_page, visitor_id, user_agent
      )
      SELECT c.id, $2, $3,
             $4, $5, $6, $7,
             $8, $9, $10, $11, $12,
             $13, $14, $15,
             $16, $17, $18, $19
        FROM clients c
       WHERE c.slug = $1
      RETURNING token`,
    [
      slug,
      token,
      canal,
      corta(sinais.gclid, 200),
      corta(sinais.gbraid, 200),
      corta(sinais.wbraid, 200),
      corta(sinais.fbclid, 200),
      corta(sinais.utmSource, 120),
      corta(sinais.utmMedium, 120),
      corta(sinais.utmCampaign, 200),
      corta(sinais.utmContent, 200),
      corta(sinais.utmTerm, 200),
      corta(sinais.campanhaId, 60),
      corta(sinais.grupoId, 60),
      corta(sinais.criativoId, 60),
      corta(sinais.referrer),
      corta(sinais.landing),
      corta(extras.visitanteId, 80),
      corta(extras.userAgent, 400),
    ]
  );

  // nenhuma linha = o slug não existe na tabela clients ainda. O cliente é
  // criado na primeira mensagem que chega; até lá não há onde pendurar o clique.
  return rows.length ? { token: rows[0].token, canal } : null;
}

export type CliqueEncontrado = {
  id: string;
  canal: Canal;
  gclid: string;
  campanha: string;
  grupo: string;
  criativo: string;
  utmSource: string;
  utmMedium: string;
  /** "source=google · medium=cpc · term=advogado trabalhista" */
  utm: string;
  landing: string;
  referrer: string;
  visitanteId: string;
};

/**
 * Acha o clique de um token, dentro do cliente.
 *
 * Só aceita clique das últimas 72 horas: token que aparece semanas depois é
 * mensagem encaminhada ou copiada, e atribuir por ele daria origem errada.
 */
export async function acharClique(
  slug: string,
  token: string,
  horas = 72
): Promise<CliqueEncontrado | null> {
  if (!token) return null;

  const rows = await consultar<{
    id: string;
    channel: string;
    gclid: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    campaign_id: string | null;
    adgroup_id: string | null;
    creative_id: string | null;
    gbraid: string | null;
    wbraid: string | null;
    landing_page: string | null;
    referrer: string | null;
    visitor_id: string | null;
  }>(
    `SELECT w.id::text AS id, w.channel, w.gclid, w.gbraid, w.wbraid,
            w.utm_source, w.utm_medium, w.utm_campaign, w.utm_content, w.utm_term,
            w.campaign_id, w.adgroup_id, w.creative_id, w.landing_page, w.referrer,
            w.visitor_id
       FROM web_clicks w
       JOIN clients c ON c.id = w.client_id
      WHERE c.slug = $1
        AND w.token = $2
        AND w.created_at > now() - ($3 || ' hours')::interval
      LIMIT 1`,
    // maiúsculas: é como o código é gerado e como o `codigoNoTexto` devolve.
    // Já foi `toLowerCase()` aqui, sobra do alfabeto antigo, e a busca não
    // achava nada — atribuição silenciosamente perdida em todo clique do site.
    [slug, token.toUpperCase(), String(horas)]
  );
  if (!rows.length) return null;
  const r = rows[0];

  const sinais: SinaisDeOrigem = {
    gclid: r.gclid || "",
    gbraid: r.gbraid || "",
    wbraid: r.wbraid || "",
    utmSource: r.utm_source || "",
    utmMedium: r.utm_medium || "",
    utmCampaign: r.utm_campaign || "",
    utmContent: r.utm_content || "",
    utmTerm: r.utm_term || "",
    campanhaId: r.campaign_id || "",
    grupoId: r.adgroup_id || "",
    criativoId: r.creative_id || "",
  };

  return {
    id: r.id,
    canal: r.channel as Canal,
    gclid: r.gclid || r.gbraid || r.wbraid || "",
    campanha: campanhaDosSinais(sinais),
    grupo: grupoDosSinais(sinais),
    criativo: criativoDosSinais(sinais),
    utmSource: r.utm_source || "",
    utmMedium: r.utm_medium || "",
    utm: resumoUtm(sinais),
    landing: r.landing_page || "",
    referrer: r.referrer || "",
    visitanteId: r.visitor_id || "",
  };
}

/**
 * O clique que merece o crédito, olhando a jornada inteira em vez de só o último.
 *
 * O caso que isto resolve: a pessoa chega por um anúncio, não fala nada, volta
 * dias depois pela busca orgânica e só então clica no WhatsApp. Atribuir ao
 * último clique daria o crédito ao orgânico — e o anúncio, que foi quem trouxe e
 * quem custou dinheiro, apareceria como se não tivesse feito nada. É assim que
 * campanha boa é cortada por engano.
 *
 * A regra é "primeiro toque pago ganha": se houve clique pago na jornada, ele
 * leva o crédito. Sem clique pago, vale o que converteu.
 *
 * Isso duplica de propósito o que o script já tenta fazer no navegador
 * (localStorage guarda o primeiro toque): aqui é a rede de segurança para quando
 * o visitante navega em modo privado, troca de aba ou limpa o storage.
 */
export async function cliqueParaAtribuir(
  slug: string,
  convertido: CliqueEncontrado,
  dias = 30
): Promise<CliqueEncontrado> {
  const pago = (c: string) => c === "google_ads" || c === "meta_ads";
  if (pago(convertido.canal) || !convertido.visitanteId) return convertido;

  const rows = await consultar<{ token: string }>(
    `SELECT w.token
       FROM web_clicks w
       JOIN clients c ON c.id = w.client_id
      WHERE c.slug = $1
        AND w.visitor_id = $2
        AND w.channel IN ('google_ads', 'meta_ads')
        AND w.created_at > now() - ($3 || ' days')::interval
      ORDER BY w.created_at ASC
      LIMIT 1`,
    [slug, convertido.visitanteId, String(dias)]
  );
  if (!rows.length) return convertido;

  // busca sem janela de 72h: o clique pago pode ser bem mais antigo que a
  // conversa, e é exatamente esse o caso que estamos resgatando
  const pagoEncontrado = await acharClique(slug, rows[0].token, dias * 24);
  if (!pagoEncontrado) return convertido;

  // o crédito é do anúncio, mas a página onde a pessoa clicou é a da conversão
  return { ...pagoEncontrado, id: convertido.id, landing: convertido.landing };
}

/**
 * Marca o clique como consumido por um lead — e, com ele, toda a jornada.
 *
 * Liga também os cliques anteriores do mesmo visitante, que é o que transforma
 * cliques soltos em história: "veio do anúncio dia 3, voltou pela busca dia 7,
 * mandou mensagem dia 8". Sem isso o painel mostraria só o último clique e a
 * pergunta de primeiro contato contra último contato ficaria sem resposta.
 *
 * `used_at` continua sendo só do clique que de fato virou conversa — é ele que
 * mede quanto clique não vira nada.
 */
export async function marcarCliqueUsado(cliqueId: string, leadId: string): Promise<void> {
  await consultar(
    `UPDATE web_clicks
        SET lead_id = $2::bigint, used_at = now()
      WHERE id = $1::bigint AND used_at IS NULL`,
    [cliqueId, leadId]
  );

  await consultar(
    `UPDATE web_clicks
        SET lead_id = $2::bigint
      WHERE lead_id IS NULL
        AND visitor_id IS NOT NULL
        AND visitor_id = (SELECT visitor_id FROM web_clicks WHERE id = $1::bigint)
        AND client_id  = (SELECT client_id  FROM web_clicks WHERE id = $1::bigint)`,
    [cliqueId, leadId]
  );
}

export type PassoDaJornada = {
  canal: string;
  campanha: string;
  pagina: string;
  referrer: string;
  em: string;
  /** este foi o clique que virou conversa */
  converteu: boolean;
};

/** A jornada do contato antes (e depois) da conversa começar. */
export async function jornadaDoLead(slug: string, leadId: string): Promise<PassoDaJornada[]> {
  const rows = await consultar<{
    channel: string;
    utm_campaign: string | null;
    campaign_id: string | null;
    landing_page: string | null;
    referrer: string | null;
    created_at: Date;
    converteu: boolean;
  }>(
    `SELECT w.channel, w.utm_campaign, w.campaign_id, w.landing_page, w.referrer,
            w.created_at, (w.used_at IS NOT NULL) AS converteu
       FROM web_clicks w
       JOIN clients c ON c.id = w.client_id
      WHERE c.slug = $1 AND w.lead_id = $2::bigint
      ORDER BY w.created_at ASC`,
    [slug, leadId]
  );

  return rows.map((r) => ({
    canal: r.channel,
    campanha: campanhaDosSinais({
      utmCampaign: r.utm_campaign || "",
      campanhaId: r.campaign_id || "",
    }),
    pagina: r.landing_page || "",
    referrer: r.referrer || "",
    em: r.created_at.toISOString(),
    converteu: r.converteu,
  }));
}

/** Quantos cliques e quantos viraram conversa, por canal — para o dashboard. */
export async function resumoDeCliques(
  slug: string,
  dias = 30
): Promise<{ canal: string; cliques: number; conversas: number }[]> {
  const rows = await consultar<{ channel: string; cliques: string; conversas: string }>(
    `SELECT w.channel,
            count(*)::text                                   AS cliques,
            count(w.lead_id)::text                           AS conversas
       FROM web_clicks w
       JOIN clients c ON c.id = w.client_id
      WHERE c.slug = $1
        AND w.created_at > now() - ($2 || ' days')::interval
      GROUP BY w.channel
      ORDER BY count(*) DESC`,
    [slug, String(dias)]
  );
  return rows.map((r) => ({
    canal: r.channel,
    cliques: Number(r.cliques) || 0,
    conversas: Number(r.conversas) || 0,
  }));
}
