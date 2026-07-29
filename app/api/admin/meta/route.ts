import { NextResponse } from "next/server";
import { ehAdmin } from "@/lib/auth";
import { listarContas, testarConta } from "@/lib/metaAds";

/**
 * Conexão da conta de anúncios, usada na hora de cadastrar o cliente.
 *
 *   acao: "listar"  -> devolve as contas que o token enxerga
 *   acao: "testar"  -> confirma que dá para ler o gasto daquela conta
 *
 * É POST (e não GET) de propósito: assim o token vai no corpo, e não na URL,
 * onde ficaria registrado em log de servidor e histórico do navegador.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await ehAdmin())) {
    return NextResponse.json({ ok: false, erro: "admin" }, { status: 401 });
  }

  const corpo = (await req.json().catch(() => ({}))) as {
    acao?: string;
    token?: string;
    adAccountId?: string;
  };

  // sem token no corpo, cai no token da agência (META_ADS_TOKEN)
  const token = String(corpo.token || "").trim() || process.env.META_ADS_TOKEN || "";

  if (corpo.acao === "listar") {
    const r = await listarContas(token);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (corpo.acao === "testar") {
    const r = await testarConta(String(corpo.adAccountId || ""), token);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, erro: "ação desconhecida" }, { status: 400 });
}
