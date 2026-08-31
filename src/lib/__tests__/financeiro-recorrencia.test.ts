// Guarda RN-029, RN-030
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  HORIZONTE_MESES,
  TETO_POR_RODADA,
  mesDe,
  mesesAMaterializar,
  proximoMes,
  somarMeses,
  vencimentoDoMes,
} from "../financeiro/recorrencia";
import { dataDoDia, diaSP } from "../financeiro/lancamentos";

/**
 * RN-029 · Contas fixas: o sistema lança sozinho os próximos meses, de carona
 * no tráfego (nunca num cron novo, ADR-002), sem duplicar e sem reescrever o
 * passado.
 * RN-030 · Transferência entre contas próprias não é receita nem despesa, tem
 * DUAS datas, e o saldo é sempre SOMADO (nunca digitado).
 */

const molde = (over: Partial<Parameters<typeof mesesAMaterializar>[0]> = {}) => ({
  inicio: dataDoDia("2026-09-01")!,
  fim: null,
  ativa: true,
  geradoAte: null,
  ...over,
});

describe("contas de mês (RN-029)", () => {
  it("anda para frente e para trás atravessando o ano", () => {
    expect(proximoMes("2026-12")).toBe("2027-01");
    expect(somarMeses("2026-09", 3)).toBe("2026-12");
    expect(somarMeses("2026-09", 4)).toBe("2027-01");
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("2026-09", 0)).toBe("2026-09");
  });

  it("o mês sai no fuso de São Paulo", () => {
    // 01/10 00:30 UTC ainda é 30/09 em São Paulo — e setembro é o mês certo
    expect(mesDe(new Date("2026-10-01T00:30:00.000Z"))).toBe("2026-09");
  });
});

describe("vencimento do mês respeita mês curto (RN-029)", () => {
  it("dia 31 em fevereiro cai no último dia, sem vazar para março", () => {
    expect(diaSP(vencimentoDoMes("2026-02", 31))).toBe("2026-02-28");
    expect(diaSP(vencimentoDoMes("2028-02", 31))).toBe("2028-02-29"); // bissexto
    expect(diaSP(vencimentoDoMes("2026-04", 31))).toBe("2026-04-30");
  });

  it("dia normal fica no dia escolhido", () => {
    expect(diaSP(vencimentoDoMes("2026-09", 5))).toBe("2026-09-05");
  });
});

describe("quais meses materializar (RN-029)", () => {
  it("conta fixa nova gera o mês atual + o horizonte", () => {
    const meses = mesesAMaterializar(molde(), "2026-09");
    expect(meses).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(meses.length).toBe(HORIZONTE_MESES + 1);
  });

  it("não repete o que já foi gerado", () => {
    expect(mesesAMaterializar(molde({ geradoAte: "2026-11" }), "2026-09")).toEqual([
      "2026-12",
    ]);
    expect(mesesAMaterializar(molde({ geradoAte: "2026-12" }), "2026-09")).toEqual([]);
  });

  it("respeita o fim combinado", () => {
    const meses = mesesAMaterializar(
      molde({ fim: dataDoDia("2026-10-01")! }),
      "2026-09"
    );
    expect(meses).toEqual(["2026-09", "2026-10"]);
  });

  it("conta fixa ENCERRADA não gera nada", () => {
    expect(mesesAMaterializar(molde({ ativa: false }), "2026-09")).toEqual([]);
  });

  it("nunca gera antes do início combinado", () => {
    const meses = mesesAMaterializar(
      molde({ inicio: dataDoDia("2026-11-01")! }),
      "2026-09"
    );
    expect(meses).toEqual(["2026-11", "2026-12"]);
  });

  it("conta fixa que começou anos atrás não trava a tela (teto por rodada)", () => {
    const meses = mesesAMaterializar(
      molde({ inicio: dataDoDia("2015-01-01")! }),
      "2026-09"
    );
    expect(meses.length).toBe(TETO_POR_RODADA);
    expect(meses[0]).toBe("2015-01");
  });

  it("rodar de novo depois de gerar até o horizonte não faz nada", () => {
    const primeira = mesesAMaterializar(molde(), "2026-09");
    const segunda = mesesAMaterializar(
      molde({ geradoAte: primeira[primeira.length - 1] }),
      "2026-09"
    );
    expect(segunda).toEqual([]);
  });
});

