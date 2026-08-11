/**
 * Encena a jornada completa de um contato. Rode: npm run demo:jornada
 *
 * Precisa de `npm run banco:local` e `npm run dev` no ar.
 *
 * Simula o que acontece de verdade com um lead ao longo de dias: a pessoa acha o
 * cliente por um anúncio, não fala nada, volta depois pela busca orgânica, na
 * terceira visita clica no WhatsApp, conversa, e o atendimento move ela no funil.
 *
 * Prova duas coisas: que a linha do tempo conta a história inteira em vez de só o
 * último clique, e que o crédito fica com o anúncio que trouxe a pessoa — não com
 * a busca orgânica que ela usou para voltar.
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
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
}
carregarEnv();

const BASE = "http://localhost:3000";
const SEGREDO = process.env.META_APP_SECRET || "";
const TELEFONE = "5541988887777";
// o mesmo navegador em todas as visitas — é o que amarra a jornada
const VISITANTE = "visitante-demo-" + crypto.randomBytes(4).toString("hex");
const RODADA = crypto.randomBytes(3).toString("hex");

const dizer = (s = "") => process.stdout.write(s + "\n");
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const B = "\x1b[1m";
const CINZA = "\x1b[90m";
const N = "\x1b[0m";

const banco = new pg.Client({ connectionString: process.env.DATABASE_URL });
await banco.connect();

// a demo tem que poder rodar de novo: sem limpar, a segunda execução cai na
// idempotência do §22 e nada é reprocessado
await banco.query(`DELETE FROM web_clicks WHERE lead_id IN (SELECT id FROM leads WHERE phone=$1)`, [
  TELEFONE,
]);
await banco.query(`DELETE FROM leads WHERE phone = $1`, [TELEFONE]);

async function visitar(params: Record<string, string>): Promise<string> {
  const q = new URLSearchParams({ ...params, vid: VISITANTE });
  const res = await fetch(`${BASE}/api/ir/demo?${q}`, { redirect: "manual" });
  const loc = res.headers.get("location") || "";
  const m = loc.match(/%23([a-z0-9]{6})/);
  await espera(1100);
  return m ? m[1] : "";
}

async function mandarMensagem(id: string, texto: string) {
  const corpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                display_phone_number: "+55 11 1222-3334",
                phone_number_id: "1112223334445",
              },
              contacts: [{ wa_id: TELEFONE, profile: { name: "Juliana Prado" } }],
              messages: [
                {
                  from: TELEFONE,
                  id,
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
  await fetch(`${BASE}/api/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig },
    body: corpo,
  });
  await espera(1800);
}

/* ================= a jornada ================= */

dizer(`\n${B}════ A jornada de um contato ════${N}`);

dizer(`\n${B}1. Acha o cliente por um anuncio do Google e visita o site${N}`);
await visitar({
  gclid: "Cj0KCQ-jornada",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "Trabalhista - Curitiba",
  utm_term: "advogado trabalhista curitiba",
  ref: "https://www.google.com/",
  landing: "https://cliente.com.br/advogado-trabalhista",
});
dizer(`   ${CINZA}visitou /advogado-trabalhista e foi embora sem falar com ninguem${N}`);

dizer(`\n${B}2. Dias depois volta, agora pela busca organica, e le o blog${N}`);
await visitar({
  ref: "https://www.google.com/search?q=calculo+rescisao",
  landing: "https://cliente.com.br/blog/como-calcular-rescisao",
});
dizer(`   ${CINZA}visitou /blog/como-calcular-rescisao, ainda sem contato${N}`);

dizer(`\n${B}3. Na terceira visita, clica no botao do WhatsApp${N}`);
const token = await visitar({
  ref: "https://www.google.com/",
  landing: "https://cliente.com.br/contato",
});
dizer(`   ${CINZA}clicou vindo do organico — codigo ${token}${N}`);

dizer(`\n${B}4. Manda a mensagem${N}`);
await mandarMensagem(
  `wamid.J1-${RODADA}`,
  `Ola! Vim pelo site e gostaria de mais informacoes. #${token}`
);
await mandarMensagem(`wamid.J2-${RODADA}`, "Fui demitida sem justa causa, atendem em Curitiba?");
dizer(`   ${CINZA}2 mensagens${N}`);

dizer(`\n${B}5. O atendimento move ela no funil${N}`);
{
  const r = await banco.query<{ id: string }>(`SELECT id::text AS id FROM leads WHERE phone = $1`, [
    TELEFONE,
  ]);
  const leadId = r.rows[0]?.id;
  // grava pela conexão que a demo já tem, em vez de importar o lib/eventosLead:
  // dois pools disputando o PGlite local derrubam a conexão. Em produção estes
  // eventos vêm do PATCH do painel, quando o cliente muda a etapa na tela.
  const evento = (tipo: string, dados: Record<string, unknown>) =>
    banco.query(`INSERT INTO lead_events (lead_id, tipo, dados) VALUES ($1::bigint,$2,$3::jsonb)`, [
      leadId,
      tipo,
      JSON.stringify(dados),
    ]);

  await evento("etapa", { para: "Em contato" });
  await espera(1100);
  await evento("anotacao", { texto: "Ligou. Consulta agendada para quinta." });
  await espera(1100);
  await evento("etapa", { para: "Qualificado" });
  dizer(`   ${CINZA}Em contato -> anotacao -> Qualificado${N}`);
}

/* ================= o que o painel mostra ================= */

dizer(`\n${B}A historia que o cliente ve${N}`);
dizer(`${CINZA}   (lida do /api/leads/historico, o mesmo endpoint que o painel chama)${N}\n`);
{
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "demo", senha: "" }),
  });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const res = await fetch(
    `${BASE}/api/leads/historico?slug=demo&telefone=${encodeURIComponent(TELEFONE)}`,
    { headers: { cookie } }
  );
  const data = (await res.json()) as {
    itens: { tipo: string; em: string; titulo: string; detalhe?: string }[];
    visitas: number;
  };

  const hora = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));

  for (const it of data.itens) {
    dizer(`   ${hora(it.em)}   ${it.titulo}`);
    if (it.detalhe) dizer(`                    ${CINZA}${it.detalhe}${N}`);
  }

  const lead = await banco.query<Record<string, unknown>>(
    `SELECT attribution_source, attribution_method, campaign_name, adset_name
       FROM leads WHERE phone = $1`,
    [TELEFONE]
  );
  const l = lead.rows[0];
  dizer(`\n   ${B}Atribuicao do lead${N}`);
  dizer(`   canal ......... ${l.attribution_source}`);
  dizer(`   campanha ...... ${l.campaign_name ?? "—"}`);
  dizer(`   grupo ......... ${l.adset_name ?? "—"}`);
  dizer(`   metodo ........ ${l.attribution_method}`);
  dizer(`\n   ${data.visitas} visitas registradas · ${data.itens.length} eventos na historia\n`);
}

await banco.end();
process.exit(0);
