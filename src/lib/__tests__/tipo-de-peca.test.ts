import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIPO_SEM_DONO,
  agruparPorTipo,
  definirTipo,
  parseCategoryTypes,
  removerTipo,
  renomearTipo,
  tipoDaCategoria,
  tiposEmUso,
} from "../categories";

/**
 * TIPO DE PEÇA — o guarda-chuva das categorias no catálogo público.
 *
 * Pedido de uma cliente da Entre Linhas: "Blusas" agrupando Regata Alça, Baby
 * Look e Ombro Único; "Shorts" agrupando os shorts. No catálogo viram duas
 * barras — o tipo em cima, e embaixo só as categorias daquele tipo.
 *
 * O vínculo é da CATEGORIA, não da peça: a lojista diz uma vez "Regata Alça é
 * Blusas" e toda peça dessa categoria — inclusive as de amanhã — já nasce no
 * guarda-chuva certo.
 */

const MAPA = {
  "regata alca": "Blusas",
  "baby look": "Blusas",
  "ombro unico": "Blusas",
  "short alfaiataria": "Shorts",
};

describe("guardar e ler o tipo", () => {
  it("lê o tipo de uma categoria", () => {
    expect(tipoDaCategoria(MAPA, "Regata Alça")).toBe("Blusas");
  });

  it("acento e maiúscula não separam a categoria", () => {
    const m = definirTipo({}, "Regata Alça", "Blusas");
    expect(tipoDaCategoria(m, "REGATA ALCA")).toBe("Blusas");
    expect(tipoDaCategoria(m, "  regata alça ")).toBe("Blusas");
  });

  it("tipo vazio TIRA o guarda-chuva", () => {
    const m = definirTipo({ "baby look": "Blusas" }, "Baby Look", "  ");
    expect(tipoDaCategoria(m, "Baby Look")).toBe("");
  });

  it("categoria renomeada leva o tipo junto", () => {
    const m = renomearTipo(MAPA, "Baby Look", "Baby Look Premium");
    expect(tipoDaCategoria(m, "Baby Look Premium")).toBe("Blusas");
    expect(tipoDaCategoria(m, "Baby Look")).toBe("");
  });

  it("categoria apagada não deixa vínculo órfão", () => {
    expect(tipoDaCategoria(removerTipo(MAPA, "Baby Look"), "Baby Look")).toBe("");
  });

  it("JSON estragado nunca derruba o catálogo", () => {
    for (const lixo of ["", "{{{", "[1,2]", "42", null]) {
      expect(parseCategoryTypes(lixo as string)).toEqual({});
    }
  });
});

describe("trava contra guarda-chuva gêmeo", () => {
  it("digitar “blusas” quando já existe “Blusas” reaproveita a grafia certa", () => {
    // sem isso, um deslize de digitação criava dois guarda-chuvas quase iguais
    const m = definirTipo({ "regata alca": "Blusas" }, "Baby Look", "blusas");
    expect(tipoDaCategoria(m, "Baby Look")).toBe("Blusas");
    expect(tiposEmUso(m)).toEqual(["Blusas"]);
  });

  it("vale também com acento e espaço sobrando", () => {
    const m = definirTipo({ a: "Calças" }, "B", "  CALCAS ");
    expect(tipoDaCategoria(m, "B")).toBe("Calças");
    expect(tiposEmUso(m)).toEqual(["Calças"]);
  });

  it("tipo realmente novo entra como foi escrito", () => {
    const m = definirTipo({ a: "Blusas" }, "B", "Shorts");
    expect(tiposEmUso(m)).toEqual(["Blusas", "Shorts"]);
  });

  it("lista os tipos em uso sem repetir", () => {
    expect(tiposEmUso({ a: "Blusas", b: "Blusas", c: "Shorts" })).toEqual([
      "Blusas",
      "Shorts",
    ]);
  });
});

describe("a tela faz ESCOLHER, não digitar", () => {
  const tela = readFileSync(
    join(process.cwd(), "src/app/(app)/produtos/category-manager.tsx"),
    "utf8"
  );

  it("tipo já criado vira opção de lista", () => {
    expect(tela).toContain("tiposExistentes.map((t)");
    expect(tela).toContain("— Sem tipo —");
    expect(tela).toContain("➕ Criar novo tipo…");
  });

  it("digitar só no “criar novo”", () => {
    expect(tela).toContain("setCriandoTipo(true)");
    expect(tela).toContain("Nome do novo tipo");
    expect(tela).toContain("Escolher da lista");
  });
});

describe("agrupar em guarda-chuvas", () => {
  const CATS = ["Regata Alça", "Baby Look", "Short Alfaiataria", "Ombro Único"];

  it("agrupa mantendo a ordem das categorias", () => {
    // a ordem dos tipos sai da 1ª categoria de cada um — uma régua só
    expect(agruparPorTipo(CATS, MAPA)).toEqual([
      { tipo: "Blusas", categorias: ["Regata Alça", "Baby Look", "Ombro Único"] },
      { tipo: "Shorts", categorias: ["Short Alfaiataria"] },
    ]);
  });

  it("loja que NÃO usa o recurso continua exatamente como era", () => {
    // lista vazia = catálogo com uma barra só, sem novidade na tela
    expect(agruparPorTipo(CATS, {})).toEqual([]);
  });

  it("categoria sem guarda-chuva não some — cai em “Outros”, no fim", () => {
    const grupos = agruparPorTipo(["Baby Look", "Meias", "Short Alfaiataria"], MAPA);
    expect(grupos.map((g) => g.tipo)).toEqual(["Blusas", "Shorts", TIPO_SEM_DONO]);
    expect(grupos.at(-1)!.categorias).toEqual(["Meias"]);
  });

  it("“Blusas” e “blusas” são o mesmo guarda-chuva", () => {
    const grupos = agruparPorTipo(["A", "B"], { a: "Blusas", b: "blusas" });
    expect(grupos).toHaveLength(1);
    expect(grupos[0].categorias).toEqual(["A", "B"]);
  });
});

describe("as portas estão ligadas", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("o catálogo monta os grupos e acende o tipo pela rolagem", () => {
    const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    // os grupos saem da ordem CRUA das categorias; a ordem das seções sai
    // depois dos grupos (achatada), para a página seguir a barra — ver
    // `catalogo-secoes-por-tipo.test.ts`
    expect(cat).toContain("agruparPorTipo(categoriasBrutas, categoryTypes)");
    // o tipo ativo SAI da categoria ativa: sem observador novo, sem estado paralelo
    expect(cat).toContain("g.categorias.includes(categories[activeCat])");
    // a barra de baixo mostra só as categorias do tipo que está sendo visto
    expect(cat).toContain("categoriasVisiveis.map((cat)");
    // com um tipo só não vale a pena a barra extra
    expect(cat).toContain("grupos.length > 1 &&");
  });

  it("as duas páginas do catálogo passam os tipos", () => {
    for (const p of [
      "src/app/catalogo/[slug]/montar-catalogo.tsx",
      "src/app/catalogo/[slug]/c/[promo]/page.tsx",
    ]) {
      expect(ler(p)).toContain("categoryTypes={parseCategoryTypes(");
    }
  });

  it("a API grava, renomeia e apaga o tipo", () => {
    const api = ler("src/app/api/categories/route.ts");
    expect(api).toContain("type: tipoDaCategoria(tipos, name)");
    expect(api).toContain("definirTipo(tipos, to, parsed.data.type)");
    expect(api).toContain("renomearTipo(tipos, from, to)");
    expect(api).toContain("removerTipo(");
  });
});
