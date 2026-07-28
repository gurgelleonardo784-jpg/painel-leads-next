import { NextResponse } from "next/server";
import { getTenant, toPublico } from "@/lib/tenants";
import { criarSessao } from "@/lib/auth";
import { limitar, liberar, ipDaRequisicao } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const { slug, senha } = (await req.json().catch(() => ({}))) as {
    slug?: string;
    senha?: string;
  };

  const tenant = slug ? getTenant(slug) : null;
  if (!tenant) return NextResponse.json({ ok: false, erro: "tenant" }, { status: 404 });

  const chave = `login:${tenant.slug}:${ipDaRequisicao(req)}`;
  const limite = limitar(chave, 10, 300);
  if (!limite.ok) {
    return NextResponse.json(
      { ok: false, erro: `Muitas tentativas. Tente de novo em ${limite.esperarSeg}s.` },
      { status: 429, headers: { "Retry-After": String(limite.esperarSeg) } }
    );
  }

  if (tenant.senha && String(senha ?? "") !== tenant.senha) {
    return NextResponse.json({ ok: false, erro: "senha" }, { status: 401 });
  }

  liberar(chave);
  await criarSessao(tenant.slug);
  return NextResponse.json({ ok: true, tenant: toPublico(tenant) });
}
