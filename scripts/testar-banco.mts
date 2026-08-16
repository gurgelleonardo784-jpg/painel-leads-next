/**
 * Testes de gravação contra um Postgres de verdade. Rode: npm run testar:banco
 *
 * Usa PGlite (o próprio Postgres compilado para WebAssembly), então não precisa
 * de servidor, container nem DATABASE_URL: o banco nasce vazio em memória,
 * recebe o `lib/schema.sql` real e some no fim.
 *
 * O que está sendo provado aqui é o §22, que a spec marca como obrigatório: o
 * Meta reenvia webhooks, e reenvio não pode virar lead duplicado. Isso não é
 * verificável lendo o código — depende de a restrição única existir no banco e
 * de a transação desfazer tudo quando ela dispara. Também prova o §23 (segunda
 * mensagem não cria segundo lead), o §24 (a primeira mensagem decide a
 * atribuição) e o §43 (dado de um cliente não encosta no outro).
 */

import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { Tenant } from "../lib/tenants";
import { extrairEventoWhatsApp } from "../lib/whatsapp";
import { atribuicaoDoReferral } from "../lib/atribuicao";

let falhas = 0;
let passes = 0;

/**
 * Escreve direto no stdout, não por console.log: mais abaixo o console é
 * desviado para capturar os logs do §36, e o resultado do teste não pode ir
 * junto para o balde.
 */
const dizer = (s: string) => process.stdout.write(s + "\n");

function conferir(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passes++;
    dizer(`  \x1b[32mok\x1b[0m   ${nome}`);
  } else {
    falhas++;
    dizer(`  \x1b[31mFALHOU\x1b[0m ${nome}\n         esperado: ${b}\n         obtido:   ${a}`);
  }
}

/* ---------- PGlite disfarçado do Pool do pg ---------- */

const banco = new PGlite();

/**
 * `lib/db.ts` guarda o pool em globalThis, então dá para plantar este adaptador
 * ali antes de qualquer consulta — sem nenhum gancho de teste no código de
 * produção. PGlite é uma conexão só, e o teste é sequencial, então
 * connect/release não precisam fazer nada.
 */
const adaptador = {
  query: (texto: string, valores: unknown[] = []) => banco.query(texto, valores),
  connect: async () => ({
    query: (texto: string, valores: unknown[] = []) => banco.query(texto, valores),
    release: () => {},
  }),
  on: () => {},
};
globalThis.__poolLeads = adaptador as unknown as Pool;

// importado depois do adaptador estar no lugar
const { gravarMensagem, leadsAEnriquecer, salvarEstruturaAnuncio, salvarSheetLeadId } = await import(
  "../lib/repositorio"
);

/* ---------- logs do §36: coletados em vez de impressos ---------- */

const eventos: string[] = [];
const logOriginal = console.log;
const errOriginal = console.error;
function capturarLogs() {
  const pegar = (...args: unknown[]) => {
    const txt = args.map(String).join(" ");
    if (txt.startsWith("[leads]")) {
      try {
        eventos.push(JSON.parse(txt.replace("[leads] ", "")).evento);
      } catch {
        /* linha que não é do registro estruturado */
      }
    }
  };
  console.log = pegar;
  console.error = pegar;
}
function soltarLogs() {
  console.log = logOriginal;
  console.error = errOriginal;
}

/* ---------- utilitários ---------- */

function tenant(slug: string): Tenant {
  return {
    slug,
    nome: `Cliente ${slug}`,
    senha: "",
    spreadsheetId: "",
    aba: "Leads",
    titulo: "",
    ddiPadrao: "55",
    chaveWebhook: "",
    status: ["Novo"],
    tz: "America/Sao_Paulo",
  };
}

const CTX = {
  wabaId: "102290129340398",
  phoneNumberId: "1112223334445",
  displayPhoneNumber: "+55 85 3333-4444",
};

type Cru = Record<string, unknown>;

function mensagem(id: string, telefone: string, texto: string, referral?: Cru) {
  const ev = extrairEventoWhatsApp(CTX.wabaId, {
    metadata: { phone_number_id: CTX.phoneNumberId, display_phone_number: CTX.displayPhoneNumber },
    contacts: [{ wa_id: telefone, profile: { name: "João" } }],
    messages: [
      {
        id,
        from: telefone,
        timestamp: "1754650260",
        type: "text",
        text: { body: texto },
        ...(referral ? { referral } : {}),
      },
    ],
  });
  return ev.mensagens[0];
}

async function contar(sql: string, valores: unknown[] = []): Promise<number> {
  const r = await banco.query<{ n: number }>(sql, valores);
  return Number(r.rows[0].n);
}

