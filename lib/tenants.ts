/**
 * Multi-tenant: cada cliente = um "tenant" com a planilha dele.
 *
 * A configuração vem da variável de ambiente TENANTS (um JSON), ou de um
 * arquivo tenants.json na raiz do projeto (útil em desenvolvimento).
 * Exemplo de um item:
 * {
 *   "slug": "acme",
 *   "nome": "ACME Consultoria",
 *   "senha": "acme2026",
 *   "spreadsheetId": "1AbC...",
 *   "aba": "Leads",
 *   "titulo": "Painel de Leads da ACME",
 *   "ddiPadrao": "55",
 *   "chaveWebhook": "chave-secreta-acme",
 *   "status": ["Novo","Em contato","Qualificado","Ganho","Perdido"]
 * }
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { TenantPublico } from "./types";
export type { TenantPublico } from "./types";

/** Envio de conversão para a Meta (Conversions API). */
export type MetaConfig = {
  datasetId: string; // ID do conjunto de dados / pixel no Events Manager
  accessToken: string; // token de usuário do sistema
  eventos: Record<string, string>; // status do painel -> nome do evento na Meta
  testEventCode?: string; // opcional, para testar no Events Manager
  leadEventSource?: string; // nome do CRM enviado em custom_data.lead_event_source
};

/** Envio de conversão para o Google Ads (upload de click conversions). */
export type GoogleConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // só dígitos, sem hífen
  loginCustomerId?: string; // MCC, se aplicável (só dígitos)
  conversoes: Record<string, string>; // status -> resource name da conversionAction
};

export type ConversoesConfig = {
  statusConversao: string[]; // quais status disparam envio
  meta?: MetaConfig;
  google?: GoogleConfig;
};

/** Recebimento direto de leads do Meta (webhook de leadgen). */
export type MetaLeadgenConfig = {
  pageId: string; // qual Página do Facebook pertence a este tenant
  pageAccessToken: string; // token da Página com permissão leads_retrieval
};

/** Captura de leads do WhatsApp Cloud API (anúncios Click-to-WhatsApp). */
export type WhatsappConfig = {
  phoneNumberId: string; // ID do número na Cloud API; roteia o webhook para este tenant
  /**
   * O número em si, só dígitos com DDI (ex.: 5585999998888).
   *
   * O `phoneNumberId` identifica o número na API, mas não serve para montar um
   * link `wa.me` — e é disso que o botão do site precisa. Sem este campo o
   * rastreamento de tráfego do site não tem para onde redirecionar.
   */
  numero?: string;
};

/** Leitura do investimento na conta de anúncios (Marketing API). */
export type MetaAdsConfig = {
  adAccountId: string; // com ou sem o prefixo "act_"
  accessToken?: string; // se vazio, usa o token de conversoes.meta (precisa de ads_read)
};

export type Tenant = {
  slug: string;
  nome: string;
  senha: string;
  spreadsheetId: string;
  aba: string;
  titulo: string;
  ddiPadrao: string;
  chaveWebhook: string;
  status: string[];
  tz: string;
  conversoes?: ConversoesConfig;
  metaLeadgen?: MetaLeadgenConfig;
  whatsapp?: WhatsappConfig;
  metaAds?: MetaAdsConfig;
  /** custo de mídia é informação da agência; só aparece pro cliente se ligado aqui */
  mostrarCustoAoCliente?: boolean;
};

const STATUS_PADRAO = ["Novo", "Em contato", "Qualificado", "Ganho", "Perdido"];

function normalizarTenant(raw: Record<string, unknown>): Tenant {
  return {
    slug: String(raw.slug || ""),
    nome: String(raw.nome || raw.slug || ""),
    senha: String(raw.senha || ""),
    spreadsheetId: String(raw.spreadsheetId || ""),
    aba: String(raw.aba || "Leads"),
    titulo: String(raw.titulo || "Painel de Leads"),
    ddiPadrao: String(raw.ddiPadrao || "55"),
    chaveWebhook: String(raw.chaveWebhook || ""),
    status: Array.isArray(raw.status) && raw.status.length ? (raw.status as string[]) : STATUS_PADRAO,
    tz: String(raw.tz || process.env.TZ || "America/Sao_Paulo"),
    conversoes: raw.conversoes ? (raw.conversoes as ConversoesConfig) : undefined,
    metaLeadgen: raw.metaLeadgen ? (raw.metaLeadgen as MetaLeadgenConfig) : undefined,
    whatsapp: raw.whatsapp ? (raw.whatsapp as WhatsappConfig) : undefined,
    metaAds: raw.metaAds ? (raw.metaAds as MetaAdsConfig) : undefined,
    mostrarCustoAoCliente: !!raw.mostrarCustoAoCliente,
  };
}

