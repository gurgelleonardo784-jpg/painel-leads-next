// Diagnóstico de configuração. Rode: npm run verificar
// Lê .env.local e tenants.json, conecta na planilha de cada cliente e diz o que
// está pronto e o que falta. Não envia nada ao Meta/Google.

import fs from "node:fs";
import path from "node:path";
import googleapis from "googleapis";

const { google } = googleapis;
const raiz = process.cwd();

const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const falta = (m) => console.log("  \x1b[31m✗\x1b[0m " + m);
const aviso = (m) => console.log("  \x1b[33m!\x1b[0m " + m);
const titulo = (m) => console.log("\n\x1b[1m" + m + "\x1b[0m");

function normal(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/_/g, " ").trim();
}

// ---- carrega .env.local ----
function carregarEnv() {
  const arq = path.join(raiz, ".env.local");
  if (!fs.existsSync(arq)) return;
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

// ---- carrega tenants ----
function carregarTenants() {
  if (process.env.TENANTS) {
    try { return JSON.parse(process.env.TENANTS); } catch { return []; }
  }
  const arq = path.join(raiz, "tenants.json");
  if (fs.existsSync(arq)) {
    try { return JSON.parse(fs.readFileSync(arq, "utf8")); } catch { return []; }
  }
  return [];
}

async function main() {
  carregarEnv();

  titulo("1. Ambiente (.env.local)");
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  email ? ok("GOOGLE_SERVICE_ACCOUNT_EMAIL definido") : falta("GOOGLE_SERVICE_ACCOUNT_EMAIL vazio");
  key ? ok("GOOGLE_PRIVATE_KEY definido") : falta("GOOGLE_PRIVATE_KEY vazio");
  process.env.SESSION_SECRET ? ok("SESSION_SECRET definido") : falta("SESSION_SECRET vazio");
  process.env.ADMIN_SENHA ? ok("ADMIN_SENHA definido") : falta("ADMIN_SENHA vazio (a tela /admin não abre)");

  titulo("1b. Webhooks da Meta (só se for receber lead do Meta/WhatsApp)");
  process.env.META_APP_SECRET
    ? ok("META_APP_SECRET definido (assinatura dos webhooks é verificada)")
    : aviso("META_APP_SECRET vazio — em produção /api/meta e /api/whatsapp respondem 503");
  process.env.META_VERIFY_TOKEN
    ? ok("META_VERIFY_TOKEN definido")
    : aviso("META_VERIFY_TOKEN vazio — o Meta não consegue verificar /api/meta");
  process.env.META_WHATSAPP_VERIFY_TOKEN
    ? ok("META_WHATSAPP_VERIFY_TOKEN definido")
    : aviso("META_WHATSAPP_VERIFY_TOKEN vazio — o Meta não consegue verificar /api/whatsapp");
  process.env.META_ADS_TOKEN
    ? ok("META_ADS_TOKEN definido (token de anúncios da agência)")
    : aviso("META_ADS_TOKEN vazio — sem ele, cada cliente precisa do próprio token de ads_read");

  const tenants = carregarTenants();
  titulo(`2. Tenants (${tenants.length} encontrado(s))`);
  if (!tenants.length) { falta("Nenhum tenant em tenants.json / TENANTS"); return; }

  // dois clientes com o mesmo número roteariam o lead para a planilha errada
  const numeros = tenants.map((t) => t.whatsapp && t.whatsapp.phoneNumberId).filter(Boolean);
  const repetidos = numeros.filter((n, i) => numeros.indexOf(n) !== i);
  if (repetidos.length) falta(`phoneNumberId repetido em mais de um cliente: ${[...new Set(repetidos)].join(", ")}`);

  if (!email || !key) {
    aviso("Sem credenciais do Google, não dá para testar a planilha. Preencha o .env.local e rode de novo.");
    return;
  }

  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  for (const t of tenants) {
    titulo(`Cliente "${t.slug || "(sem slug)"}"  —  ${t.titulo || ""}`);

    if (!t.spreadsheetId || t.spreadsheetId.startsWith("COLE_")) { falta("spreadsheetId não preenchido"); continue; }
    if (!t.senha || t.senha.startsWith("TROQUE")) aviso("senha ainda é o placeholder");

    let valores;
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: t.spreadsheetId, range: t.aba || "Página1" });
      valores = resp.data.values || [];
      ok(`Conectou na planilha (aba "${t.aba || "Página1"}")`);
    } catch (e) {
      const msg = (e && e.errors && e.errors[0] && e.errors[0].message) || (e && e.message) || String(e);
      if (/permission|forbidden|403/i.test(msg)) falta("Sem acesso — compartilhe a planilha com " + email);
      else if (/not found|404|Unable to parse range/i.test(msg)) falta("Planilha/aba não encontrada — confira o spreadsheetId e o nome da aba: " + msg);
      else falta("Erro ao ler a planilha: " + msg);
      continue;
    }

    if (valores.length < 1) { aviso("Planilha vazia (sem cabeçalho)"); continue; }
    const cab = valores[0].map((h) => String(h).trim());
    const linhas = valores.length - 1;
    ok(`${linhas} linha(s) de dados`);

    const temStatus = cab.some((h) => h === "Status");
    const temIdSistema = cab.some((h) => h === "ID");
    temStatus ? ok('Coluna "Status" presente') : aviso('Coluna "Status" será criada no 1º acesso ao painel');
    temIdSistema ? ok('Coluna "ID" (interna) presente') : aviso('Coluna "ID" será criada no 1º acesso ao painel');

    const colLeadId = cab.find((h) => h !== "ID" && ["id", "lead id", "leadid", "leadgen id"].includes(normal(h)));
    const colCtwa = cab.find((h) => normal(h) === "ctwa clid");
    const temWhats = !!(t.whatsapp && t.whatsapp.phoneNumberId);

    if (colLeadId) ok(`Lead ID do Meta detectado na coluna "${colLeadId}"`);
    else if (temWhats) aviso('Sem coluna de Lead ID — ok se os leads vêm só do WhatsApp (atribuição pelo ctwa_clid)');
    else falta('Nenhuma coluna de Lead ID do Meta (ex.: "id"). Sem ela a conversão não volta pro Meta — renomeie a coluna do id para "Lead ID".');

    // WhatsApp (Click-to-WhatsApp)
    if (temWhats) {
      ok(`WhatsApp: phoneNumberId ${t.whatsapp.phoneNumberId}`);
      colCtwa
        ? ok(`Coluna "${colCtwa}" presente (atribuição do Click-to-WhatsApp)`)
        : aviso('Coluna "ctwa_clid" será criada no 1º lead que vier de um anúncio Click-to-WhatsApp');
      // mesma regra do mapearCabecalho_ em lib/sheets.ts
      const colTel = cab.find((h) => /(telefone|whats|celular|phone|fone|^numero)/.test(normal(h)));
      colTel
        ? ok(`Coluna de telefone "${colTel}" — usada para não duplicar o mesmo contato`)
        : falta("Sem coluna de telefone reconhecível: cada mensagem viraria um lead novo. Nomeie a coluna como \"Telefone\".");
    }

    // dashboard: data e investimento
    const colData = cab.find((h) => /(^data|carimbo|timestamp|criado|created)/.test(normal(h)));
    colData
      ? ok(`Coluna de data "${colData}" — gráfico por dia e filtro de período funcionam`)
      : aviso('Sem coluna de data: o dashboard soma tudo, mas não separa por período nem monta o gráfico por dia. Acrescente "Data" ou "Carimbo de data/hora".');

    const colValor = cab.find((h) => ["valor", "ticket", "receita", "valor do negocio", "valor fechado"].includes(normal(h)));
    colValor
      ? ok(`Coluna de valor "${colValor}" — receita, ticket médio, ROAS e lucro ativos`)
      : aviso('Sem coluna de valor: o dashboard esconde receita/ROAS/lucro. Crie uma coluna "Valor" e preencha nos negócios ganhos.');

    if (t.metaAds && t.metaAds.adAccountId) {
      ok(`Conta de anúncios ${t.metaAds.adAccountId} (investimento e CPL no dashboard)`);
      if (!t.metaAds.accessToken && !(t.conversoes && t.conversoes.meta && t.conversoes.meta.accessToken))
        falta("metaAds sem token: preencha metaAds.accessToken ou conversoes.meta.accessToken (precisa de ads_read)");
      if (t.mostrarCustoAoCliente) aviso("o cliente VÊ investimento e CPL no dashboard dele");
    } else {
      aviso("Sem metaAds.adAccountId — dashboard mostra volume, mas não investimento nem CPL");
    }

    // conversões (Meta)
    const meta = t.conversoes && t.conversoes.meta;
    if (!meta) { aviso("Sem bloco conversoes.meta (status não volta pro Meta ainda)"); continue; }
    meta.datasetId ? ok("conversoes.meta.datasetId preenchido") : falta("conversoes.meta.datasetId vazio");
    meta.accessToken ? ok("conversoes.meta.accessToken preenchido") : falta("conversoes.meta.accessToken vazio");
    const nEventos = meta.eventos ? Object.keys(meta.eventos).length : 0;
    nEventos ? ok(`${nEventos} evento(s) mapeado(s)`) : falta("Nenhum evento em conversoes.meta.eventos");
  }

  console.log("\nPronto. Corrija os \x1b[31m✗\x1b[0m e rode de novo.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
