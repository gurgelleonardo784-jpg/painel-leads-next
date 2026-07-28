/** Tipos compartilhados entre servidor e cliente (sem dependências de servidor). */

export type Resposta = { pergunta: string; resposta: string };

export type Lead = {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  data: string;
  origem: string;
  campanha: string;
  status: string;
  nota: string;
  whatsapp: string;
  ordem: number;
  respostas: Resposta[];
  // identificadores técnicos usados para devolver a conversão às plataformas
  // (não aparecem no card)
  leadId: string;
  gclid: string;
  gbraid: string;
  wbraid: string;
};

export type TenantPublico = {
  slug: string;
  titulo: string;
  status: string[];
  exigeSenha: boolean;
};
