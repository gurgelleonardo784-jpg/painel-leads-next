import { getSheetsClient } from "./google";
import type { Tenant } from "./tenants";
import type { Lead } from "./types";

export type { Lead, Resposta } from "./types";

/**
 * Porta da lógica do Codigo.gs (Apps Script) para a Google Sheets API.
 * Mantém: mapeamento automático de cabeçalho, leitura de leads,
 * gravação de status/anotações e recepção de leads por webhook.
 */

export const COL_ID = "ID";
export const COL_STATUS = "Status";
export const COL_NOTA = "Anotações";
export const COL_ATUALIZADO = "Atualizado em";
export const COL_CONVERSAO = "Conversão"; // registro do envio para Meta/Google
const RESERVADAS = [COL_ID, COL_STATUS, COL_NOTA, COL_ATUALIZADO, COL_CONVERSAO];

// colunas técnicas: guardadas na planilha, mas escondidas do card.
// "id"/"leadgen id" é a coluna que a integração nativa do Meta cria com o id do lead.
const TECNICAS = new Set([
  "lead id",
  "leadid",
  "leadgen id",
  "id",
  "gclid",
  "gcl id",
  "gbraid",
  "wbraid",
  "ctwa clid", // ctwa_clid: id do clique do anúncio Click-to-WhatsApp
]);

export type Identificadores = {
  leadId: string;
  gclid: string;
  gbraid: string;
  wbraid: string;
  ctwaClid: string;
};

type Papel = "telefone" | "email" | "campanha" | "conjunto" | "anuncio" | "origem" | "data" | "nome";

/** Nomes aceitos para a coluna de valor do negócio (alimenta receita e ROAS). */
const COL_VALOR = new Set(["valor", "ticket", "valor do negocio", "receita", "valor fechado"]);

