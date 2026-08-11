/**
 * O que aconteceu com o lead depois de ele entrar.
 *
 * A planilha guarda o estado atual, nunca a mudança: dá para saber que o lead
 * está "Qualificado", não quando virou, nem quanto tempo levou, nem há quantos
 * dias está parado. É exatamente o que o cliente cobra do atendimento, e é o que
 * esta tabela passa a responder.
 *
 * Mensagens e cliques do site não entram aqui — cada um já tem tabela própria, e
 * duplicar criaria duas versões da mesma verdade. A linha do tempo do painel
 * junta as três fontes só na hora de mostrar.
 */

import { consultar, bancoConfigurado } from "./db";

export type TipoEvento = "criado" | "etapa" | "anotacao" | "conversao";

export type EventoLead = {
  tipo: TipoEvento;
  em: string;
  /** carga específica do tipo: etapa nova, texto da anotação, resultado do envio */
  dados: Record<string, unknown>;
};

/**
 * Acha o lead do banco a partir do ID da linha da planilha.
 *
 * O painel edita pelo ID da planilha (é de lá que vem a lista), mas o histórico
 * mora no banco. `sheet_lead_id` é a ponte. Devolve nulo para lead que não passou
 * pelo banco — lead de formulário, por exemplo — e aí simplesmente não há
 * histórico para gravar.
 */
export async function leadPorIdDaPlanilha(slug: string, sheetLeadId: string): Promise<string | null> {
  if (!sheetLeadId) return null;
  const rows = await consultar<{ id: string }>(
    `SELECT l.id::text AS id
       FROM leads l JOIN clients c ON c.id = l.client_id
      WHERE c.slug = $1 AND l.sheet_lead_id = $2
      LIMIT 1`,
    [slug, sheetLeadId]
  );
  return rows.length ? rows[0].id : null;
}

/**
 * Registra um evento. Nunca lança: perder uma linha de histórico é ruim, impedir
 * o cliente de mudar a etapa do lead por causa disso é pior.
 */
export async function registrarEvento(
  leadId: string,
  tipo: TipoEvento,
  dados: Record<string, unknown> = {}
): Promise<void> {
  if (!bancoConfigurado() || !leadId) return;
  try {
    await consultar(
      `INSERT INTO lead_events (lead_id, tipo, dados) VALUES ($1::bigint, $2, $3::jsonb)`,
      [leadId, tipo, JSON.stringify(dados)]
    );
  } catch (e) {
    console.error("[leads] evento não registrado:", e instanceof Error ? e.message : e);
  }
}

/** Atalho para o caminho do painel, que só tem o ID da planilha na mão. */
export async function registrarEventoPelaPlanilha(
  slug: string,
  sheetLeadId: string,
  tipo: TipoEvento,
  dados: Record<string, unknown> = {}
): Promise<void> {
  if (!bancoConfigurado()) return;
  try {
    const leadId = await leadPorIdDaPlanilha(slug, sheetLeadId);
    if (leadId) await registrarEvento(leadId, tipo, dados);
  } catch (e) {
    console.error("[leads] evento não registrado:", e instanceof Error ? e.message : e);
  }
}

/** Os eventos de um lead, do mais antigo para o mais novo. */
export async function eventosDoLead(slug: string, leadId: string): Promise<EventoLead[]> {
  const rows = await consultar<{ tipo: string; dados: Record<string, unknown> | null; em: Date }>(
    `SELECT e.tipo, e.dados, e.em
       FROM lead_events e
       JOIN leads l   ON l.id = e.lead_id
       JOIN clients c ON c.id = l.client_id
      WHERE c.slug = $1 AND e.lead_id = $2::bigint
      ORDER BY e.em ASC`,
    [slug, leadId]
  );
  return rows.map((r) => ({
    tipo: r.tipo as TipoEvento,
    em: r.em.toISOString(),
    dados: r.dados || {},
  }));
}
