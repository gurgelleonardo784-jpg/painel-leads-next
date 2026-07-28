import { NextResponse } from "next/server";
import { getTenantPorPagina } from "@/lib/tenants";
import { buscarLeadMeta, conferirWebhookMeta } from "@/lib/metaLeadgen";
import { gravarLeadWebhook } from "@/lib/sheets";

/**
 * Webhook de leadgen do Meta (recebimento direto, sem automação).
 *
 * GET  = verificação do webhook (o Meta chama uma vez ao configurar).
 * POST = notificação de novo lead: buscamos os dados na Graph API e gravamos.
 *
 * URL de callback no app do Meta: https://SEU-DOMINIO/api/meta
 */

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  if (!process.env.META_VERIFY_TOKEN) {
    console.error("Meta leadgen: META_VERIFY_TOKEN não definido — verificação vai falhar.");
  }

  if (mode === "subscribe" && token && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

type Entrada = {
  id?: string;
  changes?: { field?: string; value?: { page_id?: string; leadgen_id?: string } }[];
};

export async function POST(req: Request) {
  const corpoBruto = await req.text();

  const recusa = conferirWebhookMeta(req, corpoBruto, "Meta leadgen");
  if (recusa) return recusa;

  let corpo: { object?: string; entry?: Entrada[] };
  try {
    corpo = JSON.parse(corpoBruto);
  } catch {
    return NextResponse.json({ ok: false, erro: "json" }, { status: 400 });
  }

  if (corpo.object !== "page") return NextResponse.json({ ok: true });

  for (const entry of corpo.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== "leadgen") continue;
      const valor = ch.value || {};
      const pageId = String(valor.page_id || entry.id || "");
      const leadgenId = String(valor.leadgen_id || "");

      const tenant = getTenantPorPagina(pageId);
      if (!tenant || !tenant.metaLeadgen || !leadgenId) continue;

      try {
        const dados = await buscarLeadMeta(tenant.metaLeadgen.pageAccessToken, leadgenId);
        await gravarLeadWebhook(tenant, dados);
      } catch (e) {
        // um lead com erro não derruba o webhook inteiro (Meta reenviaria tudo)
        console.error("Meta leadgen:", e instanceof Error ? e.message : e);
      }
    }
  }

  // sempre 200 para o Meta parar de reenviar
  return NextResponse.json({ ok: true });
}
