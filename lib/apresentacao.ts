/**
 * Como o lead aparece na tela: nome, telefone, iniciais, cor, tempo.
 *
 * Fica separado do motor de métricas de propósito — aqui é decisão visual,
 * lá é conta. Sem dependência de servidor: roda no navegador.
 */

import type { Lead, TipoLead } from "./types";
import { normal, parseData } from "./format";

/** 11 dígitos viram (11) 97777-6666; o resto sai como veio. */
export function fmtTelefone(bruto: string): string {
  const d = String(bruto || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 13 && d.startsWith("55")) return fmtTelefone(d.slice(2));
  return bruto || "";
}

/**
 * Iniciais para o avatar. Ignora emoji e pontuação (nome de perfil do WhatsApp
 * costuma ter), e devolve "#" quando não há nome de gente nenhum.
 */
export function iniciais(nome: string): string {
  const limpo = String(nome || "")
    .replace(/[^\p{L}\s]/gu, " ")
    .trim();
  if (!limpo) return "#";
  const partes = limpo.split(/\s+/);
  const a = partes[0]?.[0] || "";
  const b = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (a + b).toUpperCase() || "#";
}

const CORES_AVATAR = [
  "#2b6cf6",
  "#a855f7",
  "#f59e0b",
  "#22c55e",
  "#ec4899",
  "#0d9488",
];

/** Cor estável por lead: o mesmo lead tem sempre o mesmo avatar. */
export function corAvatar(chave: string): string {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
  return CORES_AVATAR[h % CORES_AVATAR.length];
}

export function estiloAvatar(chave: string, tamanho: number) {
  const cor = corAvatar(chave);
  return {
    width: `${tamanho}px`,
    height: `${tamanho}px`,
    fontSize: `${tamanho <= 34 ? 12 : 15}px`,
    background: `linear-gradient(140deg, ${cor}, ${cor}99)`,
  };
}

/** "há 12 min", "há 2 h", "há 3 dias". Sem data, string vazia. */
export function tempoRelativo(dataTexto: string, agora = new Date()): string {
  const d = parseData(dataTexto);
  if (!d) return "";
  const seg = Math.floor((agora.getTime() - d.getTime()) / 1000);
  if (seg < 0) return "agora";
  if (seg < 60) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "há 1 dia";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}

/* ---------- etapas ---------- */

export type Etapa = { chave: string; rotulo: string; cor: string };

const SEMANTICA: { teste: RegExp; cor: string }[] = [
  { teste: /novo|nao contatado/, cor: "var(--etapa-novo)" },
  { teste: /contato|contatad|andamento/, cor: "var(--etapa-contato)" },
  { teste: /qualific/, cor: "var(--etapa-qualificado)" },
  { teste: /ganho|fechado|vendido|cliente/, cor: "var(--etapa-ganho)" },
  { teste: /perdid|descartad|desqualific/, cor: "var(--etapa-perdido)" },
];

const ORDEM_PADRAO = [
  "var(--etapa-novo)",
  "var(--etapa-contato)",
  "var(--etapa-qualificado)",
  "var(--etapa-ganho)",
  "var(--etapa-perdido)",
];

/**
 * Cor de cada status. Tenta reconhecer pelo nome (o cliente pode renomear
 * "Novo" para "Recebido"); se não reconhecer, cai na posição da lista.
 */
export function corDoStatus(status: string, statusList: string[]): string {
  const n = normal(status);
  const achado = SEMANTICA.find((s) => s.teste.test(n));
  if (achado) return achado.cor;
  const i = statusList.indexOf(status);
  return ORDEM_PADRAO[i >= 0 ? i % ORDEM_PADRAO.length : 0];
}

export function etapas(statusList: string[]): Etapa[] {
  return statusList.map((s) => ({ chave: s, rotulo: s, cor: corDoStatus(s, statusList) }));
}

/**
 * Etapa de desfecho negativo — perder o lead não é progredir nele.
 *
 * Reconhecida pelo nome, e não pela posição, porque o cliente pode renomear
 * ("Descartado", "Desqualificado") ou reordenar as etapas dele.
 */
export function ehEtapaPerdida(status: string): boolean {
  return /perdid|descartad|desqualific|cancelad/.test(normal(status));
}