async function gravar(slug: string, m: ReturnType<typeof mensagem>) {
  return gravarMensagem(tenant(slug), CTX, m, atribuicaoDoReferral(m.referral, m.ctwaClid));
}

/* ================= os testes ================= */

const REFERRAL_ANUNCIO = {
  source_id: "120000000000000",
  source_type: "ad",
  source_url: "https://fb.me/abc",
  headline: "Conheça nossa oferta",
  ctwa_clid: "ARBxc123",
};

dizer("\n\x1b[1mBanco em memória (PGlite) + lib/schema.sql\x1b[0m");
{
  const sql = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
  await banco.exec(sql);
  const n = await contar(
    `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('clients','whatsapp_accounts','leads','messages','attribution_events')`
  );
  conferir("as 5 tabelas do §19 foram criadas", n, 5);

  // rodar de novo não pode explodir: é o que o npm run migrar faz
  await banco.exec(sql);
  conferir("schema.sql é idempotente (roda 2x sem erro)", true, true);
}

capturarLogs();

dizer("\n\x1b[1m§18 — primeiro lead, vindo de anúncio\x1b[0m");
{
  const r = await gravar("acme", mensagem("wamid.1", "5585999999999", "Olá, quero saber o preço", REFERRAL_ANUNCIO));
  conferir("lead criado", r.estado, "criado");
  if (r.estado !== "duplicada") {
    conferir("ad_id devolvido para o enriquecimento", r.adId, "120000000000000");
    conferir("entra na fila do nível 3", r.precisaEnriquecer, true);
  }

  const l = await banco.query<Cru>(`SELECT * FROM leads`);
  conferir("1 lead na tabela", l.rows.length, 1);
  conferir("telefone gravado", l.rows[0].phone, "5585999999999");
  conferir("nome do perfil gravado", l.rows[0].name, "João");
  conferir("source = whatsapp (§29)", l.rows[0].source, "whatsapp");
  conferir("ad_id (§16)", l.rows[0].ad_id, "120000000000000");
  conferir("ctwa_clid (§14)", l.rows[0].ctwa_clid, "ARBxc123");
  conferir("attribution_status (§35)", l.rows[0].attribution_status, "attributed");
  conferir("attribution_confidence", l.rows[0].attribution_confidence, "high");
  conferir("campanha ainda vazia (a Meta é consultada depois)", l.rows[0].campaign_name, null);
  conferir("first_message_id (§24)", l.rows[0].first_message_id, "wamid.1");
  conferir("first_message_text", l.rows[0].first_message_text, "Olá, quero saber o preço");

  conferir("1 mensagem guardada", await contar(`SELECT count(*) AS n FROM messages`), 1);
  const msg = await banco.query<Cru>(`SELECT * FROM messages`);
  conferir("raw_payload guardado (§21)", (msg.rows[0].raw_payload as Cru).id, "wamid.1");
  conferir("evento de atribuição registrado (§19)", await contar(`SELECT count(*) AS n FROM attribution_events`), 1);

  const conta = await banco.query<Cru>(`SELECT * FROM whatsapp_accounts`);
  conferir("conta de WhatsApp registrada", conta.rows[0].phone_number_id, "1112223334445");
  conferir("waba_id capturado do entry.id", conta.rows[0].waba_id, "102290129340398");
}

dizer("\n\x1b[1m§22 — o Meta reenvia o MESMO evento\x1b[0m");
{
  const r = await gravar("acme", mensagem("wamid.1", "5585999999999", "Olá, quero saber o preço", REFERRAL_ANUNCIO));
  conferir("reconhecida como duplicada", r.estado, "duplicada");
  conferir("continua 1 lead", await contar(`SELECT count(*) AS n FROM leads`), 1);
  conferir("continua 1 mensagem", await contar(`SELECT count(*) AS n FROM messages`), 1);
  conferir(
    "não criou evento de atribuição a mais",
    await contar(`SELECT count(*) AS n FROM attribution_events`),
    1
  );
}

dizer("\n\x1b[1m§23 — segunda mensagem do mesmo contato\x1b[0m");
{
  const r = await gravar("acme", mensagem("wamid.2", "5585999999999", "ainda está disponível?"));
  conferir("lead atualizado, não recriado", r.estado, "atualizado");
  conferir("continua 1 lead", await contar(`SELECT count(*) AS n FROM leads`), 1);
  conferir("agora 2 mensagens no histórico", await contar(`SELECT count(*) AS n FROM messages`), 2);

  const l = await banco.query<Cru>(`SELECT * FROM leads`);
  conferir("§24: a atribuição da 1ª mensagem ficou de pé", l.rows[0].ad_id, "120000000000000");
  conferir("first_message_id não mudou", l.rows[0].first_message_id, "wamid.1");
  conferir("last_message_at preenchido", !!l.rows[0].last_message_at, true);
}

