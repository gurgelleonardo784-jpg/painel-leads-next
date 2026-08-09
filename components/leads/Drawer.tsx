"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, MensagemLead } from "@/lib/types";
import { tipoDoLead } from "@/lib/types";
import {
  fmtTelefone,
  iniciais,
  estiloAvatar,
  tempoRelativo,
  corDoStatus,
  rotuloAtribuicao,
  corAtribuicao,
  horaCurta,
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
  slug,
  statusList,
  onFechar,
  onStatus,
  onNota,
}: {
  lead: Lead;
  slug: string;
  statusList: string[];
  onFechar: () => void;
  onStatus: (status: string) => void;
  onNota: (nota: string) => void;
}) {
  const [nota, setNota] = useState(lead.nota);
  const [salvo, setSalvo] = useState("");
  const painel = useRef<HTMLDivElement | null>(null);

  const atrib = lead.atribuicao;
  const temConversa = !!atrib && atrib.mensagens > 0;

  /**
   * Histórico da conversa. O resultado guarda de qual telefone ele é, então
   * trocar de lead com o painel aberto já conta como "ainda carregando" sem
   * precisar limpar o estado — limpar dentro do efeito dispara render em
   * cascata, e o React reclama com razão.
   */
  const [conversa, setConversa] = useState<{
    para: string;
    mensagens: MensagemLead[];
    erro: string;
  } | null>(null);

  const carregandoConversa = temConversa && conversa?.para !== lead.telefone;

  useEffect(() => {
    if (!temConversa || !lead.telefone) return;
    let vivo = true;
    (async () => {
      const falha = (erro: string) =>
        vivo && setConversa({ para: lead.telefone, mensagens: [], erro });
      try {
        const res = await fetch(
          `/api/leads/mensagens?slug=${encodeURIComponent(slug)}&telefone=${encodeURIComponent(lead.telefone)}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => null);
        if (!vivo) return;
        if (!res.ok || !data?.ok) {
          falha("Não consegui carregar a conversa.");
          return;
        }
        setConversa({ para: lead.telefone, mensagens: data.mensagens || [], erro: "" });
      } catch {
        falha("Não consegui carregar a conversa.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [slug, lead.telefone, temConversa]);

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

          {/* origem publicitária: campanha, conjunto e anúncio (§25) */}
          {(lead.campanha || lead.conjunto || lead.anuncio || lead.utm || atrib) && (
            <section className="caixa caixa-sutil" style={{ gap: 10 }}>
              <div className="secao-cab">
                <span className="secao-titulo">Origem do lead</span>
                {atrib && (
                  <span
                    className="badge"
                    style={{
                      color: corAtribuicao(atrib.status),
                      background: `color-mix(in srgb, ${corAtribuicao(atrib.status)} 10%, transparent)`,
                      borderColor: `color-mix(in srgb, ${corAtribuicao(atrib.status)} 24%, transparent)`,
                    }}
                  >
                    {rotuloAtribuicao(atrib.status)}
                  </span>
                )}
              </div>

              <div className="atrib-grade">
                {[
                  { rotulo: "Campanha", valor: lead.campanha },
                  { rotulo: "Conjunto", valor: lead.conjunto },
                  { rotulo: "Anúncio", valor: lead.anuncio },
                ].map((linha) => (
                  <div className="atrib-linha" key={linha.rotulo}>
                    <span className="atrib-rotulo">{linha.rotulo}</span>
                    <span className={`atrib-valor${linha.valor ? "" : " vazio"}`}>
                      {linha.valor || "—"}
                    </span>
                  </div>
                ))}
              </div>

              {/* o caso que mais gera dúvida: veio de anúncio, mas qual? */}
              {atrib?.status === "pending" && (
                <p className="secao-meta" style={{ lineHeight: 1.5 }}>
                  A Meta confirmou que este contato veio de um anúncio, mas o nome da campanha
                  ainda não chegou. A sincronização tenta de novo sozinha.
                </p>
              )}
              {atrib?.status === "organic" && (
                <p className="secao-meta" style={{ lineHeight: 1.5 }}>
                  Chegou sem passar por anúncio — não há campanha a atribuir.
                </p>
              )}

              {lead.utm && (
                <span className="num" style={{ fontSize: 11, color: "var(--txt6)" }}>
                  {lead.utm}
                </span>
              )}
              {atrib?.ctwaClid && (
                <span className="num" style={{ fontSize: 10.5, color: "var(--txt6)" }}>
                  ctwa_clid {atrib.ctwaClid}
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
            {lead.somenteLeitura && (
              <div className="caixa-aviso">
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--alerta)" }}>
                  Este lead ainda não tem linha na planilha
                </div>
                <div
                  style={{ fontSize: 12.5, color: "var(--txt3)", lineHeight: 1.5, marginTop: 6 }}
                >
                  Ele foi capturado do WhatsApp e está guardado com telefone, conversa e origem —
                  mas etapa e anotação são gravadas na planilha, e a linha dele não existe lá.
                  Configure a planilha do cliente, ou rode a sincronização para criá-la.
                </div>
              </div>
            )}
            <div className="etapas-escolha" aria-disabled={lead.somenteLeitura || undefined}>
              {statusList.map((s) => {
                const c = corDoStatus(s, statusList);
                const ativo = s === lead.status;
                return (
                  <button
                    key={s}
                    className="etapa-btn"
                    aria-pressed={ativo}
                    disabled={lead.somenteLeitura}
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

                {/* com o histórico completo abaixo, repetir a 1ª mensagem aqui só
                    duplicaria; sem banco, ela é tudo o que existe */}
                {lead.primeiraMensagem && !temConversa && (
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

          {/* histórico de mensagens (§25) — o que a planilha não guarda */}
          {temConversa && (
            <section className="drawer-secao">
              <div className="secao-cab">
                <span className="secao-titulo">Conversa no WhatsApp</span>
                <span className="secao-meta">
                  {atrib!.mensagens} mensagem{atrib!.mensagens === 1 ? "" : "s"}
                  {atrib!.primeiraMensagemEm ? ` · desde ${horaCurta(atrib!.primeiraMensagemEm)}` : ""}
                </span>
              </div>

              {carregandoConversa ? (
                <p className="secao-meta">Carregando a conversa…</p>
              ) : conversa?.erro ? (
                <p className="secao-meta">{conversa.erro}</p>
              ) : !conversa?.mensagens.length ? (
                <p className="secao-meta">Nenhuma mensagem registrada.</p>
              ) : (
                <div className="conversa">
                  {conversa.mensagens.map((m, i) => (
                    <div className={`msg${m.direcao === "out" ? " msg-saida" : ""}`} key={m.id || i}>
                      <div className="msg-cab">
                        <span>{i === 0 ? "1ª mensagem" : m.direcao === "out" ? "Enviada" : "Recebida"}</span>
                        <span className="num">{horaCurta(m.em)}</span>
                      </div>
                      {m.texto ? (
                        <span className="msg-texto">{m.texto}</span>
                      ) : (
                        <span className="msg-texto vazio">
                          {m.tipo === "image"
                            ? "(imagem)"
                            : m.tipo === "audio"
                              ? "(áudio)"
                              : m.tipo === "video"
                                ? "(vídeo)"
                                : m.tipo === "document"
                                  ? "(documento)"
                                  : `(${m.tipo})`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* anotações */}
          <section className="drawer-secao">
            <div className="secao-cab">
              <span className="secao-titulo">Anotações</span>
              <span className="secao-meta">{salvo}</span>
            </div>
            <textarea
              value={nota}
              disabled={lead.somenteLeitura}
              placeholder={
                lead.somenteLeitura
                  ? "Sem linha na planilha, não há onde gravar a anotação."
                  : "Escreva o que ficou combinado com este lead…"
              }
              onChange={(e) => {
                setNota(e.target.value);
                setSalvo("");
              }}
              onBlur={salvarNota}
            />
            {!lead.somenteLeitura && (
              <button
                className="btn"
                style={{ alignSelf: "flex-start", height: 34 }}
                onClick={salvarNota}
              >
                Salvar anotação
              </button>
            )}
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
              {temConversa
                ? "Cada mudança de etapa não fica registrada — por isso esta linha do tempo mostra só o começo e o agora. A conversa acima, sim, está guardada mensagem por mensagem."
                : "A planilha guarda o estado atual do lead, não o histórico de mudanças — por isso esta linha do tempo mostra só o começo e o agora."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
