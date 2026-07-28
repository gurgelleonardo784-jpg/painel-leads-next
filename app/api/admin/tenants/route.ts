import { NextResponse } from "next/server";
import { ehAdmin } from "@/lib/auth";
import { listarTenants, criarTenant, montarDadosTenant, cadastroGravavel } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await ehAdmin())) {
    return NextResponse.json({ ok: false, erro: "admin" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, tenants: listarTenants(), gravavel: cadastroGravavel() });
}

export async function POST(req: Request) {
  if (!(await ehAdmin())) {
    return NextResponse.json({ ok: false, erro: "admin" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenant = criarTenant(montarDadosTenant(body));
    return NextResponse.json({ ok: true, tenant });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 400 }
    );
  }
}