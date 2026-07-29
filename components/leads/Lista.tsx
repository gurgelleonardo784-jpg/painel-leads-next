"use client";

import type { Lead } from "@/lib/types";
import { tipoDoLead } from "@/lib/types";
import {
  fmtTelefone,
  iniciais,
  estiloAvatar,
  tempoRelativo,
  corDoStatus,
  ROTULO_TIPO,
  COR_TIPO,
} from "@/lib/apresentacao";
import { Chevron } from "../Icones";

/** Visão em lista: mais densa que o pipeline, boa para varrer muitos leads. */
export default function Lista({
  leads,
  statusList,
  onAbrir,
  onAvancar,
}: {
  leads: Lead[];
  statusList: string[];
  onAbrir: (lead: Lead) => void;
  onAvancar: (lead: Lead) => void;
}) {
  const ultimoStatus = statusList[statusList.length - 1];

  return (
    <div className="tabela-leads">
      <div className="linha-lead cabecalho" role="row">
        <span>Lead</span>
        <span className="col-tel">Telefone</span>
        <span className="col-email">E-mail</span>
        <span className="col-origem">Origem</span>
        <span>Etapa</span>
        <span>Ações</span>
      </div>

      {leads.map((l) => {
        const tipo = tipoDoLead(l);
        const tel = fmtTelefone(l.telefone);
        const nome = l.nome.trim() || tel || "Lead sem nome";
        const cor = corDoStatus(l.status, statusList);
        const corTipo = COR_TIPO[tipo];
        const tempo = tempoRelativo(l.data);

        return (
          <div
            className="linha-lead"
            key={l.id}
            role="button"
            tabIndex={0}
            onClick={() => onAbrir(l)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAbrir(l);
              }
            }}
          >
            <div className="celula-lead">
              <div className="avatar" style={estiloAvatar(l.id, 34)} aria-hidden="true">
                {l.nome.trim() ? iniciais(l.nome) : "#"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="truncar" style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {nome}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                  <span
                    className="badge"
                    style={{
                      color: corTipo,
                      background: `color-mix(in srgb, ${corTipo} 10%, transparent)`,
                      borderColor: `color-mix(in srgb, ${corTipo} 22%, transparent)`,
                    }}
                  >
                    {ROTULO_TIPO[tipo]}
                  </span>
                  {tempo && <span className="lead-tempo">{tempo}</span>}
                </div>
              </div>
            </div>

            <span className="num col-tel">{tel || "—"}</span>
            <span className="truncar col-email" style={{ fontSize: 12.5, color: "var(--link)" }}>
              {l.email || "—"}
            </span>
            <span className="col-origem" style={{ fontSize: 12, color: "var(--txt3)" }}>
              {l.origem || "—"}
            </span>
            <span>
              <span
                className="pill-etapa"
                style={{
                  color: cor,
                  background: `color-mix(in srgb, ${cor} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${cor} 24%, transparent)`,
                }}
              >
                {l.status}
              </span>
            </span>

            <span style={{ display: "flex", gap: 7 }}>
              {l.whatsapp && (
                <a
                  className="btn btn-wa btn-peq"
                  href={l.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Chamar
                </a>
              )}
              {l.status !== ultimoStatus && (
                <button
                  className="btn-quad"
                  style={{ width: 30, height: 30 }}
                  aria-label={`Avançar ${nome}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAvancar(l);
                  }}
                >
                  <Chevron size={12} />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
