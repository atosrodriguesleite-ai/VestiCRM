/**
 * Cobrança das lojas — regras puras (sem banco), fáceis de testar.
 *
 * Não há preço fixo: cada loja tem os SEUS valores. Cobra-se implementação
 * (uma vez) e recorrência (mensal). A etiqueta (`kind`) define o tratamento:
 *   • TESTE     → período de avaliação (sem cobrança ainda)
 *   • PAGANTE   → cliente pagante (calcula em dia / a vencer / atrasado)
 *   • CORTESIA  → acesso vitalício grátis (nunca fica "atrasado"; pode virar
 *                 pago quando o dono decidir)
 *
 * `paidThrough` guarda a COMPETÊNCIA paga até (o mês pago), como uma data no
 * dia 1 daquele mês (meio-dia UTC, para não escorregar de mês por fuso).
 * Tudo é calculado no fuso de São Paulo, que é onde a operação vive.
 */

export type BillingKind = "TESTE" | "PAGANTE" | "CORTESIA";

export type BillingStatusCode =
  | "VITALICIO" // cortesia
  | "TESTE"
  | "EM_DIA"
  | "A_VENCER"
  | "ATRASADO"
  | "SEM_VALOR"; // pagante sem valor de recorrência definido

export type BillingInput = {
  kind: string;
  monthlyFee: number;
  dueDay: number;
  paidThrough: Date | null;
};

export type BillingStatus = {
  code: BillingStatusCode;
  label: string;
  tone: "green" | "amber" | "red" | "slate" | "brand";
  monthsBehind: number; // meses em aberto (0 quando em dia/cortesia/teste)
};

/** Índice de competência (ano*12 + mês0) para comparar meses com facilidade. */
function ymIndex(y: number, m: number): number {
  return y * 12 + (m - 1);
}

/** Data-competência estável: dia 1, meio-dia UTC (imune a fuso). */
export function competenciaDate(y: number, m1to12: number): Date {
  return new Date(Date.UTC(y, m1to12 - 1, 1, 12, 0, 0));
}

/** Extrai {y, m} de uma data-competência. */
function ymFromDate(d: Date): { y: number; m: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** "Agora" no fuso de São Paulo — ano, mês (1-12) e dia. */
export function spNow(now: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** "jul/2026" a partir da data-competência. */
export function formatCompetencia(d: Date | null): string {
  if (!d) return "—";
  const { y, m } = ymFromDate(d);
  return `${MESES[m - 1]}/${y}`;
}

/**
 * Índice da competência paga (paidThrough). Quando nada foi pago, considera
 * "pago até o mês passado" — ou seja, a loja deve a partir do mês atual.
 */
function paidIndex(paidThrough: Date | null, curIdx: number): number {
  if (!paidThrough) return curIdx - 1;
  const { y, m } = ymFromDate(paidThrough);
  return ymIndex(y, m);
}

/** Situação de cobrança da loja, calculada a partir das regras acima. */
export function billingStatus(b: BillingInput, now: Date = new Date()): BillingStatus {
  const kind = (b.kind || "TESTE").toUpperCase();

  if (kind === "CORTESIA")
    return { code: "VITALICIO", label: "Acesso vitalício", tone: "brand", monthsBehind: 0 };
  if (kind === "TESTE")
    return { code: "TESTE", label: "Em teste", tone: "slate", monthsBehind: 0 };

  // PAGANTE
  if (!b.monthlyFee || b.monthlyFee <= 0)
    return { code: "SEM_VALOR", label: "Definir valor", tone: "amber", monthsBehind: 0 };

  const { y, m, d } = spNow(now);
  const curIdx = ymIndex(y, m);
  const paidIdx = paidIndex(b.paidThrough, curIdx);
  const behind = curIdx - paidIdx; // meses do (pago+1) até o atual

  if (behind <= 0)
    return { code: "EM_DIA", label: "Em dia", tone: "green", monthsBehind: 0 };

  const dueDay = clampDueDay(b.dueDay);
  if (behind === 1 && d < dueDay)
    return { code: "A_VENCER", label: `Vence dia ${dueDay}`, tone: "amber", monthsBehind: 1 };

  return {
    code: "ATRASADO",
    label: behind === 1 ? "Atrasado" : `Atrasado (${behind} meses)`,
    tone: "red",
    monthsBehind: behind,
  };
}

/** Mantém o dia de vencimento entre 1 e 28 (todo mês tem dia 28). */
export function clampDueDay(day: number): number {
  if (!Number.isFinite(day)) return 10;
  return Math.min(28, Math.max(1, Math.trunc(day)));
}

/**
 * Próxima competência a registrar quando o Super Admin clica "registrar
 * pagamento do mês" — o primeiro mês ainda em aberto. Cada clique paga um mês
 * (dois cliques = quita dois meses de atraso).
 */
export function nextCompetencia(paidThrough: Date | null, now: Date = new Date()): Date {
  const { y, m } = spNow(now);
  const curIdx = ymIndex(y, m);
  const paidIdx = paidIndex(paidThrough, curIdx);
  const targetIdx = paidIdx + 1;
  const ty = Math.floor(targetIdx / 12);
  const tm = (targetIdx % 12) + 1;
  return competenciaDate(ty, tm);
}

/** True quando a competência paga alcança (ou passa) o mês atual. */
export function isPaidUpToDate(paidThrough: Date | null, now: Date = new Date()): boolean {
  const { y, m } = spNow(now);
  const curIdx = ymIndex(y, m);
  return paidIndex(paidThrough, curIdx) >= curIdx;
}