/** "R$ 1.234,56" ou "1234.56" -> 1234.56. Vazio ou lixo -> 0. */
function parseValor(txt: string): number {
  const limpo = String(txt || "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!limpo) return 0;
  // formato brasileiro: ponto é milhar, vírgula é decimal
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ---------- utilitários (portados) ---------- */

function normalizar(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatarValor(v: unknown): string {
  if (v === null || typeof v === "undefined") return "";
  return String(v).trim();
}

/**
 * Limpa o e-mail vindo da planilha.
 *
 * Célula com hiperlink às vezes guarda "mailto:fulano@x.com" como texto. Sem
 * tirar o prefixo, o card mostra "mailto:fulano@x.com" e o link vira
 * "mailto:mailto:…", que não abre o cliente de e-mail em lugar nenhum.
 */
function limparEmail(v: string): string {
  return v.replace(/^\s*mailto:\s*/i, "").trim();
}

/** Reproduz mapearCabecalho_ do Codigo.gs. A ordem dos testes importa. */
function mapearCabecalho(cab: string[]): Record<number, Papel> {
  const mapa: Record<number, Papel> = {};
  for (let i = 0; i < cab.length; i++) {
    const n = normalizar(cab[i]);
    if (/(telefone|whats|celular|phone|fone|^numero|^telefone)/.test(n)) mapa[i] = "telefone";
    else if (/(e-?mail)/.test(n)) mapa[i] = "email";
    // campanha, conjunto e anúncio são três níveis diferentes: sem separar, o
    // primeiro que aparecesse virava "campanha" e os outros dois iam parar na
    // lista de respostas do formulário. Do mais específico para o mais geral.
    else if (/(conjunto|ad ?set)/.test(n)) mapa[i] = "conjunto";
    else if (/(anuncio|ad name|^ad$|creative)/.test(n)) mapa[i] = "anuncio";
    else if (/(campanha|campaign|formulario|form name)/.test(n)) mapa[i] = "campanha";
    else if (/(origem|plataforma|fonte|source|platform|canal)/.test(n)) mapa[i] = "origem";
    else if (/(^data|carimbo|timestamp|criado|created)/.test(n)) mapa[i] = "data";
    else if (/^(nome|nome completo|primeiro nome|seu nome|name|full name|first name)$/.test(n)) mapa[i] = "nome";
  }
  return mapa;
}

function linkWhatsapp(telefone: string, ddiPadrao: string): string {
  let d = String(telefone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = ddiPadrao + d; // número brasileiro sem DDI
  if (d.length < 10 || d.length > 15) return "";
  return "https://wa.me/" + d;
}

function agoraTexto(tz: string): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const x of partes) p[x.type] = x.value;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function novoId(): string {
  return "L" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
}

/** Converte índice de coluna (1-based) para letra: 1->A, 27->AA. */
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ---------- preparação (porta prepararColunas_) ---------- */

/**
 * Garante as colunas de sistema e preenche o "ID" das linhas que têm conteúdo
 * mas vieram sem ID — o caso dos leads que a integração nativa do Meta (ou o
 * próprio cliente) escreve direto na planilha. Sem ID, o painel não consegue
 * salvar status/anotação naquele lead. Só grava de volta quando há mudança.
 * Muta `valores` em memória para o leitor usar os IDs recém-criados.
 */
async function prepararPlanilha(
  tenant: Tenant,
  sheets: ReturnType<typeof getSheetsClient>,
  valores: unknown[][]
): Promise<string[]> {
  const cab = (valores[0] || []).map((h) => String(h).trim());
  const updates: { range: string; values: (string | number)[][] }[] = [];

  // garante as colunas de sistema no cabeçalho
  for (const nome of [COL_ID, COL_STATUS, COL_NOTA, COL_ATUALIZADO]) {
    if (cab.indexOf(nome) === -1) {
      const i = cab.length;
      cab.push(nome);
      updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}1`, values: [[nome]] });
    }
  }

  // preenche IDs faltantes em linhas com conteúdo
  const iId = cab.indexOf(COL_ID);
  for (let r = 1; r < valores.length; r++) {
    const linha = valores[r] || [];
    const temConteudo = linha.some((v, c) => c !== iId && String(v ?? "").trim() !== "");
    const idAtual = String(linha[iId] ?? "").trim();
    if (temConteudo && !idAtual) {
      const novo = novoId();
      while (linha.length <= iId) linha.push("");
      linha[iId] = novo;
      valores[r] = linha;
      updates.push({ range: `${tenant.aba}!${colLetter(iId + 1)}${r + 1}`, values: [[novo]] });
    }
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: tenant.spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }
  return cab;
}

/* ---------- leitura (porta lerPlanilha_) ---------- */

export async function lerLeads(tenant: Tenant): Promise<Lead[]> {
  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheetId,
    range: tenant.aba,
  });

  const valores = (resp.data.values || []) as unknown[][];
  if (valores.length < 2) return [];

  const cab = await prepararPlanilha(tenant, sheets, valores);
  const mapa = mapearCabecalho(cab);
  const iId = cab.indexOf(COL_ID);
  const leads: Lead[] = [];

  for (let r = 1; r < valores.length; r++) {
    const linha = valores[r] || [];
    if (linha.join("").trim() === "") continue;

    const lead: Lead = {
      id: String((iId !== -1 ? linha[iId] : "") || ""),
      nome: "",
      telefone: "",
      email: "",
      data: "",
      origem: "",
      campanha: "",
      conjunto: "",
      anuncio: "",
      status: "",
      nota: "",
      whatsapp: "",
      ordem: r,
      respostas: [],
      valor: 0,
      temperatura: "",
      primeiraMensagem: "",
      utm: "",
      atribuicao: null, // preenchido em /api/leads, a partir do banco
      leadId: "",
      gclid: "",
      gbraid: "",
      wbraid: "",
    };

    for (let c = 0; c < cab.length; c++) {
      const titulo = cab[c];
      if (!titulo) continue;
      const valor = formatarValor(linha[c]);
      const papel = mapa[c];

      if (titulo === COL_STATUS) { lead.status = valor; continue; }
      if (titulo === COL_NOTA) { lead.nota = valor; continue; }
      if (RESERVADAS.indexOf(titulo) !== -1) continue;

      const tec = normalizar(titulo);
      if (TECNICAS.has(tec)) {
        if (tec === "gbraid") lead.gbraid = valor;
        else if (tec === "wbraid") lead.wbraid = valor;
        else if (tec === "gclid" || tec === "gcl id") lead.gclid = valor;
        else if (tec === "id" || tec === "lead id" || tec === "leadid" || tec === "leadgen id")
          lead.leadId = valor; // id do lead do Meta (Lead Ads)
        // demais técnicas (ex.: "ctwa clid") ficam guardadas na planilha, escondidas do card
        continue;
      }

      // colunas opcionais que alimentam o dashboard e o card, mas não são
      // "perguntas do formulário" — por isso saem da lista de respostas
      const extra = normalizar(titulo);
      if (COL_VALOR.has(extra)) {
        lead.valor = parseValor(valor);
        continue;
      }
      if (extra === "temperatura") {
        lead.temperatura = valor;
        continue;
      }
      if (extra === "primeira mensagem") {
        lead.primeiraMensagem = valor;
        continue;
      }
      if (extra === "utm" || extra === "utms") {
        lead.utm = valor;
        continue;
      }

      if (papel && !lead[papel]) {
        // campos do topo do card não repetem na lista de respostas
        lead[papel] = papel === "email" ? limparEmail(valor) : valor;
        continue;
      }
      if (valor !== "") lead.respostas.push({ pergunta: titulo, resposta: valor });
    }

    lead.status = lead.status || tenant.status[0];
    lead.whatsapp = linkWhatsapp(lead.telefone, tenant.ddiPadrao);
    leads.push(lead);
  }

  leads.reverse(); // mais recentes primeiro
  return leads;
}

/* ---------- gravação de status/anotações (porta apiSalvarLead) ---------- */

export type SalvarCampos = {
  status?: string;
  nota?: string;
  /** valor do negócio fechado; 0 limpa a célula */
  valor?: number;
};

/** Nome usado ao criar a coluna de valor, quando o cliente ainda não tem uma. */
const COL_VALOR_PADRAO = "Valor";

export type ResultadoSalvar = {
  ok: boolean;
  erro?: string;
  identificadores?: Identificadores;
};

export async function salvarLead(
  tenant: Tenant,
  id: string,
  campos: SalvarCampos
): Promise<ResultadoSalvar> {
  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheetId,
    range: tenant.aba,
  });
  const valores = (resp.data.values || []) as unknown[][];
  if (!valores.length) return { ok: false, erro: "Planilha vazia." };

  const cab = valores[0].map(String);
  const iId = cab.indexOf(COL_ID);
  if (iId === -1) return { ok: false, erro: "A planilha não tem a coluna ID." };

  let linhaNum = -1;
  for (let r = 1; r < valores.length; r++) {
    if (String(valores[r][iId]) === String(id)) { linhaNum = r + 1; break; }
  }
  if (linhaNum === -1) return { ok: false, erro: "Lead não encontrado." };

  const updates: { range: string; values: (string | number)[][] }[] = [];
  const garantirCol = (nome: string): number => {
    let i = cab.indexOf(nome);
    if (i === -1) {
      i = cab.length;
      cab.push(nome);
      updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}1`, values: [[nome]] });
    }
    return i;
  };

  if (typeof campos.status !== "undefined") {
    const i = garantirCol(COL_STATUS);
    updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}${linhaNum}`, values: [[campos.status]] });
  }
  if (typeof campos.nota !== "undefined") {
    const i = garantirCol(COL_NOTA);
    updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}${linhaNum}`, values: [[campos.nota]] });
  }
  const iAtu = garantirCol(COL_ATUALIZADO);
  updates.push({ range: `${tenant.aba}!${colLetter(iAtu + 1)}${linhaNum}`, values: [[agoraTexto(tenant.tz)]] });

  /**
   * O valor do negócio entra como número JSON, não como texto.
   *
   * Dinheiro precisa virar número na planilha, senão o cliente não consegue
   * somar a própria coluna. A tentação é usar `USER_ENTERED` e deixar o Sheets
   * interpretar — mas aí o resultado depende do idioma da planilha: "3450.75"
   * numa planilha em português vira **texto**, porque lá o separador decimal é
   * a vírgula. Já foi assim, e a coluna ficou insomável.
   *
   * Mandando o número cru com `RAW`, o Sheets guarda número em qualquer idioma
   * e não há o que adivinhar. E `RAW` continua sendo o certo para o resto do
   * lote: uma anotação começando com "=" não vira fórmula.
   */
  if (typeof campos.valor !== "undefined") {
    // usa a coluna de valor que já existir (pode se chamar "Ticket", "Receita"…)
    let iValor = cab.findIndex((h) => COL_VALOR.has(normalizar(h)));
    if (iValor === -1) iValor = garantirCol(COL_VALOR_PADRAO);
    updates.push({
      range: `${tenant.aba}!${colLetter(iValor + 1)}${linhaNum}`,
      // 0 limpa a célula: "R$ 0,00" num lead sem venda polui o relatório
      values: [[campos.valor > 0 ? campos.valor : ""]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: tenant.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });

  // extrai os identificadores da linha para a devolução da conversão.
  // Ignora a coluna de ID do sistema ("ID") para não confundir com o id do
  // lead que o Meta traz numa coluna "id" (minúsculo).
  const rowVals = valores[linhaNum - 1] || [];
  const pega = (...nomes: string[]): string => {
    for (const nome of nomes) {
      const alvo = normalizar(nome);
      for (let i = 0; i < cab.length; i++) {
        if (cab[i] === COL_ID) continue; // nunca usa o ID interno do sistema
        if (normalizar(cab[i]) === alvo) {
          const v = String(rowVals[i] ?? "").trim();
          if (v) return v;
        }
      }
    }
    return "";
  };
  const identificadores: Identificadores = {
    leadId: pega("Lead ID", "lead_id", "leadid", "leadgen_id", "id"),
    gclid: pega("gclid", "gcl_id"),
    gbraid: pega("gbraid"),
    wbraid: pega("wbraid"),
    ctwaClid: pega("ctwa_clid", "ctwa clid"),
  };

  return { ok: true, identificadores };
}

/** Registra na coluna "Conversão" o resultado do envio a Meta/Google. */
export async function registrarConversao(
  tenant: Tenant,
  id: string,
  texto: string
): Promise<void> {
  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheetId,
    range: tenant.aba,
  });
  const valores = (resp.data.values || []) as unknown[][];
  if (!valores.length) return;

  const cab = valores[0].map(String);
  const iId = cab.indexOf(COL_ID);
  if (iId === -1) return;

  let linhaNum = -1;
  for (let r = 1; r < valores.length; r++) {
    if (String(valores[r][iId]) === String(id)) { linhaNum = r + 1; break; }
  }
  if (linhaNum === -1) return;

  const updates: { range: string; values: (string | number)[][] }[] = [];
  let i = cab.indexOf(COL_CONVERSAO);
  if (i === -1) {
    i = cab.length;
    updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}1`, values: [[COL_CONVERSAO]] });
  }
  updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}${linhaNum}`, values: [[texto]] });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: tenant.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
}

