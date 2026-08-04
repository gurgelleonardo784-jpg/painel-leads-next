import crypto from "crypto";

/**
 * Recebimento direto de leads do Meta (formulário instantâneo / Lead Ads).
 * A Meta manda uma notificação com o leadgen_id; aqui buscamos os dados
 * completos na Graph API e montamos as colunas para gravar na planilha.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

type LeadMetaCru = {
  id?: string;
  field_data?: { name: string; values?: string[] }[];
  campaign_name?: string;
  ad_name?: string;
  adset_name?: string;
  platform?: string;
  created_time?: string;
  error?: { message?: string };
};

/** Dá nomes amigáveis aos campos padrão do Meta; mantém os demais como vieram. */
function rotular(nome: string): string {
  const mapa: Record<string, string> = {
    full_name: "Nome",
    first_name: "Nome",
    last_name: "Sobrenome",
    email: "Email",
    phone_number: "Telefone",
  };
  return mapa[nome] || nome;
}

/** Busca o lead na Graph API e devolve as colunas prontas para gravarLeadWebhook. */
export async function buscarLeadMeta(
  pageAccessToken: string,
  leadgenId: string
): Promise<Record<string, string>> {
  const campos = "field_data,campaign_name,ad_name,adset_name,platform,created_time";
  const url = `${GRAPH}/${leadgenId}?fields=${campos}&access_token=${encodeURIComponent(pageAccessToken)}`;

  const res = await fetch(url);
  const lead = (await res.json().catch(() => null)) as LeadMetaCru | null;
  if (!res.ok || !lead) {
    throw new Error(lead?.error?.message || `Graph API HTTP ${res.status}`);
  }

  const dados: Record<string, string> = {};
  (lead.field_data || []).forEach((f) => {
    const valor = (f.values || []).join(", ");
    if (valor) dados[rotular(f.name)] = valor;
  });

  dados["Lead ID"] = String(lead.id || leadgenId);
  dados["Origem"] =
    lead.platform === "ig" ? "Instagram" : lead.platform === "fb" ? "Facebook" : "Meta";

  // os três níveis, separados: é o que permite conferir depois quantos leads
  // cada anúncio realmente trouxe, contra o que a Meta reporta
  if (lead.campaign_name) dados["Campanha"] = lead.campaign_name;
  if (lead.adset_name) dados["Conjunto"] = lead.adset_name;
  if (lead.ad_name) dados["Anúncio"] = lead.ad_name;

  return dados;
}

/** Valida o cabeçalho X-Hub-Signature-256 enviado pela Meta (HMAC do app secret). */
export function assinaturaValida(
  appSecret: string,
  assinatura: string | null,
  corpoBruto: string
): boolean {
  if (!assinatura) return false;
  const esperado =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(corpoBruto, "utf8").digest("hex");
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Porteiro dos webhooks da Meta (`/api/meta` e `/api/whatsapp`).
 *
 * Sem `META_APP_SECRET` não há como saber se o POST veio mesmo da Meta — e o
 * endpoint é público e grava na planilha do cliente. Por isso, em produção a
 * ausência do segredo **recusa** a requisição em vez de deixar passar. Em
 * desenvolvimento passa, com aviso no console, para dar para testar com curl.
 *
 * Retorna null quando está tudo certo, ou a resposta de recusa.
 */
export function conferirWebhookMeta(
  req: Request,
  corpoBruto: string,
  rotulo: string
): Response | null {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    if (process.env.NODE_ENV === "production") {
      console.error(`${rotulo}: META_APP_SECRET ausente — webhook recusado.`);
      return Response.json({ ok: false, erro: "config" }, { status: 503 });
    }
    console.warn(`${rotulo}: META_APP_SECRET ausente — assinatura NÃO verificada (dev).`);
    return null;
  }

  if (!assinaturaValida(appSecret, req.headers.get("x-hub-signature-256"), corpoBruto)) {
    return Response.json({ ok: false, erro: "assinatura" }, { status: 403 });
  }
  return null;
}
