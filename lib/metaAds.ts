/**
 * Meta Marketing API — quanto foi investido.
 *
 * O painel sabe quantos leads chegaram (planilha), mas não quanto custaram.
 * Aqui buscamos o gasto por campanha na conta de anúncios do cliente, o que
 * transforma "342 leads" em "R$ 18 por lead". É leitura pura: nada é alterado
 * na conta de anúncios.
 *
 * Exige um token com a permissão `ads_read` na conta. O token do bloco
 * `conversoes.meta` costuma servir, desde que tenha essa permissão — por isso
 * `accessToken` aqui é opcional.
 */

import type { MetaAdsConfig } from "./tenants";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Nível de detalhe do relatório: a campanha inteira ou anúncio a anúncio. */
export type Nivel = "campaign" | "ad";

/** Uma linha de insight, já normalizada para o que o painel usa. */
export type InsightCampanha = {
  campanhaId: string;
  campanha: string;
  /** preenchidos só quando o relatório vem no nível de anúncio */
  conjunto?: string;
  anuncio?: string;
  anuncioId?: string;
  investimento: number;
  impressoes: number;
  cliques: number;
  /** leads de formulário que a própria Meta contabilizou (pode divergir da planilha) */
  leadsMeta: number;
  /**
   * Conversas iniciadas no WhatsApp/Direct pelo anúncio. É o que salva a
   * campanha de Click-to-WhatsApp de aparecer como "0 leads": o contato em si
   * a Meta não entrega (só com a Cloud API), mas o volume ela informa.
   */
  conversas: number;
  /** quantas dessas conversas tiveram resposta do cliente */
  respostas: number;
};

export type ResultadoInsights =
  | { ok: true; campanhas: InsightCampanha[]; moeda: string }
  | { ok: false; erro: string };

type LinhaCrua = {
  campaign_id?: string;
  campaign_name?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  account_currency?: string;
  actions?: { action_type?: string; value?: string }[];
};

/** Lead de formulário — a pessoa preencheu e a Meta tem os dados dela. */
const ACOES_DE_LEAD = new Set(["lead", "leadgen_grouped", "onsite_conversion.lead_grouped"]);

/**
 * Conversa iniciada por anúncio de mensagem (Click-to-WhatsApp e Direct).
 *
 * A Meta reporta duas métricas parecidas e elas não batem: a primeira é a
 * "Conversas por mensagem iniciadas" que aparece no Gerenciador de Anúncios;
 * a segunda é mais ampla e dá um número maior. Usamos a primeira, e só caímos
 * na segunda se ela não vier — o painel precisa bater com o que o cliente vê
 * no Gerenciador, senão ninguém confia no número.
 */
const ACAO_CONVERSA = "onsite_conversion.messaging_conversation_started_7d";
const ACAO_CONVERSA_ALT = "onsite_conversion.total_messaging_connection";

/** Quem respondeu depois da primeira mensagem — sinal de conversa de verdade. */
const ACOES_DE_RESPOSTA = new Set(["onsite_conversion.messaging_first_reply"]);