describe("as regras que não podem sumir do código (RN-029, RN-030)", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("a materialização NÃO vira cron (ADR-002: um 3º cron trava os deploys)", () => {
    const vercel = JSON.parse(ler("vercel.json")) as {
      crons?: { path: string; schedule: string }[];
    };
    const crons = vercel.crons ?? [];
    expect(crons.length).toBeLessThanOrEqual(2);
    expect(crons.some((c) => /recorrencia|financeiro/i.test(c.path))).toBe(false);
  });

  it("a conta fixa roda de carona ao abrir as telas do financeiro", () => {
    expect(ler("src/app/(app)/financeiro/_mov/pagina.tsx")).toContain(
      "garantirRecorrencias"
    );
    expect(ler("src/app/(app)/financeiro/extrato/page.tsx")).toContain(
      "garantirRecorrencias"
    );
  });

  it("o lançamento gerado é único por (conta fixa, mês) — nunca dois aluguéis", () => {
    const schema = ler("prisma/schema.prisma");
    expect(schema).toContain("@@unique([recorrenciaId, recorrenciaMes])");
  });

  it("transferência não vira receita nem despesa: não existe lançamento nela", () => {
    const rota = ler("src/app/api/financeiro/transferencias/route.ts");
    expect(rota).not.toContain("finLancamento");
    // e as duas contas são conferidas contra a loja (RN-013)
    expect(rota).toContain("companyId: porta.user.companyId");
  });

  it("nenhuma rota nova do módulo apaga dinheiro (só o anexo)", () => {
    const raiz = join(process.cwd(), "src/app/api/financeiro");
    const varrer = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? varrer(p) : f === "route.ts" ? [p] : [];
      });
    for (const rota of varrer(raiz)) {
      if (rota.includes("/anexos/")) continue;
      expect(
        /export\s+(async\s+)?function\s+DELETE/.test(readFileSync(rota, "utf8")),
        `${rota} exporta DELETE`
      ).toBe(false);
    }
  });

  it("o saldo é somado, nunca guardado: não existe campo saldoAtual no banco", () => {
    const schema = ler("prisma/schema.prisma");
    expect(schema).not.toMatch(/saldoAtual\s+Float/);
    expect(schema).toContain("saldoInicial");
  });
});

describe("as correções da revisão de 31/08/2026 (RN-029, RN-030)", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("editar/encerrar conta fixa NUNCA apaga lançamento com anexo", () => {
    // o boleto que a lojista guardou ali não pode sumir numa cascata
    expect(ler("src/lib/financeiro/recorrencia.ts")).toContain("anexos: { none: {} }");
  });

  it("reativar recua o relógio, senão os meses apagados nunca voltam", () => {
    const rota = ler("src/app/api/financeiro/recorrencias/[id]/route.ts");
    expect(rota).toContain("parsed.data.ativa ? { geradoAte: somarMeses(mesDe(new Date()), -1) }");
  });

  it("a carona não derruba a tela: falha de conta fixa é registrada, não propagada", () => {
    const motor = ler("src/lib/financeiro/recorrencia.ts");
    expect(motor).toContain("[contas fixas] falhou ao materializar");
  });

  it("o saldo é somado NO BANCO (agregação), não trazendo a história para a memória", () => {
    const extrato = ler("src/lib/financeiro/extrato.ts");
    expect(extrato).toContain("db.finBaixa.aggregate");
    expect(extrato).toContain("db.finConta.aggregate");
  });
});
