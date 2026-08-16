import { NextResponse } from "next/server";
import { tenantDaSessao } from "@/lib/auth";
import { salvarLead, registrarConversao, type SalvarCampos } from "@/lib/sheets";
import { enviarConversoes, resumoConversao } from "@/lib/conversoes";
import { registrarEventoPelaPlanilha } from "@/lib/eventosLead";

function agoraTexto(tz: string): string {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date())
    .forEach((x) => (p[x.type] = x.value));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { slug?: string } & SalvarCampos;
  const tenant = await tenantDaSessao(body.slug || "");
  if (!tenant) return NextResponse.json({ ok: false, erro: "sessao" }, { status: 401 });

  // lead que só existe no banco (prefixo "db:"): etapa e anotação moram na
  // planilha, então não há linha onde gravar. Recusa com o motivo, em vez de
  // deixar o salvarLead responder um genérico "lead não encontrado".
  if (id.startsWith("db:")) {
    return NextResponse.json(
      {
        ok: false,
        erro:
          "Este lead ainda não tem linha na planilha, então a etapa não pode ser salva. Configure a planilha do cliente ou rode a sincronização.",
      },
      { status: 409 }
    );
  }

  const campos: SalvarCampos = {};
  if (typeof body.status !== "undefined") campos.status = String(body.status);
  if (typeof body.nota !== "undefined") campos.nota = String(body.nota);
  if (typeof body.valor !== "undefined") {
    // negativo ou lixo vira 0, que limpa a célula em vez de gravar besteira
    const n = Number(body.valor);
    campos.valor = Number.isFinite(n) && n > 0 ? n : 0;
  }

  try {
    const res = await salvarLead(tenant, id, campos);

    // o histórico que a planilha não guarda: cada mudança de etapa e cada
    // anotação, com data. É o que permite responder depois "quanto tempo levou
    // para qualificar" e "há quantos dias está parado aqui".
    if (res.ok) {
      if (typeof campos.status !== "undefined") {
        await registrarEventoPelaPlanilha(tenant.slug, id, "etapa", { para: campos.status });
      }
      if (typeof campos.nota !== "undefined" && campos.nota.trim()) {
        await registrarEventoPelaPlanilha(tenant.slug, id, "anotacao", {
          texto: campos.nota.trim().slice(0, 500),
        });
      }
      if (typeof campos.valor !== "undefined") {
        await registrarEventoPelaPlanilha(tenant.slug, id, "valor", { valor: campos.valor });
      }
    }

    // Devolve a conversão à Meta/Google quando o status muda para um status configurado
    let conversao: string | null = null;
    if (
      res.ok &&
      typeof campos.status !== "undefined" &&
      res.identificadores &&
      tenant.conversoes &&
      tenant.conversoes.statusConversao.includes(campos.status)
    ) {
      const resultados = await enviarConversoes(tenant, res.identificadores, campos.status);
      conversao = resumoConversao(resultados, agoraTexto(tenant.tz));
      if (conversao) {
        await registrarConversao(tenant, id, conversao);
        await registrarEventoPelaPlanilha(tenant.slug, id, "conversao", {
          etapa: campos.status,
          resultado: conversao,
        });
      }
    }

    return NextResponse.json({ ...res, conversao }, { status: res.ok ? 200 : 404 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 500 }
    );
  }
}
