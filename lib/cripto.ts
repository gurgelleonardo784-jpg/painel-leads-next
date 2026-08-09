/**
 * Criptografia dos tokens da Meta guardados no banco (§20: nunca em texto puro).
 *
 * AES-256-GCM: além de cifrar, autentica — um token adulterado no banco falha
 * ao decifrar em vez de virar lixo silencioso.
 *
 * Hoje nada é gravado por aqui: o token de anúncios vem do ambiente
 * (META_ADS_TOKEN) e o Embedded Signup ainda não existe, então
 * whatsapp_accounts.access_token_encrypted fica nulo. Isto está pronto para
 * quando o App Review sair — é o que evita ter que mexer no schema depois.
 */

import crypto from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const VERSAO = "v1";
// Sal fixo da aplicação: a entropia tem que vir da ENCRYPTION_KEY, que é
// aleatória. Sal por valor só ajudaria se a chave fosse uma senha fraca.
const SAL = "painel-leads:tokens:v1";

let chaveCache: Buffer | null = null;

function chave(): Buffer {
  if (chaveCache) return chaveCache;
  const segredo = process.env.ENCRYPTION_KEY;
  if (!segredo || segredo.length < 16) {
    throw new Error(
      "ENCRYPTION_KEY ausente ou curta demais. Gere uma com: node -e \"console.log(crypto.randomBytes(32).toString('hex'))\""
    );
  }
  chaveCache = crypto.scryptSync(segredo, SAL, 32);
  return chaveCache;
}

export function criptografiaConfigurada(): boolean {
  return !!process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 16;
}

/** Devolve "v1.iv.tag.dados", tudo em base64url. Texto vazio devolve vazio. */
export function cifrar(texto: string): string {
  if (!texto) return "";
  const iv = crypto.randomBytes(12); // 96 bits, o tamanho recomendado para GCM
  const c = crypto.createCipheriv(ALGORITMO, chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return [VERSAO, iv.toString("base64url"), tag.toString("base64url"), dados.toString("base64url")].join(".");
}

/** Inverso do `cifrar`. Lança se o valor foi adulterado ou a chave mudou. */
export function decifrar(guardado: string): string {
  if (!guardado) return "";
  const partes = guardado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new Error("Token guardado em formato desconhecido.");
  }
  const [, iv, tag, dados] = partes;
  const d = crypto.createDecipheriv(ALGORITMO, chave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64url")), d.final()]).toString("utf8");
}
