"use client";

import { useCallback, useEffect, useState } from "react";
import AdminDashboard from "./AdminDashboard";
import TemaBotao from "./TemaBotao";

/** Visão de um cliente vinda da API do admin (só o que a tela usa). */
type AdminTenant = {
  slug: string;
  nome: string;
  titulo: string;
  senha: string;
  spreadsheetId: string;
  aba: string;
  ddiPadrao: string;
  conversoes?: { meta?: { datasetId?: string; accessToken?: string } };
  whatsapp?: { phoneNumberId?: string; numero?: string };
  metaAds?: { adAccountId?: string; accessToken?: string };
  mostrarCustoAoCliente?: boolean;
};

type ContaAnuncio = { id: string; nome: string; moeda: string; ativa: boolean };

type FormState = {
  slug: string; // preenchido = editando; vazio = criando
  nome: string;
  senha: string;
  spreadsheetId: string;
  aba: string;
  ddiPadrao: string;
  whatsappPhoneNumberId: string;
  whatsappNumero: string;
  metaDatasetId: string;
  metaAccessToken: string;
  metaAdAccountId: string;
  metaAdsToken: string;
  mostrarCustoAoCliente: boolean;
};

const FORM_VAZIO: FormState = {
  slug: "",
  nome: "",
  senha: "",
  spreadsheetId: "",
  aba: "Página1",
  ddiPadrao: "55",
  whatsappPhoneNumberId: "",
  whatsappNumero: "",
  metaDatasetId: "",
  metaAccessToken: "",
  metaAdAccountId: "",
  metaAdsToken: "",
  mostrarCustoAoCliente: false,
};

type Modulo = "clientes" | "dashboard";