dizer("\n\x1b[1m§17 nível 4 — lead orgânico\x1b[0m");
{
  const r = await gravar("acme", mensagem("wamid.3", "5511988887777", "bom dia"));
  conferir("lead criado", r.estado, "criado");
  const l = await banco.query<Cru>(`SELECT * FROM leads WHERE phone = '5511988887777'`);
  conferir("attribution_status = organic", l.rows[0].attribution_status, "organic");
  conferir("sem campanha inventada", l.rows[0].campaign_name, null);
  conferir("sem ad_id", l.rows[0].ad_id, null);
  conferir("não entrou na fila de enriquecimento", (r as { precisaEnriquecer: boolean }).precisaEnriquecer, false);
  conferir("orgânico não gera evento de atribuição", await contar(`SELECT count(*) AS n FROM attribution_events`), 1);
}

dizer("\n\x1b[1mLead orgânico que depois clica num anúncio\x1b[0m");
{
  await gravar("acme", mensagem("wamid.4", "5511988887777", "vi o anúncio de vocês", REFERRAL_ANUNCIO));
  const l = await banco.query<Cru>(`SELECT * FROM leads WHERE phone = '5511988887777'`);
  conferir("ganha a atribuição que não tinha", l.rows[0].ad_id, "120000000000000");
  conferir("status vira attributed", l.rows[0].attribution_status, "attributed");
  conferir("mesmo lead, não um novo", await contar(`SELECT count(*) AS n FROM leads`), 2);
}

dizer("\n\x1b[1m§43 — o mesmo telefone em dois clientes\x1b[0m");
{
  const r = await gravar("outra-agencia", mensagem("wamid.5", "5585999999999", "oi"));
  conferir("cria lead separado", r.estado, "criado");
  conferir("3 leads no total", await contar(`SELECT count(*) AS n FROM leads`), 3);
  conferir(
    "cada cliente com o seu",
    await contar(
      `SELECT count(*) AS n FROM leads l JOIN clients c ON c.id=l.client_id
        WHERE l.phone='5585999999999' AND c.slug='acme'`
    ),
    1
  );
  conferir("2 clientes cadastrados", await contar(`SELECT count(*) AS n FROM clients`), 2);
}

dizer("\n\x1b[1m§37 — a fila do enriquecimento e a gravação da estrutura\x1b[0m");
{
  const fila = await leadsAEnriquecer(50);
  conferir("2 leads esperando o nome da campanha", fila.length, 2);
  conferir("apenas do anúncio conhecido", [...new Set(fila.map((f) => f.adId))], ["120000000000000"]);

  const filaAcme = await leadsAEnriquecer(50, "acme");
  conferir("dá para filtrar por cliente", filaAcme.length, 2);
  conferir("cliente sem anúncio devolve fila vazia", (await leadsAEnriquecer(50, "outra-agencia")).length, 0);

  const n = await salvarEstruturaAnuncio("acme", "120000000000000", {
    adId: "120000000000000",
    adName: "Criativo Oferta 01",
    adsetId: "23800",
    adsetName: "Fortaleza 25-45",
    campaignId: "23700",
    campaignName: "Campanha Advogados",
  });
  conferir("os 2 leads do anúncio foram preenchidos de uma vez", n, 2);

  const l = await banco.query<Cru>(`SELECT * FROM leads WHERE phone='5585999999999' AND client_id=1`);
  conferir("campanha (§18)", l.rows[0].campaign_name, "Campanha Advogados");
  conferir("conjunto", l.rows[0].adset_name, "Fortaleza 25-45");
  conferir("anúncio", l.rows[0].ad_name, "Criativo Oferta 01");
  conferir("enriched_at marcado", !!l.rows[0].enriched_at, true);
  conferir("fila esvaziou", (await leadsAEnriquecer(50)).length, 0);
}

dizer("\n\x1b[1mEspelho na planilha\x1b[0m");
{
  await salvarSheetLeadId("1", "LABC123");
  const l = await banco.query<Cru>(`SELECT sheet_lead_id FROM leads WHERE id=1`);
  conferir("id da linha da planilha guardado", l.rows[0].sheet_lead_id, "LABC123");
  const { leadsSemEspelho } = await import("../lib/repositorio");
  const sem = await leadsSemEspelho(25);
  conferir("os outros 2 leads aparecem como sem espelho", sem.length, 2);
}