let cache: Tenant[] | null = null;

function carregar(): Tenant[] {
  if (cache) return cache;

  let bruto: unknown[] = [];

  if (process.env.TENANTS) {
    try {
      bruto = JSON.parse(process.env.TENANTS);
    } catch {
      throw new Error("A variável TENANTS não é um JSON válido.");
    }
  } else {
    // fallback: tenants.json na raiz (desenvolvimento)
    try {
      const arquivo = path.join(process.cwd(), "tenants.json");
      if (fs.existsSync(arquivo)) {
        bruto = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      }
    } catch {
      bruto = [];
    }
  }

  cache = (Array.isArray(bruto) ? bruto : []).map((r) => normalizarTenant(r as Record<string, unknown>));
  return cache;
}

export function getTenant(slug: string): Tenant | null {
  return carregar().find((t) => t.slug === slug) || null;
}

export function getTenantPorChaveWebhook(chave: string): Tenant | null {
  if (!chave) return null;
  return carregar().find((t) => t.chaveWebhook && t.chaveWebhook === chave) || null;
}

export function getTenantPorPagina(pageId: string): Tenant | null {
  if (!pageId) return null;
  return carregar().find((t) => t.metaLeadgen && t.metaLeadgen.pageId === pageId) || null;
}

export function getTenantPorTelefoneWhatsApp(phoneNumberId: string): Tenant | null {
  if (!phoneNumberId) return null;
  return carregar().find((t) => t.whatsapp && t.whatsapp.phoneNumberId === phoneNumberId) || null;
}

export function toPublico(t: Tenant): TenantPublico {
  return {
    slug: t.slug,
    titulo: t.titulo,
    status: t.status,
    exigeSenha: !!t.senha,
    mostrarCusto: !!(t.metaAds?.adAccountId && t.mostrarCustoAoCliente),
  };
}

/* ---------- escrita / administração (cadastro de clientes) ----------
 *
 * Hoje persiste no arquivo tenants.json (bom para desenvolvimento local).
 * No deploy (Vercel) o disco é efêmero: trocar `persistir`/`carregar` por um
 * banco (Postgres/Neon) mantendo estas mesmas funções. Se TENANTS vier por
 * variável de ambiente, o cadastro fica somente-leitura.
 */

function persistir(lista: Tenant[]): void {
  if (!cadastroGravavel()) {
    throw new Error(
      process.env.TENANTS
        ? "O cadastro está somente-leitura: os clientes vêm da variável de ambiente TENANTS. Edite o valor dela na hospedagem."
        : "O cadastro não pode ser salvo em produção: o disco é somente-leitura. Cadastre em desenvolvimento, clique em “Exportar (TENANTS)” e cole o JSON na variável de ambiente TENANTS."
    );
  }
  fs.writeFileSync(
    path.join(process.cwd(), "tenants.json"),
    JSON.stringify(lista, null, 2) + "\n",
    "utf8"
  );
  cache = null; // invalida o cache para a próxima leitura reler do disco
}

