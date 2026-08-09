/**
 * Motor de atribuição (§17).
 *
 * A regra de ouro do §49: o WhatsApp é fonte de **evento**, não de campanha.
 * Ele diz "esta pessoa mandou mensagem, e o anúncio de origem era este id".
 * Transformar isso em "campanha X, conjunto Y, anúncio Z" é trabalho daqui.
 *
 * Os quatro níveis:
 *   1. `referral.source_id` no webhook  -> é o ad_id, atribuição direta
 *   2. `ctwa_clid`                      -> guardado sempre, para a CAPI (§14, §31)
 *   3. Graph API a partir do ad_id      -> nomes de campanha/conjunto/anúncio
 *   4. sem nada disso                   -> orgânico. NÃO inventar campanha.
 *
 * Níveis 1, 2 e 4 são decididos sem rede, na hora do webhook. O nível 3 é o
 * único que depende da Meta, e por isso é o único que pode falhar e ser
 * repetido depois (§37) — o lead nunca espera por ele.
 */

import type { MensagemWhatsApp, Referral } from "./whatsapp";
import { registrar } from "./registro";

const GRAPH = "https://graph.facebook.com/v21.0";

export type FonteAtribuicao = "meta_ads" | "organic" | "unknown";
/** §35 */
export type StatusAtribuicao = "attributed" | "organic" | "unknown" | "pending";
export type MetodoAtribuicao = "whatsapp_referral" | "meta_lead_ads" | "none";
export type ConfiancaAtribuicao = "high" | "medium" | "low";

export type Atribuicao = {
  fonte: FonteAtribuicao;
  status: StatusAtribuicao;
  metodo: MetodoAtribuicao;
  confianca: ConfiancaAtribuicao | null;
  sourceType: string;
  sourceUrl: string;
  adId: string;
  ctwaClid: string;
};

/**
 * Níveis 1, 2 e 4 — o que dá para decidir só com o webhook na mão.
 *
 * Sobre o `status` (§35): `attributed` é quando sabemos **de qual anúncio** o
 * lead veio, ou seja, quando há `ad_id`. Se o referral existe mas não trouxe
 * `source_id` utilizável (só `ctwa_clid`, por exemplo), sabemos que veio de
 * anúncio mas não de qual — isso é `pending`, e pode ser resolvido depois pelo
 * clid. Sem referral nenhum é `organic`, e aí não se inventa campanha.
 */
export function atribuicaoDoReferral(ref: Referral | null, ctwaClid: string): Atribuicao {
  if (!ref) {
    // §17 nível 4 e §44 Teste 2
    return {
      fonte: ctwaClid ? "meta_ads" : "organic",
      status: ctwaClid ? "pending" : "organic",
      metodo: ctwaClid ? "whatsapp_referral" : "none",
      confianca: ctwaClid ? "medium" : null,
      sourceType: "",
      sourceUrl: "",
      adId: "",
      ctwaClid,
    };
  }

  const sourceType = String(ref.source_type || "").trim();
  const sourceId = String(ref.source_id || "").trim();

  // §16: só é ad_id se o próprio Meta disse que a origem é um anúncio. Um
  // `source_type: "post"` traz o id de uma publicação orgânica — chamar aquilo
  // de ad_id faria a Graph API responder "não existe" para sempre.
  const adId = sourceType === "ad" || (!sourceType && sourceId) ? sourceId : "";

  return {
    fonte: "meta_ads",
    status: adId ? "attributed" : "pending",
    metodo: "whatsapp_referral",
    // o próprio Meta afirmando o anúncio é o sinal mais forte que existe
    confianca: adId ? "high" : "medium",
    sourceType,
    sourceUrl: String(ref.source_url || "").trim(),
    adId,
    ctwaClid,
  };
}

/** Atalho para o caminho do webhook: já registra o que apareceu e o que faltou. */
export function atribuicaoDaMensagem(m: MensagemWhatsApp): Atribuicao {
  const a = atribuicaoDoReferral(m.referral, m.ctwaClid);
  if (m.referral) {
    registrar("referral_encontrado", {
      messageId: m.id,
      sourceType: a.sourceType || null,
      adId: a.adId || null,
    });
  } else {
    registrar("referral_ausente", { messageId: m.id });
  }
  if (a.ctwaClid) registrar("ctwa_clid_encontrado", { messageId: m.id });
  return a;
}

