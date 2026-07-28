import { NextResponse } from "next/server";
import { ehAdmin } from "@/lib/auth";
import { atualizarTenant, removerTenant, montarDadosTenant } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  if (!(await ehAdmin())) {
    return NextResponse.json({ ok: false, erro: "admin" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenant = atualizarTenant(slug, montarDadosTenant({ ...body, slug }));
    return NextResponse.json({ ok: true, tenant });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  if (!(await ehAdmin())) {
    return NextResponse.json({ ok: false, erro: "admin" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  try {
    removerTenant(slug);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 400 }
    );
  }
}