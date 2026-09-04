import { describe, it, expect } from "vitest";
import { EMOJI_GROUPS, buscarEmojis } from "../emojis";

/**
 * A BARRA DE PESQUISA DO SELETOR DE EMOJI (pedido do dono, 03/09/2026):
 * a vendedora digita "coração" ou "caixa" e acha sem rolar a grade inteira.
 */
describe("buscarEmojis", () => {
  it("termo vazio devolve nulo (a grade inteira, por grupo)", () => {
    expect(buscarEmojis("")).toBeNull();
    expect(buscarEmojis("   ")).toBeNull();
  });

  it("acha pelo nome em português, ignorando acento e maiúscula", () => {
    expect(buscarEmojis("coração")).toContain("❤️");
    expect(buscarEmojis("CORACAO")).toContain("❤️");
    expect(buscarEmojis("feliz")).toContain("😀");
    expect(buscarEmojis("caixa")).toContain("📦");
    expect(buscarEmojis("dinheiro")).toContain("💰");
    expect(buscarEmojis("obrigada")).toContain("🙏");
    expect(buscarEmojis("vestido")).toEqual(["👗"]);
  });

  it("pedaço da palavra já acha ('cora' → corações)", () => {
    const r = buscarEmojis("cora")!;
    expect(r).toContain("❤️");
    expect(r).toContain("💜");
  });

  it("o nome do grupo também vale ('festa' acha a turma da festa)", () => {
    expect(buscarEmojis("festa")).toContain("🎉");
  });

  it("nada casou: lista vazia (a tela avisa), não a grade inteira", () => {
    expect(buscarEmojis("xyzxyz")).toEqual([]);
  });

  it("todo emoji da grade tem palavra para ser achado", () => {
    for (const g of EMOJI_GROUPS) {
      for (const e of g.emojis) {
        // pelo nome do próprio grupo já é achável; o que importa é que a
        // grade e a lista de palavras sejam a MESMA fonte
        expect(buscarEmojis(g.titulo)).toContain(e);
      }
    }
  });

  it("nenhum emoji repetido na grade (repetido some da busca e confunde a lista)", () => {
    const todos = EMOJI_GROUPS.flatMap((g) => g.emojis);
    expect(new Set(todos).size).toBe(todos.length);
  });
});
