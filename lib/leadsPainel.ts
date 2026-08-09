/**
 * A lista de leads que o painel consome, costurada das duas fontes.
 *
 * A planilha manda no que o cliente edita: etapa, anotação, valor, respostas do
 * formulário. O banco manda na atribuição: de qual anúncio veio, com que
 * confiança, quantas mensagens trocou.
 *
 * Onde as duas se sobrepõem — campanha, conjunto, anúncio — o banco ganha,
 * porque é ele que tem o nome que a Graph API confirmou. A planilha preenche a
 * lacuna, o que mantém funcionando o cliente que digita a campanha à mão e o
 * lead de formulário, que não passa pelo banco.
 *
 * Nenhuma das duas fontes pode derrubar a outra: planilha fora, aparecem os
 * leads do banco; banco fora, aparecem os da planilha. Vive aqui, e não nas
 * rotas, porque a listagem e a exportação em CSV têm que mostrar exatamente a
 * mesma coisa.
 */

import type { Tenant } from "./tenants";
import type { Lead } from "./types";
import { lerLeads } from "./sheets";
import { bancoConfigurado } from "./db";
import { atribuicaoPorTelefone, acharAtribuicao, leadsDoBanco } from "./repositorio";
import { registrar } from "./registro";

export type LeadsDoPainel = {
  leads: Lead[];
  /** quantos vieram só do banco, sem linha na planilha */
  semPlanilha: number;
  /** vazio quando a planilha respondeu normalmente */
  erroPlanilha: string;
};

/** Todas as formas do mesmo telefone que usamos para casar as duas fontes. */
function chaves(telefone: string): string[] {
  const d = String(telefone || "").replace(/\D/g, "");
  if (!d) return [];
  const curto = d.slice(-10);
  return curto.length === 10 && curto !== d ? [d, curto] : [d];
}

export async function carregarLeadsDoPainel(tenant: Tenant): Promise<LeadsDoPainel> {
  const comBanco = bancoConfigurado();

  let daPlanilha: Lead[] = [];
  let erroPlanilha = "";
  try {
    if (tenant.spreadsheetId) daPlanilha = await lerLeads(tenant);
  } catch (e) {
    erroPlanilha = e instanceof Error ? e.message : "erro ao ler a planilha";
    // sem banco não há outra fonte: quem chamou decide se isso é fatal
    if (!comBanco) throw e;
    registrar("planilha_falhou", { cliente: tenant.slug, erro: erroPlanilha });
  }

  if (!comBanco) return { leads: daPlanilha, semPlanilha: 0, erroPlanilha };

  let mapa;
  try {
    mapa = await atribuicaoPorTelefone(tenant.slug);
  } catch (e) {
    registrar("banco_indisponivel", {
      cliente: tenant.slug,
      detalhe: "atribuição não carregada",
      erro: e instanceof Error ? e.message : String(e),
    });
    // banco fora não derruba o painel
    if (erroPlanilha) throw e;
    return { leads: daPlanilha, semPlanilha: 0, erroPlanilha };
  }

  const comAtribuicao = daPlanilha.map((l) => {
    const a = acharAtribuicao(mapa, l.telefone);
    return a
      ? {
          ...l,
          campanha: a.campanha || l.campanha,
          conjunto: a.conjunto || l.conjunto,
          anuncio: a.anuncio || l.anuncio,
          atribuicao: a,
        }
      : l;
  });

  // quem está no banco e não tem linha na planilha ficaria invisível — o pior
  // resultado possível: o lead entrou, foi cobrado no anúncio, e ninguém atende
  const naPlanilha = new Set<string>();
  for (const l of comAtribuicao) for (const k of chaves(l.telefone)) naPlanilha.add(k);

  const soNoBanco = (await leadsDoBanco(tenant.slug, tenant.ddiPadrao))
    .filter((l) => !chaves(l.telefone).some((k) => naPlanilha.has(k)))
    // sem etapa não cairiam em nenhuma coluna do pipeline; a primeira é onde um
    // lead novo entra mesmo
    .map((l) => ({ ...l, status: tenant.status[0] }));

  // os do banco são os mais recentes: entram na frente, como a planilha faz
  const leads = [...soNoBanco, ...comAtribuicao].map((l, i) => ({ ...l, ordem: i }));

  return { leads, semPlanilha: soNoBanco.length, erroPlanilha };
}
