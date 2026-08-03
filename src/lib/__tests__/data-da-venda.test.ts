import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { descricaoDaMudancaDeData, validarDataDaVenda } from "../data-da-venda";

/**
 * LANÇAMENTO RETROATIVO — pedido do dono (03/08/2026): vendas do mês passado
 * que ficaram sem lançar precisam entrar no faturamento do mês passado.
 * O dia a dia continua com data automática; a edição é caso à parte, por
 * botão, gerente+, e SEMPRE com rastro na história do pedido.
 */

describe("validação da nova data", () => {
  const agora = new Date("2026-08-03T15:00:00Z");

  it("mês passado pode (é o caso de uso inteiro)", () => {
    expect(validarDataDaVenda(new Date("2026-07-15T14:30:00Z"), agora)).toBeNull();
  });

  it("futuro não pode (venda que ainda não aconteceu não é venda)", () => {
    expect(validarDataDaVenda(new Date("2026-08-10T00:00:00Z"), agora)).toMatch(/futuro/);
  });

  it("relógio adiantado do aparelho tem 5 min de folga", () => {
    expect(validarDataDaVenda(new Date("2026-08-03T15:03:00Z"), agora)).toBeNull();
  });

  it("mais de 1 ano atrás é dedo errado no ano", () => {
    expect(validarDataDaVenda(new Date("2024-08-03T15:00:00Z"), agora)).toMatch(/antiga/);
  });

  it("data inválida não passa", () => {
    expect(validarDataDaVenda(new Date("não é data"), agora)).toMatch(/inválida/i);
  });
});

describe("o rastro da mudança", () => {
  it("diz quem mudou, de quando e para quando (horário de SP)", () => {
    const texto = descricaoDaMudancaDeData(
      "Carla",
      new Date("2026-08-03T18:00:00Z"), // 15h em SP
      new Date("2026-07-15T17:30:00Z") // 14h30 em SP
    );
    expect(texto).toContain("Carla");
    expect(texto).toContain("03/08/2026, 15:00");
    expect(texto).toContain("15/07/2026, 14:30");
    expect(texto).toContain("retroativo");
  });
});

describe("a rota está amarrada", () => {
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/orders/[id]/data-da-venda/route.ts"),
    "utf8"
  );

  it("só gerente pra cima reescreve o mês do faturamento", () => {
    expect(rota).toContain("if (!isManagerUp(user))");
  });

  it("pedido PAGO move a data do PAGAMENTO junto (é ela que manda no faturamento)", () => {
    expect(rota).toContain("...(pago ? { paidAt: quando } : {})");
    expect(rota).toContain("PAID_ORDER_STATUSES");
  });

  it("toda mudança vira registro na história do pedido (quem, de quando, para quando)", () => {
    expect(rota).toContain("db.orderEvent.create");
    expect(rota).toContain("descricaoDaMudancaDeData(user.name");
  });

  it("respeita o escopo do pedido (multi-tenant + vendedora não enxerga o alheio)", () => {
    expect(rota).toContain("...orderScope(user)");
  });

  it("a ficha do pedido usa o componente com o botão (data automática no dia a dia)", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/(app)/pedidos/[id]/page.tsx"),
      "utf8"
    );
    expect(page).toContain("<DataDaVenda");
    expect(page).toContain("podeEditar={isManagerUp(user)}");
  });
});
