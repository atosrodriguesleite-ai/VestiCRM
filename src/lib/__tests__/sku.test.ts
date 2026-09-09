import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codigoDoModelo } from "../sku";

/**
 * O CÓDIGO DO MODELO NÃO É OBRIGATÓRIO (pedido do dono, 09/09/2026): o SKU
 * que importa é o de cada cor e tamanho, na grade. Em branco, o sistema cria
 * um pelo nome — a mesma régua da importação de catálogo.
 */
describe("codigoDoModelo", () => {
  it("nasce do nome, em maiúsculas, sem acento, sem espaço, até 10 letras", () => {
    expect(codigoDoModelo("Vestido Midi Alfaiataria")).toBe("VESTIDOMID");
    expect(codigoDoModelo("Calça Jeans")).toBe("CALCAJEANS");
    expect(codigoDoModelo("Baby Look")).toBe("BABYLOOK");
  });

  it("nome sem letra nem número vira PROD (nunca código vazio: a coluna não aceita)", () => {
    expect(codigoDoModelo("🎉🎉")).toBe("PROD");
    expect(codigoDoModelo("   ")).toBe("PROD");
  });
});

describe("a tela e a porta não exigem mais o código", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("o campo do novo produto não é obrigatório e diz que o SKU fica na grade", () => {
    const tela = ler("src/app/(app)/produtos/products-view.tsx");
    expect(tela).not.toMatch(/name="sku"\s+required/);
    expect(tela).toContain("O SKU de cada cor e tamanho");
  });

  it("a porta de criar aceita sem código e gera pelo nome; a de editar aceita trocar", () => {
    const criar = ler("src/app/api/products/route.ts");
    expect(criar).toMatch(/sku: z\.string\(\)\.trim\(\)\.max\(60\)\.optional\(\)/);
    expect(criar).toContain("codigoDoModeloDisponivel(user.companyId, resto.name)");
    const editar = ler("src/app/api/products/[id]/route.ts");
    expect(editar).toMatch(/sku: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(60\)\.optional\(\)/);
    expect(editar).toContain("Já existe um produto com este código");
  });

  it("a importação usa a mesma régua (um jeito só de inventar código)", () => {
    const imp = ler("src/lib/catalog-import.ts");
    expect(imp).toContain("codigoDoModelo(p.name)");
    expect(imp).not.toContain("slugify(p.name)");
  });
});
