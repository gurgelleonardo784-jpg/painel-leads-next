/**
 * Verificação ponta a ponta do rastreamento do site. Rode: npm run testar:rastreio
 *
 * Precisa de `npm run banco:local` e `npm run dev` no ar.
 *
 * Duas perguntas, e as duas só se respondem com a rota de verdade respondendo:
 *
 *  1. Cada tipo de origem produz o prefixo certo no código? É o prefixo que
 *     sobrevive quando a gravação do clique falha — se ele estiver errado, a
 *     origem fica errada justamente no caso em que ele é a única informação.
 *
 *  2. A mensagem com código é atribuída, e a sem código NÃO é chutada? Chutar a
 *     origem de quem chegou sem código é o pior resultado possível: o número
 *     parece certo e está errado.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

function carregarEnv() {
  const arq = path.join(process.cwd(), ".env.local");
  for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    let v = t.slice(i + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
carregarEnv();

const BASE = process.env.BASE_TESTE || "http://localhost:3001";
const SLUG = process.env.SLUG_TESTE || "demo";
const SEGREDO = process.env.META_APP_SECRET || "";

let falhas = 0;
let passes = 0;
const dizer = (s = "") => process.stdout.write(s + "\n");
const V = "\x1b[32m", R = "\x1b[31m", B = "\x1b[1m", N = "\x1b[0m";

function conferir(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    passes++;
    dizer(`  ${V}ok${N}   ${nome}`);
  } else {
    falhas++;
    dizer(`  ${R}FALHOU${N} ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         obtido:   ${JSON.stringify(real)}`);
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const banco = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? undefined : true });
await banco.connect();

/** Chama a rota de redirect e devolve o código que ela pôs na mensagem. */
async function clicar(params: Record<string, string>): Promise<{ codigo: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/ir/${SLUG}?${new URLSearchParams(params)}`, {
    redirect: "manual",
  });
  const ms = Date.now() - t0;
  const loc = res.headers.get("location") || "";
  const cache = res.headers.get("cache-control") || "";
  if (!/no-store/.test(cache)) {
    falhas++;
    dizer(`  ${R}FALHOU${N} Cache-Control sem no-store: ${cache}`);
  }
  const m = decodeURIComponent(loc).match(/\b([A-Z]{2,3}-[A-Z0-9]{4})\b/);
  return { codigo: m ? m[1] : "", ms };
}

/* ================= 1. cada origem, seu prefixo ================= */

dizer(`\n${B}1. A rota classifica a origem no prefixo do código${N}`);

const CASOS: { nome: string; params: Record<string, string>; prefixo: string }[] = [
  { nome: "Google Ads (gclid)", params: { gclid: "Cj0KCQiA" }, prefixo: "PAG" },
  { nome: "Meta Ads (fbclid)", params: { fbclid: "IwAR1abc" }, prefixo: "PAG" },
  { nome: "utm_medium=cpc", params: { utm_source: "google", utm_medium: "cpc" }, prefixo: "PAG" },
  { nome: "Instagram (referrer)", params: { ref: "https://www.instagram.com/" }, prefixo: "IG" },
  { nome: "Facebook (referrer)", params: { ref: "https://www.facebook.com/" }, prefixo: "FB" },
  { nome: "Google orgânico", params: { ref: "https://www.google.com/search?q=advogado" }, prefixo: "ORG" },
  { nome: "Bing orgânico", params: { ref: "https://www.bing.com/search?q=x" }, prefixo: "ORG" },
  { nome: "outro site", params: { ref: "https://portaljuridico.com.br/artigo" }, prefixo: "REF" },
  { nome: "sem referrer nem utm", params: {}, prefixo: "DIR" },
];

let somaMs = 0;
for (const c of CASOS) {
  const { codigo, ms } = await clicar({ ...c.params, landing: "https://cliente.com.br/contato" });
  somaMs += ms;
  conferir(`${c.nome} -> ${c.prefixo}`, codigo.split("-")[0], c.prefixo);
}

dizer(`\n  tempo médio do redirect: ${Math.round(somaMs / CASOS.length)}ms`);
dizer(`  ${B}o redirect não espera a gravação${N} — o banco é escrito depois da resposta`);

/* ================= 2. a gravação acontece mesmo assim ================= */

dizer(`\n${B}2. A gravação acontece depois, sem segurar o visitante${N}`);
{
  const { codigo } = await clicar({
    gclid: "Cj0-verificacao",
    utm_campaign: "Campanha de Teste",
    utm_term: "advogado trabalhista",
    ref: "https://www.google.com/",
    landing: "https://cliente.com.br/servicos",
  });
  conferir("código gerado", /^PAG-[A-Z0-9]{4}$/.test(codigo), true);

  // dá tempo do after() rodar
  await espera(2500);
  const r = await banco.query<{ channel: string; utm_campaign: string; user_agent: string | null }>(
    `SELECT channel, utm_campaign, user_agent FROM web_clicks WHERE token = $1`,
    [codigo]
  );
  conferir("clique gravado no banco", r.rows.length, 1);
  conferir("canal detalhado (não só o prefixo)", r.rows[0]?.channel, "google_ads");
  conferir("campanha guardada", r.rows[0]?.utm_campaign, "Campanha de Teste");
  conferir("user_agent guardado", !!r.rows[0]?.user_agent, true);
}

/* ================= 3. o webhook, com e sem código ================= */

async function mandarMensagem(telefone: string, texto: string) {
  const corpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: "+55 11 1222-3334", phone_number_id: "1112223334445" },
              contacts: [{ wa_id: telefone, profile: { name: "Teste Rastreio" } }],
              messages: [
                {
                  from: telefone,
                  id: "wamid.R" + crypto.randomBytes(4).toString("hex"),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sig = "sha256=" + crypto.createHmac("sha256", SEGREDO).update(corpo, "utf8").digest("hex");
  const res = await fetch(`${BASE}/api/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
    body: corpo,
  });
  await espera(2500);
  return res.status;
}

