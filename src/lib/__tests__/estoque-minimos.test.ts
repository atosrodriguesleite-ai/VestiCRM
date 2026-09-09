// Guarda RN-051
import { describe, it, expect } from "vitest";
import { minimoEfetivo, minimoValido, noMinimo, TETO_DO_MINIMO } from "../estoque/minimos";
import { decidirAlertas, PECAS_NO_AVISO, textoDoAlerta } from "../estoque/alerta";

/**
 * MÍNIMO POR PEÇA, CATEGORIA E LOJA, COM ALERTA SEM SPAM (RN-051).
 *
 * Pedido do dono (09/09/2026): "um alerta para cada peça ou categoria
 * dizendo qual é o mínimo que posso ter daquele produto".
 */

describe("qual mínimo vale para a peça", () => {
  it("o mais específico vence: peça > categoria > loja", () => {
    expect(minimoEfetivo({ peca: 3, categoria: 2, loja: 5 })).toEqual({ valor: 3, origem: "PECA" });
    expect(minimoEfetivo({ peca: null, categoria: 2, loja: 5 })).toEqual({ valor: 2, origem: "CATEGORIA" });
    expect(minimoEfetivo({ peca: null, categoria: undefined, loja: 5 })).toEqual({ valor: 5, origem: "LOJA" });
  });

  it("zero é mínimo válido (é diferente de 'sem mínimo'): peça com 0 só avisa zerada", () => {
    expect(minimoEfetivo({ peca: 0, categoria: 4, loja: 5 })).toEqual({ valor: 0, origem: "PECA" });
    expect(noMinimo(0, 0)).toBe(true);
    expect(noMinimo(1, 0)).toBe(false);
  });

  it("a régua é a de sempre: CHEGOU ao mínimo (disponível ≤ mínimo)", () => {
    expect(noMinimo(5, 5)).toBe(true);
    expect(noMinimo(6, 5)).toBe(false);
    expect(noMinimo(0, 5)).toBe(true);
  });

  it("mínimo válido: inteiro, zero ou mais, com teto", () => {
    expect(minimoValido(0)).toBe(true);
    expect(minimoValido(12)).toBe(true);
    expect(minimoValido(-1)).toBe(false);
    expect(minimoValido(2.5)).toBe(false);
    expect(minimoValido(TETO_DO_MINIMO + 1)).toBe(false);
    expect(minimoValido("3")).toBe(false);
  });
});

describe("o alerta avisa uma vez e só volta depois da recuperação", () => {
  const l = (variantId: string, disponivel: number, minimo = 5, ativo = true) => ({
    variantId,
    disponivel,
    minimo,
    ativo,
  });

  it("peça que chegou ao mínimo sem carimbo → avisar; com carimbo → silêncio", () => {
    const d = decidirAlertas([l("a", 3), l("b", 3)], new Set(["b"]));
    expect(d.avisar).toEqual(["a"]);
    expect(d.limpar).toEqual([]);
  });

  it("peça carimbada que voltou acima do mínimo → limpar (a próxima queda avisa de novo)", () => {
    const d = decidirAlertas([l("a", 9)], new Set(["a"]));
    expect(d).toEqual({ avisar: [], limpar: ["a"] });
  });

  it("produto INATIVO não avisa e solta o carimbo (não está à venda)", () => {
    const d = decidirAlertas([l("a", 1, 5, false), l("b", 1, 5, false)], new Set(["b"]));
    expect(d).toEqual({ avisar: [], limpar: ["b"] });
  });

  it("cada peça é julgada pelo SEU mínimo", () => {
    const d = decidirAlertas([l("a", 6, 5), l("b", 6, 8)], new Set());
    expect(d.avisar).toEqual(["b"]);
  });

  it("o aviso é UM resumo: conta, as primeiras pelo nome e 'e mais N'", () => {
    const pecas = Array.from({ length: PECAS_NO_AVISO + 3 }, (_, i) => ({
      produto: `Peça ${i}`,
      cor: "Azul",
      tamanho: "M",
      disponivel: i,
      minimo: 5,
    }));
    const t = textoDoAlerta(pecas);
    expect(t.title).toBe(`⚠️ ${PECAS_NO_AVISO + 3} peças chegaram ao mínimo`);
    expect(t.body).toContain("Peça 0 Azul M (0/5)");
    expect(t.body).toContain("e mais 3");
    expect(t.body).not.toContain(`Peça ${PECAS_NO_AVISO}`);
    expect(textoDoAlerta([pecas[0]]).title).toBe("⚠️ 1 peça chegou ao mínimo");
    expect(textoDoAlerta([pecas[0]]).body).not.toContain("e mais");
  });
});