/* ---------- nível 3: a estrutura do anúncio na Graph API (§16) ---------- */

export type EstruturaAnuncio = {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
};

export type ResultadoEstrutura =
  | { ok: true; estrutura: EstruturaAnuncio }
  | { ok: false; erro: string; permanente: boolean };

/**
 * Muitos leads do mesmo anúncio chegam juntos (é o normal numa campanha que
 * está rodando). Sem cache, um lote de 20 leads faria 20 chamadas idênticas.
 */
const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { em: number; estrutura: EstruturaAnuncio }>();

/**
 * Códigos de erro da Graph API que não melhoram com repetição: token errado,
 * permissão faltando, id inexistente. Repetir só queima cota e atrasa a fila.
 */
const CODIGOS_PERMANENTES = new Set([100, 190, 200, 803]);

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tentarBuscar(adId: string, token: string): Promise<ResultadoEstrutura> {
  const params = new URLSearchParams({
    fields: "id,name,adset{id,name},campaign{id,name}",
    access_token: token,
  });

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${encodeURIComponent(adId)}?${params}`);
  } catch (e) {
    // rede caiu: é exatamente o caso de tentar de novo
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede", permanente: false };
  }

  const j = (await res.json().catch(() => null)) as {
    id?: string;
    name?: string;
    adset?: { id?: string; name?: string };
    campaign?: { id?: string; name?: string };
    error?: { message?: string; code?: number; error_user_title?: string };
  } | null;

  if (!res.ok || !j || j.error) {
    const codigo = j?.error?.code;
    const erro = j?.error?.error_user_title || j?.error?.message || `HTTP ${res.status}`;
    const permanente = typeof codigo === "number" ? CODIGOS_PERMANENTES.has(codigo) : res.status === 400;
    return { ok: false, erro, permanente };
  }

  return {
    ok: true,
    estrutura: {
      adId: String(j.id || adId),
      adName: String(j.name || ""),
      adsetId: String(j.adset?.id || ""),
      adsetName: String(j.adset?.name || ""),
      campaignId: String(j.campaign?.id || ""),
      campaignName: String(j.campaign?.name || ""),
    },
  };
}

/**
 * Busca campanha/conjunto/anúncio a partir do ad_id, com até 3 tentativas
 * (§37). Nunca lança: quem chama precisa continuar com o lead salvo mesmo se a
 * Meta estiver fora do ar.
 */
export async function buscarEstruturaAnuncio(
  adId: string,
  token: string
): Promise<ResultadoEstrutura> {
  if (!adId) return { ok: false, erro: "sem ad_id", permanente: true };
  if (!token) {
    return {
      ok: false,
      erro: "sem token com ads_read (preencha META_ADS_TOKEN ou metaAds.accessToken)",
      permanente: true,
    };
  }

  const emCache = cache.get(adId);
  if (emCache && Date.now() - emCache.em < TTL_MS) {
    return { ok: true, estrutura: emCache.estrutura };
  }

  const esperas = [0, 400, 1500];
  let ultimo: ResultadoEstrutura = { ok: false, erro: "não tentado", permanente: false };

  for (let tentativa = 0; tentativa < esperas.length; tentativa++) {
    if (esperas[tentativa]) await esperar(esperas[tentativa]);
    ultimo = await tentarBuscar(adId, token);

    if (ultimo.ok) {
      cache.set(adId, { em: Date.now(), estrutura: ultimo.estrutura });
      registrar("graph_api_consultada", {
        adId,
        campanha: ultimo.estrutura.campaignName || null,
        tentativas: tentativa + 1,
      });
      return ultimo;
    }
    if (ultimo.permanente) break; // não vai melhorar
  }

  registrar("graph_api_falhou", { adId, erro: ultimo.erro, permanente: ultimo.permanente });
  return ultimo;
}
