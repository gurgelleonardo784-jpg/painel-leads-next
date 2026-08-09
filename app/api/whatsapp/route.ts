import { NextResponse, after } from "next/server";
import { getTenantPorTelefoneWhatsApp, type Tenant } from "@/lib/tenants";
import { conferirWebhookMeta } from "@/lib/metaLeadgen";
import { extrairEventoWhatsApp, type ValorWhatsApp, type EventoWhatsApp } from "@/lib/whatsapp";
import { processarEventoWhatsApp } from "@/lib/processarWhatsapp";
import { registrar } from "@/lib/registro";

/**
 * Webhook do WhatsApp Cloud API (§8).
 *
 * GET  = verificação do webhook (§9): o Meta chama uma vez, ao configurar.
 * POST = mensagens recebidas. Roteia pelo `phone_number_id` para o cliente
 *        certo e devolve 200 **imediatamente**; o processamento acontece em
 *        `after()`, depois da resposta (§38).
 *
 * Por que responder antes de processar: o Meta reenvia o evento se o webhook
 * demorar, e uma mensagem que chega junto com o enriquecimento na Graph API
 * pode levar segundos. Processar dentro do request criaria uma fila de
 * reenvios exatamente quando o sistema está mais lento. A idempotência do §22
 * é o que torna isso seguro — reenvio não duplica nada.
 *
 * URL de callback no App do Meta: https://SEU-DOMINIO/api/whatsapp
 */

/**
 * O `after()` roda dentro do limite de duração da rota, não fora dele. Com o
 * padrão de 10s, um lote de mensagens que precise consultar a Graph API seria
 * cortado no meio — o lead ficaria salvo (isso é transação), mas a atribuição
 * cairia para o job de sincronização sem necessidade.
 */
export const maxDuration = 60;

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
  registrar("token_invalido", { origem: "whatsapp_verificacao" });
  return new Response("forbidden", { status: 403 });
}

type Entrada = { id?: string; changes?: { field?: string; value?: ValorWhatsApp }[] };

export async function POST(req: Request) {
  const corpoBruto = await req.text();

  // assinatura do app (X-Hub-Signature-256): é o que impede terceiros de
  // gravarem leads falsos na planilha do cliente
  const recusa = conferirWebhookMeta(req, corpoBruto, "WhatsApp");
  if (recusa) {
    registrar("webhook_invalido", { origem: "whatsapp", motivo: "assinatura" });
    return recusa;
  }

  let corpo: { object?: string; entry?: Entrada[] };
  try {
    corpo = JSON.parse(corpoBruto);
  } catch {
    registrar("webhook_invalido", { origem: "whatsapp", motivo: "json" });
    return NextResponse.json({ ok: false, erro: "json" }, { status: 400 });
  }

  if (corpo.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });

  // separa o roteamento (barato, síncrono) do processamento (rede e banco)
  const trabalho: { tenant: Tenant; evento: EventoWhatsApp }[] = [];

  for (const entry of corpo.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== "messages" || !ch.value) continue;

      // entry.id é o WABA que recebeu a mensagem
      const evento = extrairEventoWhatsApp(String(entry.id || ""), ch.value);
      registrar("webhook_recebido", {
        origem: "whatsapp",
        wabaId: evento.wabaId || null,
        phoneNumberId: evento.phoneNumberId || null,
        mensagens: evento.mensagens.length,
      });

      if (!evento.mensagens.length) continue; // status de entrega, leitura, etc.

      const tenant = getTenantPorTelefoneWhatsApp(evento.phoneNumberId);
      if (!tenant) {
        // número que não pertence a nenhum cliente cadastrado: não dá para
        // saber em qual planilha gravar, e adivinhar seria pior
        registrar("phone_number_id_invalido", {
          phoneNumberId: evento.phoneNumberId || null,
          wabaId: evento.wabaId || null,
        });
        continue;
      }

      trabalho.push({ tenant, evento });
    }
  }

  // depois da resposta: banco, Graph API e planilha
  if (trabalho.length) {
    after(async () => {
      for (const { tenant, evento } of trabalho) {
        try {
          await processarEventoWhatsApp(tenant, evento);
        } catch (e) {
          // processarEventoWhatsApp já trata erro por mensagem; aqui só sobra
          // falha de infraestrutura (banco fora, por exemplo)
          registrar("webhook_invalido", {
            cliente: tenant.slug,
            erro: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
  }

  // sempre 200 para o Meta parar de reenviar
  return NextResponse.json({ ok: true });
}
