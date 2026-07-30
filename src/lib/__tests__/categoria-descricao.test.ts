import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIMITE_DESCRICAO,
  definirDescricao,
  descricaoDaCategoria,
  parseCategoryDescriptions,
  removerDescricao,
  renomearDescricao,
} from "../categories";

/**
 * DESCRIÇÃO DA CATEGORIA no catálogo público.
 *
 * Antes o catálogo mostrava a descrição do PRIMEIRO produto da seção. Dois
 * problemas: o texto mudava sozinho quando a ordem dos produtos mudava, e a
 * sincronização da Nuvemshop (que sobrescreve a descrição do produto) trocava
 * o texto da seção inteira sem ninguém pedir. Agora o texto é da CATEGORIA.
 */

const TEXTO = "Poliamida Premium · 100% Forrada · Zero transparência · P ao GG";

describe("guardar e ler", () => {
  it("lê o texto de uma categoria", () => {
    const mapa = parseCategoryDescriptions(JSON.stringify({ "regata alca": TEXTO }));
    expect(descricaoDaCategoria(mapa, "Regata Alça")).toBe(TEXTO);
  });

  it("acento e maiúscula não separam a categoria", () => {
    const mapa = definirDescricao({}, "Regata Alça", TEXTO);
    expect(descricaoDaCategoria(mapa, "REGATA ALCA")).toBe(TEXTO);
    expect(descricaoDaCategoria(mapa, "  regata alça  ")).toBe(TEXTO);
  });

  it("categoria sem texto devolve vazio (o catálogo cai no antigo)", () => {
    expect(descricaoDaCategoria({}, "Baby Look")).toBe("");
  });

  it("texto vazio APAGA (é como a lojista tira a descrição)", () => {
    const mapa = definirDescricao({ "baby look": TEXTO }, "Baby Look", "   ");
    expect(descricaoDaCategoria(mapa, "Baby Look")).toBe("");
    expect(Object.keys(mapa)).toHaveLength(0);
  });

  it("corta no limite (não deixa estourar o cabeçalho do catálogo)", () => {
    const mapa = definirDescricao({}, "X", "a".repeat(500));
    expect(descricaoDaCategoria(mapa, "X")).toHaveLength(LIMITE_DESCRICAO);
  });

  it("não mexe no mapa original (nada de efeito colateral)", () => {
    const antes = { "baby look": TEXTO };
    definirDescricao(antes, "Outra", "nova");
    expect(Object.keys(antes)).toEqual(["baby look"]);
  });
});

describe("JSON estragado nunca derruba o catálogo", () => {
  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["lixo", "{{{"],
    ["array", "[1,2,3]"],
    ["número", "42"],
  ])("%s vira mapa vazio", (_nome, json) => {
    expect(parseCategoryDescriptions(json as string)).toEqual({});
  });

  it("ignora valores que não são texto", () => {
    const mapa = parseCategoryDescriptions(
      JSON.stringify({ a: 10, b: null, c: { x: 1 }, d: "vale" })
    );
    expect(mapa).toEqual({ d: "vale" });
  });
});

describe("renomear e apagar categoria", () => {
  it("renomear leva a descrição junto (senão ela sumia)", () => {
    const mapa = renomearDescricao({ "regata alca": TEXTO }, "Regata Alça", "Regata Alcinha");
    expect(descricaoDaCategoria(mapa, "Regata Alcinha")).toBe(TEXTO);
    expect(descricaoDaCategoria(mapa, "Regata Alça")).toBe("");
  });

  it("renomear categoria sem descrição não inventa texto", () => {
    expect(renomearDescricao({}, "A", "B")).toEqual({});
  });

  it("apagar não deixa texto órfão no banco", () => {
    expect(removerDescricao({ "baby look": TEXTO }, "Baby Look")).toEqual({});
  });
});

describe("as portas estão ligadas", () => {
  const raiz = process.cwd();
  const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

  it("o catálogo usa o texto da categoria e só depois cai no produto", () => {
    const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(cat).toContain("descricaoDaCategoria(categoryDescriptions, cat)");
    // o comportamento antigo continua como plano B
    expect(cat).toContain("cards[0]?.product.description");
  });

  it("as duas páginas do catálogo passam as descrições", () => {
    for (const p of [
      "src/app/catalogo/[slug]/page.tsx",
      "src/app/catalogo/[slug]/c/[promo]/page.tsx",
    ]) {
      expect(ler(p)).toContain("categoryDescriptions={parseCategoryDescriptions(");
    }
  });

  it("a API devolve, grava, renomeia e apaga a descrição", () => {
    const api = ler("src/app/api/categories/route.ts");
    expect(api).toContain("description: descricaoDaCategoria(descricoes, name)");
    expect(api).toContain("definirDescricao(descricoes, to, parsed.data.description)");
    expect(api).toContain("renomearDescricao(descricoes, from, to)");
    expect(api).toContain("removerDescricao(");
  });

  it("só gerente/admin/suporte mexem (a porta continua fechada)", () => {
    expect(ler("src/app/api/categories/route.ts")).toContain(
      "isManagerUp(user) || isSupport(user)"
    );
  });
});
