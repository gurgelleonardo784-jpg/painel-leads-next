/** Ícones em SVG inline — sem dependência externa. Herdam a cor do texto. */

type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function Atualizar({ size = 14 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.2}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function Mais({ size = 14 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.4}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Baixar({ size = 14 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.2}>
      <path d="M12 3v11" />
      <path d="M8 10.5 12 14.5l4-4" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function Sol({ size = 15 }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </svg>
  );
}

export function Lua({ size = 15 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function Lupa({ size = 15 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.2} stroke="var(--txt6)">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function Chevron({ size = 13 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.4}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function Fechar({ size = 13 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.4}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function Telefone({ size = 15 }: P) {
  return (
    <svg {...base(size)} stroke="var(--txt5)">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2.1z" />
    </svg>
  );
}

export function Envelope({ size = 15, apagado = false }: P & { apagado?: boolean }) {
  return (
    <svg {...base(size)} stroke={apagado ? "var(--txt7)" : "var(--txt5)"}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m3 6 9 6 9-6" />
    </svg>
  );
}

export function Linhas({ size = 12 }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

export function Whatsapp({ size = 13 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.1-.7.2s-.6.8-.8 1c-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.5-.9-.8-1.4-1.7-1.6-2-.1-.3 0-.4.1-.6l.6-.7c.1-.2.1-.4 0-.6l-.9-2.1c-.2-.5-.4-.4-.6-.4h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 1.9 3 4.7 4.1 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.4M12 21.5c-1.6 0-3.2-.4-4.6-1.2l-3.3.9.9-3.2A9.4 9.4 0 0 1 2.6 12 9.4 9.4 0 0 1 12 2.6 9.4 9.4 0 0 1 21.4 12 9.4 9.4 0 0 1 12 21.5" />
    </svg>
  );
}
