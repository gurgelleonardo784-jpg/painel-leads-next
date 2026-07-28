import { NextResponse } from "next/server";
import { getTenant, toPublico } from "@/lib/tenants";
import { criarSessao } from "@/lib/auth";

export async function POST(req: Request) {
  const { slug, senha } = (await req.json().catch(() => ({}))) as {
    slug?: string;
    senha?: string;
  };

  const tenant = slug ? getTenant(slug) : null;
  if (!tenant) return NextResponse.json({ ok: false, erro: "tenant" }, { status: 404 });

  if (tenant.senha && String(senha ?? "") !== tenant.senha) {
    return NextResponse.json({ ok: false, erro: "senha" }, { status: 401 });
  }

  await criarSessao(tenant.slug);
  return NextResponse.json({ ok: true, tenant: toPublico(tenant) });
}
