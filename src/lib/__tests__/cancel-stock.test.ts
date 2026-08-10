import { describe, it, expect } from "vitest";
import { resolveCancelStock, resolveReopenStock } from "../orders";

describe("cancelamento — o que fazer com o estoque", () => {
  it("sem resposta do vendedor, devolve (comportamento histórico)", () => {
    expect(resolveCancelStock(true, undefined)).toBe("DEVOLVER");
  });

  it("vendedor marcou sim: devolve", () => {
    expect(resolveCancelStock(true, true)).toBe("DEVOLVER");
  });

  it("vendedor marcou não: baixa definitiva", () => {
    expect(resolveCancelStock(true, false)).toBe("BAIXAR");
  });

  it("pedido sem estoque seguro: nada a decidir", () => {
    expect(resolveCancelStock(false, false)).toBe("NADA");
    expect(resolveCancelStock(false, true)).toBe("NADA");
    expect(resolveCancelStock(false, undefined)).toBe("NADA");
  });
});

describe("reabertura de pedido cancelado — estoque", () => {
  it("cancelado com devolução: reabrir desconta de novo (peças estavam no catálogo)", () => {
    expect(resolveReopenStock(false, false)).toBe("DESCONTAR");
  });

  it("cancelado com baixa definitiva: reabrir NÃO desconta de novo", () => {
    expect(resolveReopenStock(false, true)).toBe("REANEXAR");
  });

  it("pedido que já segura estoque: nada muda", () => {
    expect(resolveReopenStock(true, false)).toBe("NADA");
    expect(resolveReopenStock(true, true)).toBe("NADA");
  });
});
