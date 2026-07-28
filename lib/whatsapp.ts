/**
 * WhatsApp Cloud API — captura de leads.
 *
 * Quando alguém clica num anúncio "enviar mensagem" (Click-to-WhatsApp) e manda
 * a 1ª mensagem, o WhatsApp anexa um bloco `referral` com o anúncio/campanha de
 * origem e um `ctwa_clid` (id do clique). Aqui traduzimos o payload do webhook
 * em colunas prontas para gravar na planilha do cliente. Mensagens sem referral
 * são leads orgânicos (marcados como "WhatsApp").
 */

type Referral = {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
};

type Mensagem = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  referral?: Referral;
};

type Contato = { wa_id?: string; profile?: { name?: string } };

export type ValorWhatsApp = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Contato[];
  messages?: Mensagem[];
};

export type LeadWhatsApp = {
  telefone: string;
  dados: Record<string, string>;
};

/** Extrai um lead por mensagem recebida no "value" de um webhook do WhatsApp. */
export function extrairLeadsWhatsApp(valor: ValorWhatsApp): LeadWhatsApp[] {
  const nomePorWa: Record<string, string> = {};
  for (const c of valor.contacts || []) {
    if (c.wa_id) nomePorWa[c.wa_id] = c.profile?.name || "";
  }

  const leads: LeadWhatsApp[] = [];
  for (const m of valor.messages || []) {
    const telefone = String(m.from || "");
    if (!telefone) continue;

    const ref = m.referral;
    const daCampanha = !!(ref && (ref.ctwa_clid || ref.source_id || ref.headline));

    const dados: Record<string, string> = {
      Nome: nomePorWa[telefone] || "",
      Telefone: telefone,
      Origem: daCampanha ? "WhatsApp (anúncio)" : "WhatsApp",
    };
    if (ref?.headline) dados["Campanha"] = ref.headline;
    else if (ref?.source_id) dados["Campanha"] = ref.source_id;
    if (ref?.ctwa_clid) dados["ctwa_clid"] = ref.ctwa_clid;

    const texto = m.text?.body?.trim();
    if (texto) dados["Primeira mensagem"] = texto;

    leads.push({ telefone, dados });
  }
  return leads;
}