async function leadDe(telefone: string) {
  const r = await banco.query<{
    attribution_source: string;
    attribution_status: string;
    attribution_method: string;
    attribution_confidence: string;
    campaign_name: string | null;
  }>(
    `SELECT attribution_source, attribution_status, attribution_method,
            attribution_confidence, campaign_name
       FROM leads WHERE phone = $1`,
    [telefone]
  );
  return r.rows[0];
}

dizer(`\n${B}3. O webhook COM código: origem atribuída${N}`);
{
  const tel = "5511" + Math.floor(100000000 + Math.random() * 800000000);
  await banco.query(`DELETE FROM leads WHERE phone = $1`, [tel]);

  const { codigo } = await clicar({
    gclid: "Cj0-webhook",
    utm_campaign: "Busca - Trabalhista",
    ref: "https://www.google.com/",
    landing: "https://cliente.com.br/contato",
  });
  await espera(2000);

  conferir("webhook aceitou", await mandarMensagem(tel, `Olá! Vim pelo site. Ref: ${codigo}`), 200);
  const l = await leadDe(tel);
  conferir("origem = google_ads", l?.attribution_source, "google_ads");
  conferir("método = site_click", l?.attribution_method, "site_click");
  conferir("campanha veio junto", l?.campaign_name, "Busca - Trabalhista");
  conferir("confiança alta", l?.attribution_confidence, "high");
}

dizer(`\n${B}4. O webhook SEM código: NÃO adivinha${N}`);
{
  const tel = "5511" + Math.floor(100000000 + Math.random() * 800000000);
  await banco.query(`DELETE FROM leads WHERE phone = $1`, [tel]);

  // deixa um clique recente e sem lead no mesmo cliente — a armadilha: seria
  // "fácil" casar por proximidade de horário, e daria origem errada
  await clicar({ gclid: "Cj0-armadilha", ref: "https://www.google.com/" });
  await espera(2000);

  conferir("webhook aceitou", await mandarMensagem(tel, "Bom dia, queria informações"), 200);
  const l = await leadDe(tel);
  conferir("NÃO herdou o clique recente", l?.attribution_source, "organic");
  conferir("status = organic, não attributed", l?.attribution_status, "organic");
  conferir("sem campanha inventada", l?.campaign_name, null);
}

dizer(`\n${B}5. Código válido cujo clique não existe: usa o prefixo${N}`);
{
  const tel = "5511" + Math.floor(100000000 + Math.random() * 800000000);
  await banco.query(`DELETE FROM leads WHERE phone = $1`, [tel]);

  // um código que nunca foi gravado — simula a gravação ter falhado
  conferir("webhook aceitou", await mandarMensagem(tel, "Olá! Vim pelo site. Ref: ORG-9K7T"), 200);
  const l = await leadDe(tel);
  conferir("origem deduzida do prefixo ORG", l?.attribution_source, "busca_organica");
  conferir("confiança BAIXA (é só o prefixo)", l?.attribution_confidence, "low");
  conferir("sem campanha, que o prefixo não carrega", l?.campaign_name, null);
}

dizer(`\n${B}6. Código inventado: não vira origem nenhuma${N}`);
{
  const tel = "5511" + Math.floor(100000000 + Math.random() * 800000000);
  await banco.query(`DELETE FROM leads WHERE phone = $1`, [tel]);

  conferir("webhook aceitou", await mandarMensagem(tel, "oi XYZ-1234 tudo bem"), 200);
  const l = await leadDe(tel);
  conferir("prefixo inválido é ignorado", l?.attribution_source, "organic");
}

await banco.end();
dizer(`\n${passes} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
