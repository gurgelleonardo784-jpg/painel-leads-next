/**
 * Log dos eventos do §36.
 *
 * Uma linha JSON por evento, com nome fixo. É o que permite achar depois "por
 * que este lead veio sem campanha" filtrando por `referral_ausente` ou
 * `graph_api_falhou` no log da hospedagem, em vez de ler texto solto.
 *
 * Nada de PII completa: telefone sai mascarado. O payload cru fica no banco
 * (messages.raw_payload, §21), que é lugar controlado — o log costuma ir para
 * serviços de terceiros.
 */

export type EventoLog =
  | "webhook_recebido"
  | "webhook_invalido"
  | "token_invalido"
  | "waba_invalida"
  | "phone_number_id_invalido"
  | "mensagem_duplicada"
  | "lead_criado"
  | "lead_atualizado"
  | "referral_encontrado"
  | "referral_ausente"
  | "ctwa_clid_encontrado"
  | "graph_api_consultada"
  | "graph_api_falhou"
  | "atribuicao_salva"
  | "clique_site"
  | "clique_casado"
  | "clique_nao_encontrado"
  | "planilha_espelhada"
  | "planilha_falhou"
  | "banco_indisponivel";

/** Eventos que significam "algo não funcionou" e devem sair como erro. */
const FALHAS = new Set<EventoLog>([
  "webhook_invalido",
  "token_invalido",
  "waba_invalida",
  "phone_number_id_invalido",
  "graph_api_falhou",
  "planilha_falhou",
  "banco_indisponivel",
]);

/** "5585999998888" -> "5585****8888": dá para reconhecer o lead sem expor o número. */
export function mascararTelefone(tel: string): string {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 8) return d ? "****" : "";
  return `${d.slice(0, 4)}****${d.slice(-4)}`;
}

export function registrar(evento: EventoLog, dados: Record<string, unknown> = {}): void {
  const linha = JSON.stringify({ evento, ...dados });
  if (FALHAS.has(evento)) console.error("[leads]", linha);
  else console.log("[leads]", linha);
}
