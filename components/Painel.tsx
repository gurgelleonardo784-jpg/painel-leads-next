"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lead, TenantPublico } from "@/lib/types";
import { normal, parseData } from "@/lib/format";
import LeadCard from "./LeadCard";

export type SalvarCampos = { status?: string; nota?: string };

type Tela = "carregando" | "login" | "app";

export default function Painel({ tenant }: { tenant: TenantPublico }) {
  const [tela, setTela] = useState<Tela>("carregando");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statusList, setStatusList] = useState<string[]>(tenant.status);

  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState("");

  const [busca, setBusca] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fPeriodo, setFPeriodo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");

  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2200);
  }, []);

  const buscarLeads = useCallback(async (): Promise<"ok" | "unauth" | "erro"> => {
    const res = await fetch(`/api/leads?slug=${encodeURIComponent(tenant.slug)}`, {
      cache: "no-store",
    });
    if (res.status === 401) return "unauth";
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return "erro";
    setLeads(data.leads || []);
    if (Array.isArray(data.status) && data.status.length) setStatusList(data.status);
    return "ok";
  }, [tenant.slug]);

  /** Retorna vazio em caso de sucesso, ou a mensagem de erro para a tela. */
  const entrar = useCallback(
    async (valor: string): Promise<string> => {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: tenant.slug, senha: valor }),
      });
      if (!res.ok) {
        // 429 = freio de tentativas; mostra o tempo de espera em vez de "senha incorreta"
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

  // inicialização
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await buscarLeads();
      if (!vivo) return;
      if (r === "ok") setTela("app");
      else if (r === "unauth") {
        if (tenant.exigeSenha) setTela("login");
        else await entrar(""); // cria sessão sem senha
      } else toast("Não consegui carregar os leads.");
    })();
    return () => {
      vivo = false;
    };
  }, [buscarLeads, entrar, tenant.exigeSenha, toast]);

  // auto-refresh a cada 2 minutos
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

  const origens = useMemo(() => {
    const set: string[] = [];
    leads.forEach((l) => {
      if (l.origem && set.indexOf(l.origem) === -1) set.push(l.origem);
    });
    return set;
  }, [leads]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    leads.forEach((l) => {
      c[l.status] = (c[l.status] || 0) + 1;
    });
    return c;
  }, [leads]);

  const filtrados = useMemo(() => {
    const q = normal(busca);
    const dias = parseInt(fPeriodo, 10);
    return leads.filter((l) => {
      if (filtroStatus && l.status !== filtroStatus) return false;
      if (fOrigem && l.origem !== fOrigem) return false;
      if (dias) {
        const d = parseData(l.data);
        if (!d) return false;
        const limite = new Date();
        limite.setHours(0, 0, 0, 0);
        limite.setDate(limite.getDate() - (dias - 1));
        if (d < limite) return false;
      }
      if (q) {
        const texto = [l.nome, l.telefone, l.email, l.campanha, l.origem, l.nota]
          .concat(l.respostas.map((r) => r.pergunta + " " + r.resposta))
          .join(" ");
        if (normal(texto).indexOf(q) === -1) return false;
      }
      return true;
    });
  }, [leads, busca, fPeriodo, fOrigem, filtroStatus]);

  if (tela === "carregando") {
    return null;
  }

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
    <>
      <header>
        <div className="topo">
          <div className="marca">
            {tenant.titulo}
            <small>
              {filtrados.length} de {leads.length} lead{leads.length === 1 ? "" : "s"}
            </small>
          </div>
          <button className="btn" onClick={() => void atualizar()}>
            Atualizar
          </button>
        </div>
        <div className="filtros">
          <input
            className="busca"
            placeholder="Buscar por nome, telefone, e-mail ou resposta"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <select value={fOrigem} onChange={(e) => setFOrigem(e.target.value)}>
            <option value="">Todas as origens</option>
            {origens.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select value={fPeriodo} onChange={(e) => setFPeriodo(e.target.value)}>
            <option value="">Qualquer data</option>
            <option value="1">Hoje</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </select>
        </div>
      </header>

      <div className="resumo">
        <span
          className={`pill ${filtroStatus === "" ? "on" : ""}`}
          onClick={() => setFiltroStatus("")}
        >
          Todos <b>{leads.length}</b>
        </span>
        {statusList.map((s) => (
          <span
            key={s}
            className={`pill ${filtroStatus === s ? "on" : ""}`}
            onClick={() => setFiltroStatus(s)}
          >
            {s} <b>{contagem[s] || 0}</b>
          </span>
        ))}
      </div>

      <main>
        <div className="grade">
          {filtrados.length === 0 ? (
            <div className="vazio">
              <b>Nenhum lead por aqui</b>
              Ajuste a busca ou os filtros acima.
            </div>
          ) : (
            filtrados.map((l) => (
              <LeadCard key={l.id} lead={l} status={statusList} onSalvar={salvar} />
            ))
          )}
        </div>
      </main>

      <div className={`toast ${toastMsg ? "on" : ""}`}>{toastMsg}</div>
    </>
  );
}
