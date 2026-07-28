/**
 * Freio simples contra tentativa de senha em força bruta.
 *
 * Contagem em memória, por processo. Numa hospedagem serverless cada instância
 * tem o seu contador, então isso não é uma barreira absoluta — é o suficiente
 * para tornar inviável varrer senhas de 8 caracteres a partir de um IP. Se um
 * dia precisar de garantia real, trocar o Map por Redis/Upstash mantendo esta
 * mesma função.
 */

type Registro = { tentativas: number; ate: number };

const memoria = new Map<string, Registro>();

/** Limpa registros vencidos para o Map não crescer sem fim. */
function limpar(agora: number): void {
  if (memoria.size < 500) return;
  for (const [k, v] of memoria) {
    if (v.ate <= agora) memoria.delete(k);
  }
}

export type ResultadoLimite = { ok: true } | { ok: false; esperarSeg: number };

/**
 * Registra uma tentativa e diz se ela pode prosseguir.
 * @param chave  o que está sendo limitado (ex.: "login:acme:203.0.113.9")
 * @param max    tentativas permitidas dentro da janela
 * @param janelaSeg  tamanho da janela, em segundos
 */
export function limitar(chave: string, max = 10, janelaSeg = 300): ResultadoLimite {
  const agora = Date.now();
  limpar(agora);

  const atual = memoria.get(chave);
  if (!atual || atual.ate <= agora) {
    memoria.set(chave, { tentativas: 1, ate: agora + janelaSeg * 1000 });
    return { ok: true };
  }

  atual.tentativas += 1;
  if (atual.tentativas > max) {
    return { ok: false, esperarSeg: Math.ceil((atual.ate - agora) / 1000) };
  }
  return { ok: true };
}

/** Zera o contador — chamado quando a senha entra certa. */
export function liberar(chave: string): void {
  memoria.delete(chave);
}

/** IP de quem chamou, atrás do proxy da hospedagem. */
export function ipDaRequisicao(req: Request): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "desconhecido";
}
