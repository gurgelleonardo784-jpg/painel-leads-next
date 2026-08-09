"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lead, TenantPublico, TipoLead } from "@/lib/types";
import { tipoDoLead } from "@/lib/types";
import { parseData } from "@/lib/format";
import { textoBusca, tempoRelativo, iniciais } from "@/lib/apresentacao";
import { moeda, inteiro, percentual, ehGanho, ehQualificado, ehPerdido } from "@/lib/metricas";
import Kanban from "./leads/Kanban";
import Lista from "./leads/Lista";
import Drawer from "./leads/Drawer";
import NovoLead from "./leads/NovoLead";
import Dashboard from "./Dashboard";
import TemaBotao from "./TemaBotao";
import { Atualizar, Mais, Lupa, Baixar } from "./Icones";

export type SalvarCampos = { status?: string; nota?: string };

type Tela = "carregando" | "login" | "app";
type Modulo = "leads" | "dashboard";
type Visao = "pipeline" | "lista";

const FILTROS_TIPO: { valor: string; rotulo: string }[] = [
  { valor: "", rotulo: "Todos os tipos" },
  { valor: "form", rotulo: "Com formulário" },
  { valor: "whatsapp", rotulo: "Perfil WhatsApp" },
  { valor: "contato", rotulo: "Só contato" },
];

