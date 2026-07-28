import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenants";
import { gravarLeadWebhook } from "@/lib/sheets";

/**
 * Porta do doPost do Codigo.gs. Recebe leads de fora e grava na planilha
 * do tenant indicado na URL: POST /api/webhook/<slug>
 *  - Google Ads (formato nativo, valida google_key)
 *  - Meta / n8n / formulário próprio (JSON livre, valida "chave")
 */

type GoogleAdsCampo = { column_name?: string; column_id?: string; string_value?: string };
type CorpoGoogleAds = {
  user_column_data?: GoogleAdsCampo[];
  google_key?: string;
  campaign_id?: string;
  lead_id?: string;
  gcl_id?: string;
};

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const tenant = getTenant(slug);
  if (!tenant) return NextResponse.json({ ok: false, erro: "tenant" }, { status: 404 });

  let corpo: Record<string, unknown> & CorpoGoogleAds;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "json inválido" }, { status: 400 });
  }

  try {
    // Formato nativo do Google Ads
    if (corpo.user_column_data) {
      if (tenant.chaveWebhook && corpo.google_key !== tenant.chaveWebhook) {
        return NextResponse.json({ ok: false, erro: "chave inválida" }, { status: 401 });
      }
      const dados: Record<string, string> = {
        Origem: "Google Ads",
        Campanha: corpo.campaign_id || "",
      };
      corpo.user_column_data.forEach((campo) => {
        const nome = campo.column_name || campo.column_id || "";
        if (nome) dados[nome] = campo.string_value || "";
      });
      // identificadores para devolver a conversão ao Google/Meta depois
      if (corpo.lead_id) dados["Lead ID"] = String(corpo.lead_id);
      if (corpo.gcl_id) dados["gclid"] = String(corpo.gcl_id);
      await gravarLeadWebhook(tenant, dados);
      return NextResponse.json({ lead_id: corpo.lead_id, ok: true });
    }

    // Formato livre (Meta via automação, n8n, formulário próprio)
    const chave = corpo.chave as string | undefined;
    if (tenant.chaveWebhook && chave && chave !== tenant.chaveWebhook) {
      return NextResponse.json({ ok: false, erro: "chave inválida" }, { status: 401 });
    }
    delete corpo.chave;

    const dados: Record<string, string> = {};
    for (const [k, v] of Object.entries(corpo)) dados[k] = v == null ? "" : String(v);
    if (!dados.Origem && !dados.origem) dados.Origem = "Meta";

    await gravarLeadWebhook(tenant, dados);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 500 }
    );
  }
}
