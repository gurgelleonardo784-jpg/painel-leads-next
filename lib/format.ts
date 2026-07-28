/** Utilitários de formatação/filtro usados no cliente (portados do Index.html). */

export function normal(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function parseData(txt: unknown): Date | null {
  if (!txt) return null;
  const m = String(txt).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(String(txt));
  return isNaN(d.getTime()) ? null : d;
}

export function classeStatus(s: string): string {
  return "s-" + normal(s).replace(/[^a-z]/g, "");
}
