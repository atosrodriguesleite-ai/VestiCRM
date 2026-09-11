// Guarda RN-055
import { describe, it, expect } from "vitest";
import {
  ORIGEM_NACIONAL,
  avisoDePecasSemNcm,
  digitosDoNcm,
  ncmEfetivo,
  ncmParaNota,
  ncmValido,
  origemValida,
} from "../fiscal-ncm";

/**
 * RN-055 · O NCM mora aqui e vai na nota — o que dispensa a loja de manter um
 * segundo catálogo no Bling. Como é documento fiscal, a régua tem que ser
 * conservadora: número inválido nunca vira nota, e falta de número vira AVISO
 * antes de emitir, não recusa da SEFAZ depois.
 */

describe("o que é um NCM válido", () => {
  it("oito dígitos, com ou sem pontuação", () => {
    expect(ncmValido("6109.10.00")).toBe(true);
    expect(ncmValido("61091000")).toBe(true);
    expect(ncmValido(" 6109 10 00 ")).toBe(true);
  });

  it("sete ou nove dígitos NÃO passam — morreriam na SEFAZ", () => {
    expect(ncmValido("6109100")).toBe(false);
    expect(ncmValido("610910000")).toBe(false);
  });

  it("vazio e lixo não passam", () => {
    expect(ncmValido(null)).toBe(false);
    expect(ncmValido("")).toBe(false);
    expect(ncmValido("   ")).toBe(false);
    expect(ncmValido("abc")).toBe(false);
  });

  it("guarda só os dígitos", () => {
    expect(digitosDoNcm("6109.10.00")).toBe("61091000");
  });
});

describe("o formato que o Bling recebe", () => {
  it("sai com os pontos, como no exemplo da API", () => {
    expect(ncmParaNota("61091000")).toBe("6109.10.00");
    expect(ncmParaNota("6109.10.00")).toBe("6109.10.00");
  });

  it("número inválido NUNCA vira campo na nota", () => {
    expect(ncmParaNota("6109100")).toBeNull();
    expect(ncmParaNota(null)).toBeNull();
  });
});

describe("de qual degrau vem o NCM (peça > categoria > loja)", () => {
  it("a peça manda quando tem o dela", () => {
    expect(
      ncmEfetivo({ daPeca: "61091000", daCategoria: "62034200", daLoja: "61102000" })
    ).toEqual({ ncm: "61091000", de: "PECA" });
  });

  it("sem a peça, vale a categoria — é o caminho normal do atacado", () => {
    expect(ncmEfetivo({ daCategoria: "62034200", daLoja: "61102000" })).toEqual({
      ncm: "62034200",
      de: "CATEGORIA",
    });
  });

  it("sem categoria, vale o da loja — para quem vende um tipo só de peça", () => {
    expect(ncmEfetivo({ daLoja: "61102000" })).toEqual({
      ncm: "61102000",
      de: "LOJA",
    });
  });

  it("loja que não cadastrou NADA não manda campo (a nota sai como antes)", () => {
    expect(ncmEfetivo({})).toEqual({ ncm: null, de: "NENHUM" });
  });

  it("degrau com número INVÁLIDO é pulado, não derruba a conta", () => {
    // alguém digitou 7 dígitos na categoria; a peça tem o dela certo
    expect(ncmEfetivo({ daPeca: "61091000", daCategoria: "620342" })).toEqual({
      ncm: "61091000",
      de: "PECA",
    });
    // e o contrário: peça errada, categoria certa
    expect(ncmEfetivo({ daPeca: "610", daCategoria: "62034200" })).toEqual({
      ncm: "62034200",
      de: "CATEGORIA",
    });
  });
});

describe("origem da mercadoria", () => {
  it("o padrão é nacional (a confecção brasileira)", () => {
    expect(ORIGEM_NACIONAL).toBe(0);
    expect(origemValida(null)).toBe(0);
    expect(origemValida(undefined)).toBe(0);
  });

  it("aceita as origens da Receita (0 a 8) — quem revende importado tem outra", () => {
    expect(origemValida(1)).toBe(1);
    expect(origemValida(8)).toBe(8);
  });

  it("valor fora da tabela cai no nacional em vez de ir torto para a nota", () => {
    expect(origemValida(9)).toBe(0);
    expect(origemValida(-1)).toBe(0);
    expect(origemValida(1.5)).toBe(0);
  });
});

describe("o aviso ANTES de emitir (nota não se desfaz com um clique)", () => {
  it("sem peça faltando, não há aviso", () => {
    expect(avisoDePecasSemNcm([])).toBeNull();
  });

  it("diz quantas, quais, e manda cadastrar a CATEGORIA (não peça por peça)", () => {
    const aviso = avisoDePecasSemNcm([
      { nome: "Regata Quadrada", categoria: "Regatas" },
      { nome: "Baby Look", categoria: "Baby Look" },
    ])!;
    expect(aviso).toContain("2 peças sem NCM");
    expect(aviso).toContain("Regata Quadrada");
    expect(aviso).toContain('"Regatas"');
    expect(aviso).toContain("Configurações");
  });

  it("lista longa não vira parede de texto", () => {
    const muitas = Array.from({ length: 9 }, (_, i) => ({
      nome: `Peça ${i}`,
      categoria: "Regatas",
    }));
    const aviso = avisoDePecasSemNcm(muitas)!;
    expect(aviso).toContain("9 peças sem NCM");
    expect(aviso).toContain("e mais 6");
    expect(aviso).not.toContain("Peça 8");
  });

  it("categoria repetida aparece UMA vez (é ela que a loja vai cadastrar)", () => {
    const aviso = avisoDePecasSemNcm([
      { nome: "Regata A", categoria: "Regatas" },
      { nome: "Regata B", categoria: "Regatas" },
    ])!;
    expect(aviso.match(/Regatas/g)).toHaveLength(1);
    expect(aviso).toContain("a categoria");
  });
});
