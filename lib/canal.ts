/**
 * De onde veio a visita, a partir do que o navegador entrega.
 *
 * É o equivalente, para o Google e para o site, do que o `referral` faz para o
 * anúncio da Meta — com uma diferença importante: aqui não existe ninguém
 * confirmando a origem. O que temos é o que a URL e o `document.referrer`
 * dizem, e os dois podem faltar.
 *
 * Por isso a regra do §17 vale igual: quando não dá para saber, o canal é
 * `desconhecido`. Nunca `direto` por eliminação, e nunca `google_organico` só
 * porque não achamos um gclid — navegador que bloqueia referrer produziria
 * "orgânico" falso, e aí o cliente tomaria decisão de mídia com número inventado.
 */

export type Canal =
  | "google_ads"
  | "google_organico"
  | "meta_ads"
  | "busca_organica"
  | "social"
  | "referencia"
  | "direto"
  /**
   * Mídia paga sem saber a plataforma. Só aparece quando o clique não chegou a
   * ser gravado e a origem foi deduzida do prefixo "PAG" do código — que
   * confunde Google e Meta de propósito, para o código ficar curto.
   */
  | "pago"
  | "desconhecido";

/** O que o script do site captura e manda para o endpoint de redirecionamento. */
export type SinaisDeOrigem = {
  /** identificador de clique do Google Ads */
  gclid?: string;
  /** variantes do gclid usadas quando o consentimento limita o rastreio (iOS) */
  gbraid?: string;
  wbraid?: string;
  /** identificador de clique da Meta, quando o tráfego vem de anúncio dela */
  fbclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** ValueTrack: {campaignid}, {adgroupid}, {creative} no template de acompanhamento */
  campanhaId?: string;
  grupoId?: string;
  criativoId?: string;
  /** document.referrer da primeira página vista */
  referrer?: string;
  /** a URL de entrada, sem os parâmetros de rastreio */
  landing?: string;
};

const limpo = (v: unknown) => String(v ?? "").trim();

