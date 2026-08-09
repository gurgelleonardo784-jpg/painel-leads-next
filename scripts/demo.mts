/**
 * Demonstração local do rastreamento, ponta a ponta. Rode: npm run demo
 *
 * Precisa de dois processos já no ar:
 *   1. npm run banco:local
 *   2. npm run dev
 *
 * Manda webhooks HTTP de verdade para /api/whatsapp, assinados com
 * X-Hub-Signature-256 exatamente como a Meta assina, e mostra o que aconteceu
 * no banco depois de cada um. Nada é simulado no caminho: é o Next atendendo, o
 * driver pg gravando e o SQL de produção rodando.
 *
 * Encena a sequência dos testes de aceitação do §44.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/* ---------- configuração vinda do .env.local ---------- */

function carregarEnv() {
  const arq = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(arq)) throw new Error("Crie o .env.local primeiro.");
  for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
carregarEnv();

const BASE = process.env.DEMO_URL || "http://localhost:3000";
const SEGREDO = process.env.META_APP_SECRET || "";
const PHONE_NUMBER_ID = "1112223334445";
const WABA_ID = "102290129340398";

const banco = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: undefined });
await banco.connect();

/* ---------- apresentação ---------- */

const N = "\x1b[0m";
const B = "\x1b[1m";
const CINZA = "\x1b[90m";
const VERDE = "\x1b[32m";
const AMARELO = "\x1b[33m";

const dizer = (s = "") => process.stdout.write(s + "\n");
const titulo = (s: string) => dizer(`\n${B}${s}${N}`);
const nota = (s: string) => dizer(`${CINZA}   ${s}${N}`);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- o webhook ---------- */

type Referral = Record<string, string>;

function payload(msgs: { id: string; from: string; texto: string; referral?: Referral }[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+55 85 3333-4444",
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: msgs.map((m) => ({
                wa_id: m.from,
                profile: { name: nomeDe(m.from) },
              })),
              messages: msgs.map((m) => ({
                from: m.from,
                id: m.id,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: "text",
                text: { body: m.texto },
                ...(m.referral ? { referral: m.referral } : {}),
              })),
            },
          },
        ],
      },
    ],
  };
}

const NOMES: Record<string, string> = {
  "5585999999999": "João Pereira",
  "5585988887777": "Maria Souza",
  "5511977776666": "Carlos Lima",
};
const nomeDe = (tel: string) => NOMES[tel] || "";

