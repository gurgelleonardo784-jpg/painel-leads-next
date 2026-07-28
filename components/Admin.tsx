"use client";

import { useCallback, useEffect, useState } from "react";

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
  whatsapp?: { phoneNumberId?: string };
};

type FormState = {
  slug: string; // preenchido = editando; vazio = criando
  nome: string;
  senha: string;
  spreadsheetId: string;
  aba: string;
  ddiPadrao: string;
  whatsappPhoneNumberId: string;
  metaDatasetId: string;
  metaAccessToken: string;
};

const FORM_VAZIO: FormState = {
  slug: "",
  nome: "",
  senha: "",
  spreadsheetId: "",
  aba: "Página1",
  ddiPadrao: "55",
  whatsappPhoneNumberId: "",
  metaDatasetId: "",
  metaAccessToken: "",
};

export default function Admin() {
  const [tela, setTela] = useState<"carregando" | "login" | "app">("carregando");
  const [senhaLogin, setSenhaLogin] = useState("");
  const [erroLogin, setErroLogin] = useState("");

  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [gravavel, setGravavel] = useState(true);

  const [form, setForm] = useState<FormState | null>(null);
  const [editando, setEditando] = useState(false);
  const [erroForm, setErroForm] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

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
      metaDatasetId: t.conversoes?.meta?.datasetId || "",
      metaAccessToken: t.conversoes?.meta?.accessToken || "",
    });
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
    <>
      <header>
        <div className="topo">
          <div className="marca">
            Administração
            <small>
              {tenants.length} cliente{tenants.length === 1 ? "" : "s"} cadastrado
              {tenants.length === 1 ? "" : "s"}
            </small>
          </div>
          <button className="btn btn-primario" onClick={novo}>
            + Novo cliente
          </button>
          {tenants.length > 0 && (
            <button
              className="btn"
              title="Copia o cadastro inteiro no formato da variável de ambiente TENANTS"
              onClick={copiarTenants}
            >
              Exportar (TENANTS)
            </button>
          )}
          <button className="btn" onClick={() => void sair()}>
            Sair
          </button>
        </div>
      </header>

      <main>
        {!gravavel && (
          <div className="aviso-ro">
            Cadastro em modo <b>somente-leitura</b> (produção sem banco). As alterações não serão
            salvas até um banco de dados ser configurado.
          </div>
        )}

        {form && (
          <div className="card admin-form">
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
                <div className="card cliente" key={t.slug}>
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
      </main>

      <div className={`toast ${msg ? "on" : ""}`}>{msg}</div>
    </>
  );
}