/** Tipos compartilhados entre servidor e cliente (sem dependências de servidor). */

export type Resposta = { pergunta: string; resposta: string };

/**
 * A atribuição publicitária de um lead, vinda do banco de rastreamento.
 *
 * Nula quando aquele contato não passou pelo webhook do WhatsApp — lead de
 * formulário, cadastro manual, ou telefone que só existe na planilha. Nulo aqui
 * significa "não sabemos", nunca "orgânico": orgânico é uma conclusão, e vem
 * como `status: "organic"`.
 */
export type AtribuicaoLead = {
  /** attributed | organic | pending | unknown (§35) */
  status: string;
  /** meta_ads | organic | unknown */
  fonte: string;
  metodo: string;
  confianca: string;
  adId: string;
  ctwaClid: string;
  campanha: string;
  conjunto: string;
  anuncio: string;
  primeiraMensagemEm: string;
  ultimaMensagemEm: string;
  /** quantas mensagens este contato já mandou */
  mensagens: number;
};

/** Uma mensagem do histórico da conversa. */
export type MensagemLead = {
  id: string;
  texto: string;
  tipo: string;
  em: string;
  direcao: string;
};

/**
 * De onde o lead veio, e portanto o que dá para saber sobre ele:
 *  - "form": preencheu o formulário (tem respostas)
 *  - "whatsapp": chegou pela conversa (temos telefone e nome do perfil)
 *  - "contato": só o telefone, sem nome confirmado
 */
export type TipoLead = "form" | "whatsapp" | "contato";

export type Lead = {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  data: string;
  origem: string;
  campanha: string;
  /** conjunto de anúncios (ad set) de origem, quando a planilha traz */
  conjunto: string;
  /** anúncio (criativo) de origem — é o nível onde o rastreamento fica útil */
  anuncio: string;
  status: string;
  nota: string;
  whatsapp: string;
  ordem: number;
  respostas: Resposta[];
  /** valor do negócio, da coluna "Valor" da planilha (0 = não informado) */
  valor: number;
  /** "Quente" / "Morno" / "Frio", da coluna "Temperatura" (vazio = não classificado) */
  temperatura: string;
  /** 1ª mensagem, preenchida pelo webhook do WhatsApp */
  primeiraMensagem: string;
  /** origem rastreada (utm_source/medium/campaign), quando a planilha traz */
  utm: string;
  /**
   * Atribuição vinda do banco de rastreamento do WhatsApp. Preenchida em
   * /api/leads, casando pelo telefone. Nula = este contato não veio por lá.
   */
  atribuicao: AtribuicaoLead | null;
  /**
   * Lead que existe no banco mas não tem linha na planilha. Etapa e anotação
   * moram na planilha, então não há onde gravá-las — o painel mostra o lead e
   * explica o motivo, em vez de oferecer um botão que falharia.
   */
  somenteLeitura?: boolean;
  // identificadores técnicos usados para devolver a conversão às plataformas
  // (não aparecem no card)
  leadId: string;
  gclid: string;
  gbraid: string;
  wbraid: string;
};

/**
 * O tipo é derivado do que o lead trouxe, não de um campo na planilha:
 * respondeu perguntas -> "form"; veio de conversa -> "whatsapp"; o resto é
 * "contato" (temos como falar com ele, mas nada que o qualifique).
 */
export function tipoDoLead(lead: Lead): TipoLead {
  if (lead.respostas.length > 0) return "form";
  if (/whats/i.test(lead.origem) || lead.primeiraMensagem) return "whatsapp";
  return "contato";
}

/** O que mostrar como título quando o lead chegou sem nome. */
export function nomeExibido(lead: Lead, telefoneFormatado: string): string {
  return lead.nome.trim() || telefoneFormatado;
}

export type TenantPublico = {
  slug: string;
  titulo: string;
  status: string[];
  exigeSenha: boolean;
  /** se o dashboard deste cliente mostra investimento e CPL */
  mostrarCusto: boolean;
};
