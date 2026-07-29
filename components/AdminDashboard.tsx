"use client";

import { useEffect, useState } from "react";
import type { Metricas } from "@/lib/metricas";
import { moeda, inteiro, compacto, percentual } from "@/lib/metricas";
import { corAvatar } from "@/lib/apresentacao";

/**
 * Visão consolidada da agência: todos os clientes lado a lado.
 *
 * Aqui o servidor faz a conta (precisa ler a planilha de cada cliente), então
 * isto é só apresentação. Um cliente que falhe vira uma linha de aviso em vez
 * de derrubar a tela.
 */

type LinhaCliente = {
  slug: string;
  nome: string;
  erro?: string;
  metricas?: Metricas;
};

const PERIODOS = [
  { valor: 7, rotulo: "Últimos 7 dias" },
  { valor: 30, rotulo: "Últimos 30 dias" },
  { valor: 90, rotulo: "Últimos 90 dias" },
];

export default function AdminDashboard() {
  const [dias, setDias] = useState(30);
  const [clientes, setClientes] = useState<LinhaCliente[] | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await fetch(`/api/admin/metricas?dias=${dias}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!vivo) return;
      setClientes(data?.ok ? data.clientes : []);
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [dias]);

  /** O aviso de carregando sai do evento, não de dentro do efeito. */
  function trocarPeriodo(novo: number) {
    setCarregando(true);
    setDias(novo);
  }

  const linhas = (clientes || []).filter((c) => c.metricas);
  const soma = (f: (m: Metricas) => number) => linhas.reduce((s, c) => s + f(c.metricas!), 0);

  const totalLeads = soma((m) => m.total);
  const totalQualif = soma((m) => m.qualificados);
  const totalGanhos = soma((m) => m.ganhos);
  const totalInvestido = soma((m) => m.custo?.investimento || 0);
  const totalReceita = soma((m) => m.receita);

  const temCusto = totalInvestido > 0;
  const temReceita = soma((m) => m.comValor) > 0;
  const cod = linhas.find((c) => c.metricas?.custo?.moeda)?.metricas?.custo?.moeda || "BRL";
  const maxLeads = Math.max(...linhas.map((c) => c.metricas!.total), 1);

  const colunas = temReceita
    ? "2fr 1fr 0.9fr 0.9fr 0.9fr 1.1fr 0.9fr 1fr"
    : "2fr 1.2fr 1fr 1fr 1fr 1.1fr";

  return (
    <>
      <div className="dash-cab">
        <div className="titulos">
          <span className="t">Visão consolidada</span>
          <span className="s">
            {linhas.length} cliente{linhas.length === 1 ? "" : "s"} com dados
            {carregando ? " · atualizando…" : ""}
          </span>
        </div>
        <select value={dias} aria-label="Período" onChange={(e) => trocarPeriodo(+e.target.value)}>
          {PERIODOS.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </div>

      {carregando && !clientes ? (
        <div className="kpis">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="esqueleto" style={{ height: 96 }} />
          ))}
        </div>
      ) : linhas.length === 0 ? (
        <div className="vazio">
          <b>Nada para mostrar ainda</b>
          Cadastre um cliente com planilha para ver as métricas aqui.
        </div>
      ) : (
        <>
          <div className="kpis">
            <Kpi rotulo="Leads no período" valor={compacto(totalLeads)} />
            <Kpi
              rotulo="Qualificados"
              valor={inteiro(totalQualif)}
              sub={totalLeads ? `${percentual((totalQualif / totalLeads) * 100)} do total` : undefined}
              cor="var(--etapa-qualificado)"
            />
            <Kpi rotulo="Ganhos" valor={inteiro(totalGanhos)} cor="var(--etapa-ganho)" />
            <Kpi
              rotulo="Investimento"
              valor={temCusto ? moeda(totalInvestido, cod) : "—"}
              sub={temCusto ? undefined : "sem conta de anúncios"}
            />
            <Kpi
              rotulo="Custo por lead"
              valor={temCusto && totalLeads ? moeda(totalInvestido / totalLeads, cod) : "—"}
              sub="média de todos os clientes"
              cor="var(--etapa-contato)"
            />
          </div>

          <div className="bloco">
            <div className="bloco-cab">
              <div>
                <div className="t">Leads por cliente</div>
                <div className="s">No período selecionado</div>
              </div>
            </div>
            <div className="barras">
              {linhas
                .slice()
                .sort((a, b) => b.metricas!.total - a.metricas!.total)
                .map((c) => (
                  <div className="barra-item" key={c.slug}>
                    <div className="barra-cab">
                      <span className="ponto ponto-g" style={{ background: corAvatar(c.slug) }} />
                      <span className="nome">{c.nome}</span>
                      {c.metricas!.custo?.cpl != null && (
                        <span className="num">CPL {moeda(c.metricas!.custo.cpl, cod)}</span>
                      )}
                    </div>
                    <div className="barra-linha">
                      <div className="trilho fina">
                        <div
                          style={{
                            width: `${Math.max((c.metricas!.total / maxLeads) * 100, 3)}%`,
                            background: corAvatar(c.slug),
                          }}
                        />
                      </div>
                      <span className="barra-contagem">{inteiro(c.metricas!.total)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="bloco-tabela">
            <div className="cab">
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Comparativo</div>
                <div style={{ fontSize: 12.5, color: "var(--txt4)", marginTop: 3 }}>
                  Os mesmos números em tabela
                </div>
              </div>
            </div>
            <div className="tabela-rolagem rolagem">
              <div style={{ minWidth: temReceita ? 900 : 700 }}>
                <div className="linha-camp cabecalho" style={{ gridTemplateColumns: colunas }}>
                  <span>Cliente</span>
                  <span>Leads</span>
                  <span>Variação</span>
                  <span>Qualif.</span>
                  <span>Ganhos</span>
                  <span>Investimento</span>
                  <span>CPL</span>
                  {temReceita && <span>Receita</span>}
                </div>
                {linhas.map((c) => {
                  const m = c.metricas!;
                  const temCustoLinha = m.custo && !m.custo.erro;
                  return (
                    <div className="linha-camp" key={c.slug} style={{ gridTemplateColumns: colunas }}>
                      <div className="camp-nome">
                        <span className="ponto" style={{ background: corAvatar(c.slug) }} />
                        <a className="n truncar link" href={`/${c.slug}`} target="_blank" rel="noreferrer">
                          {c.nome}
                        </a>
                      </div>
                      <span className="num forte">{inteiro(m.total)}</span>
                      <span
                        className={`num ${m.variacaoTotal === null ? "" : m.variacaoTotal >= 0 ? "bom" : "ruim"}`}
                      >
                        {m.variacaoTotal === null ? "—" : percentual(m.variacaoTotal)}
                      </span>
                      <span className="num">{inteiro(m.qualificados)}</span>
                      <span className="num">{inteiro(m.ganhos)}</span>
                      <span className="num">
                        {temCustoLinha ? moeda(m.custo!.investimento, cod) : "—"}
                      </span>
                      <span className="num">{temCustoLinha ? moeda(m.custo!.cpl, cod) : "—"}</span>
                      {temReceita && (
                        <span className="num bom">{m.receita > 0 ? moeda(m.receita, cod) : "—"}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {temReceita && (
            <div className="grid-3">
              <div className="resumo-card">
                <span className="r">Receita total</span>
                <span className="v">{moeda(totalReceita, cod)}</span>
                <span className="h">Soma do valor dos negócios ganhos em todos os clientes.</span>
              </div>
              <div className="resumo-card">
                <span className="r">ROAS da carteira</span>
                <span className="v">
                  {temCusto ? `${(totalReceita / totalInvestido).toFixed(1).replace(".", ",")}x` : "—"}
                </span>
                <span className="h">Receita dividida pelo investimento em mídia.</span>
              </div>
              <div className="resumo-card">
                <span className="r">Lucro</span>
                <span className="v">{moeda(totalReceita - totalInvestido, cod)}</span>
                <span className="h">Receita menos investimento, no período.</span>
              </div>
            </div>
          )}
        </>
      )}

      {(clientes || [])
        .filter((c) => c.erro)
        .map((c) => (
          <div className="aviso-inline aviso-atencao" key={c.slug}>
            <b>{c.nome}:</b> {c.erro}
          </div>
        ))}
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
