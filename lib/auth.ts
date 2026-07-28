import crypto from "crypto";
import { cookies } from "next/headers";
import { getTenant, type Tenant } from "./tenants";

/**
 * Sessão simples por cookie assinado (HMAC). O cookie guarda o slug do
 * tenant; a assinatura impede que o valor seja adulterado no navegador.
 * Sem senha trafegando a cada chamada (diferente do painel antigo).
 */

const COOKIE = "sessao";
const MAX_IDADE = 60 * 60 * 24 * 30; // 30 dias

function segredo(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Defina SESSION_SECRET no ambiente.");
  return s;
}

function assinar(slug: string): string {
  const mac = crypto.createHmac("sha256", segredo()).update(slug).digest("base64url");
  return `${slug}.${mac}`;
}

function verificar(valor: string | undefined): string | null {
  if (!valor) return null;
  const i = valor.lastIndexOf(".");
  if (i === -1) return null;
  const slug = valor.slice(0, i);
  const esperado = assinar(slug);
  // comparação em tempo constante
  const a = Buffer.from(valor);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return slug;
}

export async function criarSessao(slug: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, assinar(slug), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_IDADE,
  });
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Retorna o tenant da sessão se o cookie for válido E bater com o slug pedido. */
export async function tenantDaSessao(slugPedido: string): Promise<Tenant | null> {
  const jar = await cookies();
  const slug = verificar(jar.get(COOKIE)?.value);
  if (!slug || slug !== slugPedido) return null;
  return getTenant(slug);
}
