import { NextResponse } from "next/server";
import { ehAdmin } from "@/lib/auth";
import { listarTenants } from "@/lib/tenants";
import { lerLeads } from "@/lib/sheets";
import { buscarInvestimento, tokenDeAnuncios } from "@/lib/metaAds";
import { calcular, ultimosDias, type Metricas } from "@/lib/metricas";

/**
 * Visão consolidada da agência: um resumo por cliente, com investimento e CPL.
 *
 * Aqui o servidor faz o trabalho todo — lê a planilha de cada cliente e busca o
 * gasto de cada conta de anúncios. Os clientes são processados em paralelo, e um
 * que falhe (planilha sem acesso, token vencido) vira uma linha com erro em vez
 * de derrubar o dashboard inteiro.
 */

export const dynamic = "force-dynamic";

export type LinhaCliente = {
  slug: string;
  nome: string;
  erro?: string;
  metricas?: Metricas;
};

export async function GET(req: Request) {
  if (!(await ehAdmin())) {
    return NextResponse.json({ ok: false, erro: "admin" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const dias = Math.min(Math.max(parseInt(sp.get("dias") || "30", 10) || 30, 1), 365);
  const periodo = ultimosDias(dias);

  const clientes = await Promise.all(
    listarTenants().map(async (t): Promise<LinhaCliente> => {
      if (!t.spreadsheetId) return { slug: t.slug, nome: t.nome, erro: "sem planilha" };

      try {
        // planilha e conta de anúncios são independentes: buscamos juntas
        const [leads, insights] = await Promise.all([
          lerLeads(t),
          t.metaAds?.adAccountId
            ? buscarInvestimento(
                t.metaAds,
                tokenDeAnuncios(t.metaAds, t.conversoes?.meta?.accessToken),
                periodo.desde,
                periodo.ate
              )
            : Promise.resolve(null),
        ]);

        const custo = !insights
          ? null
          : insights.ok
            ? { campanhas: insights.campanhas, moeda: insights.moeda }
            : { campanhas: [], moeda: "BRL", erro: insights.erro };

        return {
          slug: t.slug,
          nome: t.nome || t.slug,
          metricas: calcular(leads, t.status, periodo, custo),
        };
      } catch (e) {
        return {
          slug: t.slug,
          nome: t.nome || t.slug,
          erro: e instanceof Error ? e.message : "erro ao ler os dados",
        };
      }
    })
  );

  return NextResponse.json({ ok: true, periodo, clientes });
}
