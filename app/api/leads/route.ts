import { NextResponse } from "next/server";
import { tenantDaSessao } from "@/lib/auth";
import { lerLeads, gravarLeadWebhook } from "@/lib/sheets";

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

/**
 * Cadastro manual de lead (botão "Novo lead" do painel). Grava uma linha na
 * planilha do cliente pelo mesmo caminho do webhook — colunas que não existem
 * são criadas sozinhas.
 */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const tenant = await tenantDaSessao(String(corpo.slug || ""));
  if (!tenant) return NextResponse.json({ ok: false, erro: "sessao" }, { status: 401 });

  const txt = (v: unknown) => String(v ?? "").trim();
  const nome = txt(corpo.nome);
  const telefone = txt(corpo.telefone);

  if (!nome && !telefone) {
    return NextResponse.json(
      { ok: false, erro: "Informe ao menos o nome ou o telefone." },
      { status: 400 }
    );
  }

  const dados: Record<string, string> = { Origem: txt(corpo.origem) || "Cadastro manual" };
  if (nome) dados["Nome"] = nome;
  if (telefone) dados["Telefone"] = telefone;
  if (txt(corpo.email)) dados["Email"] = txt(corpo.email);
  if (txt(corpo.campanha)) dados["Campanha"] = txt(corpo.campanha);
  if (txt(corpo.nota)) dados["Anotações"] = txt(corpo.nota);

  try {
    await gravarLeadWebhook(tenant, dados);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro ao gravar" },
      { status: 500 }
    );
  }
}
