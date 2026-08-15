import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diaSP, virouPedidoDepois } from "../linha-do-tempo";

/**
 * LINHA DO TEMPO COMERCIAL — ideia do dono (01/08/2026): em vez de "última
 * compra", a HISTÓRIA do relacionamento, com cada movimento dizendo se
 * virou venda.
 */

describe("virou pedido depois?", () => {
  const momento = new Date("2026-07-01T12:00:00Z");

  it("compra em até 7 dias depois conta", () => {
    expect(virouPedidoDepois(momento, [new Date("2026-07-05T10:00:00Z")])).toBe(true);
  });

  it("compra ANTES do momento não conta (não inverte causa e efeito)", () => {
    expect(virouPedidoDepois(momento, [new Date("2026-06-28T10:00:00Z")])).toBe(false);
  });

  it("compra tarde demais não conta (8+ dias já é outra história)", () => {
    expect(virouPedidoDepois(momento, [new Date("2026-07-09T13:00:00Z")])).toBe(false);
  });

  it("sem compras, não virou", () => {
    expect(virouPedidoDepois(momento, [])).toBe(false);
  });
});

describe("agrupamento por dia no fuso do Brasil", () => {
  it("madrugada UTC ainda é o dia anterior em São Paulo", () => {
    // 01:00 UTC do dia 2 = 22:00 do dia 1º em SP
    expect(diaSP(new Date("2026-07-02T01:00:00Z"))).toBe("2026-07-01");
    expect(diaSP(new Date("2026-07-02T12:00:00Z"))).toBe("2026-07-02");
  });
});

describe("amarração", () => {
  const lib = readFileSync(join(process.cwd(), "src/lib/linha-do-tempo.ts"), "utf8");
  const ficha = readFileSync(
    join(process.cwd(), "src/app/(app)/clientes/[id]/page.tsx"),
    "utf8"
  );

  it("o 'hoje' usa a MESMA régua de ritmo da agenda e da Recompra", () => {
    expect(lib).toContain("cicloEntreCompras(");
    expect(lib).toContain("passouDoRitmo(");
  });

  it("pedido soma netTotal (régua do faturamento)", () => {
    expect(lib).toContain("valor: p.netTotal");
  });

  it("nota interna não vira 'conversou no WhatsApp'", () => {
    expect(lib).toContain('kind: "TEXT"');
  });

  it("a ficha do cliente mostra a linha do tempo comercial", () => {
    expect(ficha).toContain("linhaDoTempoComercial(user.companyId, customer.id)");
    expect(ficha).toContain("Linha do tempo comercial");
    expect(ficha).toContain("passou do ponto");
  });
});
