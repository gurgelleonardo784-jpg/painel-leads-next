"use client";

import { useEffect, useRef, useState } from "react";
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
import { moeda } from "@/lib/metricas";
import { Fechar, Telefone, Envelope, Whatsapp } from "../Icones";

/**
 * Detalhe do lead, em painel lateral.
 *
 * Duas situações bem diferentes convivem aqui: o lead que preencheu o
 * formulário (mostra as respostas) e o que chegou só com telefone (mostra o
 * que falta e oferece qualificar à mão). O drawer troca de conteúdo conforme
 * o caso em vez de exibir campos vazios.
 */
export default function Drawer({
  lead,
  statusList,
  onFechar,
  onStatus,
  onNota,
}: {
  lead: Lead;
  statusList: string[];
  onFechar: () => void;
  onStatus: (status: string) => void;
  onNota: (nota: string) => void;
}) {
  const [nota, setNota] = useState(lead.nota);
  const [salvo, setSalvo] = useState("");
  const painel = useRef<HTMLDivElement | null>(null);

  const tipo = tipoDoLead(lead);
  const tel = fmtTelefone(lead.telefone);
  const nome = lead.nome.trim() || tel || "Lead sem nome";
  const temNome = !!lead.nome.trim();
  const cor = corDoStatus(lead.status, statusList);
  const corTipo = COR_TIPO[tipo];

  // Esc fecha, como manda o spec
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    painel.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  function salvarNota() {
    if (nota === lead.nota) return;
    onNota(nota);
    setSalvo("Anotação salva");
  }

  const notaNome = !temNome
    ? { txt: "sem nome — apenas telefone", cor: "var(--txt3)" }
    : tipo === "whatsapp"
      ? { txt: "nome do perfil do WhatsApp", cor: "var(--sucesso-txt)" }
      : null;

  return (
    <div
      className="overlay"
      role="presentation"
      onClick={onFechar}
    >
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhe de ${nome}`}
        tabIndex={-1}
        ref={painel}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-cab">
          <div className="avatar" style={estiloAvatar(lead.id, 46)} aria-hidden="true">
            {temNome ? iniciais(lead.nome) : "#"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{nome}</h2>
            {notaNome && (
              <div className="nota-nome" style={{ color: notaNome.cor }}>
                {notaNome.txt}
              </div>
            )}
            <div className="lead-metas" style={{ marginTop: 5 }}>
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
              <span
                className="pill-etapa"
                style={{
                  color: cor,
                  background: `color-mix(in srgb, ${cor} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${cor} 24%, transparent)`,
                }}
              >
                {lead.status}
              </span>
              <span style={{ fontSize: 12, color: "var(--txt5)" }}>
                {[lead.origem, tempoRelativo(lead.data)].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
          <button className="btn-quad" onClick={onFechar} aria-label="Fechar">
            <Fechar />
          </button>
        </header>

        <div className="drawer-corpo rolagem">
          {/* contato */}
          <section className="drawer-secao" style={{ gap: 9 }}>
            {lead.telefone && (
              <a className="contato-linha" href={`tel:+55${lead.telefone.replace(/\D/g, "")}`}>
                <Telefone />
                <span className="num">{tel}</span>
              </a>
            )}
            {lead.email ? (
              <a className="contato-linha link" href={`mailto:${lead.email}`}>
                <Envelope />
                <span className="truncar">{lead.email}</span>
              </a>
            ) : (
              <div className="contato-linha vazia">
                <Envelope apagado />
                E-mail não informado
              </div>
            )}
            {lead.whatsapp && (
              <a
                className="btn btn-wa-cheio"
                href={lead.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Whatsapp size={16} />
                Chamar no WhatsApp
              </a>
            )}
          </section>

          {/* origem */}
          {(lead.campanha || lead.utm) && (
            <section className="caixa caixa-sutil">
              <span className="secao-titulo">Campanha de origem</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{lead.campanha || "—"}</span>
              {lead.utm && (
                <span className="num" style={{ fontSize: 11, color: "var(--txt6)" }}>
                  {lead.utm}
                </span>
              )}
            </section>
          )}

          {lead.valor > 0 && (
            <section className="caixa caixa-sutil">
              <span className="secao-titulo">Valor do negócio</span>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{moeda(lead.valor)}</span>
            </section>
          )}

          {/* etapa */}
          <section className="drawer-secao">
            <span className="secao-titulo">Etapa do lead</span>
            <div className="etapas-escolha">
              {statusList.map((s) => {
                const c = corDoStatus(s, statusList);
                const ativo = s === lead.status;
                return (
                  <button
                    key={s}
                    className="etapa-btn"
                    aria-pressed={ativo}
                    onClick={() => onStatus(s)}
                    style={
                      ativo
                        ? {
                            color: c,
                            background: `color-mix(in srgb, ${c} 12%, transparent)`,
                            borderColor: `color-mix(in srgb, ${c} 35%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </section>

          {/* formulário ou qualificação manual */}
          <section className="drawer-secao">
            <div className="secao-cab">
              <span className="secao-titulo">
                {tipo === "form" ? "Respostas do formulário" : "Informações do lead"}
              </span>
              <span className="secao-meta">
                {tipo === "form"
                  ? `${lead.respostas.length} pergunta${lead.respostas.length === 1 ? "" : "s"}`
                  : "sem formulário"}
              </span>
            </div>

            {tipo === "form" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lead.respostas.map((qa, i) => (
                  <div className="caixa" key={i}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span className="qa-num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="qa-p">{qa.pergunta}</span>
                    </div>
                    <span className="qa-r">{qa.resposta}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="caixa-aviso">
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--alerta)" }}>
                    Este lead não passou pelo formulário
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--txt3)",
                      lineHeight: 1.5,
                      marginTop: 6,
                    }}
                  >
                    {tipo === "whatsapp"
                      ? "Chegou direto no WhatsApp: temos o telefone e o nome do perfil, mas nenhuma pergunta respondida. Qualifique na conversa e registre nas anotações."
                      : "Chegou apenas com o telefone (clique no anúncio). Sem nome confirmado, e-mail ou respostas."}
                  </div>
                </div>

                {lead.primeiraMensagem && (
                  <div className="caixa">
                    <span className="secao-titulo" style={{ color: "var(--sucesso-txt)" }}>
                      Primeira mensagem no WhatsApp
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.5 }}>{lead.primeiraMensagem}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* anotações */}
          <section className="drawer-secao">
            <div className="secao-cab">
              <span className="secao-titulo">Anotações</span>
              <span className="secao-meta">{salvo}</span>
            </div>
            <textarea
              value={nota}
              placeholder="Escreva o que ficou combinado com este lead…"
              onChange={(e) => {
                setNota(e.target.value);
                setSalvo("");
              }}
              onBlur={salvarNota}
            />
            <button
              className="btn"
              style={{ alignSelf: "flex-start", height: 34 }}
              onClick={salvarNota}
            >
              Salvar anotação
            </button>
          </section>

          {/* histórico: só o que a planilha realmente sabe */}
          <section className="drawer-secao">
            <span className="secao-titulo">Histórico</span>
            <div className="timeline">
              <div className="timeline-item">
                <div className="timeline-trilho">
                  <span className="ponto ponto-g" style={{ background: cor }} />
                  <span className="linha" />
                </div>
                <div>
                  <div className="timeline-texto">Etapa atual: {lead.status}</div>
                  <div className="timeline-quando">
                    {lead.nota.trim() ? "com anotação registrada" : "sem anotação"}
                  </div>
                </div>
              </div>
              <div className="timeline-item">
                <div className="timeline-trilho">
                  <span className="ponto ponto-g" style={{ background: "var(--linha-hover-2)" }} />
                </div>
                <div>
                  <div className="timeline-texto">
                    Lead recebido{lead.origem ? ` via ${lead.origem}` : ""}
                  </div>
                  <div className="timeline-quando">{lead.data || "data não informada"}</div>
                </div>
              </div>
            </div>
            <p className="secao-meta" style={{ lineHeight: 1.5 }}>
              A planilha guarda o estado atual do lead, não o histórico de mudanças — por isso
              esta linha do tempo mostra só o começo e o agora.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
