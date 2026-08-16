/**
 * Motor de métricas — puro, sem I/O.
 *
 * Recebe os leads (como já vêm da planilha) e, opcionalmente, o investimento
 * vindo da Meta, e devolve tudo que os dashboards mostram. Sem dependência de
 * servidor: roda igual no browser (painel do cliente, que já tem os leads em
 * mãos) e no Node (visão consolidada da agência).
 *
 * Uma limitação honesta: a planilha guarda o *estado atual* de cada lead, não
 * o histórico. Então dá para dizer "41% estão qualificados", mas não "levou 2
 * dias para qualificar" — isso exigiria registrar cada mudança de status.
 */

import type { Lead } from "./types";
import type { InsightCampanha } from "./metaAds";
import { parseData, normal } from "./format";

/* ---------- período ---------- */

export type Periodo = {
  /** YYYY-MM-DD (início do dia, inclusive) */
  desde: string;
  /** YYYY-MM-DD (fim do dia, inclusive) */
  ate: string;
  dias: number;
};

function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

function meiaNoite(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Últimos N dias contando hoje (7 = hoje + 6 anteriores). */
export function ultimosDias(dias: number, hoje = new Date()): Periodo {
  const fim = meiaNoite(hoje);
  const ini = new Date(fim);
  ini.setDate(ini.getDate() - (dias - 1));
  return { desde: iso(ini), ate: iso(fim), dias };
}

/** O período de mesmo tamanho imediatamente anterior — base das comparações. */
export function periodoAnterior(p: Periodo): Periodo {
  const ini = new Date(p.desde + "T00:00:00");
  const fimAnterior = new Date(ini);
  fimAnterior.setDate(fimAnterior.getDate() - 1);
  const iniAnterior = new Date(fimAnterior);
  iniAnterior.setDate(iniAnterior.getDate() - (p.dias - 1));
  return { desde: iso(iniAnterior), ate: iso(fimAnterior), dias: p.dias };
}

export function temData(lead: Lead): boolean {
  return parseData(lead.data) !== null;
}

function dentro(lead: Lead, p: Periodo): boolean {
  const d = parseData(lead.data);
  // planilha sem coluna de data (ou célula vazia): o lead existe, só não dá
  // para situá-lo no tempo. Descartar zeraria o dashboard inteiro de quem não
  // tem essa coluna — então ele entra nos totais, e a tela avisa quantos são.
  if (!d) return true;
  const dia = iso(meiaNoite(d));
  return dia >= p.desde && dia <= p.ate;
}

export function filtrarPeriodo(leads: Lead[], p: Periodo): Lead[] {
  return leads.filter((l) => dentro(l, p));
}

/* ---------- agrupamentos ---------- */

export type Fatia = { nome: string; leads: number };

/** Série diária completa: dias sem lead entram como 0, senão o gráfico mente. */
export type PontoDia = { dia: string; leads: number };

export function serieDiaria(leads: Lead[], p: Periodo): PontoDia[] {
  const contagem: Record<string, number> = {};
  for (const l of leads) {
    const d = parseData(l.data);
    if (!d) continue;
    const dia = iso(meiaNoite(d));
    if (dia < p.desde || dia > p.ate) continue;
    contagem[dia] = (contagem[dia] || 0) + 1;
  }

  const pontos: PontoDia[] = [];
  const cursor = new Date(p.desde + "T00:00:00");
  const fim = new Date(p.ate + "T00:00:00");
  while (cursor <= fim) {
    const dia = iso(cursor);
    pontos.push({ dia, leads: contagem[dia] || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return pontos;
}

function agrupar(leads: Lead[], campo: (l: Lead) => string, semNome: string): Fatia[] {
  const mapa = new Map<string, number>();
  for (const l of leads) {
    const chave = (campo(l) || "").trim() || semNome;
    mapa.set(chave, (mapa.get(chave) || 0) + 1);
  }
  return [...mapa.entries()]
    .map(([nome, n]) => ({ nome, leads: n }))
    .sort((a, b) => b.leads - a.leads);
}

export function porOrigem(leads: Lead[]): Fatia[] {
  return agrupar(leads, (l) => l.origem, "Sem origem");
}

export function porCampanha(leads: Lead[]): Fatia[] {
  return agrupar(leads, (l) => l.campanha, "Sem campanha");
}

/* ---------- funil ---------- */

export type EtapaFunil = {
  status: string;
  leads: number;
  /** % sobre o total de leads do período */
  percentual: number;
};

/**
 * O funil segue a ordem de status configurada no tenant (Novo → ... → Ganho).
 * Cada etapa mostra quantos leads estão *nela agora* — é uma foto do estado
 * atual, não um fluxo acumulado.
 */
export function funil(leads: Lead[], statusList: string[]): EtapaFunil[] {
  const contagem: Record<string, number> = {};
  for (const l of leads) {
    const s = l.status || statusList[0] || "Novo";
    contagem[s] = (contagem[s] || 0) + 1;
  }
  const total = leads.length || 1;
  return statusList.map((s) => ({
    status: s,
    leads: contagem[s] || 0,
    percentual: ((contagem[s] || 0) / total) * 100,
  }));
}

/* ---------- classificação de status ---------- */

/**
 * "Qualificado" e "Ganho" são nomes de status configuráveis, então a
 * classificação é por texto normalizado, com sinônimos comuns.
 */
function ehStatus(s: string, alvos: string[]): boolean {
  const n = normal(s);
  return alvos.some((a) => n.includes(a));
}

export const ehQualificado = (s: string) => ehStatus(s, ["qualific"]);
export const ehGanho = (s: string) => ehStatus(s, ["ganho", "fechado", "vendido", "cliente"]);
export const ehPerdido = (s: string) => ehStatus(s, ["perdido", "descartado", "desqualific"]);
export const ehNovo = (s: string) => ehStatus(s, ["novo", "nao contatado"]);

/* ---------- resultado ---------- */

export type Custo = {
  investimento: number;
  moeda: string;
  /** custo por lead */
  cpl: number | null;
  custoPorQualificado: number | null;
  custoPorGanho: number | null;
  /** quando a leitura da conta de anúncios falhou, o motivo */
  erro?: string;
};

export type CampanhaMetrica = {
  nome: string;
  canal: string;
  leads: number;
  qualificados: number;
  ganhos: number;
  investimento: number | null;
  cpl: number | null;
  /** soma do valor dos leads ganhos desta campanha (coluna "Valor" da planilha) */
  receita: number;
  roas: number | null;
  lucro: number | null;
  impressoes: number | null;
  cliques: number | null;
  /**
   * Conversas iniciadas pelo anúncio (Click-to-WhatsApp / Direct), segundo a
   * Meta. O contato em si não vem — só com a Cloud API — mas sem isto uma
   * campanha de mensagem apareceria com zero resultado.
   */
  conversas: number;
  respostas: number;
  custoPorConversa: number | null;
  /** quantos leads a Meta diz ter gerado (atribuição dela) */
  leadsMeta: number;
  /** (planilha − Meta) / Meta, em %. null quando a Meta não reportou lead */
  divergencia: number | null;
  /** CPL pela contagem da Meta — o número que ela mostra no Gerenciador */
  cplMeta: number | null;
};

/**
 * O mesmo recorte, no nível do anúncio. É aqui que o rastreamento fica útil:
 * campanha diz onde o dinheiro entrou, anúncio diz qual criativo trouxe gente.
 */
export type AnuncioMetrica = {
  anuncio: string;
  conjunto: string;
  campanha: string;
  canal: string;
  investimento: number;
  leadsMeta: number;
  leadsPlanilha: number;
  divergencia: number | null;
  conversas: number;
  /** conversas que passaram de 3 mensagens — o filtro de curioso */
  engajadas: number;
  respostas: number;
  /** investimento dividido pelas conversas engajadas */
  custoPorEngajada: number | null;
  custoPorConversa: number | null;
  qualificados: number;
  ganhos: number;
  receita: number;
  cpl: number | null;
  cplMeta: number | null;
};

export type CanalMetrica = {
  nome: string;
  leads: number;
  investimento: number;
  receita: number;
  cpl: number | null;
  roas: number | null;
};

/** Nome de canal para cada fonte de atribuição rastreada. */
const NOME_DA_FONTE: Record<string, string> = {
  google_ads: "Google Ads",
  google_organico: "Google orgânico",
  meta_ads: "Meta Ads",
  busca_organica: "Busca orgânica",
  social: "Redes sociais",
  referencia: "Indicação",
  organic: "WhatsApp direto",
};

/**
 * O canal do lead.
 *
 * Quando existe atribuição rastreada, ela manda: veio de gclid, UTM ou
 * referrer, e é mais confiável que qualquer palavra na coluna "Origem". Só
 * quando não há atribuição é que caímos no texto da planilha, que é o que
 * existia antes do rastreamento.
 *
 * Investimento só existe para o que veio da conta de anúncios; os demais canais
 * aparecem com volume e receita, sem custo.
 */
export function canalDoLead(lead: Lead): string {
  const fonte = lead.atribuicao?.fonte;
  if (fonte && NOME_DA_FONTE[fonte]) return NOME_DA_FONTE[fonte];

  const o = normal(lead.origem);
  const temCampanha = !!lead.campanha.trim();
  if (/indica/.test(o)) return "Indicação";
  // orgânico ANTES de pago: "Google orgânico" contém "google", e testar pago
  // primeiro fundia busca orgânica com mídia paga — os dois canais que o
  // cliente mais precisa comparar
  if (/organic|seo/.test(o)) return /google/.test(o) ? "Google orgânico" : "Busca orgânica";
  if (/google|adwords/.test(o) || lead.gclid) return "Google Ads";
  if (/whats/.test(o)) return temCampanha ? "Meta Ads" : "WhatsApp direto";
  if (/instagram/.test(o)) return temCampanha ? "Meta Ads" : "Instagram orgânico";
  if (/facebook|meta/.test(o)) return "Meta Ads";
  if (/site|blog/.test(o)) return "Site / SEO";
  return lead.origem.trim() || "Sem origem";
}

export type Metricas = {
  periodo: Periodo;
  total: number;
  /** quantos do total não têm data e por isso ficam fora do gráfico por dia */
  semData: number;
  /** leads que ainda estão no primeiro status (não trabalhados) */
  novos: number;
  qualificados: number;
  ganhos: number;
  perdidos: number;
  taxaQualificacao: number; // %
  taxaGanho: number; // %
  /** variação % do total contra o período anterior (null se não havia base) */
  variacaoTotal: number | null;
  serie: PontoDia[];
  funil: EtapaFunil[];
  origens: Fatia[];
  campanhas: CampanhaMetrica[];
  anuncios: AnuncioMetrica[];
  canais: CanalMetrica[];
  /** quantos leads do período têm o anúncio de origem preenchido na planilha */
  comAnuncio: number;
  custo: Custo | null;
  /** soma do valor dos leads ganhos no período */
  receita: number;
  /** receita / nº de ganhos */
  ticketMedio: number | null;
  /** receita / investimento — null sem uma das duas pontas */
  roas: number | null;
  lucro: number | null;
  /** quantos leads têm valor preenchido (se 0, receita/ROAS não têm base) */
  comValor: number;
  /** leads parados no primeiro status — a fila de trabalho */
  aguardandoContato: number;
  /** conversas iniciadas por anúncios de mensagem, somadas (fonte: Meta) */
  conversas: number;
  custoPorConversa: number | null;
};

function taxa(parte: number, todo: number): number {
  return todo > 0 ? (parte / todo) * 100 : 0;
}

function dividir(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/**
 * Casa as campanhas da planilha com as da conta de anúncios pelo nome
 * normalizado. Não é perfeito — se o nome na planilha vier truncado pela
 * automação, a linha fica sem investimento em vez de casar errado.
 *
 * Ordena por lucro (receita − investimento), como pede o design: o que
 * interessa não é quem gerou mais lead, é quem deu mais retorno.
 */
function casarCampanhas(leads: Lead[], insights: InsightCampanha[]): CampanhaMetrica[] {
  const porNome = new Map<string, InsightCampanha>();
  for (const c of insights) porNome.set(normal(c.campanha).trim(), c);

  // agrupa os leads por campanha, somando status e valor de uma vez só
  type Acc = { nome: string; canal: string; leads: number; qual: number; ganhos: number; receita: number };
  const grupos = new Map<string, Acc>();
  for (const l of leads) {
    const nome = l.campanha.trim() || "Sem campanha";
    const chave = normal(nome).trim();
    const g = grupos.get(chave) || {
      nome,
      canal: canalDoLead(l),
      leads: 0,
      qual: 0,
      ganhos: 0,
      receita: 0,
    };
    g.leads += 1;
    if (ehQualificado(l.status) || ehGanho(l.status)) g.qual += 1;
    if (ehGanho(l.status)) {
      g.ganhos += 1;
      g.receita += l.valor;
    }
    grupos.set(chave, g);
  }

  const montar = (
    nome: string,
    canal: string,
    leads: number,
    qual: number,
    ganhos: number,
    receita: number,
    ins?: InsightCampanha
  ): CampanhaMetrica => {
    const investimento = ins ? ins.investimento : null;
    return {
      nome,
      canal,
      leads,
      qualificados: qual,
      ganhos,
      receita,
      investimento,
      cpl: ins && leads > 0 ? dividir(ins.investimento, leads) : null,
      roas: investimento && investimento > 0 ? receita / investimento : null,
      lucro: investimento === null ? null : receita - investimento,
      impressoes: ins ? ins.impressoes : null,
      cliques: ins ? ins.cliques : null,
      conversas: ins ? ins.conversas : 0,
      respostas: ins ? ins.respostas : 0,
      custoPorConversa: ins && ins.conversas > 0 ? ins.investimento / ins.conversas : null,
      leadsMeta: ins ? ins.leadsMeta : 0,
      divergencia: ins && ins.leadsMeta > 0 ? ((leads - ins.leadsMeta) / ins.leadsMeta) * 100 : null,
      cplMeta: ins && ins.leadsMeta > 0 ? ins.investimento / ins.leadsMeta : null,
    };
  };

  const usados = new Set<string>();
  const linhas: CampanhaMetrica[] = [...grupos.entries()].map(([chave, g]) => {
    const ins = porNome.get(chave);
    if (ins) usados.add(chave);
    return montar(g.nome, g.canal, g.leads, g.qual, g.ganhos, g.receita, ins);
  });

  // campanha que gastou e não gerou lead nenhum também precisa aparecer:
  // é exatamente onde o dinheiro está indo embora sem retorno
  for (const ins of insights) {
    const chave = normal(ins.campanha).trim();
    if (usados.has(chave) || ins.investimento <= 0) continue;
    linhas.push(montar(ins.campanha, "Meta Ads", 0, 0, 0, 0, ins));
  }

  return linhas.sort((a, b) => {
    const la = a.lucro ?? a.receita;
    const lb = b.lucro ?? b.receita;
    return lb - la || b.leads - a.leads;
  });
}

/**
 * Rastreamento por anúncio: cruza o que a Meta reporta com o que realmente
 * chegou na planilha.
 *
 * As duas contagens divergem por motivos legítimos — a Meta atribui pela
 * janela dela, o formulário pode ser abandonado, a automação pode falhar —
 * e por motivos que interessam: lead duplicado, lead que nunca chegou. Por
 * isso o painel mostra as duas lado a lado em vez de escolher uma.
 *
 * O casamento é pelo nome do anúncio. Lead sem coluna de anúncio na planilha
 * conta só do lado da Meta, e a tela avisa.
 */
function reconciliarAnuncios(leads: Lead[], insights: InsightCampanha[]): AnuncioMetrica[] {
  // leads da planilha, agrupados pelo nome do anúncio
  type Grupo = { leads: number; qual: number; ganhos: number; receita: number };
  const daPlanilha = new Map<string, Grupo>();
  for (const l of leads) {
    const chave = normal(l.anuncio).trim();
    if (!chave) continue;
    const g = daPlanilha.get(chave) || { leads: 0, qual: 0, ganhos: 0, receita: 0 };
    g.leads += 1;
    if (ehQualificado(l.status) || ehGanho(l.status)) g.qual += 1;
    if (ehGanho(l.status)) {
      g.ganhos += 1;
      g.receita += l.valor;
    }
    daPlanilha.set(chave, g);
  }

  const linhas: AnuncioMetrica[] = [];
  const usados = new Set<string>();

  for (const ins of insights) {
    const nome = ins.anuncio || "(sem anúncio)";
    const chave = normal(nome).trim();
    const g = daPlanilha.get(chave);
    if (g) usados.add(chave);

    const naPlanilha = g?.leads || 0;
    linhas.push({
      anuncio: nome,
      conjunto: ins.conjunto || "",
      campanha: ins.campanha,
      canal: "Meta Ads",
      investimento: ins.investimento,
      leadsMeta: ins.leadsMeta,
      leadsPlanilha: naPlanilha,
      divergencia: ins.leadsMeta > 0 ? ((naPlanilha - ins.leadsMeta) / ins.leadsMeta) * 100 : null,
      conversas: ins.conversas,
      engajadas: ins.engajadas,
      respostas: ins.respostas,
      custoPorConversa: ins.conversas > 0 ? ins.investimento / ins.conversas : null,
      custoPorEngajada: ins.engajadas > 0 ? ins.investimento / ins.engajadas : null,
      qualificados: g?.qual || 0,
      ganhos: g?.ganhos || 0,
      receita: g?.receita || 0,
      cpl: naPlanilha > 0 ? ins.investimento / naPlanilha : null,
      cplMeta: ins.leadsMeta > 0 ? ins.investimento / ins.leadsMeta : null,
    });
  }

  // anúncio que trouxe lead na planilha mas não aparece no relatório da Meta:
  // é sinal de nome divergente ou de lead atribuído errado — precisa aparecer
  for (const [chave, g] of daPlanilha) {
    if (usados.has(chave)) continue;
    const original = leads.find((l) => normal(l.anuncio).trim() === chave);
    linhas.push({
      anuncio: original?.anuncio || chave,
      conjunto: original?.conjunto || "",
      campanha: original?.campanha || "",
      canal: original ? canalDoLead(original) : "Meta Ads",
      investimento: 0,
      leadsMeta: 0,
      leadsPlanilha: g.leads,
      divergencia: null,
      conversas: 0,
      engajadas: 0,
      respostas: 0,
      custoPorConversa: null,
      custoPorEngajada: null,
      qualificados: g.qual,
      ganhos: g.ganhos,
      receita: g.receita,
      cpl: null,
      cplMeta: null,
    });
  }

  return linhas.sort(
    (a, b) => b.leadsPlanilha - a.leadsPlanilha || b.investimento - a.investimento
  );
}

/** Agrupa os leads por canal, somando o investimento das campanhas de cada um. */
function agruparCanais(leads: Lead[], campanhas: CampanhaMetrica[]): CanalMetrica[] {
  const mapa = new Map<string, CanalMetrica>();
  const pegar = (nome: string): CanalMetrica => {
    const atual = mapa.get(nome) || {
      nome,
      leads: 0,
      investimento: 0,
      receita: 0,
      cpl: null,
      roas: null,
    };
    mapa.set(nome, atual);
    return atual;
  };

  for (const l of leads) {
    const c = pegar(canalDoLead(l));
    c.leads += 1;
    if (ehGanho(l.status)) c.receita += l.valor;
  }
  // o investimento vem da campanha, não do lead — soma no canal dela
  for (const camp of campanhas) {
    if (!camp.investimento) continue;
    pegar(camp.canal).investimento += camp.investimento;
  }

  return [...mapa.values()]
    .map((c) => ({
      ...c,
      cpl: dividir(c.investimento, c.leads),
      roas: c.investimento > 0 ? c.receita / c.investimento : null,
    }))
    .sort((a, b) => b.leads - a.leads);
}

export type EntradaCusto = {
  campanhas: InsightCampanha[];
  /** o mesmo período no nível de anúncio, quando disponível */
  anuncios?: InsightCampanha[];
  moeda: string;
  erro?: string;
};

export function calcular(
  todosOsLeads: Lead[],
  statusList: string[],
  periodo: Periodo,
  custo?: EntradaCusto | null
): Metricas {
  const leads = filtrarPeriodo(todosOsLeads, periodo);
  const anterior = filtrarPeriodo(todosOsLeads, periodoAnterior(periodo));

  // a comparação com o período anterior só considera leads com data — os sem
  // data cairiam nos dois períodos e inflariam os dois lados igualmente
  const comData = leads.filter(temData).length;
  const comDataAnterior = anterior.filter(temData).length;

  const total = leads.length;
  const novos = leads.filter((l) => ehNovo(l.status)).length;
  const qualificados = leads.filter((l) => ehQualificado(l.status) || ehGanho(l.status)).length;
  const ganhos = leads.filter((l) => ehGanho(l.status)).length;
  const perdidos = leads.filter((l) => ehPerdido(l.status)).length;

  const insights = custo?.campanhas || [];
  const investimento = insights.reduce((s, c) => s + c.investimento, 0);
  const campanhas = casarCampanhas(leads, insights);

  // receita = valor dos negócios ganhos. Depende da coluna "Valor" da planilha:
  // sem ela, receita/ROAS/lucro ficam zerados e a tela avisa em vez de inventar.
  const receita = leads.filter((l) => ehGanho(l.status)).reduce((s, l) => s + l.valor, 0);
  const comValor = leads.filter((l) => l.valor > 0).length;
  const primeiroStatus = statusList[0] || "Novo";

  // conversas iniciadas por anúncio de mensagem. O custo por conversa só
  // considera o que foi gasto nas campanhas que geraram conversa — misturar
  // com o gasto de campanhas de formulário daria um número sem sentido.
  const totalConversas = campanhas.reduce((s, c) => s + c.conversas, 0);
  const investimentoConversas = campanhas
    .filter((c) => c.conversas > 0)
    .reduce((s, c) => s + (c.investimento || 0), 0);

  return {
    periodo,
    total,
    semData: total - comData,
    novos,
    qualificados,
    ganhos,
    perdidos,
    taxaQualificacao: taxa(qualificados, total),
    taxaGanho: taxa(ganhos, total),
    variacaoTotal:
      comDataAnterior > 0 ? ((comData - comDataAnterior) / comDataAnterior) * 100 : null,
    serie: serieDiaria(leads, periodo),
    funil: funil(leads, statusList),
    origens: porOrigem(leads),
    campanhas,
    anuncios: reconciliarAnuncios(leads, custo?.anuncios || []),
    comAnuncio: leads.filter((l) => l.anuncio.trim()).length,
    canais: agruparCanais(leads, campanhas),
    receita,
    ticketMedio: dividir(receita, ganhos),
    roas: investimento > 0 && receita > 0 ? receita / investimento : null,
    lucro: investimento > 0 || receita > 0 ? receita - investimento : null,
    comValor,
    aguardandoContato: leads.filter((l) => (l.status || primeiroStatus) === primeiroStatus).length,
    conversas: totalConversas,
    custoPorConversa: totalConversas > 0 ? dividir(investimentoConversas, totalConversas) : null,
    custo: custo
      ? {
          investimento,
          moeda: custo.moeda,
          cpl: dividir(investimento, total),
          custoPorQualificado: dividir(investimento, qualificados),
          custoPorGanho: dividir(investimento, ganhos),
          erro: custo.erro,
        }
      : null,
  };
}

/* ---------- formatação (compartilhada pelos dashboards) ---------- */

/**
 * Dinheiro para leitura de painel: acima de R$ 100 os centavos somem, porque
 * "R$ 18.432" se lê melhor que "R$ 18.432,17" numa coluna de totais.
 *
 * Serve para soma e média. NÃO serve para o valor de um lead específico — ver
 * `moedaExata`.
 */
export function moeda(v: number | null, cod = "BRL"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cod,
    maximumFractionDigits: v >= 100 ? 0 : 2,
  }).format(v);
}

/**
 * Dinheiro com os centavos sempre.
 *
 * Para o valor de um negócio, o arredondamento do `moeda` mente: quem digita
 * 3.450,75 e lê "R$ 3.451" acha que o sistema alterou o número dele — e a
 * desconfiança se espalha para o resto do painel.
 */
export function moedaExata(v: number | null, cod = "BRL"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cod,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function inteiro(v: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(v));
}

/** Valores grandes viram 12,9 mil — stat tile não comporta 7 dígitos. */
export function compacto(v: number): string {
  if (Math.abs(v) < 10000) return inteiro(v);
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function percentual(v: number, casas = 0): string {
  return `${v.toFixed(casas).replace(".", ",")}%`;
}

/** "2026-07-29" -> "29/jul" (rótulo de eixo). */
export function diaCurto(diaIso: string): string {
  const [, m, d] = diaIso.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${Number(d)}/${meses[Number(m) - 1] || ""}`;
}
