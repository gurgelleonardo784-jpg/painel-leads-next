/**
 * Espelho do lead na planilha do cliente.
 *
 * O banco é a fonte da verdade do rastreamento (mensagens, eventos de
 * atribuição, idempotência). Mas quem o cliente abre é o painel, e o painel lê
 * a planilha — então todo lead do WhatsApp continua ganhando a linha dele lá,
 * exatamente como antes. Sem isso, ligar o banco faria os leads sumirem da tela
 * do cliente, o que seria uma regressão e não uma entrega.
 *
 * O ciclo tem dois momentos, e é de propósito (§37):
 *   1. chegou a mensagem  -> grava a linha na hora, com telefone e texto.
 *      O lead nunca espera pela Meta.
 *   2. a Graph API respondeu -> volta na mesma linha e preenche campanha,
 *      conjunto e anúncio.
 *
 * Nunca escrevemos `referral.headline` na coluna "Campanha". Headline é o
 * título do anúncio, não o nome da campanha — era o que o painel fazia antes, e
 * fazia a tabela do §2 mostrar texto de criativo onde deveria haver campanha.
 */

import type { Tenant } from "./tenants";
import { gravarLeadWebhook, atualizarColunasLead } from "./sheets";
import { registrar } from "./registro";

export const COL_CAMPANHA = "Campanha";
export const COL_CONJUNTO = "Conjunto";
export const COL_ANUNCIO = "Anúncio";

export type DadosEspelho = {
  nome: string;
  telefone: string;
  primeiraMensagem: string;
  ctwaClid: string;
  /**
   * O rótulo do canal que vai na coluna "Origem": "WhatsApp (anúncio)",
   * "Google Ads", "Google orgânico"... É por esta coluna que o dashboard separa
   * os canais, então ela precisa dizer o canal, não só o meio de contato.
   */
  origem: string;
  /** o que já se sabe da campanha no momento em que a mensagem chega */
  campanha?: string;
  conjunto?: string;
  anuncio?: string;
  /** identificador de clique do Google, para devolver a conversão a eles */
  gclid?: string;
  /** resumo do rastreio (source, medium, palavra-chave) */
  utm?: string;
};

/** As colunas que dá para preencher no instante em que a mensagem chega. */
function colunasIniciais(d: DadosEspelho): Record<string, string> {
  const dados: Record<string, string> = {
    Nome: d.nome,
    Telefone: d.telefone,
    Origem: d.origem,
  };
  if (d.primeiraMensagem) dados["Primeira mensagem"] = d.primeiraMensagem;
  if (d.ctwaClid) dados["ctwa_clid"] = d.ctwaClid;
  if (d.gclid) dados["gclid"] = d.gclid;
  if (d.utm) dados["UTM"] = d.utm;
  // tráfego do site já chega com o nome da campanha quando o template de
  // acompanhamento manda utm_campaign; o do anúncio da Meta só depois
  if (d.campanha) dados[COL_CAMPANHA] = d.campanha;
  if (d.conjunto) dados[COL_CONJUNTO] = d.conjunto;
  if (d.anuncio) dados[COL_ANUNCIO] = d.anuncio;
  return dados;
}

/**
 * Grava a linha do lead novo. Devolve o ID da linha, ou "" se a planilha
 * recusou — falha de planilha não pode derrubar o webhook, o lead já está
 * salvo no banco de qualquer jeito, e o job de sincronização tenta de novo.
 */
export async function espelharLeadNovo(tenant: Tenant, d: DadosEspelho): Promise<string> {
  try {
    const id = await gravarLeadWebhook(tenant, colunasIniciais(d));
    registrar("planilha_espelhada", { cliente: tenant.slug, sheetLeadId: id });
    return id;
  } catch (e) {
    registrar("planilha_falhou", {
      cliente: tenant.slug,
      erro: e instanceof Error ? e.message : String(e),
    });
    return "";
  }
}

/** Preenche campanha/conjunto/anúncio na linha que já existe. */
export async function espelharAtribuicao(
  tenant: Tenant,
  sheetLeadId: string,
  dados: { campanha: string; conjunto: string; anuncio: string }
): Promise<void> {
  if (!sheetLeadId) return;
  try {
    await atualizarColunasLead(tenant, sheetLeadId, {
      [COL_CAMPANHA]: dados.campanha,
      [COL_CONJUNTO]: dados.conjunto,
      [COL_ANUNCIO]: dados.anuncio,
    });
  } catch (e) {
    registrar("planilha_falhou", {
      cliente: tenant.slug,
      sheetLeadId,
      erro: e instanceof Error ? e.message : String(e),
    });
  }
}
