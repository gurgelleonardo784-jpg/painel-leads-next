import { NextResponse } from "next/server";
import { conferirSenhaAdmin, criarSessaoAdmin, senhaAdminConfigurada } from "@/lib/auth";
import { limitar, liberar, ipDaRequisicao } from "@/lib/rateLimit";

export async function POST(req: Request) {
  if (!senhaAdminConfigurada()) {
    return NextResponse.json(
      { ok: false, erro: "ADMIN_SENHA não configurada no servidor (.env.local)." },
      { status: 500 }
    );
  }

  // o admin abre o cadastro de todos os clientes: freio mais curto que o deles
  const chave = `admin:${ipDaRequisicao(req)}`;
  const limite = limitar(chave, 5, 600);
  if (!limite.ok) {
    return NextResponse.json(
      { ok: false, erro: `Muitas tentativas. Tente de novo em ${limite.esperarSeg}s.` },
      { status: 429, headers: { "Retry-After": String(limite.esperarSeg) } }
    );
  }

  const { senha } = (await req.json().catch(() => ({}))) as { senha?: string };
  if (!conferirSenhaAdmin(String(senha ?? ""))) {
    return NextResponse.json({ ok: false, erro: "senha" }, { status: 401 });
  }

  liberar(chave);
  await criarSessaoAdmin();
  return NextResponse.json({ ok: true });
}