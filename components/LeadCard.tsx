"use client";

import { useState } from "react";
import type { Lead } from "@/lib/types";
import { classeStatus } from "@/lib/format";
import type { SalvarCampos } from "./Painel";

type Estado = "idle" | "salvando" | "erro";

export default function LeadCard({
  lead,
  status,
  onSalvar,
}: {
  lead: Lead;
  status: string[];
  onSalvar: (id: string, campos: SalvarCampos) => Promise<boolean>;
}) {
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState(lead.nota);
  const [estStatus, setEstStatus] = useState<Estado>("idle");
  const [estNota, setEstNota] = useState<Estado>("idle");

  const meta = [lead.data, lead.origem, lead.campanha].filter(Boolean);
  const primeiras = lead.respostas.slice(0, 4);
  const extras = lead.respostas.slice(4);

  async function salvarStatus(valor: string) {
    setEstStatus("salvando");
    const ok = await onSalvar(lead.id, { status: valor });
    setEstStatus(ok ? "idle" : "erro");
  }

  async function salvarNota() {
    if (nota === lead.nota) return;
    setEstNota("salvando");
    const ok = await onSalvar(lead.id, { nota });
    setEstNota(ok ? "idle" : "erro");
  }

  const borda = (e: Estado) =>
    e === "salvando" ? "#f59e0b" : e === "erro" ? "#b91c1c" : undefined;

  return (
    <article className="card">
      <div className="cab">
        <div className="cab-info">
          <h3>{lead.nome || "Lead sem nome"}</h3>
          {meta.length > 0 && (
            <div className="meta">
              {meta.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </div>
          )}
        </div>
        <span className={`chip ${classeStatus(lead.status)}`}>{lead.status}</span>
      </div>

      {(lead.telefone || lead.email) && (
        <div className="contato">
          {lead.telefone && <div>{lead.telefone}</div>}
          {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
        </div>
      )}

      {primeiras.length > 0 && (
        <div className="respostas">
          {primeiras.map((r, i) => (
            <div className="qa" key={i}>
              <div className="p">{r.pergunta}</div>
              <div className="r">{r.resposta}</div>
            </div>
          ))}
          {extras.length > 0 && aberto &&
            extras.map((r, i) => (
              <div className="qa" key={`e${i}`}>
                <div className="p">{r.pergunta}</div>
                <div className="r">{r.resposta}</div>
              </div>
            ))}
          {extras.length > 0 && (
            <button className="ver-mais" onClick={() => setAberto((v) => !v)}>
              {aberto ? "Ver menos" : `Ver mais ${extras.length} resposta(s)`}
            </button>
          )}
        </div>
      )}

      <div className="acoes">
        {lead.whatsapp ? (
          <a className="btn btn-wa" href={lead.whatsapp} target="_blank" rel="noopener noreferrer">
            Chamar no WhatsApp
          </a>
        ) : (
          <button className="btn btn-wa" disabled>
            Sem telefone válido
          </button>
        )}

        <div className="linha2">
          <select
            value={lead.status}
            style={{ borderColor: borda(estStatus) }}
            onChange={(e) => salvarStatus(e.target.value)}
          >
            {status.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <textarea
          placeholder="Anotações sobre este lead"
          value={nota}
          style={{ borderColor: borda(estNota) }}
          onChange={(e) => setNota(e.target.value)}
          onBlur={salvarNota}
        />
      </div>
    </article>
  );
}
