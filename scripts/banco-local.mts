/**
 * Postgres local para ver o produto rodando sem instalar nada.
 * Rode: npm run banco:local
 *
 * É o PGlite (Postgres compilado para WebAssembly) exposto numa porta TCP,
 * falando o protocolo do Postgres de verdade. Para o `pg` do aplicativo é um
 * servidor Postgres comum — a mesma DATABASE_URL, o mesmo driver, o mesmo SQL.
 *
 * Serve para demonstração e desenvolvimento. Para produção, um Postgres de
 * verdade (Neon, Supabase, Railway): isto guarda em ./\.pglite e é uma conexão
 * multiplexada, não aguenta carga.
 */

import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORTA = Number(process.env.PORTA_BANCO_LOCAL || 54329);
const dados = path.join(process.cwd(), ".pglite");

const db = await PGlite.create({ dataDir: dados });

// aplica o schema já na subida, para não precisar de um passo separado
const sql = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
await db.exec(sql);

// o padrão é 1 conexão, e aí o pool do Next e qualquer outro cliente (psql, o
// script da demo) se derrubam com ECONNRESET
const servidor = new PGLiteSocketServer({
  db,
  port: PORTA,
  host: "127.0.0.1",
  maxConnections: 10,
});
await servidor.start();

console.log(`\nPostgres local no ar em 127.0.0.1:${PORTA}`);
console.log(`Dados em ${dados}`);
console.log(`\nNo .env.local:`);
console.log(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORTA}/postgres?sslmode=disable\n`);
console.log("Ctrl+C para parar.\n");

async function parar() {
  await servidor.stop();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", parar);
process.on("SIGTERM", parar);