/** O host do referrer, sem "www.". Vazio se não der para ler. */
export function hostDoReferrer(referrer: string): string {
  const r = limpo(referrer);
  if (!r) return "";
  try {
    return new URL(r).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const BUSCADORES_GOOGLE = /(^|\.)google\.[a-z.]+$/;
const OUTROS_BUSCADORES = /(^|\.)(bing|duckduckgo|yahoo|ecosia|brave|startpage|yandex|baidu)\./;
const REDES = /(^|\.)(facebook|instagram|fb|l\.facebook|lm\.facebook|twitter|x|t|linkedin|tiktok|youtube|pinterest|threads)\.[a-z.]+$/;

/** utm_medium que significa mídia paga. */
const PAGO = /^(cpc|ppc|paid|paidsearch|paid_search|cpm|cpv|display)$/;

/**
 * Decide o canal.
 *
 * A ordem importa: identificador de clique vence tudo, porque é a única coisa
 * que a plataforma de anúncio assinou. Depois vem o que o anunciante marcou nas
 * UTMs, e só por último o referrer, que é o sinal mais fraco.
 */
export function classificarCanal(s: SinaisDeOrigem): Canal {
  // 1. identificador de clique — o sinal mais forte que existe
  if (limpo(s.gclid) || limpo(s.gbraid) || limpo(s.wbraid)) return "google_ads";
  if (limpo(s.fbclid)) return "meta_ads";

  // 2. o que o anunciante marcou na URL
  const fonte = limpo(s.utmSource).toLowerCase();
  const meio = limpo(s.utmMedium).toLowerCase();

  if (fonte || meio) {
    const ehPago = PAGO.test(meio);
    if (/google/.test(fonte)) return ehPago ? "google_ads" : "google_organico";
    if (/(facebook|instagram|meta|fb|ig)/.test(fonte)) return ehPago ? "meta_ads" : "social";
    // pago de plataforma que não modelamos (Bing, LinkedIn, TikTok…). Chamar
    // isso de "indicação" escondia que houve investimento — e mídia paga
    // aparecendo como tráfego gratuito falseia o cálculo de custo por lead.
    if (ehPago) return "pago";
    if (/(organic|seo)/.test(meio)) return "busca_organica";
    if (/(social)/.test(meio)) return "social";
    if (/(referral|referencia|indicacao)/.test(meio)) return "referencia";
    if (/(email|e-mail|newsletter|crm)/.test(meio)) return "referencia";
  }

  // 3. o referrer — só serve se a própria URL não disse nada
  const host = hostDoReferrer(limpo(s.referrer));
  if (host) {
    // sem gclid e vindo do Google: é resultado orgânico. Vale porque houve
    // referrer de verdade, não porque faltou o gclid.
    if (BUSCADORES_GOOGLE.test(host)) return "google_organico";
    if (OUTROS_BUSCADORES.test(host)) return "busca_organica";
    if (REDES.test(host)) return "social";

    const proprio = limpo(s.landing);
    const hostProprio = proprio ? hostDoReferrer(proprio) : "";
    // navegação dentro do próprio site não é origem nenhuma
    if (hostProprio && host === hostProprio) return "desconhecido";

    return "referencia";
  }

  // 4. sem clique, sem UTM e sem referrer.
  //
  // Ou a pessoa digitou o endereço, ou o navegador não mandou referrer, ou
  // veio de aplicativo. São três coisas diferentes e não dá para separar —
  // então isto é "desconhecido", não "direto". Chamar de direto inflaria um
  // canal que talvez nem exista.
  return "desconhecido";
}

/** Como o canal aparece na coluna "Origem" da planilha e no card do lead. */
export const ROTULO_CANAL: Record<Canal, string> = {
  google_ads: "Google Ads",
  google_organico: "Google orgânico",
  meta_ads: "Meta Ads",
  busca_organica: "Busca orgânica",
  social: "Redes sociais",
  referencia: "Indicação de site",
  direto: "Acesso direto",
  pago: "Mídia paga",
  desconhecido: "Origem não identificada",
};

/** Canais que são mídia paga — o que entra em "leads de anúncios". */
export function ehPago(canal: string): boolean {
  return canal === "google_ads" || canal === "meta_ads" || canal === "pago";
}

/**
 * Valor de UTM que na verdade é um ID, não um nome.
 *
 * Acontece muito: o Google Ads não tem macro para o *nome* da campanha, só
 * `{campaignid}`. Quem monta o template de acompanhamento com
 * `utm_campaign={campaignid}` acaba mandando `21458920134` — e mostrar isso na
 * coluna "Campanha" como se fosse nome é o mesmo erro que o painel cometia
 * antes com o `headline` do Meta. Aqui a gente reconhece e marca com "#".
 */
function ehIdentificador(v: string): boolean {
  return /^\d{6,}$/.test(v);
}

/** Nome quando é nome; ID marcado com "#" quando é ID; vazio quando não há nada. */
function nomeOuId(nome: string, id: string): string {
  const n = limpo(nome);
  if (n) return ehIdentificador(n) ? `#${n}` : n;
  const i = limpo(id);
  return i ? `#${i}` : "";
}

/**
 * O nome de campanha que dá para saber sem chamar API nenhuma.
 *
 * Se o template de acompanhamento manda `utm_campaign` com o nome, ele vem na
 * própria URL — e aí a Google Ads API não é necessária para nada. Sem isso
 * sobra o ID, que é melhor que vazio mas não é nome, e vai marcado.
 */
export function campanhaDosSinais(s: SinaisDeOrigem): string {
  return nomeOuId(s.utmCampaign || "", s.campanhaId || "");
}

export function grupoDosSinais(s: SinaisDeOrigem): string {
  return nomeOuId(s.utmContent || "", s.grupoId || "");
}

export function criativoDosSinais(s: SinaisDeOrigem): string {
  const id = limpo(s.criativoId);
  return id ? `#${id}` : "";
}

/**
 * Resumo do rastreio para a coluna "UTM" do painel.
 *
 * É onde a palavra-chave aparece: numa campanha de busca, saber que o lead
 * pesquisou "advogado trabalhista fortaleza" costuma valer mais que saber qual
 * criativo ele viu — e não há campo próprio para isso.
 */
export function resumoUtm(s: SinaisDeOrigem): string {
  const partes = [
    limpo(s.utmSource) && `source=${limpo(s.utmSource)}`,
    limpo(s.utmMedium) && `medium=${limpo(s.utmMedium)}`,
    limpo(s.utmTerm) && `term=${limpo(s.utmTerm)}`,
  ].filter(Boolean);
  return partes.join(" · ");
}