/* ---------- webhook (porta gravarLead_) ---------- */

/**
 * Acrescenta uma linha de lead. Devolve o `ID` interno gerado, que é como
 * encontrar essa mesma linha depois (o espelho da atribuição usa isso para
 * preencher campanha/conjunto/anúncio quando a Graph API responder).
 */
export async function gravarLeadWebhook(
  tenant: Tenant,
  dados: Record<string, string>
): Promise<string> {
  const sheets = getSheetsClient();
  const aba = tenant.aba;

  const respCab = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheetId,
    range: `${aba}!1:1`,
  });
  let cab = (respCab.data.values?.[0] as unknown[] | undefined)?.map(String) ?? [];

  if (!cab.length) {
    cab = ["ID", "Data", "Origem", "Campanha", "Nome", "Telefone", "Email", "Status", "Anotações", "Atualizado em"];
  }
  // garante colunas reservadas
  for (const nome of RESERVADAS) if (cab.indexOf(nome) === -1) cab.push(nome);

  const papeis = mapearCabecalho(cab);
  const porPapel: Partial<Record<Papel, number>> = {};
  Object.keys(papeis).forEach((i) => {
    const papel = papeis[Number(i)];
    if (typeof porPapel[papel] === "undefined") porPapel[papel] = Number(i);
  });

  const destino: Record<string, number> = {};
  Object.keys(dados).forEach((chave) => {
    let i = cab.indexOf(chave);
    if (i === -1) {
      const papel = mapearCabecalho([chave])[0];
      if (papel && typeof porPapel[papel] !== "undefined") i = porPapel[papel] as number;
    }
    if (i === -1) {
      i = cab.length;
      cab.push(chave);
    }
    destino[chave] = i;
  });

  // reescreve o cabeçalho (pode ter ganho colunas novas ou reservadas)
  await sheets.spreadsheets.values.update({
    spreadsheetId: tenant.spreadsheetId,
    range: `${aba}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [cab] },
  });

  const linha: string[] = new Array(cab.length).fill("");
  Object.keys(dados).forEach((chave) => { linha[destino[chave]] = dados[chave]; });
  const id = novoId();
  linha[cab.indexOf(COL_ID)] = id;
  linha[cab.indexOf(COL_STATUS)] = tenant.status[0];
  const iData = cab.indexOf("Data");
  if (iData !== -1 && !linha[iData]) linha[iData] = agoraTexto(tenant.tz);

  await sheets.spreadsheets.values.append({
    spreadsheetId: tenant.spreadsheetId,
    range: `${aba}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [linha] },
  });

  return id;
}

