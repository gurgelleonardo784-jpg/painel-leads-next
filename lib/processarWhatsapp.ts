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
import {
  atribuicaoDaMensagem,
  atribuicaoDoClique,
  buscarEstruturaAnuncio,
  type Atribuicao,
} from "./atribuicao";
import { tokenNoTexto, acharClique, marcarCliqueUsado, cliqueParaAtribuir } from "./cliques";
import { ROTULO_CANAL, type Canal } from "./canal";
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

/**
 * O rótulo que vai na coluna "Origem" da planilha.
 *
 * É por essa coluna que o dashboard separa canais, então ela tem que dizer o
 * canal e não só "veio pelo WhatsApp". Lead do WhatsApp sem origem conhecida
 * continua "WhatsApp", que é a verdade: sabemos o meio, não a origem.
 */
function origemParaPlanilha(a: Atribuicao): string {
  if (a.fonte === "meta_ads") return "WhatsApp (anúncio)";
  if (a.fonte === "organic" || a.fonte === "unknown") return "WhatsApp";
  return ROTULO_CANAL[a.fonte as Canal] || "WhatsApp";
}

/**
 * A atribuição de uma conversa, olhando as duas origens possíveis.
 *
 * O anúncio da Meta se identifica sozinho: vem `referral` no próprio evento.
 * O tráfego do site não — quem buscou no Google, entrou no site e clicou no
 * botão do WhatsApp chega aqui indistinguível de quem já tinha o número. Para
 * esse caso o sinal é o código que o `/api/ir/<slug>` colocou na mensagem
 * pré-preenchida.
 *
 * Ordem: o `referral` ganha. Se a Meta afirma que o clique foi no anúncio dela,
 * é isso — um código de site na mesma mensagem seria de uma visita anterior.
 */
async function atribuicaoDaConversa(
  tenant: Tenant,
  m: MensagemWhatsApp
): Promise<Atribuicao> {
  const daMeta = atribuicaoDaMensagem(m);
  if (m.referral || daMeta.ctwaClid) return daMeta;

  const token = tokenNoTexto(m.texto);
  if (!token) return daMeta;

  const clique = await acharClique(tenant.slug, token);
  if (!clique) {
    // token inventado, expirado, ou mensagem copiada de outra conversa.
    // Não vira origem nenhuma — melhor sem atribuição que com a errada.
    registrar("clique_nao_encontrado", { cliente: tenant.slug, messageId: m.id });
    return daMeta;
  }

  // o crédito pode ser de um clique anterior: quem veio pelo anúncio e voltou
  // pelo orgânico não deve virar lead orgânico
  const creditado = await cliqueParaAtribuir(tenant.slug, clique);

  registrar("clique_casado", {
    cliente: tenant.slug,
    messageId: m.id,
    canal: creditado.canal,
    campanha: creditado.campanha || null,
    resgatouToquePago: creditado.canal !== clique.canal || undefined,
  });
  return atribuicaoDoClique(creditado);
}

/** Uma mensagem: grava, espelha e tenta enriquecer. Não lança. */
async function processarMensagem(
  tenant: Tenant,
  ctx: ContextoEvento,
  m: MensagemWhatsApp
): Promise<void> {
  const atrib = await atribuicaoDaConversa(tenant, m);
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
      origem: origemParaPlanilha(atrib),
      campanha: atrib.campanha,
      conjunto: atrib.conjunto,
      anuncio: atrib.anuncio,
      gclid: atrib.gclid,
      utm: atrib.utm,
    });
    if (sheetLeadId) await salvarSheetLeadId(r.leadId, sheetLeadId);
  }

  // o clique do site só conta como consumido depois de existir o lead — assim
  // "clique sem conversa" continua sendo um número confiável
  if (atrib.cliqueId) await marcarCliqueUsado(atrib.cliqueId, r.leadId);

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
