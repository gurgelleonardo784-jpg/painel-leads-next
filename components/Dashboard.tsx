"use client";

import { useEffect, useMemo, useState } from "react";
import type { Lead, TenantPublico } from "@/lib/types";
import type { InsightCampanha } from "@/lib/metaAds";
import {
  calcular,
  ultimosDias,
  moeda,
  inteiro,
  compacto,
  percentual,
  diaCurto,
  type EntradaCusto,
} from "@/lib/metricas";
import { corDoCanal, corDoStatus } from "@/lib/apresentacao";

/**
 * Resultados das campanhas.
 *
 * O volume sai dos leads que o painel já tem; o investimento vem da conta de
 * anúncios (/api/metricas). Receita, ROAS e lucro dependem da coluna "Valor"
 * da planilha — sem ela, essas colunas somem em vez de mostrar zero, e a tela
 * diz o porquê.
 */

const PERIODOS = [
  { valor: 7, rotulo: "Últimos 7 dias" },
  { valor: 30, rotulo: "Últimos 30 dias" },
  { valor: 90, rotulo: "Últimos 90 dias" },
];

const COLS_ANUNCIO = "2.6fr 1fr 0.9fr 0.9fr 1fr 1fr 0.8fr";
const COLS_WHATS = "2.4fr 1fr 0.9fr 1.1fr 1.1fr 1.1fr 1.1fr";

/**
 * A divergência entre a contagem da Meta e a da planilha.
 * Não pinta de vermelho por ser negativa — divergir é normal. Só destaca o
 * que passa de 25%, que é onde vale investigar.
 */
