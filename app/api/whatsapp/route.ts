import { NextResponse } from "next/server";
import { getTenantPorTelefoneWhatsApp } from "@/lib/tenants";
import { conferirWebhookMeta } from "@/lib/metaLeadgen";
import { extrairLeadsWhatsApp, type ValorWhatsApp } from "@/lib/whatsapp";
import { gravarLeadWhatsappSeNovo } from "@/lib/sheets";

/**
 * Webhook do WhatsApp Cloud API (captura de leads Click-to-WhatsApp).
 *
 * GET  = verificação do webhook (o Meta chama uma vez ao configurar).
 * POST = mensagens recebidas: roteia pelo phone_number_id para o cliente certo
 *        e grava o lead (número, nome, campanha, ctwa_clid) na planilha dele.
 *
 * URL de callback no App do Meta: https://SEU-DOMINIO/api/whatsapp
 */

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  if (!process.env.META_WHATSAPP_VERIFY_TOKEN) {
    console.error("WhatsApp: META_WHATSAPP_VERIFY_TOKEN não definido — verificação vai falhar.");
  }

  if (mode === "subscribe" && token && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

type Entrada = { changes?: { field?: string; value?: ValorWhatsApp }[] };

export async function POST(req: Request) {
  const corpoBruto = await req.text();

  const recusa = conferirWebhookMeta(req, corpoBruto, "WhatsApp");
  if (recusa) return recusa;

  let corpo: { object?: string; entry?: Entrada[] };
  try {
    corpo = JSON.parse(corpoBruto);
  } catch {
    return NextResponse.json({ ok: false, erro: "json" }, { status: 400 });
  }

  if (corpo.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });

  for (const entry of corpo.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== "messages" || !ch.value) continue;
      const phoneNumberId = ch.value.metadata?.phone_number_id || "";
      const tenant = getTenantPorTelefoneWhatsApp(phoneNumberId);
      if (!tenant) continue;

      for (const lead of extrairLeadsWhatsApp(ch.value)) {
        try {
          await gravarLeadWhatsappSeNovo(tenant, lead.telefone, lead.dados);
        } catch (e) {
          // um lead com erro não derruba o webhook inteiro (Meta reenviaria tudo)
          console.error("WhatsApp captura:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // sempre 200 para o Meta parar de reenviar
  return NextResponse.json({ ok: true });
}