// Guarda RN-088
// Guarda RN-089
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAID_ORDER_STATUSES } from "../orders";

/**
 * RN-088 — a faixa "Hoje" do BI é calculada AO VIVO (três consultas
 * baratas pelas réguas de sempre: cliente cadastrada hoje no calendário de
 * SP; pedido pago hoje por paidAt, netTotal; a cláusula do "esperando
 * agora") e a tela a atualiza sozinha a cada 30 s com a aba visível.
 */

const chamadas: { modelo: string; args: Record<string, unknown> }[] = [];
vi.mock("../db", () => ({
  db: {
    customer: { async count(args: Record<string, unknown>) { chamadas.push({ modelo: "customer.count", args }); return 3; } },
    order: {
      async aggregate(args: Record<string, unknown>) {
        chamadas.push({ modelo: "order.aggregate", args });
        return { _sum: { netTotal: 270.004 }, _count: 2 };
      },
    },
    $queryRaw: async (partes: TemplateStringsArray) => {
      chamadas.push({ modelo: "$queryRaw", args: { sql: partes.join("?") } });
      return [{ n: BigInt(1) }];
    },
  },
}));

import { numerosDeHoje } from "../bi/hoje";
import { INTERVALO_DA_FAIXA_MS, avisoDaFalha, textoDeAtualizado, textoDaContagem } from "../bi/hoje-regra";

describe("os números de hoje", () => {
  it("contatos de hoje (0h de SP), pagos de hoje por paidAt com netTotal, esperando agora pela cláusula do painel", async () => {
    // terça 13/10 às 12:00 SP; o dia começa às 03:00 UTC
    const n = await numerosDeHoje("loja", new Date("2026-10-13T15:00:00.000Z"));
    expect(n).toMatchObject({ dia: "2026-10-13", leads: 3, pedidosPagos: 2, vendido: 270, esperandoAgora: 1 });
    const contatos = chamadas.find((c) => c.modelo === "customer.count")!.args as { where: Record<string, unknown> };
    expect(contatos.where).toEqual({ companyId: "loja", createdAt: { gte: new Date("2026-10-13T03:00:00.000Z") } });
    const vendas = chamadas.find((c) => c.modelo === "order.aggregate")!.args as { where: Record<string, unknown>; _sum: unknown };
    expect(vendas.where).toEqual({ companyId: "loja", status: { in: [...PAID_ORDER_STATUSES] }, paidAt: { gte: new Date("2026-10-13T03:00:00.000Z") } });
    expect(vendas._sum).toEqual({ netTotal: true });
    const sql = chamadas.find((c) => c.modelo === "$queryRaw")!.args.sql as string;
    expect(sql).toMatch(/"lastInboundAt" > COALESCE\("lastOutboundAt", '-infinity'::timestamp\)/);
  });
  it("o texto de 'atualizado': minutos inteiros para baixo (90 s ainda é 1 min)", () => {
    expect([textoDeAtualizado(2), textoDeAtualizado(40), textoDeAtualizado(90), textoDeAtualizado(150)]).toEqual(["agora", "há 40 s", "há 1 min", "há 2 min"]);
  });
  it("a falha diz o que foi: sessão vencida, módulo fechado, ou rede", () => {
    expect(avisoDaFalha(401)).toMatch(/sessão venceu/);
    expect(avisoDaFalha(404)).toMatch(/não está mais disponível/);
    expect(avisoDaFalha(0)).toMatch(/sem conexão/);
    expect(INTERVALO_DA_FAIXA_MS).toBe(30_000);
  });
  it("a rota passa pela porteira do BI", () => {
    const rota = readFileSync(join(__dirname, "../../app/api/bi/hoje/route.ts"), "utf8");
    expect(rota).toMatch(/porteiraBi\(\)/);
  });
});

describe("o número que anima (textoDaContagem)", () => {
  const limpo = (t: string) => t.replace(/\u00a0/g, " ");
  it("valor final sem centavos: nenhum quadro mostra centavos — a largura não pula no fim", () => {
    expect(limpo(textoDaContagem(1233.98, 1234, "brl"))).toBe("R$ 1.234");
    expect(limpo(textoDaContagem(0, 1234, "brl"))).toBe("R$ 0");
    expect(limpo(textoDaContagem(1234, 1234, "brl"))).toBe("R$ 1.234");
  });
  it("valor final com centavos: todo quadro mostra 2 casas, e o último é o `brl` da casa", () => {
    expect(limpo(textoDaContagem(100, 1234.57, "brl"))).toBe("R$ 100,00");
    expect(limpo(textoDaContagem(1234.57, 1234.57, "brl"))).toBe("R$ 1.234,57");
  });
  it("inteiro: arredonda", () => {
    expect(textoDaContagem(2.6, 3)).toBe("3");
  });
});
