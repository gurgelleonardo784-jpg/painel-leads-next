/**
 * O caminho completo de uma mensagem do WhatsApp, do §15:
 *
 *   recebe webhook -> identifica telefone -> captura referral -> captura
 *   ctwa_clid -> salva atribuição -> consulta a Meta -> salva o lead
 *
 * Com uma inversão deliberada em relação ao desenho do §15: o lead é gravado
 * **antes** da consulta à Meta, não depois. É o que o §37 pede — se a Graph API
 * estiver fora, o lead entra assim mesmo e o nome da campanha chega no job de
 * sincronização. Perder um lead porque a API de outra empresa caiu seria o pior
 * erro possível neste produto.
 *
 * Roda dentro de `after()` no webhook: o Meta recebe 200 na hora e o
 * processamento acontece depois da resposta (§38).
 */

import type { Tenant } from "./tenants";
import type { EventoWhatsApp, MensagemWhatsApp } from "./whatsapp";
import { atribuicaoDaMensagem, buscarEstruturaAnuncio } from "./atribuicao";
import { tokenDeAnuncios } from "./metaAds";
import { bancoConfigurado } from "./db";
import {
  gravarMensagem,
  salvarEstruturaAnuncio,
  registrarFalhaEnriquecimento,
  salvarSheetLeadId,
  type ContextoEvento,
} from "./repositorio";
import { espelharLeadNovo, espelharAtribuicao } from "./espelho";
import { gravarLeadWhatsappSeNovo } from "./sheets";
import { registrar, mascararTelefone } from "./registro";

/** O token com `ads_read` que este cliente usa para ler a estrutura do anúncio. */
export function tokenDoCliente(tenant: Tenant): string {
  return tokenDeAnuncios(tenant.metaAds, tenant.conversoes?.meta?.accessToken);
}

/**
 * Nível 3 da atribuição: ad_id -> campanha/conjunto/anúncio, no banco e na
 * planilha. Usado tanto no fluxo do webhook quanto no job de retry.
 *
 * Recebe uma lista de linhas da planilha porque um anúncio que está rodando
 * gera vários leads: uma consulta à Meta resolve todos eles de uma vez.
 */
export async function enriquecerAnuncio(
  tenant: Tenant,
  adId: string,
  linhasPlanilha: (string | null)[]
): Promise<boolean> {
  const r = await buscarEstruturaAnuncio(adId, tokenDoCliente(tenant));

  if (!r.ok) {
    await registrarFalhaEnriquecimento(tenant.slug, adId, r.erro);
    return false;
  }

  await salvarEstruturaAnuncio(tenant.slug, adId, r.estrutura);

  for (const sheetLeadId of linhasPlanilha) {
    if (!sheetLeadId) continue;
    await espelharAtribuicao(tenant, sheetLeadId, {
      campanha: r.estrutura.campaignName,
      conjunto: r.estrutura.adsetName,
      anuncio: r.estrutura.adName,
    });
  }
  return true;
}

/** Uma mensagem: grava, espelha e tenta enriquecer. Não lança. */
async function processarMensagem(
  tenant: Tenant,
  ctx: ContextoEvento,
  m: MensagemWhatsApp
): Promise<void> {
  const atrib = atribuicaoDaMensagem(m);
  const r = await gravarMensagem(tenant, ctx, m, atrib);

  // §22: reenvio do Meta para aqui e para de andar
  if (r.estado === "duplicada") return;

  let sheetLeadId = r.sheetLeadId;

  if (r.estado === "criado") {
    sheetLeadId = await espelharLeadNovo(tenant, {
      nome: m.nomePerfil,
      telefone: m.telefone,
      primeiraMensagem: m.texto,
      ctwaClid: atrib.ctwaClid,
      deAnuncio: atrib.fonte === "meta_ads",
    });
    if (sheetLeadId) await salvarSheetLeadId(r.leadId, sheetLeadId);
  }

  if (r.precisaEnriquecer && r.adId) {
    await enriquecerAnuncio(tenant, r.adId, [sheetLeadId]);
  }
}

/**
 * Caminho antigo, para quem ainda não configurou o banco: grava direto na
 * planilha, um lead por telefone. Sem histórico de mensagens e sem a garantia
 * de idempotência do §22 — a checagem é uma varredura da planilha, que não
 * segura duas entregas simultâneas do mesmo evento.
 */
async function processarSemBanco(tenant: Tenant, evento: EventoWhatsApp): Promise<void> {
  registrar("banco_indisponivel", {
    cliente: tenant.slug,
    detalhe: "DATABASE_URL não configurada — gravando só na planilha, sem idempotência",
  });

  for (const m of evento.mensagens) {
    const atrib = atribuicaoDaMensagem(m);
    const dados: Record<string, string> = {
      Nome: m.nomePerfil,
      Telefone: m.telefone,
      Origem: atrib.fonte === "meta_ads" ? "WhatsApp (anúncio)" : "WhatsApp",
    };
    if (m.texto) dados["Primeira mensagem"] = m.texto;
    if (atrib.ctwaClid) dados["ctwa_clid"] = atrib.ctwaClid;

    try {
      await gravarLeadWhatsappSeNovo(tenant, m.telefone, dados);
    } catch (e) {
      registrar("planilha_falhou", {
        cliente: tenant.slug,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/**
 * Processa um evento inteiro do webhook. Um erro numa mensagem não derruba as
 * outras: o Meta reenviaria o lote todo, e as que já entraram voltariam como
 * duplicadas — mas as que falharam por um motivo pontual mereciam a chance.
 */
export async function processarEventoWhatsApp(
  tenant: Tenant,
  evento: EventoWhatsApp
): Promise<void> {
  if (!evento.mensagens.length) return;

  if (!bancoConfigurado()) {
    await processarSemBanco(tenant, evento);
    return;
  }

  const ctx: ContextoEvento = {
    wabaId: evento.wabaId,
    phoneNumberId: evento.phoneNumberId,
    displayPhoneNumber: evento.displayPhoneNumber,
  };

  for (const m of evento.mensagens) {
    try {
      await processarMensagem(tenant, ctx, m);
    } catch (e) {
      registrar("webhook_invalido", {
        cliente: tenant.slug,
        messageId: m.id,
        telefone: mascararTelefone(m.telefone),
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
