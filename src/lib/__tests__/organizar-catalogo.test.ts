import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sugerirCategoria, sugerirEmLote } from "../organizar-catalogo";

/**
 * ORGANIZADOR DE CATÁLOGO (06/08/2026): loja nova com centenas de produtos
 * sem categoria. O motor lê o NOME da peça e sugere onde ela mora — a loja
 * revisa e confirma. Estes testes guardam as regras do motor.
 */

describe("sugerir categoria pelo nome da peça", () => {
  it("nomes comuns de moda caem na categoria certa", () => {
    expect(sugerirCategoria("Vestido Longo Amanda")).toBe("Vestidos");
    expect(sugerirCategoria("REGATA CANELADA")).toBe("Regatas");
    expect(sugerirCategoria("Calça pantalona alfaiataria")).toBe("Calças");
    expect(sugerirCategoria("Biquíni cortininha")).toBe("Biquínis");
    expect(sugerirCategoria("Saída de praia crochê")).toBe("Saídas de Praia");
  });

  it("a PRIMEIRA palavra do nome manda: 'Conjunto short e cropped' é Conjunto", () => {
    expect(sugerirCategoria("Conjunto short e cropped alfaiataria")).toBe(
      "Conjuntos"
    );
  });

  it("acento e caixa não atrapalham (macacão/MACACAO dão no mesmo)", () => {
    expect(sugerirCategoria("Macacão pantacourt")).toBe("Macacões");
    expect(sugerirCategoria("MACACAO PANTACOURT")).toBe("Macacões");
  });

  it("palavra dentro de outra NÃO engana: 'Topázio' não é Top", () => {
    expect(sugerirCategoria("Colar Topázio dourado")).toBe("Acessórios");
    expect(sugerirCategoria("Anel Topázio")).toBe(null);
  });

  it("nome sem palavra conhecida fica SEM sugestão (a loja decide)", () => {
    expect(sugerirCategoria("Peça Amanda 042")).toBe(null);
  });

  it("a grafia DA LOJA vence a canônica (nunca cria categoria gêmea)", () => {
    expect(sugerirCategoria("Vestido midi", ["VESTIDO", "Shorts"])).toBe(
      "VESTIDO"
    );
    expect(sugerirCategoria("Short jeans", ["VESTIDO", "Shorts"])).toBe(
      "Shorts"
    );
  });
});

describe("sugestão em lote (o que a tela mostra para revisar)", () => {
  it("só entra o que MUDARIA de verdade; singular/plural não conta como mudança", () => {
    const mudancas = sugerirEmLote(
      [
        { id: "1", name: "Vestido Amanda", category: "Vestido" }, // já está (singular)
        { id: "2", name: "Vestido Bela", category: "Geral" }, // muda
        { id: "3", name: "Peça 042", category: "Geral" }, // sem sugestão
      ],
      ["Vestidos", "Geral"]
    );
    expect(mudancas).toEqual([
      { id: "2", nome: "Vestido Bela", atual: "Geral", sugerida: "Vestidos" },
    ]);
  });
});

describe("aplicação em massa: segura e no lugar certo", () => {
  const api = readFileSync(
    join(process.cwd(), "src/app/api/products/organizar/route.ts"),
    "utf8"
  );

  it("a API exige gerência/suporte e nunca sai da própria loja", () => {
    expect(api).toContain("isManagerUp(user)");
    expect(api).toContain("companyId: user.companyId");
  });

  it("a tela tem o modo organizar e a prévia revisável", () => {
    const view = readFileSync(
      join(process.cwd(), "src/app/(app)/produtos/products-view.tsx"),
      "utf8"
    );
    expect(view).toContain("sugerirEmLote");
    expect(view).toContain("SugestoesModal");
    expect(view).toContain("canOrganize");
  });
});