dizer("\n\x1b[1mTráfego do site: Google Ads e Google orgânico\x1b[0m");
{
  const { registrarClique, acharClique, marcarCliqueUsado, gerarCodigo } = await import(
    "../lib/cliques"
  );
  const { classificarCanal } = await import("../lib/canal");
  const { atribuicaoDoClique } = await import("../lib/atribuicao");

  /**
   * Faz o que a rota /api/ir faz: classifica, gera o código e só então grava.
   * O código nasce fora do banco de propósito — é o que permite o redirect não
   * esperar pela gravação.
   */
  async function gravarClique(slug: string, sinais: Parameters<typeof classificarCanal>[0]) {
    const canal = classificarCanal(sinais);
    const codigo = gerarCodigo(canal, sinais);
    return registrarClique(slug, sinais, codigo, canal);
  }

  // 1. a pessoa busca no Google, clica no anúncio, entra no site e clica no WhatsApp
  const clique = await gravarClique("acme", {
    gclid: "Cj0KCQiA-testes",
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "Advogados - Search",
    utmContent: "Trabalhista - Fortaleza",
    referrer: "https://www.google.com/",
    landing: "https://cliente.com.br/advogado-trabalhista",
  });
  conferir("clique registrado", !!clique, true);
  conferir("canal reconhecido pelo gclid", clique?.canal, "google_ads");
  conferir("código com prefixo PAG", clique?.token.split("-")[0], "PAG");

  // 2. a mensagem chega com o código que viajou no texto
  const achado = await acharClique("acme", clique!.token);
  conferir("clique encontrado pelo token", !!achado, true);
  conferir("nome da campanha veio da utm, sem API", achado?.campanha, "Advogados - Search");
  conferir("grupo veio do utm_content", achado?.grupo, "Trabalhista - Fortaleza");

  const atrib = atribuicaoDoClique(achado!);
  const r = await gravar("acme", mensagem("wamid.G1", "5511955554444", `Olá! Vim pelo site. #${clique!.token}`));
  // grava com a atribuição do clique, não com a do referral (que não existe)
  const r2 = await gravarMensagem(tenant("acme"), CTX, mensagem("wamid.G2", "5511933332222", "oi"), atrib);
  conferir("lead do site criado", r2.estado, "criado");

  if (r2.estado !== "duplicada") await marcarCliqueUsado(atrib.cliqueId!, r2.leadId);

  const l = await banco.query<Cru>(`SELECT * FROM leads WHERE phone='5511933332222'`);
  conferir("fonte = google_ads", l.rows[0].attribution_source, "google_ads");
  conferir("método = site_click", l.rows[0].attribution_method, "site_click");
  conferir("status = attributed", l.rows[0].attribution_status, "attributed");
  conferir("gclid guardado", l.rows[0].gclid, "Cj0KCQiA-testes");
  conferir("campanha preenchida na hora", l.rows[0].campaign_name, "Advogados - Search");
  conferir("sem ad_id (é conceito da Meta)", l.rows[0].ad_id, null);

  const w = await banco.query<Cru>(`SELECT lead_id, used_at FROM web_clicks WHERE token=$1`, [
    clique!.token,
  ]);
  conferir("clique marcado como consumido", !!w.rows[0].used_at, true);
  conferir("clique aponta para o lead", String(w.rows[0].lead_id), String((r2 as { leadId: string }).leadId));

  // o outro lead entrou sem atribuição porque foi gravado pelo caminho do
  // referral (que não existe) — é o comportamento certo: o casamento do token
  // acontece em processarWhatsapp, não dentro do gravarMensagem
  conferir("lead com token mas gravado sem clique fica organic", r.estado, "criado");

  // 2b. clique velho não atribui: mensagem copiada semanas depois daria origem errada
  const antigo = await gravarClique("acme", { gclid: "velho" });
  await banco.query(`UPDATE web_clicks SET created_at = now() - interval '100 hours' WHERE token=$1`, [
    antigo!.token,
  ]);
  conferir("clique de 100h atrás é ignorado", await acharClique("acme", antigo!.token), null);

  // 2c. token de outro cliente não vale (§43)
  const deOutro = await gravarClique("outra-agencia", { gclid: "x" });
  conferir("token de outro cliente não é encontrado", await acharClique("acme", deOutro!.token), null);

  // 3. o resumo que o dashboard usa
  const { resumoDeCliques } = await import("../lib/cliques");
  const resumo = await resumoDeCliques("acme");
  const ads = resumo.find((x) => x.canal === "google_ads");
  conferir("resumo conta os cliques de Google Ads", ads?.cliques, 2);
  conferir("e quantos viraram conversa", ads?.conversas, 1);
}

soltarLogs();

dizer("\n\x1b[1m§36 — os eventos que foram registrados\x1b[0m");
{
  const unicos = [...new Set(eventos)].sort();
  for (const e of ["lead_criado", "lead_atualizado", "mensagem_duplicada", "atribuicao_salva"]) {
    conferir(`registrou "${e}"`, unicos.includes(e), true);
  }
}

await banco.close();
console.log(`\n${passes} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