/**
 * A próxima etapa ao avançar um lead, ou `null` quando não há para onde ir.
 *
 * Pular as etapas de perda é o ponto todo desta função. A lista de etapas
 * parece uma fila, mas o fim dela não é: "Ganho" e "Perdido" são desfechos
 * opostos, não passos consecutivos. Avançando pelo índice, o botão de avançar
 * levava um negócio **ganho** para **perdido** — um clique errado apagando a
 * informação mais valiosa do painel, sem confirmação e sem desfazer.
 *
 * Perder um lead continua possível, mas só como escolha explícita no detalhe.
 */
export function proximaEtapa(atual: string, statusList: string[]): string | null {
  const i = statusList.indexOf(atual);
  if (i === -1) return statusList[0] ?? null;
  for (let j = i + 1; j < statusList.length; j++) {
    if (!ehEtapaPerdida(statusList[j])) return statusList[j];
  }
  return null;
}

/* ---------- tipo do lead ---------- */

export const ROTULO_TIPO: Record<TipoLead, string> = {
  form: "Formulário",
  whatsapp: "Perfil WhatsApp",
  contato: "Só contato",
};

export const COR_TIPO: Record<TipoLead, string> = {
  form: "var(--tipo-form)",
  whatsapp: "var(--tipo-whats)",
  contato: "var(--tipo-contato)",
};

/* ---------- atribuição publicitária (§35) ---------- */

/**
 * Como cada status de atribuição se apresenta.
 *
 * "pending" é o caso que mais confunde e por isso tem nome próprio na tela: o
 * lead veio de anúncio (a Meta confirmou), mas o nome da campanha ainda não
 * chegou. Chamar isso de "orgânico" seria mentir, e deixar em branco pareceria
 * bug.
 */
export const ROTULO_ATRIBUICAO: Record<string, string> = {
  attributed: "De anúncio",
  pending: "Anúncio não identificado",
  organic: "Orgânico",
  unknown: "Origem indefinida",
};

export const COR_ATRIBUICAO: Record<string, string> = {
  attributed: "var(--canal-meta)",
  pending: "var(--alerta)",
  organic: "var(--tipo-whats)",
  unknown: "var(--txt5)",
};

export function rotuloAtribuicao(status: string): string {
  return ROTULO_ATRIBUICAO[status] || "Origem indefinida";
}

export function corAtribuicao(status: string): string {
  return COR_ATRIBUICAO[status] || "var(--txt5)";
}

/** "08/08 10:31" a partir de um ISO. Vazio se não der para ler. */
export function horaCurta(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/* ---------- temperatura ---------- */

export function corTemperatura(t: string): string | null {
  const n = normal(t);
  if (/quente/.test(n)) return "var(--temp-quente)";
  if (/morn/.test(n)) return "var(--temp-morno)";
  if (/frio|fria/.test(n)) return "var(--temp-frio)";
  return null;
}

/* ---------- cores de canal ---------- */

const CORES_CANAL: { teste: RegExp; cor: string }[] = [
  // busca orgânica antes de "google": senão "Google orgânico" pegaria a cor de
  // Google Ads e os dois canais ficariam indistinguíveis no gráfico
  { teste: /seo|organic|busca/, cor: "var(--canal-site)" },
  { teste: /meta|facebook/, cor: "var(--canal-meta)" },
  { teste: /google/, cor: "var(--canal-google)" },
  { teste: /instagram|social|rede/, cor: "var(--canal-instagram)" },
  { teste: /indica|referenc/, cor: "var(--canal-indicacao)" },
  { teste: /site/, cor: "var(--canal-site)" },
  { teste: /whats/, cor: "var(--tipo-whats)" },
];

export function corDoCanal(nome: string): string {
  const n = normal(nome);
  return CORES_CANAL.find((c) => c.teste.test(n))?.cor || "var(--txt5)";
}

/** Texto de busca de um lead — tudo que o filtro precisa varrer. */
export function textoBusca(lead: Lead): string {
  return normal(
    [lead.nome, lead.telefone, lead.email, lead.campanha, lead.origem, lead.nota, lead.primeiraMensagem]
      .concat(lead.respostas.map((r) => `${r.pergunta} ${r.resposta}`))
      .join(" ")
  );
}