/** Normaliza um texto livre para um slug de URL: minúsculo, sem acento, com hífens. */
export function normalizarSlug(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function gerarChaveWebhook(): string {
  return crypto.randomBytes(12).toString("hex");
}

export function listarTenants(): Tenant[] {
  return carregar();
}

/**
 * O cadastro só é gravável onde existe disco de verdade — ou seja, em
 * desenvolvimento.
 *
 * Duas razões para ser falso:
 *  - `TENANTS` definida: a configuração vem do ambiente, o arquivo não manda.
 *  - rodando na Vercel: o disco é somente-leitura. Antes desta checagem a tela
 *    aparecia editável e só falhava no momento de salvar, com erro de sistema
 *    de arquivos — o que faz parecer bug em vez de configuração faltando.
 */
export function cadastroGravavel(): boolean {
  return !process.env.TENANTS && !process.env.VERCEL;
}

export function criarTenant(dados: Record<string, unknown>): Tenant {
  const lista = carregar().slice();
  const slug = normalizarSlug(String(dados.slug || dados.nome || ""));
  if (!slug) throw new Error("Informe um nome/endereço válido para o cliente.");
  if (lista.some((t) => t.slug === slug)) {
    throw new Error(`Já existe um cliente com o endereço "${slug}".`);
  }
  const novo = normalizarTenant({ ...dados, slug });
  if (!novo.chaveWebhook) novo.chaveWebhook = gerarChaveWebhook();
  lista.push(novo);
  persistir(lista);
  return novo;
}

export function atualizarTenant(slug: string, dados: Record<string, unknown>): Tenant {
  const lista = carregar().slice();
  const i = lista.findIndex((t) => t.slug === slug);
  if (i === -1) throw new Error("Cliente não encontrado.");
  // o slug (link do cliente) não muda no update, para não quebrar o acesso dele
  const atualizado = normalizarTenant({ ...lista[i], ...dados, slug });
  lista[i] = atualizado;
  persistir(lista);
  return atualizado;
}

export function removerTenant(slug: string): void {
  const lista = carregar();
  if (!lista.some((t) => t.slug === slug)) throw new Error("Cliente não encontrado.");
  persistir(lista.filter((t) => t.slug !== slug));
}

/**
 * Converte os campos do formulário do admin no objeto do tenant. Se vier
 * Dataset ID + Access Token do Meta, monta o bloco `conversoes.meta` completo
 * com os eventos padrão (o admin não precisa configurar o mapeamento à mão).
 * Quando os campos do Meta vêm vazios, `conversoes` não é incluído — no update
 * isso preserva a configuração que já existia.
 */
export function montarDadosTenant(entrada: Record<string, unknown>): Record<string, unknown> {
  const txt = (v: unknown) => String(v ?? "").trim();
  const nome = txt(entrada.nome);
  const titulo = txt(entrada.titulo) || (nome ? `Painel de Leads — ${nome}` : "Painel de Leads");

  const dados: Record<string, unknown> = {
    slug: entrada.slug,
    nome,
    titulo,
    senha: String(entrada.senha ?? ""),
    spreadsheetId: txt(entrada.spreadsheetId),
    aba: txt(entrada.aba) || "Página1",
    ddiPadrao: txt(entrada.ddiPadrao) || "55",
    status: ["Novo", "Em contato", "Qualificado", "Ganho", "Perdido"],
  };

  const phoneNumberId = txt(entrada.whatsappPhoneNumberId);
  const numeroWhatsapp = txt(entrada.whatsappNumero).replace(/\D/g, "");
  if (phoneNumberId || numeroWhatsapp) {
    dados.whatsapp = numeroWhatsapp
      ? { phoneNumberId, numero: numeroWhatsapp }
      : { phoneNumberId };
  }

  // conta de anúncios: o token é opcional — sem ele vale o da agência
  // (META_ADS_TOKEN) e, por último, o token de conversões
  const adAccountId = txt(entrada.metaAdAccountId);
  if (adAccountId) {
    const tokenAds = txt(entrada.metaAdsToken);
    dados.metaAds = tokenAds ? { adAccountId, accessToken: tokenAds } : { adAccountId };
  }
  dados.mostrarCustoAoCliente = !!entrada.mostrarCustoAoCliente;

  const datasetId = txt(entrada.metaDatasetId);
  const accessToken = txt(entrada.metaAccessToken);
  if (datasetId && accessToken) {
    dados.conversoes = {
      statusConversao: ["Em contato", "Qualificado", "Ganho", "Perdido"],
      meta: {
        datasetId,
        accessToken,
        testEventCode: "",
        leadEventSource: titulo,
        eventos: {
          "Em contato": "lead_contacted",
          Qualificado: "lead_qualified",
          Ganho: "lead_won",
          Perdido: "lead_disqualified",
        },
      },
    };
  }

  return dados;
}
