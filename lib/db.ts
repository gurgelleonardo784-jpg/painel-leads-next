/**
 * Conexão com o Postgres.
 *
 * A planilha continua sendo o que o painel lê. Este banco existe para o que a
 * planilha não dá conta: histórico de mensagens, eventos de atribuição e,
 * principalmente, a idempotência do §22 — que precisa de uma restrição única
 * de verdade, não de uma varredura de linhas.
 *
 * O pool é um singleton preso ao globalThis: em desenvolvimento o Next recarrega
 * o módulo a cada mudança, e sem isso cada recarga abriria um pool novo até
 * estourar o limite de conexões do servidor.
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __poolLeads: Pool | undefined;
}

/** O banco é opcional: sem DATABASE_URL o webhook cai no caminho antigo (só planilha). */
export function bancoConfigurado(): boolean {
  return !!process.env.DATABASE_URL;
}

function criarPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não está definida. Rode `npm run migrar` depois de criar o banco (veja o .env.example)."
    );
  }

  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);

  /**
   * TLS verificado de verdade, por padrão.
   *
   * Neon, Supabase e Railway usam certificado público válido, então a
   * verificação completa funciona — e é ela que garante que o banco do outro
   * lado é mesmo o seu. Desligar a verificação, que é o atalho comum, aceita
   * qualquer certificado e deixa a conexão aberta a um intermediário, com as
   * credenciais e os dados dos leads passando por ali.
   *
   * `DATABASE_SSL_INSEGURO=1` existe como escape para banco com certificado
   * autoassinado (servidor próprio). É opt-in explícito, nunca o padrão.
   */
  const inseguro = process.env.DATABASE_SSL_INSEGURO === "1";

  return new Pool({
    connectionString: url,
    ssl: local ? undefined : inseguro ? { rejectUnauthorized: false } : true,
    // serverless abre muitos processos; poucas conexões por processo, e não
    // deixa nenhuma parada de graça segurando vaga no servidor
    max: Number(process.env.DATABASE_MAX_CONEXOES || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!globalThis.__poolLeads) {
    const p = criarPool();
    // sem este handler, um erro num cliente ocioso derruba o processo inteiro
    p.on("error", (e) => console.error("[db] erro no cliente ocioso:", e.message));
    globalThis.__poolLeads = p;
  }
  return globalThis.__poolLeads;
}

export async function consultar<T extends QueryResultRow>(
  texto: string,
  valores: unknown[] = []
): Promise<T[]> {
  const res = await pool().query<T>(texto, valores);
  return res.rows;
}

/**
 * Roda a função dentro de uma transação, com COMMIT no fim e ROLLBACK em
 * qualquer erro. É o que permite tratar "lead + mensagem" como uma coisa só:
 * se a mensagem for duplicada, o lead também não é tocado.
 */
export async function emTransacao<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool().connect();
  try {
    await cliente.query("BEGIN");
    const r = await fn(cliente);
    await cliente.query("COMMIT");
    return r;
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/** Sinal usado pela transação de gravação para abortar sem virar erro de verdade. */
export class MensagemDuplicada extends Error {
  constructor(public readonly messageId: string) {
    super(`mensagem ${messageId} já processada`);
    this.name = "MensagemDuplicada";
  }
}
