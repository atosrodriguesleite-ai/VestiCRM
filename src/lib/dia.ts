/**
 * O DIA do dinheiro (RN-030) — regra pura, sem banco, para valer tanto no
 * Financeiro quanto na ficha do pedido e nas telas (um só relógio: duas cópias
 * desta régua eram onde um fuso ajustado num lado deixava o outro para trás,
 * achado da revisão de 05/10/2026).
 */

/**
 * O dia (AAAA-MM-DD) de um instante no fuso de São Paulo (UTC−3, sem horário
 * de verão desde 2019 — mesma régua já usada no Dashboard e no Financeiro).
 */
export function diaSP(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * "2026-09-05" (o que o campo de data manda) → instante do MEIO-DIA em UTC.
 *
 * Guardar meia-noite UTC parece inocente e não é: em São Paulo isso é 21h do
 * dia ANTERIOR, e a parcela apareceria vencendo um dia antes na tela e nos
 * relatórios. Ao meio-dia, qualquer fuso de ±11h continua no mesmo dia.
 */
export function dataDoDia(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(`${iso.trim()}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // "2026-02-30" não existe: o JavaScript viraria 2 de MARÇO em silêncio, e
  // um vencimento digitado errado cairia noutro mês sem ninguém ver. Se o dia
  // que saiu não é o dia que entrou, a data não existe — devolve null e quem
  // chama avisa a lojista.
  const [, ano, mes, dia] = m;
  if (
    d.getUTCFullYear() !== Number(ano) ||
    d.getUTCMonth() + 1 !== Number(mes) ||
    d.getUTCDate() !== Number(dia)
  )
    return null;
  return d;
}
