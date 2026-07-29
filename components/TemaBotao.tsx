"use client";

import { useSyncExternalStore } from "react";

/**
 * Alternador de tema.
 *
 * O CSS já segue a preferência do sistema sozinho; este botão só carimba
 * `data-theme` no <html> para o usuário mandar o contrário, e guarda a escolha.
 * Usa useSyncExternalStore para ler o DOM sem descompasso na hidratação — no
 * servidor o valor é sempre "claro", e o React acerta ao montar.
 */

const CHAVE = "painel-tema";
const EVENTO = "painel-tema-mudou";

function inscrever(aoMudar: () => void): () => void {
  window.addEventListener(EVENTO, aoMudar);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", aoMudar);
  return () => {
    window.removeEventListener(EVENTO, aoMudar);
    mq.removeEventListener("change", aoMudar);
  };
}

/** O tema que está valendo na tela agora — explícito ou herdado do sistema. */
function lerEfetivo(): "claro" | "escuro" {
  const marcado = document.documentElement.dataset.theme;
  if (marcado === "dark") return "escuro";
  if (marcado === "light") return "claro";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

export default function TemaBotao() {
  const tema = useSyncExternalStore(inscrever, lerEfetivo, () => "claro" as const);

  function alternar() {
    const novo = tema === "escuro" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {
      // navegação privada / storage bloqueado: o tema só não persiste
    }
    window.dispatchEvent(new Event(EVENTO));
  }

  return (
    <button
      className="btn btn-icone"
      onClick={alternar}
      aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"}
      title={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"}
    >
      <span aria-hidden="true">{tema === "escuro" ? "☀" : "☾"}</span>
    </button>
  );
}

/**
 * Script que roda antes da primeira pintura, aplicando o tema salvo.
 * Sem isso, quem escolheu "escuro" veria um lampejo branco a cada carga.
 */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem("${CHAVE}");if(t)document.documentElement.dataset.theme=t}catch(e){}`;
