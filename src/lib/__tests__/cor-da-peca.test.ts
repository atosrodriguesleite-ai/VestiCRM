import { describe, it, expect } from "vitest";
import { acharVariacao, corOuUnica, SEM_COR } from "../cor-da-peca";
import { limitarSacola } from "../catalogo/teto-do-estoque";

// Guarda RN-078 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * PEÇA SEM COR SE CHAMA "Único". A Jueri gravava cor VAZIA e a porta do
 * pedido do catálogo recusava o pedido inteiro como "dados inválidos" — a
 * mensagem chegava no WhatsApp e o pedido não entrava (Sutilli, 09/10/2026).
 * A prova pela rota de verdade contra o banco (o código antigo responde 400,
 * o novo 201; a migração atravessa as colisões; a sync grava e cura "Único")
 * está em scripts/e2e-pedido-catalogo-sem-cores.ts (6 e 7) e
 * scripts/e2e-jueri-sync.ts (2d).
 */
describe("corOuUnica", () => {
  it("cor vazia, só espaço, espaço invisível, nula ou ausente é \"Único\"", () => {
    expect(SEM_COR).toBe("Único");
    for (const c of ["", "   ", " ", "\t", null, undefined]) expect(corOuUnica(c)).toBe("Único");
  });
  it("cor de verdade passa como está (só sem as pontas)", () => {
    expect(corOuUnica("Dourado")).toBe("Dourado");
    expect(corOuUnica(" Prata ")).toBe("Prata");
  });
});

describe("acharVariacao — a porta do pedido do catálogo", () => {
  const unica = { id: "u", color: "Único", size: "Único" };
  const vazia = { id: "v", color: "", size: "Único" };
  it("o pedido antigo da fila (cor vazia) casa com a peça renomeada para \"Único\"", () => {
    expect(acharVariacao([unica], "", "Único")?.id).toBe("u");
    expect(acharVariacao([unica], "  ", "Único")?.id).toBe("u");
  });
  it("e o contrário: pedido \"Único\" casa com a peça que ainda está vazia", () => {
    expect(acharVariacao([vazia], "Único", "Único")?.id).toBe("v");
  });
  it("com as duas na mesma peça, o EXATO decide — nunca a ordem de leitura", () => {
    expect(acharVariacao([unica, vazia], "", "Único")?.id).toBe("v");
    expect(acharVariacao([vazia, unica], "Único", "Único")?.id).toBe("u");
  });
  it("o tamanho continua exigido, e cor de verdade não ganha ponte nenhuma", () => {
    expect(acharVariacao([unica], "", "M")).toBeUndefined();
    const pretos = [
      { id: "p1", color: "Preto ", size: "M" },
      { id: "p2", color: "Preto", size: "M" },
    ];
    expect(acharVariacao(pretos, "Preto", "M")?.id).toBe("p2");
    expect(acharVariacao([{ id: "p", color: "Preto", size: "M" }], "", "M")).toBeUndefined();
    expect(acharVariacao([{ id: "p", color: "Preto", size: "M" }], "Branco", "M")).toBeUndefined();
  });
});

describe("a sacola guardada no aparelho não perde a peça sem cor", () => {
  const vitrine: Record<string, Record<string, number>> = { "p1|Único": { "Único": 4 } };
  const disponivelDe = (chave: string, t: string) => vitrine[chave]?.[t];
  it("a chave antiga \"produto|\" volta como \"produto|Único\", no teto de hoje", () => {
    const { sacola, ajustou } = limitarSacola({ "p1|": { "Único": 6 } }, disponivelDe);
    expect(sacola).toEqual({ "p1|Único": { "Único": 4 } });
    expect(ajustou).toBe(true);
  });
  it("chave que ainda existe do jeito que está não é tocada", () => {
    const { sacola } = limitarSacola({ "p2|": { "Único": 1 } }, (c, t) => (c === "p2|" && t === "Único" ? 3 : undefined));
    expect(sacola).toEqual({ "p2|": { "Único": 1 } });
  });
});
