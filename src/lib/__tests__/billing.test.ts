import { describe, it, expect } from "vitest";
import {
  billingStatus,
  nextCompetencia,
  competenciaDate,
  formatCompetencia,
  isPaidUpToDate,
  clampDueDay,
} from "../billing";

// "Agora" fixo para os testes: 20/jul/2026, ~12h em São Paulo (15h UTC).
const NOW = new Date("2026-07-20T15:00:00Z");

describe("billingStatus", () => {
  it("cortesia é sempre vitalício, nunca atrasa", () => {
    const s = billingStatus(
      { kind: "CORTESIA", monthlyFee: 0, dueDay: 10, paidThrough: null },
      NOW
    );
    expect(s.code).toBe("VITALICIO");
    expect(s.monthsBehind).toBe(0);
  });

  it("teste aparece como em teste", () => {
    const s = billingStatus(
      { kind: "TESTE", monthlyFee: 0, dueDay: 10, paidThrough: null },
      NOW
    );
    expect(s.code).toBe("TESTE");
  });

  it("pagante sem valor pede para definir valor", () => {
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 0, dueDay: 10, paidThrough: null },
      NOW
    );
    expect(s.code).toBe("SEM_VALOR");
  });

  it("pago até o mês atual = em dia", () => {
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 150, dueDay: 10, paidThrough: competenciaDate(2026, 7) },
      NOW
    );
    expect(s.code).toBe("EM_DIA");
  });

  it("pago adiantado (mês seguinte) = em dia", () => {
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 150, dueDay: 10, paidThrough: competenciaDate(2026, 8) },
      NOW
    );
    expect(s.code).toBe("EM_DIA");
  });

  it("deve o mês atual, mas antes do vencimento = a vencer", () => {
    // pago até junho; hoje é dia 20/jul, vencimento dia 25 → ainda a vencer
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 150, dueDay: 25, paidThrough: competenciaDate(2026, 6) },
      NOW
    );
    expect(s.code).toBe("A_VENCER");
    expect(s.label).toContain("25");
  });

  it("deve o mês atual e já passou do vencimento = atrasado", () => {
    // pago até junho; hoje é dia 20/jul, vencimento dia 10 → atrasado
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 150, dueDay: 10, paidThrough: competenciaDate(2026, 6) },
      NOW
    );
    expect(s.code).toBe("ATRASADO");
    expect(s.monthsBehind).toBe(1);
  });

  it("dois meses em aberto = atrasado com contagem", () => {
    // pago até maio; atual julho → deve junho e julho
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 150, dueDay: 10, paidThrough: competenciaDate(2026, 5) },
      NOW
    );
    expect(s.code).toBe("ATRASADO");
    expect(s.monthsBehind).toBe(2);
    expect(s.label).toContain("2");
  });

  it("nunca pagou (paidThrough null) devendo o mês atual, após vencimento = atrasado", () => {
    const s = billingStatus(
      { kind: "PAGANTE", monthlyFee: 150, dueDay: 5, paidThrough: null },
      NOW
    );
    expect(s.code).toBe("ATRASADO");
    expect(s.monthsBehind).toBe(1);
  });
});

describe("nextCompetencia", () => {
  it("primeiro pagamento quita o mês atual", () => {
    const next = nextCompetencia(competenciaDate(2026, 6), NOW);
    expect(formatCompetencia(next)).toBe("jul/2026");
  });

  it("quando nada foi pago, o primeiro registro é o mês atual", () => {
    const next = nextCompetencia(null, NOW);
    expect(formatCompetencia(next)).toBe("jul/2026");
  });

  it("adiantar paga o mês seguinte", () => {
    const next = nextCompetencia(competenciaDate(2026, 7), NOW);
    expect(formatCompetencia(next)).toBe("ago/2026");
  });

  it("vira o ano corretamente", () => {
    const next = nextCompetencia(competenciaDate(2026, 12), NOW);
    expect(formatCompetencia(next)).toBe("jan/2027");
  });
});

describe("isPaidUpToDate", () => {
  it("em dia quando paidThrough alcança o mês atual", () => {
    expect(isPaidUpToDate(competenciaDate(2026, 7), NOW)).toBe(true);
    expect(isPaidUpToDate(competenciaDate(2026, 6), NOW)).toBe(false);
    expect(isPaidUpToDate(null, NOW)).toBe(false);
  });
});

describe("clampDueDay", () => {
  it("mantém entre 1 e 28", () => {
    expect(clampDueDay(0)).toBe(1);
    expect(clampDueDay(31)).toBe(28);
    expect(clampDueDay(15)).toBe(15);
    expect(clampDueDay(NaN)).toBe(10);
  });
});
