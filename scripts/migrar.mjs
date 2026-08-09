// Cria/atualiza as tabelas do banco de leads. Rode: npm run migrar
//
// Aplica lib/schema.sql inteiro, que é escrito para ser idempotente
// (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS). Rodar duas vezes
// não faz nada na segunda. Não apaga nem altera dado existente.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const raiz = process.cwd();
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const falta = (m) => console.log("  \x1b[31m✗\x1b[0m " + m);

function carregarEnv() {
  for (const nome of [".env.local", ".env"]) {
    const arq = path.join(raiz, nome);
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
      const t = linha.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const chave = t.slice(0, i).trim();
      let valor = t.slice(i + 1).trim();
      if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1);
      if (!(chave in process.env)) process.env[chave] = valor;
    }
  }
}

async function main() {
  carregarEnv();

  const url = process.env.DATABASE_URL;
  if (!url) {
    falta("DATABASE_URL não está definida no .env.local.");
    console.log(
      "\n  Crie um Postgres (Neon, Supabase, Railway ou local) e cole a string de\n" +
        "  conexão em DATABASE_URL. Exemplo:\n" +
        "  DATABASE_URL=postgresql://usuario:senha@host/banco?sslmode=require\n"
    );
    process.exit(1);
  }

  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
  const cliente = new pg.Client({
    connectionString: url,
    ssl: local ? undefined : { rejectUnauthorized: false },
  });

  const sql = fs.readFileSync(path.join(raiz, "lib", "schema.sql"), "utf8");

  console.log("\n\x1b[1mMigrando o banco de leads\x1b[0m");
  try {
    await cliente.connect();
    ok("Conectou no Postgres");
  } catch (e) {
    falta("Não conseguiu conectar: " + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }

  try {
    // schema.sql é idempotente, mas ainda assim vai tudo ou não vai nada
    await cliente.query("BEGIN");
    await cliente.query(sql);
    await cliente.query("COMMIT");
    ok("Schema aplicado (lib/schema.sql)");
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    falta("Erro ao aplicar o schema: " + (e && e.message ? e.message : String(e)));
    await cliente.end();
    process.exit(1);
  }

  const { rows } = await cliente.query(
    `SELECT table_name, (SELECT count(*) FROM information_schema.columns c
                          WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS colunas
       FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_name IN ('clients','whatsapp_accounts','leads','messages','attribution_events')
      ORDER BY t.table_name`
  );
  for (const r of rows) ok(`${r.table_name} (${r.colunas} colunas)`);

  const esperadas = ["attribution_events", "clients", "leads", "messages", "whatsapp_accounts"];
  const faltando = esperadas.filter((n) => !rows.some((r) => r.table_name === n));
  if (faltando.length) {
    falta("Tabelas ausentes: " + faltando.join(", "));
    await cliente.end();
    process.exit(1);
  }

  await cliente.end();
  console.log("\nBanco pronto.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
