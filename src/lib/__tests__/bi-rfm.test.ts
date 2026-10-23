import { describe, it, expect } from "vitest";
import {
  GRUPOS_RFM,
  IDS_DOS_GRUPOS,
  calcularRfm,
  grupoDaCelula,
  grupoDe,
  matrizDoRfm,
  mensagemDoGrupo,
  notaFv,
  notasPorPercentil,
  resumirRfm,
  type BaseDoRfm,
} from "../bi/rfm-regra";

// Guarda RN-093
/**
 * O RFM DO BI (pedido do dono, 22/10/2026): notas de 1 a 5 comparando com
 * a PRÓPRIA loja, Frequência e Valor nos últimos 12 meses, oito grupos.
 */
const AGORA = new Date("2026-10-23T15:00:00Z");
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000);
const cliente = (id: string, o: Partial<BaseDoRfm> & { dias: number }): BaseDoRfm => ({
  id,
  compras: o.compras ?? 2,
  ltv: o.ltv ?? 100,
  ultimaCompra: diasAtras(o.dias),
  compras12: o.compras12 ?? 1,
  valor12: o.valor12 ?? 100,
});

describe("notasPorPercentil: as notas são da própria loja, de 20 em 20%", () => {
  it("dez valores diferentes viram duas clientes em cada nota — pelos dois lados do empate", () => {
    const valores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(valores.map(notasPorPercentil(valores, "baixo"))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(valores.map(notasPorPercentil(valores, "alto"))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("frequência: o bloco empatado leva a nota do PÉ — 'comprou uma vez' não sobe por ser comum, e 2 compras não vale o mesmo que 10", () => {
    // o exemplo da revisão: 70 com 1 compra, 20 com 2, 10 com 3 ou mais
    const valores = [...Array(70).fill(1), ...Array(20).fill(2), 3, 3, 4, 4, 5, 6, 7, 8, 9, 10];
    const nota = notasPorPercentil(valores, "baixo");
    expect(nota(1)).toBe(1);
    expect(nota(2)).toBe(4);
    expect(nota(10)).toBe(5);
    // quem leva 5 é no máximo o topo de verdade (≤ 20%)
    expect(valores.filter((v) => nota(v) === 5).length).toBeLessThanOrEqual(20);
    // empate: a mesma nota para todas
    expect(new Set(valores.filter((v) => v === 1).map(nota)).size).toBe(1);
  });

  it("recência: o bloco empatado leva a nota do TOPO — quem comprou no mesmo dia é igualmente recente", () => {
    // a loja que vendeu para todas hoje não vê todas "Perdidas"
    const hoje = [0, 0, 0, 0, 0].map((d) => -d);
    expect(hoje.map(notasPorPercentil(hoje, "alto"))).toEqual([5, 5, 5, 5, 5]);
    expect(notasPorPercentil([-3], "alto")(-3)).toBe(5);
  });

  it("lista vazia não quebra, e a nota nunca sai de 1 a 5", () => {
    expect(notasPorPercentil([], "baixo")(1)).toBe(3);
    for (const empate of ["baixo", "alto"] as const) {
      const nota = notasPorPercentil([10, 20, 30], empate);
      for (const v of [-100, 0, 10, 15, 30, 1e9]) {
        expect(nota(v)).toBeGreaterThanOrEqual(1);
        expect(nota(v)).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe("grupoDe: recência × (frequência + valor), oito grupos", () => {
  it("toda combinação cai em exatamente um grupo, pela régua combinada com o dono", () => {
    const esperado: Record<number, string[]> = {
      // fv:   1            2            3            4           5
      5: ["PROMISSORAS", "PROMISSORAS", "PROMISSORAS", "CAMPEAS", "CAMPEAS"],
      4: ["PROMISSORAS", "PROMISSORAS", "PROMISSORAS", "CAMPEAS", "CAMPEAS"],
      3: ["ATENCAO", "ATENCAO", "ATENCAO", "FIEIS", "FIEIS"],
      2: ["HIBERNANDO", "HIBERNANDO", "HIBERNANDO", "NAO_PERDER", "NAO_PERDER"],
      1: ["PERDIDAS", "PERDIDAS", "PERDIDAS", "NAO_PERDER", "NAO_PERDER"],
    };
    for (let r = 1; r <= 5; r++)
      for (let fv = 1; fv <= 5; fv++) {
        expect(grupoDe(r, fv, 3)).toBe(esperado[r][fv - 1]);
        expect(grupoDaCelula(r, fv)).toBe(esperado[r][fv - 1]);
      }
  });

  it("primeira compra da vida, recente, é Novata — mesmo gastando muito", () => {
    expect(grupoDe(5, 5, 1)).toBe("NOVATAS");
    expect(grupoDe(4, 2, 1)).toBe("NOVATAS");
    // a primeira compra antiga não é novata
    expect(grupoDe(3, 2, 1)).toBe("ATENCAO");
    expect(grupoDe(1, 1, 1)).toBe("PERDIDAS");
  });

  it("F e V viram uma nota: a média com o meio para cima", () => {
    expect(notaFv(4, 3)).toBe(4);
    expect(notaFv(3, 2)).toBe(3);
    expect(notaFv(1, 1)).toBe(1);
    expect(notaFv(5, 5)).toBe(5);
  });

  it("os oito grupos têm nome, emoji, quem é e a ação — e nenhum se chama 'Em risco' (a faixa da Recompra)", () => {
    expect(IDS_DOS_GRUPOS).toHaveLength(8);
    for (const g of GRUPOS_RFM) {
      expect(g.rotulo && g.emoji && g.quem && g.acao).toBeTruthy();
      expect(g.rotulo.toLowerCase()).not.toContain("em risco");
    }
  });
});

describe("calcularRfm: quem não compra há 12 meses é Perdida, sem nota", () => {
  it("as notas comparam só quem comprou nos 12 meses", () => {
    const base = [
      cliente("recente", { dias: 2, compras12: 5, valor12: 2000, compras: 9 }),
      cliente("meio", { dias: 40, compras12: 2, valor12: 600 }),
      cliente("velha", { dias: 200, compras12: 1, valor12: 100 }),
      cliente("sumida", { dias: 500, compras12: 0, valor12: 0, compras: 6, ltv: 9000 }),
    ];
    const r = calcularRfm(base, AGORA);
    const por = new Map(r.map((c) => [c.id, c]));
    expect(por.get("sumida")).toMatchObject({ grupo: "PERDIDAS", r: null, f: null, v: null, fv: null, diasDesde: 500 });
    // três com nota: a mais recente tem a maior recência
    expect(por.get("recente")!.r).toBeGreaterThan(por.get("meio")!.r!);
    expect(por.get("meio")!.r).toBeGreaterThan(por.get("velha")!.r!);
    expect(por.get("recente")!.grupo).toBe("CAMPEAS");
  });

  it("valor com centavo quebrado e igual leva a mesma nota", () => {
    const r = calcularRfm(
      [cliente("a", { dias: 1, valor12: 100.004 }), cliente("b", { dias: 1, valor12: 100.0 }), cliente("c", { dias: 1, valor12: 50 })],
      AGORA
    );
    expect(r[0].v).toBe(r[1].v);
  });

  it("loja sem nenhuma cliente não quebra", () => {
    expect(calcularRfm([], AGORA)).toEqual([]);
    const resumo = resumirRfm([]);
    expect(resumo).toMatchObject({ clientes: 0, ativas: 0, valor12: 0, ltvMedio: null, poucas: false });
    for (const g of IDS_DOS_GRUPOS) expect(resumo.porGrupo[g]).toMatchObject({ clientes: 0, ltvMedio: null, pctReceita: null });
  });
});

describe("resumirRfm: as partes fecham o todo", () => {
  const base: BaseDoRfm[] = Array.from({ length: 37 }, (_, i) =>
    cliente(`c${i}`, {
      dias: (i * 17) % 420,
      compras: 1 + (i % 6),
      ltv: 100 + i * 33.33,
      compras12: (i * 17) % 420 > 365 ? 0 : 1 + (i % 4),
      valor12: (i * 17) % 420 > 365 ? 0 : 50 + i * 11.11,
    })
  );
  const clientes = calcularRfm(base, AGORA);
  const resumo = resumirRfm(clientes);

  it("a soma das clientes e das porcentagens dos grupos fecha", () => {
    const grupos = IDS_DOS_GRUPOS.map((g) => resumo.porGrupo[g]);
    expect(grupos.reduce((s, g) => s + g.clientes, 0)).toBe(37);
    expect(grupos.reduce((s, g) => s + g.pctClientes, 0)).toBe(100);
    expect(grupos.reduce((s, g) => s + (g.pctReceita ?? 0), 0)).toBe(100);
  });

  it("o vendido nos 12 meses é a soma exata dos grupos (o centavo fecha) e bate com a soma das clientes", () => {
    const somaGrupos = IDS_DOS_GRUPOS.reduce((s, g) => s + Math.round(resumo.porGrupo[g].valor12 * 100), 0);
    const somaClientes = clientes.reduce((s, c) => s + Math.round(c.valor12 * 100), 0);
    expect(Math.round(resumo.valor12 * 100)).toBe(somaGrupos);
    expect(somaGrupos).toBe(somaClientes);
  });

  it("LTV médio do grupo = vendido na vida ÷ clientes", () => {
    for (const g of IDS_DOS_GRUPOS) {
      const r = resumo.porGrupo[g];
      if (r.clientes) expect(r.ltvMedio).toBeCloseTo(r.totalVida / r.clientes, 2);
    }
  });

  it("a matriz conta só quem tem nota, e cada célula bate com o grupo dela (fora as novatas)", () => {
    const m = matrizDoRfm(clientes);
    const soma = m.flat().reduce((s, n) => s + n, 0);
    expect(soma).toBe(resumo.ativas);
    for (const c of clientes)
      if (c.r != null && c.fv != null && c.grupo !== "NOVATAS") expect(grupoDaCelula(c.r, c.fv)).toBe(c.grupo);
  });

  it("avisa quando há poucas clientes com nota", () => {
    expect(resumirRfm(calcularRfm(base.slice(0, 5), AGORA)).poucas).toBe(true);
    expect(resumo.poucas).toBe(resumo.ativas < 20);
  });
});

describe("mensagemDoGrupo: a mensagem pronta de cada grupo", () => {
  it("saúda pelo primeiro nome e leva o link do catálogo, em todos os grupos", () => {
    for (const g of IDS_DOS_GRUPOS) {
      const m = mensagemDoGrupo(g, "  Maria   Clara ", "https://catalago.net/loja");
      expect(m.startsWith("Oi Maria!")).toBe(true);
      expect(m).toContain("https://catalago.net/loja");
    }
  });

  it("nunca diz 'Oi Contato!' para o crachá provisório", () => {
    const m = mensagemDoGrupo("NAO_PERDER", "Contato (82) 99999-0000", "x");
    expect(m.startsWith("Oi!")).toBe(true);
    expect(m).not.toContain("Contato");
  });

  it("cada grupo tem a SUA mensagem", () => {
    const textos = new Set(IDS_DOS_GRUPOS.map((g) => mensagemDoGrupo(g, "Ana", "L")));
    expect(textos.size).toBe(8);
  });
});
