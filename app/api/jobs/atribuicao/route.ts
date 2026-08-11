import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenants";
import { bancoConfigurado } from "@/lib/db";
import { leadsAEnriquecer, leadsSemEspelho, salvarSheetLeadId } from "@/lib/repositorio";
import { enriquecerAnuncio } from "@/lib/processarWhatsapp";
import { espelharLeadNovo } from "@/lib/espelho";
import { registrar } from "@/lib/registro";

/**
 * Job de sincronização da atribuição (§37).
 *
 * O lead entra na hora que a mensagem chega, com telefone e primeira mensagem.
 * Se a Graph API estiver fora, ou o token sem permissão naquele instante, o
 * `campaign_name` fica nulo — e é este job que volta depois e preenche.
 *
 * Também conserta o caso oposto: lead que entrou no banco mas cuja linha na
 * planilha falhou. Sem isso ele existiria só no banco, invisível para o cliente.
 *
 * Chamada esperada (cron da hospedagem, a cada 15 min):
 *   GET /api/jobs/atribuicao
 *   Authorization: Bearer $CRON_SECRET
 *
 * Aceita `?cliente=slug` para rodar só um cliente, e `?limite=N`.
 */

export const dynamic = "force-dynamic";
// o job faz várias chamadas de rede em sequência; o padrão de 10s não basta
export const maxDuration = 60;

function autorizado(req: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  const cabecalho = req.headers.get("authorization") || "";
  return cabecalho === `Bearer ${segredo}`;
}

async function rodar(req: Request) {
  if (!process.env.CRON_SECRET) {
    // sem segredo o endpoint ficaria aberto, e ele gasta cota da Graph API e
    // escreve na planilha do cliente — recusar é mais seguro que liberar
    return NextResponse.json(
      { ok: false, erro: "CRON_SECRET não configurado — o job fica desligado." },
      { status: 503 }
    );
  }
  if (!autorizado(req)) {
    registrar("token_invalido", { origem: "job_atribuicao" });
    return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });
  }
  if (!bancoConfigurado()) {
    return NextResponse.json(
      { ok: false, erro: "DATABASE_URL não configurada — não há fila para processar." },
      { status: 503 }
    );
  }

  const sp = new URL(req.url).searchParams;
  const slug = sp.get("cliente") || undefined;
  const limite = Math.min(Math.max(Number(sp.get("limite")) || 100, 1), 300);

  let enriquecidos = 0;
  let falhas = 0;
  let espelhados = 0;

  /* ---- 1. atribuição pendente: ad_id sem nome de campanha ---- */

  const pendentes = await leadsAEnriquecer(limite, slug);

  // um anúncio que está rodando gera muitos leads; agrupamos para consultar a
  // Meta uma vez por anúncio, não uma vez por lead
  const porAnuncio = new Map<string, { slug: string; adId: string; linhas: (string | null)[] }>();
  for (const l of pendentes) {
    const chave = `${l.slug}|${l.adId}`;
    const grupo = porAnuncio.get(chave) || { slug: l.slug, adId: l.adId, linhas: [] };
    grupo.linhas.push(l.sheetLeadId);
    porAnuncio.set(chave, grupo);
  }

  for (const grupo of porAnuncio.values()) {
    const tenant = getTenant(grupo.slug);
    if (!tenant) continue; // cliente removido do cadastro depois do lead entrar
    try {
      if (await enriquecerAnuncio(tenant, grupo.adId, grupo.linhas)) enriquecidos++;
      else falhas++;
    } catch (e) {
      falhas++;
      registrar("graph_api_falhou", {
        cliente: grupo.slug,
        adId: grupo.adId,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /* ---- 2. leads no banco que não conseguiram linha na planilha ---- */

  for (const lead of await leadsSemEspelho(25, slug)) {
    const tenant = getTenant(lead.slug);
    if (!tenant) continue;
    const sheetLeadId = await espelharLeadNovo(tenant, {
      nome: lead.nome,
      telefone: lead.telefone,
      primeiraMensagem: lead.primeiraMensagem,
      ctwaClid: lead.ctwaClid,
      gclid: lead.gclid,
      origem: lead.origem,
      campanha: lead.campanha,
      conjunto: lead.conjunto,
      anuncio: lead.anuncio,
    });
    if (sheetLeadId) {
      await salvarSheetLeadId(lead.id, sheetLeadId);
      espelhados++;
    }
  }

  return NextResponse.json({
    ok: true,
    leadsPendentes: pendentes.length,
    anunciosConsultados: porAnuncio.size,
    enriquecidos,
    falhas,
    espelhados,
  });
}

export async function GET(req: Request) {
  return rodar(req);
}

export async function POST(req: Request) {
  return rodar(req);
}
