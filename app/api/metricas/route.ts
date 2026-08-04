import { NextResponse } from "next/server";
import { tenantDaSessao } from "@/lib/auth";
import { buscarInvestimento, tokenDeAnuncios } from "@/lib/metaAds";
import { ultimosDias } from "@/lib/metricas";

/**
 * Investimento do cliente logado, para o dashboard dele.
 *
 * As métricas de volume (leads, funil, origens) o painel calcula no próprio
 * navegador — ele já tem a lista de leads em mãos. O que só o servidor pode
 * buscar é o gasto na conta de anúncios, e é só isso que sai daqui.
 *
 * Custo de mídia é informação da agência: só responde se o cliente estiver
 * marcado como "mostrar custo" no cadastro.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slug = sp.get("slug") || "";
  const dias = Math.min(Math.max(parseInt(sp.get("dias") || "30", 10) || 30, 1), 365);

  const tenant = await tenantDaSessao(slug);
  if (!tenant) return NextResponse.json({ ok: false, erro: "sessao" }, { status: 401 });

  if (!tenant.mostrarCustoAoCliente || !tenant.metaAds?.adAccountId) {
    return NextResponse.json({ ok: true, custo: null });
  }

  const periodo = ultimosDias(dias);
  const token = tokenDeAnuncios(tenant.metaAds, tenant.conversoes?.meta?.accessToken);

  // campanha e anúncio são duas chamadas independentes; vão juntas
  const [porCampanha, porAnuncio] = await Promise.all([
    buscarInvestimento(tenant.metaAds, token, periodo.desde, periodo.ate, "campaign"),
    buscarInvestimento(tenant.metaAds, token, periodo.desde, periodo.ate, "ad"),
  ]);

  if (!porCampanha.ok) {
    // o dashboard continua útil sem o custo; o erro aparece discreto na tela
    return NextResponse.json({
      ok: true,
      custo: { campanhas: [], moeda: "BRL", erro: porCampanha.erro },
    });
  }

  return NextResponse.json({
    ok: true,
    custo: {
      campanhas: porCampanha.campanhas,
      anuncios: porAnuncio.ok ? porAnuncio.campanhas : [],
      moeda: porCampanha.moeda,
    },
  });
}
