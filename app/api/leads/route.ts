import { NextResponse } from "next/server";
import { tenantDaSessao } from "@/lib/auth";
import { lerLeads } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  const tenant = await tenantDaSessao(slug);
  if (!tenant) return NextResponse.json({ ok: false, erro: "sessao" }, { status: 401 });

  try {
    const leads = await lerLeads(tenant);
    return NextResponse.json({
      ok: true,
      leads,
      status: tenant.status,
      atualizadoEm: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 500 }
    );
  }
}
