/**
 * WhatsApp Cloud API — leitura do payload do webhook.
 *
 * Este módulo é só tradução: pega o JSON que o Meta manda e devolve um objeto
 * tipado. Não decide atribuição (isso é `lib/atribuicao.ts`) e não grava nada
 * (isso é `lib/repositorio.ts`).
 *
 * O ponto crítico é o bloco `referral` (§13): quando alguém clica num anúncio
 * Click-to-WhatsApp e manda a 1ª mensagem, ele vem com o anúncio de origem e o
 * `ctwa_clid`. Ele aparece **só nessa primeira mensagem** — se for descartado
 * aqui, a atribuição daquele lead está perdida para sempre (§53). Por isso
 * guardamos o bloco inteiro, inclusive os campos que hoje ninguém lê.
 */

/** O objeto `referral` como o Meta documenta (§13). Todos os campos são opcionais. */
export type Referral = {
  source_url?: string;
  source_id?: string;
  source_type?: string; // "ad" | "post"
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
};

type MensagemCrua = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  referral?: Referral;
  /** algumas versões do payload trazem o clid fora do referral */
  ctwa_clid?: string;
};

type Contato = { wa_id?: string; profile?: { name?: string } };

export type ValorWhatsApp = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Contato[];
  messages?: MensagemCrua[];
};

export type MensagemWhatsApp = {
  /** message.id — é a chave de idempotência do §22 */
  id: string;
  /** message.from: telefone do usuário, só dígitos, com DDI */
  telefone: string;
  /** nome do perfil do WhatsApp (pode vir vazio) */
  nomePerfil: string;
  waId: string;
  /** quando o usuário mandou, não quando recebemos */
  em: Date | null;
  tipo: string;
  texto: string;
  referral: Referral | null;
  ctwaClid: string;
  /** o objeto original da mensagem, para gravar em messages.raw_payload (§21) */
  bruto: unknown;
};

export type EventoWhatsApp = {
  /** entry.id do webhook = o WABA que recebeu a mensagem */
  wabaId: string;
  /** roteia o evento para o cliente certo */
  phoneNumberId: string;
  /** o número comercial que recebeu a mensagem, legível */
  displayPhoneNumber: string;
  mensagens: MensagemWhatsApp[];
};

function soDigitos(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

/**
 * O texto da mensagem, qualquer que seja o tipo. Um lead que responde clicando
 * num botão do anúncio não manda `text`, e ficar com a primeira mensagem vazia
 * esconde justamente o lead que interagiu.
 */
function textoDaMensagem(m: MensagemCrua): string {
  return (
    m.text?.body ||
    m.button?.text ||
    m.interactive?.button_reply?.title ||
    m.interactive?.list_reply?.title ||
    ""
  ).trim();
}

/** Só considera o referral se ele tiver algo que sirva de atribuição. */
function referralUtil(r: Referral | undefined): Referral | null {
  if (!r) return null;
  const tem = r.source_id || r.ctwa_clid || r.source_url || r.headline || r.source_type;
  return tem ? r : null;
}

function dataDe(timestamp: unknown): Date | null {
  const seg = Number(timestamp);
  if (!Number.isFinite(seg) || seg <= 0) return null;
  const d = new Date(seg * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Traduz um `entry[].changes[].value` de campo `messages` no evento tipado.
 * `wabaId` vem do `entry.id`, que é o único lugar onde o WABA aparece.
 */
export function extrairEventoWhatsApp(wabaId: string, valor: ValorWhatsApp): EventoWhatsApp {
  const nomePorWa: Record<string, string> = {};
  for (const c of valor.contacts || []) {
    if (c.wa_id) nomePorWa[c.wa_id] = String(c.profile?.name || "").trim();
  }

  const mensagens: MensagemWhatsApp[] = [];
  for (const m of valor.messages || []) {
    const telefone = soDigitos(m.from);
    const id = String(m.id || "");
    // sem telefone não há contato, e sem id não há como não duplicar (§22)
    if (!telefone || !id) continue;

    const ref = referralUtil(m.referral);
    mensagens.push({
      id,
      telefone,
      nomePerfil: nomePorWa[String(m.from)] || nomePorWa[telefone] || "",
      waId: String(m.from || ""),
      em: dataDe(m.timestamp),
      tipo: String(m.type || "text"),
      texto: textoDaMensagem(m),
      referral: ref,
      ctwaClid: String(ref?.ctwa_clid || m.ctwa_clid || ""),
      bruto: m,
    });
  }

  return {
    wabaId: String(wabaId || ""),
    phoneNumberId: String(valor.metadata?.phone_number_id || ""),
    displayPhoneNumber: String(valor.metadata?.display_phone_number || ""),
    mensagens,
  };
}
