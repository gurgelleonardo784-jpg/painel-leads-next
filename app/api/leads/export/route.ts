import { tenantDaSessao } from "@/lib/auth";
import { carregarLeadsDoPainel } from "@/lib/leadsPainel";
import { tipoDoLead } from "@/lib/types";

/**
 * Exportação da lista de leads em CSV (§28).
 *
 * As colunas são as que a especificação pede, na ordem dela — inclusive o
 * `ctwa_clid`, que não aparece na tela mas é o que permite fechar o ciclo de
 * conversão depois.
 *
 * GET /api/leads/export?slug=acme
 */

export const dynamic = "force-dynamic";

/** Escapa um campo de CSV: aspas dobradas, e cerca quando há separador ou quebra. */
function campo(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ROTULO_ORIGEM: Record<string, string> = {
  attributed: "Anúncio",
  pending: "Anúncio (não identificado)",
  organic: "Orgânico",
  unknown: "Indefinido",
};

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tenant = await tenantDaSessao(sp.get("slug") || "");
  if (!tenant) return new Response("sessao", { status: 401 });

  // a mesma função da listagem: o CSV tem que trazer exatamente o que a tela mostra
  let leads;
  try {
    ({ leads } = await carregarLeadsDoPainel(tenant));
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "erro", { status: 500 });
  }

  const cabecalho = [
    "Nome",
    "Telefone",
    "Email",
    "Origem",
    "Campanha",
    "Conjunto",
    "Anúncio",
    "Data",
    "Status",
    "Atribuição",
    "Mensagens",
    "ctwa_clid",
  ];

  // ponto e vírgula: é o que o Excel em português entende como separador.
  // BOM na frente pelo mesmo motivo — sem ele, acento vira caractere estranho.
  const linhas = [cabecalho.join(";")];
  for (const l of leads) {
    const a = l.atribuicao;
    linhas.push(
      [
        l.nome,
        l.telefone,
        l.email,
        l.origem || (tipoDoLead(l) === "form" ? "Formulário" : ""),
        l.campanha,
        l.conjunto,
        l.anuncio,
        l.data,
        l.status,
        a ? ROTULO_ORIGEM[a.status] || a.status : "",
        a ? a.mensagens : "",
        a ? a.ctwaClid : "",
      ]
        .map(campo)
        .join(";")
    );
  }

  const hoje = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + linhas.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${tenant.slug}-${hoje}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
