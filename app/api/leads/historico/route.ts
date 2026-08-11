import { NextResponse } from "next/server";
import { tenantDaSessao } from "@/lib/auth";
import { bancoConfigurado } from "@/lib/db";
import { mensagensDoContato, leadIdPorTelefone } from "@/lib/repositorio";
import { jornadaDoLead } from "@/lib/cliques";
import { eventosDoLead } from "@/lib/eventosLead";
import { ROTULO_CANAL, type Canal } from "@/lib/canal";

/**
 * A história completa de um contato, numa lista só.
 *
 * Junta três fontes que vivem em tabelas separadas de propósito — cliques no
 * site, mensagens do WhatsApp e eventos do lead — e devolve tudo em ordem
 * cronológica, pronto para virar linha do tempo na tela.
 *
 * A junção acontece aqui, na leitura, e não na gravação: cada tabela continua
 * sendo a única dona do que ela guarda, e não existe uma quarta cópia dos mesmos
 * fatos para sair de sincronia.
 *
 * GET /api/leads/historico?slug=acme&telefone=5585999999999
 */

export const dynamic = "force-dynamic";

/** Um item da linha do tempo, já em linguagem de negócio. */
type Item = {
  tipo: "visita" | "mensagem" | "etapa" | "anotacao" | "conversao";
  em: string;
  titulo: string;
  detalhe?: string;
  /** para a mensagem: entrada ou saída */
  direcao?: string;
  /** destaca o momento em que a visita virou conversa */
  destaque?: boolean;
};

/** "https://cliente.com.br/blog/direitos" -> "/blog/direitos" */
function caminho(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "página inicial" : u.pathname;
  } catch {
    return url;
  }
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tenant = await tenantDaSessao(sp.get("slug") || "");
  if (!tenant) return NextResponse.json({ ok: false, erro: "sessao" }, { status: 401 });

  const telefone = sp.get("telefone") || "";
  if (!telefone || !bancoConfigurado()) {
    return NextResponse.json({ ok: true, itens: [], semBanco: !bancoConfigurado() });
  }

  try {
    const leadId = await leadIdPorTelefone(tenant.slug, telefone);
    if (!leadId) return NextResponse.json({ ok: true, itens: [] });

    // sequencial, não em paralelo: são três consultas pequenas, e disputar
    // conexões do pool para ganhar alguns milissegundos não paga o risco de
    // esgotar o limite justamente quando o painel está sendo usado
    const mensagens = await mensagensDoContato(tenant.slug, telefone);
    const jornada = await jornadaDoLead(tenant.slug, leadId);
    const eventos = await eventosDoLead(tenant.slug, leadId);

    const itens: Item[] = [];

    // 1. as visitas ao site, antes de qualquer mensagem
    for (const p of jornada) {
      const canal = ROTULO_CANAL[p.canal as Canal] || p.canal;
      const onde = caminho(p.pagina);
      itens.push({
        tipo: "visita",
        em: p.em,
        titulo: p.converteu ? `Clicou no WhatsApp — ${canal}` : `Visitou o site — ${canal}`,
        detalhe: [p.campanha, onde].filter(Boolean).join(" · "),
        destaque: p.converteu,
      });
    }

    // 2. a conversa
    mensagens.forEach((m, i) => {
      itens.push({
        tipo: "mensagem",
        em: m.em,
        titulo: i === 0 ? "Primeira mensagem" : m.direcao === "out" ? "Mensagem enviada" : "Mensagem recebida",
        detalhe: m.texto || `(${m.tipo})`,
        direcao: m.direcao,
      });
    });

    // 3. o que o atendimento fez depois
    for (const e of eventos) {
      if (e.tipo === "etapa") {
        itens.push({
          tipo: "etapa",
          em: e.em,
          titulo: `Etapa alterada para ${String(e.dados.para || "—")}`,
        });
      } else if (e.tipo === "anotacao") {
        itens.push({ tipo: "anotacao", em: e.em, titulo: "Anotação", detalhe: String(e.dados.texto || "") });
      } else if (e.tipo === "conversao") {
        itens.push({
          tipo: "conversao",
          em: e.em,
          titulo: "Conversão enviada à plataforma de anúncio",
          detalhe: String(e.dados.etapa || ""),
        });
      }
    }

    // desempate por tipo quando dois eventos caem no mesmo segundo: sem isso a
    // ordem fica ao gosto do array e a história aparece embaralhada. A sequência
    // natural é visitar, conversar, e só então o atendimento agir.
    const PESO: Record<Item["tipo"], number> = {
      visita: 0,
      mensagem: 1,
      etapa: 2,
      anotacao: 3,
      conversao: 4,
    };
    itens.sort((a, b) => a.em.localeCompare(b.em) || PESO[a.tipo] - PESO[b.tipo]);

    return NextResponse.json({ ok: true, itens, visitas: jornada.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "erro" },
      { status: 500 }
    );
  }
}
