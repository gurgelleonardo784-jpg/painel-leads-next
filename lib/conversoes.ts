import type { Tenant, MetaConfig, GoogleConfig } from "./tenants";
import type { Identificadores } from "./sheets";

/**
 * Envia a conversão de volta às plataformas de anúncio quando o cliente muda
 * o status do lead no painel.
 *   - Meta: Conversions API (evento CRM atribuído pelo lead_id do Lead Ad)
 *   - Google Ads: upload de click conversion pelo gclid/gbraid/wbraid
 *
 * Requer credenciais por tenant (ver tenants.example.json). Sem config, nada
 * é enviado. Nenhum erro aqui derruba o salvamento do status.
 */

const META_API = "https://graph.facebook.com/v21.0";
const GOOGLE_ADS_API = "https://googleads.googleapis.com/v18";

export type ResultadoEnvio = {
  plataforma: "Meta" | "Google";
  ok: boolean;
  detalhe: string;
};

/* ---------- Meta ---------- */

/**
 * Monta o evento conforme a origem do lead. São dois formatos diferentes na
 * mesma API:
 *   - Lead Ad (formulário): evento de CRM atribuído pelo `lead_id`.
 *   - Click-to-WhatsApp: evento de conversa atribuído pelo `ctwa_clid`, que
 *     exige `action_source: "business_messaging"` + `messaging_channel`.
 */
function montarEventoMeta(
  cfg: MetaConfig,
  ids: Identificadores,
  eventName: string,
  eventTimeSec: number
): Record<string, unknown> {
  if (ids.leadId) {
    return {
      event_name: eventName,
      event_time: eventTimeSec,
      action_source: "system_generated",
      // exigido pelo Meta para eventos de lead vindos de CRM
      custom_data: {
        event_source: "crm",
        lead_event_source: cfg.leadEventSource || "Painel Leads",
      },
      user_data: { lead_id: Number(ids.leadId) },
    };
  }

  return {
    event_name: eventName,
    event_time: eventTimeSec,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: { ctwa_clid: ids.ctwaClid },
  };
}

async function enviarMeta(
  cfg: MetaConfig,
  ids: Identificadores,
  eventName: string,
  eventTimeSec: number
): Promise<ResultadoEnvio> {
  try {
    const body: Record<string, unknown> = {
      data: [montarEventoMeta(cfg, ids, eventName, eventTimeSec)],
      access_token: cfg.accessToken,
    };
    if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;

    const res = await fetch(`${META_API}/${cfg.datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as
      | { events_received?: number; error?: { message?: string; error_user_title?: string } }
      | null;

    if (!res.ok) {
      const detalhe = j?.error?.error_user_title || j?.error?.message || `HTTP ${res.status}`;
      return { plataforma: "Meta", ok: false, detalhe };
    }
    return { plataforma: "Meta", ok: true, detalhe: `evento "${eventName}" recebido` };
  } catch (e) {
    return { plataforma: "Meta", ok: false, detalhe: e instanceof Error ? e.message : "erro" };
  }
}

/* ---------- Google Ads ---------- */

async function tokenGoogle(cfg: GoogleConfig): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = (await res.json().catch(() => null)) as { access_token?: string } | null;
  return j?.access_token || null;
}

/** Data/hora no formato do Google Ads: "aaaa-mm-dd hh:mm:ss+hh:mm". */
function dataHoraGoogle(tz: string): string {
  const agora = new Date();
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(agora)
    .forEach((x) => (p[x.type] = x.value));

  const bruto = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(agora)
    .find((x) => x.type === "timeZoneName")?.value;
  let offset = (bruto || "GMT+00:00").replace("GMT", "");
  if (!offset) offset = "+00:00";

  const hora = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hora}:${p.minute}:${p.second}${offset}`;
}

async function enviarGoogle(
  cfg: GoogleConfig,
  ids: Identificadores,
  conversionAction: string,
  tz: string
): Promise<ResultadoEnvio> {
  try {
    const token = await tokenGoogle(cfg);
    if (!token) return { plataforma: "Google", ok: false, detalhe: "falha ao obter token OAuth" };

    const conversao: Record<string, string> = {
      conversionAction,
      conversionDateTime: dataHoraGoogle(tz),
    };
    if (ids.gclid) conversao.gclid = ids.gclid;
    else if (ids.gbraid) conversao.gbraid = ids.gbraid;
    else if (ids.wbraid) conversao.wbraid = ids.wbraid;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": cfg.developerToken,
      "Content-Type": "application/json",
    };
    if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;

    const res = await fetch(`${GOOGLE_ADS_API}/customers/${cfg.customerId}:uploadClickConversions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ conversions: [conversao], partialFailure: true }),
    });
    const j = (await res.json().catch(() => null)) as
      | { partialFailureError?: { message?: string }; error?: { message?: string } }
      | null;

    if (!res.ok) {
      return { plataforma: "Google", ok: false, detalhe: j?.error?.message || `HTTP ${res.status}` };
    }
    if (j?.partialFailureError?.message) {
      return { plataforma: "Google", ok: false, detalhe: j.partialFailureError.message };
    }
    return { plataforma: "Google", ok: true, detalhe: "conversão enviada" };
  } catch (e) {
    return { plataforma: "Google", ok: false, detalhe: e instanceof Error ? e.message : "erro" };
  }
}

/* ---------- orquestrador ---------- */

export async function enviarConversoes(
  tenant: Tenant,
  ids: Identificadores,
  status: string
): Promise<ResultadoEnvio[]> {
  const cfg = tenant.conversoes;
  if (!cfg) return [];

  const tarefas: Promise<ResultadoEnvio>[] = [];
  const agoraSec = Math.floor(Date.now() / 1000);

  // só envia se o Meta estiver de fato configurado (evita "falhas" antes da hora)
  if (cfg.meta && cfg.meta.datasetId && cfg.meta.accessToken) {
    const evento = cfg.meta.eventos[status];
    // lead_id vem do Lead Ad; ctwa_clid, do anúncio Click-to-WhatsApp
    if (!ids.leadId && !ids.ctwaClid) {
      tarefas.push(
        Promise.resolve({ plataforma: "Meta", ok: false, detalhe: "lead sem lead_id/ctwa_clid" })
      );
    } else if (!evento) {
      tarefas.push(
        Promise.resolve({ plataforma: "Meta", ok: false, detalhe: `sem evento mapeado para "${status}"` })
      );
    } else {
      tarefas.push(enviarMeta(cfg.meta, ids, evento, agoraSec));
    }
  }

  if (cfg.google && cfg.google.developerToken && cfg.google.customerId) {
    const acao = cfg.google.conversoes[status];
    if (!ids.gclid && !ids.gbraid && !ids.wbraid) {
      tarefas.push(
        Promise.resolve({ plataforma: "Google", ok: false, detalhe: "lead sem gclid/gbraid/wbraid" })
      );
    } else if (!acao) {
      tarefas.push(
        Promise.resolve({ plataforma: "Google", ok: false, detalhe: `sem conversionAction para "${status}"` })
      );
    } else {
      tarefas.push(enviarGoogle(cfg.google, ids, acao, tenant.tz));
    }
  }

  return Promise.all(tarefas);
}

/** Texto curto para gravar na coluna "Conversão" da planilha. */
export function resumoConversao(resultados: ResultadoEnvio[], quando: string): string {
  if (!resultados.length) return "";
  const partes = resultados.map((r) => `${r.plataforma}: ${r.ok ? "ok" : "falha (" + r.detalhe + ")"}`);
  return `${partes.join(" · ")} — ${quando}`;
}