async function enviar(corpo: unknown): Promise<number> {
  const bruto = JSON.stringify(corpo);
  const assinatura =
    "sha256=" + crypto.createHmac("sha256", SEGREDO).update(bruto, "utf8").digest("hex");

  const res = await fetch(`${BASE}/api/whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": assinatura,
    },
    body: bruto,
  });
  // o processamento roda em after(), depois da resposta
  await espera(1200);
  return res.status;
}

/* ---------- leitura do banco ---------- */

type LinhaLead = {
  nome: string;
  telefone: string;
  origem: string;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  status: string;
  ad_id: string | null;
  ctwa_clid: string | null;
  primeira: string | null;
  mensagens: string;
};

async function leads(): Promise<LinhaLead[]> {
  const { rows } = await banco.query<LinhaLead>(
    `SELECT l.name AS nome, l.phone AS telefone, l.attribution_source AS origem,
            l.campaign_name AS campanha, l.adset_name AS conjunto, l.ad_name AS anuncio,
            l.attribution_status AS status, l.ad_id, l.ctwa_clid,
            l.first_message_text AS primeira,
            (SELECT count(*) FROM messages m WHERE m.lead_id = l.id)::text AS mensagens
       FROM leads l JOIN clients c ON c.id = l.client_id
      WHERE c.slug = 'demo'
      ORDER BY l.created_at`
  );
  return rows;
}

async function contar(sql: string): Promise<number> {
  const { rows } = await banco.query<{ n: string }>(sql);
  return Number(rows[0].n);
}

function tabela(rows: LinhaLead[]) {
  const cols: [string, (l: LinhaLead) => string][] = [
    ["Nome", (l) => l.nome || "—"],
    ["Telefone", (l) => l.telefone],
    ["Origem", (l) => (l.origem === "meta_ads" ? "WhatsApp (anúncio)" : "WhatsApp")],
    ["Campanha", (l) => l.campanha || "—"],
    ["Conjunto", (l) => l.conjunto || "—"],
    ["Anúncio", (l) => l.anuncio || "—"],
    ["Msgs", (l) => l.mensagens],
    ["Atribuição", (l) => l.status],
  ];
  const larguras = cols.map(([t, f]) => Math.max(t.length, ...rows.map((r) => f(r).length)));
  const linha = (vals: string[]) => "   " + vals.map((v, i) => v.padEnd(larguras[i])).join("  ");
  dizer(B + linha(cols.map(([t]) => t)) + N);
  dizer("   " + larguras.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) dizer(linha(cols.map(([, f]) => f(r))));
}

/* ================= a demonstração ================= */

const REFERRAL_01 = {
  source_url: "https://fb.me/2xJ9kQm",
  source_id: "120210000000001",
  source_type: "ad",
  headline: "Advogado trabalhista em Fortaleza",
  body: "Consulta gratuita. Fale agora.",
  media_type: "image",
  ctwa_clid: "ARBZ9xKq1mNpQrSt",
};
const REFERRAL_02 = { ...REFERRAL_01, source_id: "120210000000002", headline: "Seus direitos" };

dizer(`\n${B}════ Demonstração do rastreamento (local) ════${N}`);
nota(`webhook: ${BASE}/api/whatsapp`);
nota(`banco:   ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":***@")}`);

// começa limpo, para a demo ser sempre a mesma
await banco.query(`DELETE FROM leads WHERE client_id IN (SELECT id FROM clients WHERE slug='demo')`);

titulo("1. Pessoa clica no anúncio Click-to-WhatsApp e manda a 1ª mensagem");
nota("§44 Teste 3 — é o evento que carrega o referral, e ele só vem uma vez");
{
  const status = await enviar(
    payload([
      {
        id: "wamid.DEMO001",
        from: "5585999999999",
        texto: "Olá, vi o anúncio. Quanto custa a consulta?",
        referral: REFERRAL_01,
      },
    ])
  );
  dizer(`   HTTP ${status === 200 ? VERDE : AMARELO}${status}${N} ${CINZA}(o Meta é liberado na hora; o resto roda em after())${N}`);
  const l = (await leads())[0];
  dizer(`\n   ${B}O lead que nasceu:${N}`);
  dizer(`   nome ................ ${l.nome}`);
  dizer(`   telefone ............ ${l.telefone}`);
  dizer(`   primeira mensagem ... "${l.primeira}"`);
  dizer(`   ad_id (§16) ......... ${VERDE}${l.ad_id}${N}   ${CINZA}<- referral.source_id${N}`);
  dizer(`   ctwa_clid (§14) ..... ${VERDE}${l.ctwa_clid}${N}`);
  dizer(`   atribuição (§35) .... ${l.status}`);
  dizer(`   campanha ............ ${AMARELO}${l.campanha || "pendente"}${N}   ${CINZA}<- precisa da Graph API${N}`);
  nota("sem META_ADS_TOKEN nesta demo, a consulta do nome da campanha falha —");
  nota("e é exatamente o §37: o lead entrou de todo jeito, a campanha fica na fila.");
}

titulo("2. O mesmo Meta reenvia o MESMO evento");
nota("§22 — reenvio é normal, e não pode virar lead nem mensagem duplicada");
{
  await enviar(
    payload([
      {
        id: "wamid.DEMO001",
        from: "5585999999999",
        texto: "Olá, vi o anúncio. Quanto custa a consulta?",
        referral: REFERRAL_01,
      },
    ])
  );
  const nLeads = await contar(`SELECT count(*) AS n FROM leads`);
  const nMsgs = await contar(`SELECT count(*) AS n FROM messages`);
  dizer(`   leads: ${VERDE}${nLeads}${N}   mensagens: ${VERDE}${nMsgs}${N}   ${CINZA}(continua 1 e 1)${N}`);
}

titulo("3. A mesma pessoa manda uma segunda mensagem");
nota("§23 — atualiza o contato, guarda a mensagem, não cria lead novo");
{
  await enviar(payload([
    { id: "wamid.DEMO002", from: "5585999999999", texto: "Consigo ir amanhã de manhã?" },
  ]));
  const l = (await leads())[0];
  dizer(`   leads: ${VERDE}${await contar(`SELECT count(*) AS n FROM leads`)}${N}   mensagens deste lead: ${VERDE}${l.mensagens}${N}`);
  dizer(`   ad_id preservado ..... ${VERDE}${l.ad_id}${N}   ${CINZA}<- §24: a 1ª mensagem decidiu a atribuição${N}`);
}

titulo("4. Alguém chega sem anúncio (orgânico)");
nota("§17 nível 4 / §44 Teste 2 — não se inventa campanha");
{
  await enviar(payload([
    { id: "wamid.DEMO003", from: "5511977776666", texto: "Bom dia, vocês atendem em São Paulo?" },
  ]));
  const l = (await leads()).find((x) => x.telefone === "5511977776666")!;
  dizer(`   atribuição ........... ${l.status}`);
  dizer(`   ad_id ................ ${l.ad_id || CINZA + "nenhum" + N}`);
  dizer(`   campanha ............. ${l.campanha || CINZA + "nenhuma" + N}`);
}

titulo("5. Outra pessoa, de outro anúncio da mesma campanha");
{
  await enviar(payload([
    {
      id: "wamid.DEMO004",
      from: "5585988887777",
      texto: "Quero falar sobre rescisão",
      referral: REFERRAL_02,
    },
  ]));
  dizer(`   ad_id ................ ${VERDE}${(await leads()).find((x) => x.telefone === "5585988887777")!.ad_id}${N}`);
}

titulo("6. A Graph API responde (aqui, simulada)");
nota("é o nível 3 do §17: ad_id -> campanha / conjunto / anúncio.");
nota("com META_ADS_TOKEN de verdade, isto acontece sozinho no passo 1.");
{
  const { salvarEstruturaAnuncio } = await import("../lib/repositorio");
  await salvarEstruturaAnuncio("demo", "120210000000001", {
    adId: "120210000000001",
    adName: "Criativo Oferta 01",
    adsetId: "23851000000000001",
    adsetName: "Fortaleza 25-45",
    campaignId: "23850000000000001",
    campaignName: "Advogados — Trabalhista",
  });
  await salvarEstruturaAnuncio("demo", "120210000000002", {
    adId: "120210000000002",
    adName: "Criativo Direitos 02",
    adsetId: "23851000000000001",
    adsetName: "Fortaleza 25-45",
    campaignId: "23850000000000001",
    campaignName: "Advogados — Trabalhista",
  });
  dizer(`   ${VERDE}2 anúncios resolvidos${N}`);
}

titulo("O que o cliente vê no painel (§2)");
tabela(await leads());

titulo("O que ficou guardado, e que a planilha não guardaria");
{
  const m = await banco.query<{ telefone: string; texto: string; quando: string }>(
    `SELECT l.phone AS telefone, m.message_text AS texto,
            to_char(m."timestamp", 'DD/MM HH24:MI') AS quando
       FROM messages m JOIN leads l ON l.id = m.lead_id
      ORDER BY m."timestamp"`
  );
  dizer(`   ${B}messages${N} — cada mensagem, não só a primeira:`);
  for (const r of m.rows) dizer(`     ${r.quando}  ${r.telefone}  "${r.texto}"`);

  const a = await banco.query<{ ad_id: string; ctwa_clid: string; quando: string }>(
    `SELECT ad_id, ctwa_clid, to_char(created_at,'DD/MM HH24:MI') AS quando
       FROM attribution_events ORDER BY created_at`
  );
  dizer(`\n   ${B}attribution_events${N} — o histórico de atribuição:`);
  for (const r of a.rows) dizer(`     ${r.quando}  ad ${r.ad_id}  clid ${r.ctwa_clid}`);

  const bruto = await banco.query<{ tem: boolean }>(
    `SELECT raw_payload ? 'referral' AS tem FROM messages
      WHERE whatsapp_message_id = 'wamid.DEMO001'`
  );
  dizer(`\n   ${B}raw_payload${N} (§21) — o referral original guardado: ${bruto.rows[0]?.tem ? VERDE + "sim" + N : "não"}`);
}

titulo("Resumo dos números (§25)");
{
  const r = await banco.query<Record<string, string>>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE attribution_status='attributed')::text AS anuncio,
            count(*) FILTER (WHERE attribution_status='organic')::text    AS organico,
            (SELECT count(*) FROM messages)::text                         AS mensagens
       FROM leads`
  );
  const x = r.rows[0];
  dizer(`   Total de leads ...... ${x.total}`);
  dizer(`   De anúncio .......... ${x.anuncio}`);
  dizer(`   Orgânicos ........... ${x.organico}`);
  dizer(`   Mensagens ........... ${x.mensagens}`);
}

dizer(`\n${CINZA}Os leads não aparecem na planilha nesta demo porque não há credencial do${N}`);
dizer(`${CINZA}Google no .env.local — o log do "npm run dev" mostra planilha_falhou, e o${N}`);
dizer(`${CINZA}lead ficou salvo no banco de qualquer forma. Com credencial, cada um destes${N}`);
dizer(`${CINZA}vira uma linha em /demo.${N}\n`);

await banco.end();
