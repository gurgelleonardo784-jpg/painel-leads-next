import { NextResponse } from "next/server";
import { tenantDaSessao } from "@/lib/auth";
import { bancoConfigurado } from "@/lib/db";
import { mensagensDoContato } from "@/lib/repositorio";

/**
 * Histórico da conversa de um contato, para o detalhe do lead (§25).
 *
 * Busca pelo telefone, que é o identificador lógico do contato dentro do
 * cliente (§23) — e sempre preso ao cliente da sessão, nunca ao slug que veio
 * na URL sem conferência (§43).
 *
 * GET /api/leads/mensagens?slug=acme&telefone=5585999999999
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tenant = await tenantDaSessao(sp.get("slug") || "");
  if (!tenant) return NextResponse.json({ ok: false, erro: "sessao" }, { status: 401 });

  const telefone = sp.get("telefone") || "";
  if (!telefone) return NextResponse.json({ ok: true, mensagens: [] });

  // sem banco não há histórico — a planilha guarda só a primeira mensagem
  if (!bancoConfigurado()) {
    return NextResponse.json({ ok: true, mensagens: [], semBanco: true });
  }

  try {
    return NextResponse.json({
      ok: true,
      mensagens: await mensagensDoContato(tenant.slug, telefone),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 500 }
    );
  }
}
