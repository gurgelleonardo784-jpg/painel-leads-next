"use client";

import { useEffect, useRef, useState } from "react";

/** Cadastro manual — para o lead que chegou por fora (telefone, indicação). */
export default function NovoLead({
  slug,
  onFechar,
  onCriado,
}: {
  slug: string;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [form, setForm] = useState({
    nome: "",
    telefone: "",
    email: "",
    campanha: "",
    origem: "",
    nota: "",
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const primeiro = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    primeiro.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function salvar() {
    if (!form.nome.trim() && !form.telefone.trim()) {
      setErro("Informe ao menos o nome ou o telefone.");
      return;
    }
    setSalvando(true);
    setErro("");
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, ...form }),
    });
    const data = await res.json().catch(() => null);
    setSalvando(false);
    if (!res.ok || !data?.ok) {
      setErro(data?.erro || "Não consegui gravar na planilha.");
      return;
    }
    onCriado();
  }

  const campo = (
    chave: keyof typeof form,
    rotulo: string,
    dica = "",
    ref?: React.Ref<HTMLInputElement>
  ) => (
    <label className="campo">
      <span>{rotulo}</span>
      <input
        ref={ref}
        value={form[chave]}
        placeholder={dica}
        onChange={(e) => setForm({ ...form, [chave]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="overlay" role="presentation" onClick={onFechar}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Novo lead"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-cab">
          <div style={{ flex: 1 }}>
            <h2>Novo lead</h2>
            <div className="secao-meta" style={{ marginTop: 4 }}>
              Grava direto na planilha do cliente
            </div>
          </div>
          <button className="btn-quad" onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-corpo rolagem">
          <div className="form-grid">
            {campo("nome", "Nome", "Nome do contato", primeiro)}
            {campo("telefone", "Telefone", "11988887777")}
            {campo("email", "E-mail (opcional)", "nome@empresa.com")}
            {campo("origem", "Origem", "Indicação, telefone, evento…")}
            {campo("campanha", "Campanha (opcional)", "de onde veio")}
          </div>
          <label className="campo">
            <span>Anotação inicial (opcional)</span>
            <textarea
              value={form.nota}
              placeholder="O que já se sabe sobre este lead"
              onChange={(e) => setForm({ ...form, nota: e.target.value })}
            />
          </label>
          <div className="erro">{erro}</div>
          <div className="form-acoes">
            <button className="btn" onClick={onFechar}>
              Cancelar
            </button>
            <button className="btn btn-primario" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? "Gravando…" : "Criar lead"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
