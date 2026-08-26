import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fimDoDiaSP,
  inicioDoDiaSP,
  lerPeriodo,
  paramsDoPeriodo,
  periodoPorExtenso,
} from "../periodo";

/**
 * FILTRO DE PERÍODO PERSONALIZADO na Inteligência Comercial.
 *
 * Os atalhos ("30 dias", "1 ano") não respondem o que a lojista pergunta de
 * verdade: "quanto vendi na Black Friday?", "como fechou o mês passado?".
 */

describe("dia inteiro no horário do Brasil", () => {
  it("começa à meia-noite de São Paulo (03:00 em UTC)", () => {
    expect(inicioDoDiaSP("2026-07-01")?.toISOString()).toBe("2026-07-01T03:00:00.000Z");
  });

  it("termina às 23:59 de São Paulo — o último dia entra INTEIRO", () => {
    // sem isso, as vendas do fim da noite do último dia sumiam do relatório
    expect(fimDoDiaSP("2026-07-31")?.toISOString()).toBe("2026-08-01T02:59:59.999Z");
  });

  it("data vazia ou torta não vira período", () => {
    for (const v of ["", "  ", "31/07/2026", "abc", null, undefined]) {
      expect(inicioDoDiaSP(v)).toBeNull();
      expect(fimDoDiaSP(v)).toBeNull();
    }
  });
});

describe("sem datas: continua nos atalhos", () => {
  it("o padrão é 30 dias", () => {
    const f = lerPeriodo({});
    expect(f.dias).toBe(30);
    expect(f.personalizado).toBe(false);
  });

  it.each([1, 7, 30, 90, 365])("aceita o atalho de %s dias", (d) => {
    expect(lerPeriodo({ dias: String(d) }).dias).toBe(d);
  });

  it("atalho inventado cai no padrão (ninguém consegue forçar 9999 dias)", () => {
    expect(lerPeriodo({ dias: "9999" }).dias).toBe(30);
    expect(lerPeriodo({ dias: "abc" }).dias).toBe(30);
  });
});

describe("com datas: manda o que a lojista escolheu", () => {
  it("de + até vira o período exato", () => {
    const f = lerPeriodo({ de: "2026-07-01", ate: "2026-07-31" });
    expect(f.personalizado).toBe(true);
    expect(f.dias).toBeNull();
    expect(f.period.from.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(f.period.to.toISOString()).toBe("2026-08-01T02:59:59.999Z");
  });

  it("só o 'de': daquele dia até agora", () => {
    const f = lerPeriodo({ de: "2026-07-01" });
    expect(f.personalizado).toBe(true);
    expect(f.period.from.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(f.period.to.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("só o 'até': tudo até aquele dia", () => {
    const f = lerPeriodo({ ate: "2026-07-31" });
    expect(f.personalizado).toBe(true);
    expect(f.period.from.getTime()).toBe(0);
    expect(f.period.to.toISOString()).toBe("2026-08-01T02:59:59.999Z");
  });

  it("datas trocadas são INVERTIDAS, não viram relatório vazio", () => {
    const f = lerPeriodo({ de: "2026-07-31", ate: "2026-07-01" });
    expect(f.period.from.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(f.period.to.toISOString()).toBe("2026-08-01T02:59:59.999Z");
    expect(f.de).toBe("2026-07-01");
    expect(f.ate).toBe("2026-07-31");
  });

  it("a data escolhida vence o atalho que estava na URL", () => {
    expect(lerPeriodo({ dias: "7", de: "2026-07-01" }).personalizado).toBe(true);
  });

  it("data torta não sequestra o filtro (cai no atalho)", () => {
    const f = lerPeriodo({ dias: "7", de: "31/07/2026" });
    expect(f.personalizado).toBe(false);
    expect(f.dias).toBe(7);
  });
});

describe("o período viaja junto nos links", () => {
  it("atalho vira dias=", () => {
    expect(paramsDoPeriodo(lerPeriodo({ dias: "90" }))).toBe("dias=90");
  });

  it("personalizado leva as datas (a planilha sai do MESMO recorte da tela)", () => {
    expect(paramsDoPeriodo(lerPeriodo({ de: "2026-07-01", ate: "2026-07-31" }))).toBe(
      "de=2026-07-01&ate=2026-07-31"
    );
    expect(paramsDoPeriodo(lerPeriodo({ de: "2026-07-01" }))).toBe("de=2026-07-01");
  });

  it("escreve o período por extenso para a tela", () => {
    expect(periodoPorExtenso(lerPeriodo({ de: "2026-07-01", ate: "2026-07-31" }))).toBe(
      "01/07/2026 a 31/07/2026"
    );
    expect(periodoPorExtenso(lerPeriodo({ de: "2026-07-01" }))).toBe("01/07/2026 a hoje");
    expect(periodoPorExtenso(lerPeriodo({ dias: "30" }))).toBe("");
  });
});

describe("a tela e a exportação usam a mesma leitura", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("a Inteligência tem os campos De e Até", () => {
    const tela = ler("src/app/(app)/inteligencia/page.tsx");
    expect(tela).toContain("lerPeriodo(sp)");
    expect(tela).toContain('name="de"');
    expect(tela).toContain('name="ate"');
  });

  it("a exportação sai do mesmo recorte (não fixa em dias)", () => {
    const rota = ler("src/app/api/intelligence/export/route.ts");
    expect(rota).toContain("lerPeriodo({");
    expect(rota).not.toContain("periodFromDays(");
  });

  it("a lista de recuperação não é mais cortada em 12 na origem", () => {
    const insights = ler("src/lib/tracking/insights.ts");
    expect(insights).not.toContain("out.slice(0, 12)");
    expect(insights).toContain("LIMITE_RECUPERACAO");
    // e a sacola vem GRAVADA no carrinho da esteira (nenhuma consulta por
    // carrinho — uma por carrinho derrubaria a tela; decisão de 26/08/2026)
    expect(insights).toContain("lerItens(cart.items)");
  });

  it("dá para abrir TODOS os carrinhos abandonados", () => {
    const tela = ler("src/app/(app)/inteligencia/page.tsx");
    expect(tela).toContain('sp.recuperacao === "tudo"');
    expect(tela).toContain("Ver todas as ${recuperacao.length} oportunidades");
    // e o cartão do KPI leva direto para a lista
    expect(tela).toContain("recuperacao=tudo#recuperar");
  });
});