/**
 * Preenche colunas de uma linha já existente, achada pelo `ID`.
 *
 * É o que fecha o ciclo do §37 na planilha: o lead entra na hora com telefone
 * e mensagem, e campanha/conjunto/anúncio aparecem quando a Graph API responde.
 * Usa o mesmo mapeamento de papéis da gravação, para escrever na coluna
 * "Campanha" que já existe em vez de criar uma segunda ao lado dela.
 *
 * Devolve `false` se a linha não foi encontrada — nunca lança por isso: uma
 * linha apagada à mão não pode derrubar o processamento do lead.
 */
export async function atualizarColunasLead(
  tenant: Tenant,
  id: string,
  valores: Record<string, string>
): Promise<boolean> {
  const preenchidos = Object.keys(valores).filter((k) => String(valores[k] ?? "").trim() !== "");
  if (!id || !preenchidos.length) return false;

  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheetId,
    range: tenant.aba,
  });
  const linhas = (resp.data.values || []) as unknown[][];
  if (!linhas.length) return false;

  const cab = linhas[0].map(String);
  const iId = cab.indexOf(COL_ID);
  if (iId === -1) return false;

  let linhaNum = -1;
  for (let r = 1; r < linhas.length; r++) {
    if (String(linhas[r][iId] ?? "") === String(id)) { linhaNum = r + 1; break; }
  }
  if (linhaNum === -1) return false;

  // onde cada papel (campanha/conjunto/anúncio) já mora no cabeçalho
  const papeis = mapearCabecalho(cab);
  const porPapel: Partial<Record<Papel, number>> = {};
  for (const k of Object.keys(papeis)) {
    const papel = papeis[Number(k)];
    if (typeof porPapel[papel] === "undefined") porPapel[papel] = Number(k);
  }

  const updates: { range: string; values: (string | number)[][] }[] = [];
  for (const chave of preenchidos) {
    let i = cab.indexOf(chave);
    if (i === -1) {
      const papel = mapearCabecalho([chave])[0];
      if (papel && typeof porPapel[papel] !== "undefined") i = porPapel[papel] as number;
    }
    if (i === -1) {
      i = cab.length;
      cab.push(chave);
      updates.push({ range: `${tenant.aba}!${colLetter(i + 1)}1`, values: [[chave]] });
    }
    updates.push({
      range: `${tenant.aba}!${colLetter(i + 1)}${linhaNum}`,
      values: [[valores[chave]]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: tenant.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
  return true;
}

function soDigitos(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

/**
 * Grava um lead vindo do WhatsApp, mas só se aquele telefone ainda não estiver
 * na planilha — evita criar um lead novo a cada mensagem da mesma pessoa.
 * Retorna "duplicado" quando o contato já existe.
 */
export async function gravarLeadWhatsappSeNovo(
  tenant: Tenant,
  telefone: string,
  dados: Record<string, string>
): Promise<"gravado" | "duplicado"> {
  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheetId,
    range: tenant.aba,
  });
  const valores = (resp.data.values || []) as unknown[][];
  const cab = (valores[0] || []).map(String);

  // acha a coluna de telefone pelo mapeamento de cabeçalho
  const mapa = mapearCabecalho(cab);
  let iTel = -1;
  for (const k of Object.keys(mapa)) {
    if (mapa[Number(k)] === "telefone") {
      iTel = Number(k);
      break;
    }
  }

  const alvo = soDigitos(telefone);
  if (iTel !== -1 && alvo) {
    for (let r = 1; r < valores.length; r++) {
      if (soDigitos(String(valores[r]?.[iTel] ?? "")) === alvo) return "duplicado";
    }
  }

  await gravarLeadWebhook(tenant, dados);
  return "gravado";
}