function numero(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function contar(acoes: LinhaCrua["actions"], tipos: Set<string>): number {
  let total = 0;
  for (const a of acoes || []) {
    if (a.action_type && tipos.has(a.action_type)) total += numero(a.value);
  }
  return total;
}

/** Valor de uma ação específica, ou 0 se a Meta não reportou aquela ação. */
function valorDaAcao(acoes: LinhaCrua["actions"], tipo: string): number {
  const a = (acoes || []).find((x) => x.action_type === tipo);
  return a ? numero(a.value) : 0;
}

function contarConversas(acoes: LinhaCrua["actions"]): number {
  return valorDaAcao(acoes, ACAO_CONVERSA) || valorDaAcao(acoes, ACAO_CONVERSA_ALT);
}

/* ---------- cache ----------
 * A Marketing API é lenta (1-3s) e tem limite de chamadas por hora. O painel
 * recarrega sozinho, então sem cache um cliente com a aba aberta queimaria a
 * cota à toa. TTL curto: gasto do dia não muda de minuto em minuto.
 */

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { em: number; valor: ResultadoInsights }>();

function doCache(chave: string): ResultadoInsights | null {
  const item = cache.get(chave);
  if (!item) return null;
  if (Date.now() - item.em > TTL_MS) {
    cache.delete(chave);
    return null;
  }
  return item.valor;
}

/** Normaliza o id da conta: aceita "act_123" ou "123". */
function contaFormatada(id: string): string {
  const limpo = String(id || "").trim();
  return limpo.startsWith("act_") ? limpo : `act_${limpo}`;
}

/**
 * Qual token usar para ler anúncios deste cliente, em ordem de preferência:
 *   1. o token do próprio cliente (metaAds.accessToken)
 *   2. o token da agência (META_ADS_TOKEN) — um usuário de sistema com acesso
 *      a todas as contas dos clientes, que é o arranjo normal de agência
 *   3. o token de conversões, que às vezes já tem ads_read
 */
export function tokenDeAnuncios(
  cfg: MetaAdsConfig | undefined,
  tokenConversoes: string | undefined
): string {
  return cfg?.accessToken || process.env.META_ADS_TOKEN || tokenConversoes || "";
}

export type ContaAnuncio = {
  id: string; // com o prefixo act_
  nome: string;
  moeda: string;
  ativa: boolean;
};

/**
 * Lista as contas de anúncio que o token enxerga — é o que permite escolher a
 * conta do cliente numa lista, em vez de colar um ID a esmo.
 *
 * Exige `ads_read` (ou `ads_management`) no token. Sem isso a Graph API
 * responde "(#200) Missing Permissions", e é isso que devolvemos ao admin.
 */
export async function listarContas(
  token: string
): Promise<{ ok: true; contas: ContaAnuncio[] } | { ok: false; erro: string }> {
  if (!token) return { ok: false, erro: "Informe um token de acesso." };

  const params = new URLSearchParams({
    fields: "id,name,account_status,currency",
    limit: "200",
    access_token: token,
  });

  try {
    const contas: ContaAnuncio[] = [];
    let url = `${GRAPH}/me/adaccounts?${params}`;

    for (let pagina = 0; pagina < 5 && url; pagina++) {
      const res = await fetch(url);
      const j = (await res.json().catch(() => null)) as {
        data?: { id?: string; name?: string; account_status?: number; currency?: string }[];
        paging?: { next?: string };
        error?: { message?: string; code?: number };
      } | null;

      if (!res.ok || !j) {
        const msg = j?.error?.message || `HTTP ${res.status}`;
        // o erro mais comum tem uma causa específica; vale explicar
        if (j?.error?.code === 200 || /permission/i.test(msg)) {
          return {
            ok: false,
            erro: "Este token não tem permissão de leitura de anúncios (ads_read). Gere um token de usuário de sistema com ads_read na conta de negócios.",
          };
        }
        return { ok: false, erro: msg };
      }

      for (const c of j.data || []) {
        contas.push({
          id: String(c.id || ""),
          nome: String(c.name || c.id || "(sem nome)"),
          moeda: String(c.currency || ""),
          ativa: c.account_status === 1,
        });
      }
      url = j.paging?.next || "";
    }

    if (!contas.length) {
      return {
        ok: false,
        erro: "O token é válido, mas não há nenhuma conta de anúncio associada a ele.",
      };
    }
    return { ok: true, contas };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

/**
 * Confere se dá mesmo para ler o gasto desta conta — uma chamada real de
 * insights nos últimos 7 dias. É o que transforma "salvei o ID" em "está
 * conectado", antes de o cliente abrir o painel e ver um traço.
 */
export async function testarConta(
  adAccountId: string,
  token: string
): Promise<{ ok: true; investimento: number; moeda: string; campanhas: number } | { ok: false; erro: string }> {
  if (!adAccountId) return { ok: false, erro: "Escolha uma conta de anúncio." };
  if (!token) return { ok: false, erro: "Informe um token de acesso." };

  const hoje = new Date();
  const desde = new Date(hoje);
  desde.setDate(desde.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // ignora o cache: o teste tem que bater na API de verdade
  cache.delete(`${contaFormatada(adAccountId)}|${iso(desde)}|${iso(hoje)}`);

  const res = await buscarInvestimento(
    { adAccountId, accessToken: token },
    undefined,
    iso(desde),
    iso(hoje)
  );

  if (!res.ok) return { ok: false, erro: res.erro };
  return {
    ok: true,
    investimento: res.campanhas.reduce((s, c) => s + c.investimento, 0),
    moeda: res.moeda,
    campanhas: res.campanhas.length,
  };
}

/**
 * Busca o investimento por campanha no período (datas em YYYY-MM-DD).
 * Nunca lança: erro de credencial/permissão vira `{ ok: false }` para o
 * dashboard mostrar os números de volume mesmo sem os de custo.
 */
export async function buscarInvestimento(
  cfg: MetaAdsConfig,
  tokenFallback: string | undefined,
  desde: string,
  ate: string,
  nivel: Nivel = "campaign"
): Promise<ResultadoInsights> {
  const token = cfg.accessToken || tokenFallback || "";
  if (!cfg.adAccountId || !token) {
    return { ok: false, erro: "conta de anúncios ou token não configurados" };
  }

  const conta = contaFormatada(cfg.adAccountId);
  const chave = `${conta}|${desde}|${ate}|${nivel}`;
  const emCache = doCache(chave);
  if (emCache) return emCache;

  const campos =
    nivel === "ad"
      ? "campaign_id,campaign_name,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,account_currency"
      : "campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency";

  const params = new URLSearchParams({
    level: nivel,
    fields: campos,
    time_range: JSON.stringify({ since: desde, until: ate }),
    time_increment: "all_days",
    // no nível de anúncio uma conta grande passa de 200 linhas
    limit: nivel === "ad" ? "500" : "200",
    access_token: token,
  });

  try {
    const campanhas: InsightCampanha[] = [];
    let moeda = "BRL";
    let url = `${GRAPH}/${conta}/insights?${params}`;

    // a API pagina; seguimos o cursor, com teto para não girar sem fim
    for (let pagina = 0; pagina < 10 && url; pagina++) {
      const res = await fetch(url);
      const j = (await res.json().catch(() => null)) as {
        data?: LinhaCrua[];
        paging?: { next?: string };
        error?: { message?: string; error_user_title?: string };
      } | null;

      if (!res.ok || !j) {
        const erro = j?.error?.error_user_title || j?.error?.message || `HTTP ${res.status}`;
        const falha: ResultadoInsights = { ok: false, erro };
        cache.set(chave, { em: Date.now(), valor: falha });
        return falha;
      }

      for (const linha of j.data || []) {
        if (linha.account_currency) moeda = linha.account_currency;
        campanhas.push({
          campanhaId: String(linha.campaign_id || ""),
          campanha: String(linha.campaign_name || "(sem nome)"),
          conjunto: linha.adset_name ? String(linha.adset_name) : undefined,
          anuncio: linha.ad_name ? String(linha.ad_name) : undefined,
          anuncioId: linha.ad_id ? String(linha.ad_id) : undefined,
          investimento: numero(linha.spend),
          impressoes: numero(linha.impressions),
          cliques: numero(linha.clicks),
          leadsMeta: contar(linha.actions, ACOES_DE_LEAD),
          conversas: contarConversas(linha.actions),
          respostas: contar(linha.actions, ACOES_DE_RESPOSTA),
        });
      }

      url = j.paging?.next || "";
    }

    const valor: ResultadoInsights = { ok: true, campanhas, moeda };
    cache.set(chave, { em: Date.now(), valor });
    return valor;
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}