export default function Painel({ tenant }: { tenant: TenantPublico }) {
  const [tela, setTela] = useState<Tela>("carregando");
  const [modulo, setModulo] = useState<Modulo>("leads");
  const [visao, setVisao] = useState<Visao>("pipeline");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [statusList, setStatusList] = useState<string[]>(tenant.status);
  const [sincronizado, setSincronizado] = useState("");

  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState("");

  const [busca, setBusca] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fPeriodo, setFPeriodo] = useState("");
  const [fTipo, setFTipo] = useState("");
  // filtros de atribuição e etapa do §25
  const [fCampanha, setFCampanha] = useState("");
  const [fConjunto, setFConjunto] = useState("");
  const [fAnuncio, setFAnuncio] = useState("");
  const [fStatus, setFStatus] = useState("");

  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2200);
  }, []);

  const buscarLeads = useCallback(async (): Promise<"ok" | "login" | "erro"> => {
    const res = await fetch(`/api/leads?slug=${encodeURIComponent(tenant.slug)}`, {
      cache: "no-store",
    });
    if (res.status === 401) return "login";
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return "erro";
    setLeads(data.leads || []);
    if (Array.isArray(data.status) && data.status.length) setStatusList(data.status);
    setSincronizado(data.atualizadoEm || "");
    return "ok";
  }, [tenant.slug]);

  /** Vazio em caso de sucesso, ou a mensagem de erro para a tela. */
  const entrar = useCallback(
    async (valor: string): Promise<string> => {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: tenant.slug, senha: valor }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          const data = await res.json().catch(() => null);
          return data?.erro || "Muitas tentativas. Tente de novo mais tarde.";
        }
        return "Senha incorreta.";
      }
      const r = await buscarLeads();
      if (r !== "ok") return "Não consegui carregar os leads. Tente de novo.";
      setTela("app");
      return "";
    },
    [tenant.slug, buscarLeads]
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await buscarLeads();
      if (!vivo) return;
      if (r === "ok") setTela("app");
      else if (!tenant.exigeSenha) setTela((await entrar("")) ? "login" : "app");
      else setTela("login");
    })();
    return () => {
      vivo = false;
    };
  }, [buscarLeads, entrar, tenant.exigeSenha]);

  // recarrega sozinho enquanto a aba está visível
  useEffect(() => {
    if (tela !== "app") return;
    const id = setInterval(() => {
      if (!document.hidden) void buscarLeads();
    }, 120000);
    return () => clearInterval(id);
  }, [tela, buscarLeads]);

  async function onLogin() {
    setErroLogin("verificando...");
    setErroLogin(await entrar(senha));
  }

  async function atualizar() {
    toast("Atualizando...");
    const r = await buscarLeads();
    toast(r === "ok" ? "Atualizado" : "Sessão expirada. Recarregue a página.");
  }

  const salvar = useCallback(
    async (id: string, campos: SalvarCampos): Promise<boolean> => {
      // lead que só existe no banco: não há linha na planilha onde gravar.
      // Melhor dizer isso do que deixar a mudança aparecer na tela e sumir na
      // próxima atualização.
      if (id.startsWith("db:")) {
        toast("Este lead ainda não tem linha na planilha — a etapa não pode ser salva.");
        return false;
      }

      setLeads((atual) =>
        atual.map((l) =>
          l.id === id
            ? {
                ...l,
                ...(typeof campos.status !== "undefined" ? { status: campos.status } : {}),
                ...(typeof campos.nota !== "undefined" ? { nota: campos.nota } : {}),
              }
            : l
        )
      );
      const res = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: tenant.slug, ...campos }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast("Não consegui salvar: " + (data?.erro || "erro"));
        return false;
      }
      toast("Salvo");
      return true;
    },
    [tenant.slug, toast]
  );

  const avancar = useCallback(
    (lead: Lead) => {
      const i = statusList.indexOf(lead.status);
      const proximo = statusList[Math.min(i + 1, statusList.length - 1)];
      if (!proximo || proximo === lead.status) return;
      void salvar(lead.id, { status: proximo });
    },
    [statusList, salvar]
  );

  const origens = useMemo(() => {
    const set: string[] = [];
    leads.forEach((l) => {
      if (l.origem && set.indexOf(l.origem) === -1) set.push(l.origem);
    });
    return set;
  }, [leads]);

  /** Valores distintos de um campo, para montar as listas de filtro. */
  const distintos = useCallback(
    (pega: (l: Lead) => string) => {
      const set = new Set<string>();
      leads.forEach((l) => {
        const v = pega(l).trim();
        if (v) set.add(v);
      });
      return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
    [leads]
  );

  const campanhas = useMemo(() => distintos((l) => l.campanha), [distintos]);
  // conjunto e anúncio acompanham a campanha escolhida: oferecer o conjunto de
  // outra campanha na lista só produz filtro que devolve zero
  const conjuntos = useMemo(
    () =>
      distintos((l) => (!fCampanha || l.campanha === fCampanha ? l.conjunto : "")),
    [distintos, fCampanha]
  );
  const anuncios = useMemo(
    () =>
      distintos((l) =>
        (!fCampanha || l.campanha === fCampanha) && (!fConjunto || l.conjunto === fConjunto)
          ? l.anuncio
          : ""
      ),
    [distintos, fCampanha, fConjunto]
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const dias = parseInt(fPeriodo, 10);
    return leads.filter((l) => {
      if (fOrigem && l.origem !== fOrigem) return false;
      if (fTipo && tipoDoLead(l) !== (fTipo as TipoLead)) return false;
      if (fCampanha && l.campanha !== fCampanha) return false;
      if (fConjunto && l.conjunto !== fConjunto) return false;
      if (fAnuncio && l.anuncio !== fAnuncio) return false;
      if (fStatus && l.status !== fStatus) return false;
      if (dias) {
        const d = parseData(l.data);
        if (!d) return false;
        const limite = new Date();
        limite.setHours(0, 0, 0, 0);
        limite.setDate(limite.getDate() - (dias - 1));
        if (d < limite) return false;
      }
      if (q && !textoBusca(l).includes(q)) return false;
      return true;
    });
  }, [leads, busca, fPeriodo, fOrigem, fTipo, fCampanha, fConjunto, fAnuncio, fStatus]);

  const filtroAtivo = !!(
    busca || fOrigem || fPeriodo || fTipo || fCampanha || fConjunto || fAnuncio || fStatus
  );

  const limparFiltros = useCallback(() => {
    setBusca("");
    setFOrigem("");
    setFPeriodo("");
    setFTipo("");
    setFCampanha("");
    setFConjunto("");
    setFAnuncio("");
    setFStatus("");
  }, []);


  // KPIs sobre a base inteira, como manda o spec (os filtros mexem só na lista)
  const kpis = useMemo(() => {
    const total = leads.length || 0;
    const ativos = leads.filter((l) => !ehGanho(l.status) && !ehPerdido(l.status)).length;
    const qualif = leads.filter((l) => ehQualificado(l.status) || ehGanho(l.status)).length;
    const ganhos = leads.filter((l) => ehGanho(l.status));
    const comForm = leads.filter((l) => tipoDoLead(l) === "form").length;
    const receita = ganhos.reduce((s, l) => s + l.valor, 0);

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const novosHoje = leads.filter((l) => {
      const d = parseData(l.data);
      return d ? d >= hoje : false;
    }).length;

    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

    return [
      {
        rotulo: "Leads ativos",
        valor: inteiro(ativos),
        delta: novosHoje > 0 ? `+${novosHoje} hoje` : "",
        pct: pct(ativos),
        cor: "var(--etapa-novo)",
      },
      {
        rotulo: "Taxa de qualificação",
        valor: percentual(total ? (qualif / total) * 100 : 0),
        delta: `${inteiro(qualif)} leads`,
        pct: pct(qualif),
        cor: "var(--etapa-qualificado)",
        neutro: true,
      },
      {
        rotulo: "Negócios ganhos",
        valor: inteiro(ganhos.length),
        delta: receita > 0 ? moeda(receita) : "",
        pct: pct(ganhos.length),
        cor: "var(--etapa-ganho)",
      },
      {
        rotulo: "Leads",
        valor: inteiro(total),
        delta: "total recebido",
        pct: 100,
        cor: "var(--txt)",
        neutro: true,
      },
      {
        rotulo: "Leads de formulário",
        valor: inteiro(comForm),
        delta: `${pct(comForm)}% do total`,
        pct: pct(comForm),
        cor: "var(--etapa-novo)",
        neutro: true,
      },
    ];
  }, [leads]);

  const leadAberto = selecionado ? leads.find((l) => l.id === selecionado) || null : null;

  if (tela === "carregando") return null;

  if (tela === "login") {
    return (
      <div className="login">
        <h2>{tenant.titulo}</h2>
        <p>Digite a senha de acesso</p>
        <input
          type="password"
          value={senha}
          placeholder="senha"
          autoComplete="current-password"
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onLogin();
          }}
        />
        <button className="btn" onClick={() => void onLogin()}>
          Entrar
        </button>
        <div className="erro">{erroLogin}</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div className="topo">
          <div className="topo-linha">
            <div className="marca-bloco">
              <div className="logo" aria-hidden="true">
                {iniciais(tenant.titulo) || "PL"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="titulo-linha">
                  <h1>Painel de Leads</h1>
                  <span className="chip-cliente">{tenant.titulo}</span>
                </div>
                <div className="sync">
                  <span className="ponto" />
                  <span>
                    {sincronizado ? `Sincronizado ${tempoRelativo(sincronizado)}` : "Sincronizado"} ·{" "}
                    {inteiro(leads.length)} lead{leads.length === 1 ? "" : "s"} no total
                  </span>
                </div>
              </div>
            </div>

            <div className="topo-acoes">
              <button className="btn" onClick={() => void atualizar()}>
                <Atualizar />
                <span className="rotulo-btn">Atualizar</span>
              </button>
              {/* §28. Baixa a lista inteira, não a filtrada — o rótulo diz isso
                  quando há filtro ativo, para ninguém abrir o arquivo e achar
                  que veio lead demais. */}
              <a
                className="btn"
                href={`/api/leads/export?slug=${encodeURIComponent(tenant.slug)}`}
                title="Baixa a lista completa de leads em CSV"
              >
                <Baixar />
                <span className="rotulo-btn">
                  {filtroAtivo ? "Exportar tudo" : "Exportar CSV"}
                </span>
              </a>
              <button className="btn btn-primario" onClick={() => setCriando(true)}>
                <Mais />
                <span className="rotulo-btn">Novo lead</span>
              </button>
              <span className="divisor" />
              <TemaBotao />
            </div>
          </div>

          <div className="abas" role="tablist" aria-label="Módulos">
            <button
              className="aba"
              role="tab"
              aria-selected={modulo === "leads"}
              onClick={() => setModulo("leads")}
            >
              Leads
            </button>
            <button
              className="aba"
              role="tab"
              aria-selected={modulo === "dashboard"}
              onClick={() => setModulo("dashboard")}
            >
              Dashboard
            </button>
          </div>
        </div>
      </header>

      {modulo === "dashboard" ? (
        <div className="conteudo">
          <Dashboard
            tenant={tenant}
            leads={leads}
            statusList={statusList}
            onVerAnuncio={(anuncio) => {
              // §27: sai do dashboard já na lista daquele anúncio. Limpa os
              // outros filtros para não somar restrições e devolver zero.
              limparFiltros();
              setFAnuncio(anuncio);
              setVisao("lista");
              setModulo("leads");
            }}
          />
        </div>
      ) : (
        <div className="conteudo">
          <div className="kpis">
            {kpis.map((k) => (
              <div className="kpi" key={k.rotulo}>
                <span className="rotulo">{k.rotulo}</span>
                <div className="valor-linha">
                  <span className="valor">{k.valor}</span>
                  {k.delta && (
                    <span className={`delta${k.neutro ? " neutro" : ""}`}>{k.delta}</span>
                  )}
                </div>
                <div className="barra">
                  <div style={{ width: `${k.pct}%`, background: k.cor }} />
                </div>
              </div>
            ))}
          </div>

          <div className="filtros">
            <div className="busca-wrap">
              <Lupa />
              <input
                className="busca"
                placeholder="Buscar por nome, telefone, e-mail ou resposta"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <select
              value={fOrigem}
              aria-label="Origem"
              onChange={(e) => setFOrigem(e.target.value)}
            >
              <option value="">Todas as origens</option>
              {origens.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              value={fPeriodo}
              aria-label="Período"
              onChange={(e) => setFPeriodo(e.target.value)}
            >
              <option value="">Qualquer data</option>
              <option value="1">Hoje</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
            </select>
            <select value={fTipo} aria-label="Tipo de lead" onChange={(e) => setFTipo(e.target.value)}>
              {FILTROS_TIPO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
            <select value={fStatus} aria-label="Etapa" onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Todas as etapas</option>
              {statusList.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* atribuição: só aparece se houver o que filtrar (§25) */}
            {campanhas.length > 0 && (
              <select
                value={fCampanha}
                aria-label="Campanha"
                onChange={(e) => {
                  setFCampanha(e.target.value);
                  // conjunto e anúncio da campanha anterior não valem mais
                  setFConjunto("");
                  setFAnuncio("");
                }}
              >
                <option value="">Todas as campanhas</option>
                {campanhas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {conjuntos.length > 0 && (
              <select
                value={fConjunto}
                aria-label="Conjunto"
                onChange={(e) => {
                  setFConjunto(e.target.value);
                  setFAnuncio("");
                }}
              >
                <option value="">Todos os conjuntos</option>
                {conjuntos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {anuncios.length > 0 && (
              <select
                value={fAnuncio}
                aria-label="Anúncio"
                onChange={(e) => setFAnuncio(e.target.value)}
              >
                <option value="">Todos os anúncios</option>
                {anuncios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            )}

            {filtroAtivo && (
              <button className="btn" onClick={limparFiltros}>
                Limpar filtros
              </button>
            )}

            <span className="espaco" />

            <div className="segmentado">
              <button
                className="seg"
                aria-pressed={visao === "pipeline"}
                onClick={() => setVisao("pipeline")}
              >
                Pipeline
              </button>
              <button
                className="seg"
                aria-pressed={visao === "lista"}
                onClick={() => setVisao("lista")}
              >
                Lista
              </button>
            </div>
          </div>

          {/* com filtro ativo, o que está na tela é um recorte — dizer qual */}
          {filtroAtivo && filtrados.length > 0 && (
            <div className="recorte">
              <b>
                {inteiro(filtrados.length)} lead{filtrados.length === 1 ? "" : "s"}
              </b>
              <span>
                {[
                  fAnuncio && `anúncio “${fAnuncio}”`,
                  fConjunto && `conjunto “${fConjunto}”`,
                  fCampanha && `campanha “${fCampanha}”`,
                  fStatus && `etapa ${fStatus}`,
                  fOrigem && `origem ${fOrigem}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || `de ${inteiro(leads.length)} no total`}
              </span>
            </div>
          )}

          {leads.length === 0 ? (
            <div className="vazio">
              <b>Nenhum lead ainda</b>
              Assim que o primeiro lead cair na planilha, ele aparece aqui.
            </div>
          ) : filtrados.length === 0 ? (
            <div className="vazio">
              <b>Nenhum lead com esses filtros</b>
              Ajuste a busca ou os filtros acima.
            </div>
          ) : visao === "pipeline" ? (
            <Kanban
              leads={filtrados}
              statusList={statusList}
              onAbrir={(l) => setSelecionado(l.id)}
              onAvancar={avancar}
            />
          ) : (
            <Lista
              leads={filtrados}
              statusList={statusList}
              onAbrir={(l) => setSelecionado(l.id)}
              onAvancar={avancar}
            />
          )}
        </div>
      )}

      {leadAberto && (
        <Drawer
          lead={leadAberto}
          slug={tenant.slug}
          statusList={statusList}
          onFechar={() => setSelecionado(null)}
          onStatus={(s) => void salvar(leadAberto.id, { status: s })}
          onNota={(n) => void salvar(leadAberto.id, { nota: n })}
        />
      )}

      {criando && (
        <NovoLead
          slug={tenant.slug}
          onFechar={() => setCriando(false)}
          onCriado={() => {
            setCriando(false);
            toast("Lead criado");
            void buscarLeads();
          }}
        />
      )}

      <div className={`toast ${toastMsg ? "on" : ""}`}>{toastMsg}</div>
    </div>
  );
}
