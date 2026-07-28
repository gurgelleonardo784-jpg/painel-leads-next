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

import type { TenantPublico } from "./types";
export type { TenantPublico } from "./types";

/** Envio de conversão para a Meta (Conversions API). */
export type MetaConfig = {
  datasetId: string; // ID do conjunto de dados / pixel no Events Manager
  accessToken: string; // token de usuário do sistema
  eventos: Record<string, string>; // status do painel -> nome do evento na Meta
  testEventCode?: string; // opcional, para testar no Events Manager
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
      // require dinâmico evita quebrar o bundle quando o arquivo não existe
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
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

export function toPublico(t: Tenant): TenantPublico {
  return {
    slug: t.slug,
    titulo: t.titulo,
    status: t.status,
    exigeSenha: !!t.senha,
  };
}
