import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gerarInsights, inicioDoMesSP } from "../recompra-painel";

/**
 * PAINEL DE RECOMPRA — exigência do dono: "100% confiável; se a informação
 * existe em outra tela, os números têm que bater e a conta fechar".
 * Este guarda trava a FONTE ÚNICA e o Monitor IA determinístico.
 */

const base = {
  porFaixa: { ATIVA: 10, ESFRIANDO: 3, RISCO: 1, SUMIDA: 0 },
  passouDoPonto: 0,
  valorEmRisco: 0,
  compradoras: 14,
  recorrentes: 10,
  taxaRecompra: (10 / 14) * 100,
  cicloMedioDaLoja: 21,
  mesFaturamento: 10_000,
  mesRecompra: 6_000,
  mesPrimeiraCompra: 4_000,
  mesAnteriorRecompra: 5_000,
  vips: [],
  concentracaoVip: 40,
  recuperadoMes: 0,
  recuperadoVendas: 0,
  aniversariantes: 0,
} as const;

describe("Monitor IA — cada frase nasce de uma conta, nunca de chute", () => {
  it("clientes passadas do ponto viram o alerta nº 1, com o valor em jogo", () => {
    const ins = gerarInsights({ ...base, passouDoPonto: 5, valorEmRisco: 2500 });
    expect(ins[0].nivel).toBe("ALERTA");
    expect(ins[0].texto).toContain("5 clientes");
    expect(ins[0].texto).toContain("2.500");
  });

  it("queda forte da receita de recompra (>30%) dispara alarme com os dois números", () => {
    const ins = gerarInsights({ ...base, mesRecompra: 3_000, mesAnteriorRecompra: 10_000 });
    const alarme = ins.find((i) => i.texto.includes("caiu"));
    expect(alarme?.nivel).toBe("ALERTA");
    expect(alarme?.texto).toContain("70%");
  });

  it("taxa de recompra alta vira boa notícia; baixa vira alerta — nunca os dois", () => {
    const boa = gerarInsights({ ...base, taxaRecompra: 74 });
    expect(boa.some((i) => i.texto.includes("74%") && i.nivel === "BOA")).toBe(true);
    const ruim = gerarInsights({ ...base, taxaRecompra: 20, recorrentes: 3 });
    expect(ruim.some((i) => i.texto.includes("20%") && i.nivel === "ALERTA")).toBe(true);
  });

  it("loja pequena (menos de 5 compradoras) não é julgada pela taxa", () => {
    const ins = gerarInsights({ ...base, compradoras: 3, taxaRecompra: 0 });
    expect(ins.some((i) => i.texto.includes("0% das clientes"))).toBe(false);
  });

  it("concentração VIP alta vira aviso de dependência", () => {
    const ins = gerarInsights({ ...base, concentracaoVip: 72, compradoras: 50 });
    expect(ins.some((i) => i.texto.includes("72%") && i.nivel === "ATENCAO")).toBe(true);
  });

  it("sem nada para alertar, o monitor DIZ que está tudo bem (nunca fica mudo)", () => {
    const ins = gerarInsights({
      ...base,
      taxaRecompra: 50,
      mesFaturamento: 0,
      mesRecompra: 0,
      mesPrimeiraCompra: 0,
      mesAnteriorRecompra: 0,
    });
    expect(ins).toHaveLength(1);
    expect(ins[0].nivel).toBe("BOA");
  });

  it("alertas vêm antes das boas notícias", () => {
    const ins = gerarInsights({
      ...base,
      passouDoPonto: 2,
      valorEmRisco: 100,
      recuperadoMes: 500,
      recuperadoVendas: 1,
    });
    const niveis = ins.map((i) => i.nivel);
    expect(niveis.indexOf("BOA")).toBeGreaterThan(niveis.indexOf("ALERTA"));
  });
});

describe("início do mês no calendário de São Paulo", () => {
  it("1º do mês às 03:00 UTC (meia-noite em SP)", () => {
    expect(inicioDoMesSP(new Date("2026-08-15T12:00:00Z")).toISOString()).toBe(
      "2026-08-01T03:00:00.000Z"
    );
  });

  it("madrugada UTC do dia 1º ainda é o mês anterior em SP", () => {
    // 01:00 UTC de 1º/ago = 22:00 de 31/jul em SP → o mês de SP é julho
    expect(inicioDoMesSP(new Date("2026-08-01T01:00:00Z")).toISOString()).toBe(
      "2026-07-01T03:00:00.000Z"
    );
  });

  it("mês anterior", () => {
    expect(inicioDoMesSP(new Date("2026-08-15T12:00:00Z"), 1).toISOString()).toBe(
      "2026-07-01T03:00:00.000Z"
    );
  });
});

describe("FONTE ÚNICA — o painel não faz conta própria", () => {
  const painel = readFileSync(join(process.cwd(), "src/lib/recompra-painel.ts"), "utf8");
  const rotaRec = readFileSync(join(process.cwd(), "src/app/api/recuperacao/route.ts"), "utf8");

  it("clientes/estágios/VIPs vêm da aba Recompra (dadosDaAbaRecompra)", () => {
    expect(painel).toContain("dadosDaAbaRecompra(user)");
  });

  it("o placar de recuperação é a MESMA função da tela Recuperação", () => {
    expect(painel).toContain("placarDeRecuperacao(user.companyId");
    expect(rotaRec).toContain("placarDeRecuperacao(user.companyId");
  });

  it("faturamento pela régua do Dashboard: netTotal + PAID + data de pagamento", () => {
    expect(painel).toContain("PAID_ORDER_STATUSES");
    expect(painel).toContain("netTotal");
    expect(painel).not.toMatch(/\bo\.total\b/);
  });

  it("a tela do painel declara as fontes e linka as telas irmãs", () => {
    const tela = readFileSync(
      join(process.cwd(), "src/app/(app)/recompra/painel/page.tsx"),
      "utf8"
    );
    expect(tela).toContain("painelDeRecompra(user)");
    expect(tela).toContain('href="/recompra"');
    expect(tela).toContain('href="/recuperacao"');
  });
});
