import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orderScope } from "../scope";
import type { SessionUser } from "../auth";

/**
 * CADA VENDEDORA NO SEU PAINEL.
 *
 * O painel de pedidos da Juliana estava cheio de pedidos da Lara. O dono da
 * venda é o `sellerId` — o mesmo campo que manda na comissão —, então é ele
 * que decide o que aparece na tela de cada uma. Gerência vê a loja inteira.
 */

const usuario = (role: string): SessionUser =>
  ({ id: "u-juliana", companyId: "loja-1", role, name: "Juliana" }) as SessionUser;

describe("quem vê quais pedidos", () => {
  it("vendedora vê SÓ os pedidos dela", () => {
    expect(orderScope(usuario("SELLER"))).toEqual({
      companyId: "loja-1",
      sellerId: "u-juliana",
    });
  });

  it("gerente, admin e suporte veem a loja inteira", () => {
    for (const role of ["MANAGER", "ADMIN", "SUPPORT", "SUPERADMIN"]) {
      expect(orderScope(usuario(role))).toEqual({ companyId: "loja-1" });
    }
  });

  it("o filtro NUNCA sai sem a loja (isolamento entre lojas)", () => {
    for (const role of ["SELLER", "MANAGER", "ADMIN", "SUPPORT"]) {
      expect(orderScope(usuario(role)).companyId).toBe("loja-1");
    }
  });
});

/**
 * A regra tem que valer em TODA porta de pedido — lista, ficha, PDF, Pix,
 * nota, frete, transferência e exportação. Uma porta esquecida com
 * `companyId` puro devolve o pedido da colega para quem abrir o link direto.
 */
describe("todas as portas de pedido usam a mesma régua", () => {
  const raiz = process.cwd();
  const PORTAS = [
    "src/app/(app)/pedidos/page.tsx",
    "src/app/(app)/pedidos/[id]/page.tsx",
    "src/app/api/orders/[id]/route.ts",
    "src/app/api/orders/[id]/pdf/route.ts",
    "src/app/api/orders/[id]/resale-pdf/route.ts",
    "src/app/api/orders/[id]/pix/route.ts",
    "src/app/api/orders/[id]/card/route.ts",
    "src/app/api/orders/[id]/nfe/route.ts",
    "src/app/api/orders/[id]/frete/route.ts",
    "src/app/api/orders/[id]/transferir/route.ts",
    "src/app/api/export/pedidos/route.ts",
    "src/app/declaracao/[id]/page.tsx",
  ];

  it.each(PORTAS)("%s filtra por orderScope", (arquivo) => {
    const fonte = readFileSync(join(raiz, arquivo), "utf8");
    expect(fonte).toContain("orderScope");
  });

  it("nenhuma porta busca pedido só pela loja", () => {
    for (const arquivo of PORTAS) {
      const fonte = readFileSync(join(raiz, arquivo), "utf8");
      // o padrão perigoso: pegar o pedido pelo id sem olhar de quem é
      expect(
        /where: \{ id(?:: orderId)?, companyId: user/.test(fonte),
        `${arquivo} busca pedido sem filtrar a vendedora`
      ).toBe(false);
    }
  });
});