function Diferenca({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="num">—</span>;
  const forte = Math.abs(valor) >= 25;
  const classe = !forte ? "" : valor < 0 ? "ruim" : "alerta";
  const sinal = valor > 0 ? "+" : "";
  return (
    <span className={`num ${classe}`} title={forte ? "Divergência alta — vale conferir" : undefined}>
      {sinal}
      {valor.toFixed(0)}%
    </span>
  );
}

export default function Dashboard({
  tenant,
  leads,
  statusList,
}: {
  tenant: TenantPublico;
  leads: Lead[];
  statusList: string[];
}) {
  const [dias, setDias] = useState(30);
  const [canal, setCanal] = useState("");
  const [custo, setCusto] = useState<EntradaCusto | null>(null);
  const [diaAtivo, setDiaAtivo] = useState<number | null>(null);

  useEffect(() => {
    if (!tenant.mostrarCusto) return;
    let vivo = true;
    (async () => {
      const res = await fetch(`/api/metricas?slug=${encodeURIComponent(tenant.slug)}&dias=${dias}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!vivo) return;
      const c = data?.custo as
        | { campanhas: InsightCampanha[]; anuncios?: InsightCampanha[]; moeda: string; erro?: string }
        | null
        | undefined;
      setCusto(c ?? null);
    })();
    return () => {
      vivo = false;
    };
  }, [tenant.slug, tenant.mostrarCusto, dias]);

  const m = useMemo(
    () => calcular(leads, statusList, ultimosDias(dias), custo),
    [leads, statusList, dias, custo]
  );

  const cod = m.custo?.moeda || "BRL";
  const temCusto = !!m.custo && !m.custo.erro && m.custo.investimento > 0;
  const temReceita = m.comValor > 0;

  const canais = useMemo(() => m.canais.map((c) => c.nome), [m.canais]);
  const campanhas = useMemo(
    () => (canal ? m.campanhas.filter((c) => c.canal === canal) : m.campanhas),
    [m.campanhas, canal]
  );
  const anuncios = useMemo(
    () => (canal ? m.anuncios.filter((a) => a.canal === canal) : m.anuncios),
    [m.anuncios, canal]
  );
  // anúncios de mensagem ganham tabela própria: as colunas que importam neles
  // (conversas, profundidade) não fazem sentido nos de formulário
  const anunciosWhats = useMemo(
    () => anuncios.filter((a) => a.conversas > 0).sort((x, y) => y.conversas - x.conversas),
    [anuncios]
  );

  // KPIs recalculam com o filtro de canal
  const agregado = useMemo(() => {
    const investimento = campanhas.reduce((s, c) => s + (c.investimento || 0), 0);
    const nLeads = campanhas.reduce((s, c) => s + c.leads, 0);
    const qualif = campanhas.reduce((s, c) => s + c.qualificados, 0);
    const ganhos = campanhas.reduce((s, c) => s + c.ganhos, 0);
    const receita = campanhas.reduce((s, c) => s + c.receita, 0);
    const conversas = campanhas.reduce((s, c) => s + c.conversas, 0);
    // custo por conversa só sobre o gasto das campanhas que geraram conversa
    const gastoConversas = campanhas
      .filter((c) => c.conversas > 0)
      .reduce((s, c) => s + (c.investimento || 0), 0);
    return {
      investimento,
      nLeads,
      qualif,
      ganhos,
      receita,
      conversas,
      custoConversa: conversas > 0 ? gastoConversas / conversas : null,
    };
  }, [campanhas]);

  const maxDia = Math.max(...m.serie.map((p) => p.leads), 1);
  const maxCanal = Math.max(...m.canais.map((c) => c.leads), 1);
  const maxCampanha = Math.max(...campanhas.map((c) => c.leads), 1);
  const maxOrigem = Math.max(...m.origens.map((o) => o.leads), 1);
  const pico = m.serie.reduce((a, p) => Math.max(a, p.leads), 0);

  // campanha de mensagem não gera lead na planilha; o que ela gera é conversa
  const temConversas = campanhas.some((c) => c.conversas > 0);

  // as colunas da tabela seguem o que existe: sem receita, sem coluna de receita
  const colunas = temReceita
    ? "2.4fr 1fr 0.9fr 0.8fr 1fr 0.9fr 0.8fr 1fr 0.7fr 1fr"
    : temConversas
      ? "2.4fr 1.1fr 1fr 0.9fr 1fr 1fr 1.1fr"
      : "2.6fr 1.2fr 1fr 1fr 1.1fr 0.9fr";

  return (
    <>
      <div className="dash-cab">
        <div className="titulos">
          <span className="t">Resultados das campanhas</span>
          <span className="s">
            {PERIODOS.find((p) => p.valor === dias)?.rotulo} · {inteiro(m.total)} lead
            {m.total === 1 ? "" : "s"} no período
          </span>
        </div>
        {canais.length > 1 && (
          <select value={canal} aria-label="Canal" onChange={(e) => setCanal(e.target.value)}>
            <option value="">Todos os canais</option>
            {canais.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select value={dias} aria-label="Período" onChange={(e) => setDias(+e.target.value)}>
          {PERIODOS.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </div>

      {m.custo?.erro && (
        <div className="aviso-inline aviso-atencao">
          <b>Investimento indisponível.</b> {m.custo.erro}
        </div>
      )}
      {m.semData > 0 && m.semData === m.total && (
        <div className="aviso-inline aviso-atencao">
          <b>A planilha não tem coluna de data.</b> Os totais estão certos, mas sem data não dá
          para separar por período nem montar o gráfico por dia.
        </div>
      )}

      {/* 6 KPIs */}
      <div className="kpis kpis-6">
        <Kpi
          rotulo="Investimento"
          valor={temCusto ? moeda(agregado.investimento, cod) : "—"}
          sub={temCusto ? "no período" : "sem conta de anúncios"}
        />
        <Kpi
          rotulo="Leads gerados"
          valor={compacto(agregado.nLeads)}
          sub={`${(agregado.nLeads / dias).toFixed(1).replace(".", ",")} por dia`}
          cor="var(--etapa-novo)"
        />
        <Kpi
          rotulo="Custo por lead"
          valor={temCusto && agregado.nLeads ? moeda(agregado.investimento / agregado.nLeads, cod) : "—"}
          sub="média ponderada"
          cor="var(--etapa-contato)"
        />
        {temConversas ? (
          <Kpi
            rotulo="Conversas no WhatsApp"
            valor={inteiro(agregado.conversas)}
            sub={
              agregado.custoConversa !== null
                ? `${moeda(agregado.custoConversa, cod)} por conversa`
                : "iniciadas por anúncio"
            }
            cor="var(--tipo-whats)"
          />
        ) : (
          <Kpi
            rotulo="Qualificados"
            valor={inteiro(agregado.qualif)}
            sub={agregado.nLeads ? `${percentual((agregado.qualif / agregado.nLeads) * 100)} dos leads` : "—"}
            cor="var(--etapa-qualificado)"
          />
        )}
        <Kpi
          rotulo="Receita gerada"
          valor={temReceita ? moeda(agregado.receita, cod) : "—"}
          sub={temReceita ? `${inteiro(agregado.ganhos)} negócios ganhos` : 'sem coluna "Valor"'}
          cor="var(--etapa-ganho)"
        />
        <Kpi
          rotulo="ROAS"
          valor={
            temCusto && temReceita && agregado.investimento > 0
              ? `${(agregado.receita / agregado.investimento).toFixed(1).replace(".", ",")}x`
              : "—"
          }
          sub="retorno sobre anúncio"
          cor="var(--sucesso-txt)"
        />
      </div>

      {/* leads por dia + canais */}
      <div className="grid-2">
        <div className="bloco">
          <div className="bloco-cab">
            <div>
              <div className="t">Leads por dia</div>
              <div className="s">
                {diaAtivo !== null && m.serie[diaAtivo]
                  ? `${inteiro(m.serie[diaAtivo].leads)} lead${m.serie[diaAtivo].leads === 1 ? "" : "s"} em ${diaCurto(m.serie[diaAtivo].dia)}`
                  : pico > 0
                    ? `Pico de ${inteiro(pico)} leads · últimos 3 dias em destaque`
                    : "Sem leads com data no período"}
              </div>
            </div>
            <div className="legenda">
              <span>
                <i style={{ background: "rgba(76,141,255,0.42)" }} />
                Período
              </span>
              <span>
                <i style={{ background: "var(--marca-clara)" }} />
                Recente
              </span>
            </div>
          </div>
          <div className="colunas-dia" onMouseLeave={() => setDiaAtivo(null)}>
            {m.serie.map((p, i) => (
              <div
                key={p.dia}
                onMouseEnter={() => setDiaAtivo(i)}
                title={`${p.leads} em ${diaCurto(p.dia)}`}
              >
                <div
                  className={`col${i >= m.serie.length - 3 ? " recente" : ""}`}
                  style={{ height: `${Math.max((p.leads / maxDia) * 100, 4)}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="bloco">
          <div className="bloco-cab">
            <div>
              <div className="t">Desempenho por canal</div>
              <div className="s">Volume{temCusto ? ", custo por lead e retorno" : " de leads"}</div>
            </div>
          </div>
          <div className="barras">
            {m.canais.length === 0 ? (
              <p className="secao-meta">Nenhum canal identificado.</p>
            ) : (
              m.canais.map((c) => (
                <div className="barra-item" key={c.nome}>
                  <div className="barra-cab">
                    <span className="ponto ponto-g" style={{ background: corDoCanal(c.nome) }} />
                    <span className="nome">{c.nome}</span>
                    {c.cpl !== null && <span className="num">CPL {moeda(c.cpl, cod)}</span>}
                    {c.roas !== null && (
                      <span className="num bom">{c.roas.toFixed(1).replace(".", ",")}x</span>
                    )}
                  </div>
                  <div className="barra-linha">
                    <div className="trilho fina">
                      <div
                        style={{
                          width: `${Math.max((c.leads / maxCanal) * 100, 3)}%`,
                          background: corDoCanal(c.nome),
                        }}
                      />
                    </div>
                    <span className="barra-contagem">
                      {inteiro(c.leads)} lead{c.leads === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* tabela de campanhas */}
      <div className="bloco-tabela">
        <div className="cab">
          <div>
            <div className="t" style={{ fontSize: 14.5, fontWeight: 600 }}>
              Rastreamento por campanha
            </div>
            <div className="s" style={{ fontSize: 12.5, color: "var(--txt4)", marginTop: 3 }}>
              {temReceita ? "Ordenado por lucro (receita − investimento)" : "Ordenado por volume de leads"}
            </div>
          </div>
          <span className="secao-meta">Campanha identificada pela coluna da planilha</span>
        </div>

        {campanhas.length === 0 ? (
          <p className="vazio" style={{ padding: "40px 20px" }}>
            Nenhuma campanha no período.
          </p>
        ) : (
          <div className="tabela-rolagem rolagem">
            <div style={{ minWidth: temReceita ? 1100 : 760 }}>
              <div className="linha-camp cabecalho" style={{ gridTemplateColumns: colunas }}>
                <span>Campanha</span>
                <span>Volume</span>
                <span>Investido</span>
                <span title="Leads que chegaram na planilha">Leads</span>
                {temConversas && (
                  <>
                    <span>Conversas</span>
                    <span>Custo/conversa</span>
                  </>
                )}
                <span>CPL</span>
                {!temConversas && <span>Qualif.</span>}
                {temReceita && (
                  <>
                    <span>Receita</span>
                    <span>ROAS</span>
                    <span>Lucro</span>
                  </>
                )}
              </div>

              {campanhas.map((c) => (
                <div className="linha-camp" key={c.nome} style={{ gridTemplateColumns: colunas }}>
                  <div className="camp-nome">
                    <span className="ponto" style={{ background: corDoCanal(c.canal) }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="n truncar">{c.nome}</div>
                      <div className="utm truncar">{c.canal}</div>
                    </div>
                  </div>
                  <div className="trilho tabela">
                    <div
                      style={{
                        width: `${Math.max((c.leads / maxCampanha) * 100, 3)}%`,
                        background: corDoCanal(c.canal),
                      }}
                    />
                  </div>
                  <span className="num">
                    {c.investimento === null ? "Orgânico" : moeda(c.investimento, cod)}
                  </span>
                  <span className="num forte">{inteiro(c.leads)}</span>
                  {temConversas && (
                    <>
                      <span className="num forte" style={{ color: "var(--tipo-whats)" }}>
                        {c.conversas > 0 ? inteiro(c.conversas) : "—"}
                      </span>
                      <span className="num">
                        {c.custoPorConversa === null ? "—" : moeda(c.custoPorConversa, cod)}
                      </span>
                    </>
                  )}
                  <span className="num">{c.cpl === null ? "—" : moeda(c.cpl, cod)}</span>
                  {!temConversas && (
                    <span style={{ fontSize: 12, color: "var(--etapa-qualificado)" }}>
                      {inteiro(c.qualificados)}
                      {c.leads > 0 && ` (${Math.round((c.qualificados / c.leads) * 100)}%)`}
                    </span>
                  )}
                  {temReceita && (
                    <>
                      <span className="num bom">{c.receita > 0 ? moeda(c.receita, cod) : "—"}</span>
                      <span
                        className={`num ${c.roas === null ? "" : c.roas >= 4 ? "bom" : c.roas >= 2 ? "alerta" : "ruim"}`}
                      >
                        {c.roas === null ? "—" : `${c.roas.toFixed(1).replace(".", ",")}x`}
                      </span>
                      <span className={`num fraco ${c.lucro !== null && c.lucro < 0 ? "ruim" : ""}`}>
                        {c.lucro === null
                          ? "—"
                          : `${c.lucro >= 0 ? "+" : "−"}${moeda(Math.abs(c.lucro), cod)}`}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* campanhas de mensagem: o funil que existe sem a Cloud API */}
      {anunciosWhats.length > 0 && (
        <div className="bloco-tabela">
          <div className="cab">
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>
                Campanhas de WhatsApp — por anúncio
              </div>
              <div style={{ fontSize: 12.5, color: "var(--txt4)", marginTop: 3 }}>
                Quantas conversas cada criativo abriu e quantas foram adiante
              </div>
            </div>
            <span className="secao-meta">Fonte: Meta · contato individual exige Cloud API</span>
          </div>

          <div className="tabela-rolagem rolagem">
            <div style={{ minWidth: 1020 }}>
              <div className="linha-camp cabecalho" style={{ gridTemplateColumns: COLS_WHATS }}>
                <span>Anúncio</span>
                <span>Investido</span>
                <span>Conversas</span>
                <span>Custo/conversa</span>
                <span title="Responderam a primeira mensagem">Responderam</span>
                <span title="Trocaram 3 mensagens ou mais">3+ mensagens</span>
                <span title="Investimento dividido pelas conversas que passaram de 3 mensagens">
                  Custo/engajada
                </span>
              </div>

              {anunciosWhats.map((a, i) => (
                <div
                  className="linha-camp"
                  key={a.anuncio + i}
                  style={{ gridTemplateColumns: COLS_WHATS }}
                >
                  <div className="camp-nome">
                    <span className="ponto" style={{ background: "var(--tipo-whats)" }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="n truncar" title={a.anuncio}>
                        {a.anuncio}
                      </div>
                      <div className="utm truncar">{a.campanha}</div>
                    </div>
                  </div>
                  <span className="num">{moeda(a.investimento, cod)}</span>
                  <span className="num forte" style={{ color: "var(--tipo-whats)" }}>
                    {inteiro(a.conversas)}
                  </span>
                  <span className="num">
                    {a.custoPorConversa === null ? "—" : moeda(a.custoPorConversa, cod)}
                  </span>
                  <span className="num">
                    {inteiro(a.respostas)}
                    {a.conversas > 0 && (
                      <span style={{ color: "var(--txt5)" }}>
                        {" "}
                        ({Math.round((a.respostas / a.conversas) * 100)}%)
                      </span>
                    )}
                  </span>
                  <span className="num">
                    {inteiro(a.engajadas)}
                    {a.conversas > 0 && (
                      <span style={{ color: "var(--txt5)" }}>
                        {" "}
                        ({Math.round((a.engajadas / a.conversas) * 100)}%)
                      </span>
                    )}
                  </span>
                  <span className="num forte">
                    {a.custoPorEngajada === null ? "—" : moeda(a.custoPorEngajada, cod)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="secao-meta" style={{ padding: "12px 22px 16px", lineHeight: 1.5 }}>
            <b>Custo/engajada</b> é o número que mais se aproxima de custo por lead nessas
            campanhas: quem trocou 3 mensagens ou mais não foi curioso de passagem. O telefone
            dessas pessoas só chega ao painel com o número na WhatsApp Cloud API.
          </p>
        </div>
      )}

      {/* rastreamento por anúncio: Meta x planilha */}
      {anuncios.length > 0 && (
        <div className="bloco-tabela">
          <div className="cab">
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Rastreamento por anúncio</div>
              <div style={{ fontSize: 12.5, color: "var(--txt4)", marginTop: 3 }}>
                O que a Meta reporta contra o que realmente chegou na planilha
              </div>
            </div>
            <span className="secao-meta">
              {m.comAnuncio} de {m.total} leads têm anúncio de origem
            </span>
          </div>

          {m.comAnuncio === 0 && (
            <div style={{ padding: "0 22px 14px" }}>
              <p className="aviso-inline aviso-atencao">
                <b>A planilha não tem coluna de anúncio.</b> Sem ela dá para ver o que a Meta
                reporta, mas não dá para conferir contra o que chegou. Acrescente uma coluna{" "}
                <b>Anúncio</b> (e <b>Conjunto</b>) na planilha — a integração nativa do Meta já
                preenche as duas.
              </p>
            </div>
          )}

          <div className="tabela-rolagem rolagem">
            <div style={{ minWidth: 980 }}>
              <div className="linha-camp cabecalho" style={{ gridTemplateColumns: COLS_ANUNCIO }}>
                <span>Anúncio</span>
                <span>Investido</span>
                <span>Meta diz</span>
                <span>Chegou</span>
                <span>Diferença</span>
                <span>CPL real</span>
                <span>Qualif.</span>
              </div>

              {anuncios.slice(0, 25).map((a, i) => (
                <div
                  className="linha-camp"
                  key={a.anuncio + i}
                  style={{ gridTemplateColumns: COLS_ANUNCIO }}
                >
                  <div className="camp-nome">
                    <span className="ponto" style={{ background: corDoCanal(a.canal) }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="n truncar" title={a.anuncio}>
                        {a.anuncio}
                      </div>
                      <div className="utm truncar" title={`${a.campanha} · ${a.conjunto}`}>
                        {[a.campanha, a.conjunto].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </div>
                  <span className="num">
                    {a.investimento > 0 ? moeda(a.investimento, cod) : "—"}
                  </span>
                  <span className="num">{a.leadsMeta > 0 ? inteiro(a.leadsMeta) : "—"}</span>
                  <span className="num forte">{inteiro(a.leadsPlanilha)}</span>
                  <Diferenca valor={a.divergencia} />
                  <span className="num">{a.cpl === null ? "—" : moeda(a.cpl, cod)}</span>
                  <span style={{ fontSize: 12, color: "var(--etapa-qualificado)" }}>
                    {inteiro(a.qualificados)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* funil + origens */}
      <div className="grid-funil">
        <div className="bloco">
          <div className="bloco-cab">
            <div>
              <div className="t">Funil de conversão</div>
              <div className="s">Distribuição atual do pipeline</div>
            </div>
          </div>
          <div className="barras">
            {m.funil.map((e) => {
              const cor = corDoStatus(e.status, statusList);
              return (
                <div className="barra-item" key={e.status}>
                  <div className="barra-cab">
                    <span className="nome">{e.status}</span>
                    <span className="num">
                      {inteiro(e.leads)} · {percentual(e.percentual)}
                    </span>
                  </div>
                  <div className="trilho">
                    <div
                      style={{
                        width: `${Math.max(e.percentual, e.leads > 0 ? 2 : 0)}%`,
                        background: cor,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bloco">
          <div className="bloco-cab">
            <div>
              <div className="t">Origem dos leads</div>
              <div className="s">{PERIODOS.find((p) => p.valor === dias)?.rotulo}</div>
            </div>
          </div>
          <div className="barras">
            {m.origens.length === 0 ? (
              <p className="secao-meta">Nenhuma origem informada.</p>
            ) : (
              m.origens.slice(0, 8).map((o) => (
                <div className="origem-item" key={o.nome}>
                  <span className="n" title={o.nome}>
                    {o.nome}
                  </span>
                  <div className="trilho">
                    <div
                      style={{
                        width: `${Math.max((o.leads / maxOrigem) * 100, 3)}%`,
                        background: "var(--marca)",
                      }}
                    />
                  </div>
                  <span className="c">{inteiro(o.leads)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3 resumos */}
      <div className="grid-3">
        <div className="resumo-card">
          <span className="r">Ticket médio dos ganhos</span>
          <span className="v">{temReceita ? moeda(m.ticketMedio, cod) : "—"}</span>
          <span className="h">
            {temReceita
              ? "Considera apenas negócios marcados como ganhos."
              : 'Preencha a coluna "Valor" na planilha para este número existir.'}
          </span>
        </div>
        <div className="resumo-card">
          <span className="r">Leads aguardando contato</span>
          <span className="v">{inteiro(m.aguardandoContato)}</span>
          <span className="h">Priorize estes antes de abrir novas campanhas.</span>
        </div>
        <div className="resumo-card">
          <span className="r">Conversão de ganho</span>
          <span className="v">{percentual(m.taxaGanho, 1)}</span>
          <span className="h">Do total de leads recebidos no período.</span>
        </div>
      </div>
    </>
  );
}

function Kpi({
  rotulo,
  valor,
  sub,
  cor,
}: {
  rotulo: string;
  valor: string;
  sub?: string;
  cor?: string;
}) {
  return (
    <div className="kpi kpi-compacto">
      <span className="rotulo">{rotulo}</span>
      <span className="valor" style={cor ? { color: cor } : undefined}>
        {valor}
      </span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