export default function Admin() {
  const [tela, setTela] = useState<"carregando" | "login" | "app">("carregando");
  const [senhaLogin, setSenhaLogin] = useState("");
  const [erroLogin, setErroLogin] = useState("");

  const [modulo, setModulo] = useState<Modulo>("clientes");
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [gravavel, setGravavel] = useState(true);

  const [form, setForm] = useState<FormState | null>(null);
  const [editando, setEditando] = useState(false);
  const [erroForm, setErroForm] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  // conexão da conta de anúncios
  const [contas, setContas] = useState<ContaAnuncio[] | null>(null);
  const [conexao, setConexao] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<"" | "listando" | "testando">("");

  /** Pergunta à Meta quais contas o token enxerga, para escolher numa lista. */
  async function buscarContas() {
    if (!form) return;
    setOcupado("listando");
    setConexao(null);
    const res = await fetch("/api/admin/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "listar", token: form.metaAdsToken }),
    });
    const data = await res.json().catch(() => null);
    setOcupado("");
    if (!res.ok || !data?.ok) {
      setContas(null);
      setConexao({ tipo: "erro", texto: data?.erro || "Não consegui falar com a Meta." });
      return;
    }
    setContas(data.contas);
    setConexao({
      tipo: "ok",
      texto: `${data.contas.length} conta${data.contas.length === 1 ? "" : "s"} encontrada${data.contas.length === 1 ? "" : "s"}. Escolha a deste cliente.`,
    });
  }

  /** Confirma que dá mesmo para ler o gasto da conta escolhida. */
  async function testarConexao() {
    if (!form) return;
    setOcupado("testando");
    setConexao(null);
    const res = await fetch("/api/admin/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acao: "testar",
        token: form.metaAdsToken,
        adAccountId: form.metaAdAccountId,
      }),
    });
    const data = await res.json().catch(() => null);
    setOcupado("");
    if (!res.ok || !data?.ok) {
      setConexao({ tipo: "erro", texto: data?.erro || "Não consegui ler essa conta." });
      return;
    }
    const v = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: data.moeda || "BRL",
    }).format(data.investimento);
    setConexao({
      tipo: "ok",
      texto: `Conectado. Nos últimos 7 dias: ${v} em ${data.campanhas} campanha${data.campanhas === 1 ? "" : "s"}.`,
    });
  }

  function aviso(texto: string) {
    setMsg(texto);
    setTimeout(() => setMsg(""), 2200);
  }

  const carregar = useCallback(async (): Promise<"ok" | "login" | "erro"> => {
    const res = await fetch("/api/admin/tenants", { cache: "no-store" });
    if (res.status === 401) return "login";
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return "erro";
    setTenants(data.tenants || []);
    setGravavel(!!data.gravavel);
    return "ok";
  }, []);

  useEffect(() => {
    (async () => {
      const r = await carregar();
      setTela(r === "ok" ? "app" : "login");
    })();
  }, [carregar]);

  async function entrar() {
    setErroLogin("verificando...");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaLogin }),
    });
    if (!res.ok) {
      // 429 (freio de tentativas) e 500 (ADMIN_SENHA ausente) explicam o porquê
      const data = res.status === 401 ? null : await res.json().catch(() => null);
      setErroLogin(data?.erro || "Senha incorreta.");
      return;
    }
    setErroLogin("");
    const r = await carregar();
    setTela(r === "ok" ? "app" : "login");
  }

  async function sair() {
    await fetch("/api/admin/logout", { method: "POST" });
    setTenants([]);
    setTela("login");
  }

  function novo() {
    setForm({ ...FORM_VAZIO });
    setEditando(false);
    setErroForm("");
  }

  function editar(t: AdminTenant) {
    setForm({
      slug: t.slug,
      nome: t.nome,
      senha: t.senha,
      spreadsheetId: t.spreadsheetId,
      aba: t.aba,
      ddiPadrao: t.ddiPadrao,
      whatsappPhoneNumberId: t.whatsapp?.phoneNumberId || "",
      whatsappNumero: t.whatsapp?.numero || "",
      metaDatasetId: t.conversoes?.meta?.datasetId || "",
      metaAccessToken: t.conversoes?.meta?.accessToken || "",
      metaAdAccountId: t.metaAds?.adAccountId || "",
      metaAdsToken: t.metaAds?.accessToken || "",
      mostrarCustoAoCliente: !!t.mostrarCustoAoCliente,
    });
    setContas(null);
    setConexao(null);
    setEditando(true);
    setErroForm("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function salvar() {
    if (!form) return;
    if (!form.nome.trim()) {
      setErroForm("Informe o nome do cliente.");
      return;
    }
    setSalvando(true);
    setErroForm("");
    const url = editando
      ? `/api/admin/tenants/${encodeURIComponent(form.slug)}`
      : "/api/admin/tenants";
    const res = await fetch(url, {
      method: editando ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => null);
    setSalvando(false);
    if (!res.ok || !data?.ok) {
      setErroForm(data?.erro || "Não consegui salvar.");
      return;
    }
    setForm(null);
    aviso(editando ? "Cliente atualizado." : "Cliente criado.");
    await carregar();
  }

  async function excluir(t: AdminTenant) {
    if (!confirm(`Excluir o cliente "${t.titulo}"? Isso remove o acesso dele ao painel.`)) return;
    const res = await fetch(`/api/admin/tenants/${encodeURIComponent(t.slug)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      aviso(data?.erro || "Não consegui excluir.");
      return;
    }
    aviso("Cliente excluído.");
    await carregar();
  }

  function copiar(texto: string) {
    navigator.clipboard?.writeText(texto);
    aviso("Link copiado!");
  }

  /**
   * Leva o cadastro para produção sem banco: o JSON copiado daqui é exatamente
   * o conteúdo da variável de ambiente TENANTS (na Vercel, por exemplo).
   */
  function copiarTenants() {
    navigator.clipboard?.writeText(JSON.stringify(tenants));
    aviso("JSON copiado — cole na variável TENANTS.");
  }

  if (tela === "carregando") return null;

  if (tela === "login") {
    return (
      <div className="login">
        <h2>Administração</h2>
        <p>Área da agência. Digite a senha de administrador.</p>
        <input
          type="password"
          value={senhaLogin}
          placeholder="senha de admin"
          autoComplete="current-password"
          onChange={(e) => setSenhaLogin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void entrar();
          }}
        />
        <button className="btn" onClick={() => void entrar()}>
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
                AG
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="titulo-linha">
                  <h1>Administração</h1>
                  <span className="chip-cliente">Agência</span>
                </div>
                <div className="sync">
                  <span className="ponto" />
                  <span>
                    {tenants.length} cliente{tenants.length === 1 ? "" : "s"} cadastrado
                    {tenants.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </div>

            <div className="topo-acoes">
              {modulo === "clientes" && (
                <button className="btn btn-primario" onClick={novo}>
                  <span aria-hidden="true">+</span>
                  <span className="rotulo-btn">Novo cliente</span>
                </button>
              )}
              {modulo === "clientes" && tenants.length > 0 && (
                <button
                  className="btn"
                  title="Copia o cadastro inteiro no formato da variável de ambiente TENANTS"
                  onClick={copiarTenants}
                >
                  <span className="rotulo-btn">Exportar (TENANTS)</span>
                </button>
              )}
              <button className="btn" onClick={() => void sair()}>
                Sair
              </button>
              <span className="divisor" />
              <TemaBotao />
            </div>
          </div>

          <div className="abas" role="tablist" aria-label="Módulos">
            <button
              className="aba"
              role="tab"
              aria-selected={modulo === "clientes"}
              onClick={() => setModulo("clientes")}
            >
              Clientes
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
          <AdminDashboard />
        </div>
      ) : (
      <div className="conteudo">
        {!gravavel && (
          <div className="aviso-ro">
            Cadastro em modo <b>somente-leitura</b>: em produção o disco é apagado a cada deploy,
            então os clientes vêm da variável de ambiente <b>TENANTS</b>. Cadastre em
            desenvolvimento, clique em <b>Exportar (TENANTS)</b> e cole o JSON nessa variável na
            hospedagem.
          </div>
        )}

        {form && (
          <div className="admin-form">
            <h3>{editando ? `Editar "${form.nome || form.slug}"` : "Novo cliente"}</h3>
            <div className="form-grid">
              <label className="campo">
                <span>Nome do cliente</span>
                <input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Fortal Consórcio"
                />
              </label>
              {!editando && (
                <label className="campo">
                  <span>Endereço do link (opcional)</span>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="vazio = gera do nome"
                  />
                </label>
              )}
              <label className="campo">
                <span>Senha do cliente</span>
                <input
                  value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })}
                  placeholder="senha de acesso do cliente"
                />
              </label>
              <label className="campo">
                <span>ID da planilha</span>
                <input
                  value={form.spreadsheetId}
                  onChange={(e) => setForm({ ...form, spreadsheetId: e.target.value })}
                  placeholder="pedaço do meio da URL da planilha"
                />
              </label>
              <label className="campo">
                <span>Aba da planilha</span>
                <input
                  value={form.aba}
                  onChange={(e) => setForm({ ...form, aba: e.target.value })}
                  placeholder="Página1"
                />
              </label>
              <label className="campo">
                <span>DDI padrão</span>
                <input
                  value={form.ddiPadrao}
                  onChange={(e) => setForm({ ...form, ddiPadrao: e.target.value })}
                  placeholder="55"
                />
              </label>
              <label className="campo campo-full">
                <span>WhatsApp — Phone Number ID (opcional)</span>
                <input
                  value={form.whatsappPhoneNumberId}
                  onChange={(e) => setForm({ ...form, whatsappPhoneNumberId: e.target.value })}
                  placeholder="ID do número na Cloud API — roteia os leads deste cliente"
                />
              </label>
              <label className="campo campo-full">
                <span>WhatsApp — número (para o botão do site)</span>
                <input
                  value={form.whatsappNumero}
                  onChange={(e) => setForm({ ...form, whatsappNumero: e.target.value })}
                  placeholder="5585999998888 — com DDI, só números"
                />
              </label>
              <label className="campo campo-full">
                <span>Meta — Dataset ID (opcional)</span>
                <input
                  value={form.metaDatasetId}
                  onChange={(e) => setForm({ ...form, metaDatasetId: e.target.value })}
                  placeholder="para devolver a conversão ao Meta"
                />
              </label>
              <label className="campo campo-full">
                <span>Meta — Access Token (opcional)</span>
                <input
                  value={form.metaAccessToken}
                  onChange={(e) => setForm({ ...form, metaAccessToken: e.target.value })}
                  placeholder="EAA..."
                />
              </label>
              <div className="campo-full conexao-meta">
                <div className="conexao-titulo">
                  Conta de anúncios da Meta
                  <small>
                    Traz investimento, CPL e ROAS para o dashboard deste cliente. Precisa de um
                    token com <b>ads_read</b> — o token de conversões acima <b>não</b> serve.
                  </small>
                </div>

                <label className="campo">
                  <span>Token de anúncios (vazio = usa o token da agência)</span>
                  <input
                    value={form.metaAdsToken}
                    onChange={(e) => {
                      setForm({ ...form, metaAdsToken: e.target.value });
                      setContas(null);
                      setConexao(null);
                    }}
                    placeholder="EAA… (usuário de sistema com ads_read)"
                  />
                </label>

                <div className="conexao-acoes">
                  <button
                    className="btn"
                    disabled={ocupado !== ""}
                    onClick={() => void buscarContas()}
                  >
                    {ocupado === "listando" ? "Buscando…" : "Buscar contas"}
                  </button>

                  {contas ? (
                    <select
                      value={form.metaAdAccountId}
                      aria-label="Conta de anúncios"
                      onChange={(e) => {
                        setForm({ ...form, metaAdAccountId: e.target.value });
                        setConexao(null);
                      }}
                    >
                      <option value="">Escolha a conta…</option>
                      {contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome} · {c.id}
                          {c.ativa ? "" : " (inativa)"}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.metaAdAccountId}
                      onChange={(e) => setForm({ ...form, metaAdAccountId: e.target.value })}
                      placeholder="ou cole o ID: act_1234567890"
                      style={{ flex: 1, minWidth: 200 }}
                    />
                  )}

                  <button
                    className="btn"
                    disabled={ocupado !== "" || !form.metaAdAccountId}
                    onClick={() => void testarConexao()}
                  >
                    {ocupado === "testando" ? "Testando…" : "Testar"}
                  </button>
                </div>

                {conexao && (
                  <p className={`conexao-status ${conexao.tipo}`}>{conexao.texto}</p>
                )}
              </div>
              <label className="campo-check">
                <input
                  type="checkbox"
                  checked={form.mostrarCustoAoCliente}
                  onChange={(e) =>
                    setForm({ ...form, mostrarCustoAoCliente: e.target.checked })
                  }
                />
                <span>
                  Mostrar investimento e custo por lead no dashboard do cliente
                  <br />
                  <small style={{ color: "var(--txt3)" }}>
                    Desmarcado, o custo de mídia aparece só aqui na área da agência.
                  </small>
                </span>
              </label>
            </div>
            <div className="erro">{erroForm}</div>
            <div className="form-acoes">
              <button className="btn" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primario"
                disabled={salvando}
                onClick={() => void salvar()}
              >
                {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Criar cliente"}
              </button>
            </div>
          </div>
        )}

        <div className="admin-lista">
          {tenants.length === 0 ? (
            <div className="vazio">
              <b>Nenhum cliente ainda</b>
              Clique em “+ Novo cliente” para cadastrar o primeiro.
            </div>
          ) : (
            tenants.map((t) => {
              // esta lista só existe depois do login (nunca no servidor), então
              // dá para ler o endereço do navegador direto aqui
              const link = `${window.location.origin}/${t.slug}`;
              const temMeta = !!t.conversoes?.meta?.datasetId;
              const temWhats = !!t.whatsapp?.phoneNumberId;
              return (
                <div className="cliente" key={t.slug}>
                  <div className="cliente-info">
                    <h3>{t.titulo}</h3>
                    <div className="cliente-meta">
                      <a href={`/${t.slug}`} target="_blank" rel="noreferrer">
                        {link}
                      </a>
                      <span className={`tag ${t.spreadsheetId ? "tag-ok" : "tag-off"}`}>
                        {t.spreadsheetId ? "planilha ✓" : "sem planilha"}
                      </span>
                      <span className={`tag ${temMeta ? "tag-ok" : "tag-off"}`}>
                        {temMeta ? "Meta ✓" : "sem Meta"}
                      </span>
                      {temWhats && <span className="tag tag-ok">WhatsApp ✓</span>}
                      <span className="tag">senha: {t.senha || "—"}</span>
                    </div>
                  </div>
                  <div className="cliente-acoes">
                    <button className="btn" onClick={() => copiar(link)}>
                      Copiar link
                    </button>
                    <button className="btn" onClick={() => editar(t)}>
                      Editar
                    </button>
                    <button className="btn btn-perigo" onClick={() => void excluir(t)}>
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      <div className={`toast ${msg ? "on" : ""}`}>{msg}</div>
    </div>
  );
}