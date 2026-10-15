import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { reservarComExtras } from "../reservations";
import { STATUS_QUE_SEGURAM_NA_LOJA } from "../estoque/inventario";
import {
  INICIO_DOS_EXTRAS,
  MARCA_DOS_EXTRAS,
  STATUS_COM_EXTRA_PENDENTE,
  confirmacaoDosExtras,
  extrasDoPedido,
  extrasPrevistos,
  extrasSemCiencia,
  pedidoMostraExtras,
  respostaDeExtras,
  textoDosExtras,
  totalDeExtras,
} from "../pedido-extras";

// Guarda RN-075

/**
 * PEÇAS EXTRAS — o pedido pode pedir mais do que o estoque tem, com ciência.
 *
 * Pedido do dono (09/10/2026): a vendedora era impedida de lançar o pedido
 * quando faltava peça, e numa confecção a peça que falta é FEITA para o
 * pedido. O que existe fica segurado; o resto é extra — não mexe em estoque,
 * não vai para a Nuvemshop, e só entra com a confirmação de quem lançou.
 *
 * O caminho inteiro (rotas de verdade, banco de verdade: criar, editar,
 * cancelar, restaurar) é provado por `scripts/e2e-pecas-extras.ts`.
 */

/**
 * Banco de mentira com o comportamento CONDICIONAL do Postgres: o lote
 * (`$queryRaw` da `reservarEstoque`) só baixa a peça que cabe inteira, e a
 * baixa unitária (`updateMany` com `gte`) idem — nunca deixa negativo.
 */
function bancoFake(estoque: Record<string, number>) {
  return {
    productVariant: {
      async updateMany({ where, data }: { where: { id: string; stock?: { gte: number } }; data: { stock: { decrement: number } } }) {
        const atual = estoque[where.id] ?? 0;
        if (where.stock && atual < where.stock.gte) return { count: 0 };
        estoque[where.id] = atual - data.stock.decrement;
        return { count: 1 };
      },
      async findUnique({ where }: { where: { id: string } }) {
        return { stock: estoque[where.id] ?? 0 };
      },
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return where.id.in.map((id) => ({ id, stock: estoque[id] ?? 0 }));
      },
    },
    async $queryRaw(sql: Prisma.Sql) {
      // os valores do lote vêm em trios (peça, quantidade, livre) — a peça
      // livre (RN-076) baixa sem condição e fica negativa
      const v = sql.values as (string | number | boolean)[];
      const ok: { id: string }[] = [];
      for (let i = 0; i < v.length; i += 3) {
        const id = String(v[i]);
        const q = Number(v[i + 1]);
        const livre = v[i + 2] === true;
        if (livre || (estoque[id] ?? 0) >= q) {
          estoque[id] = estoque[id] ?? 0;
          estoque[id] -= q;
          ok.push({ id });
        }
      }
      return ok;
    },
  };
}

describe("reservarComExtras: segura o que existe, o resto é extra", () => {
  it("o que cabe sai inteiro; o que não cabe segura o que há e vira extra", async () => {
    const estoque = { v1: 10, v2: 2, v3: 0 };
    const r = await reservarComExtras(bancoFake(estoque) as never, [
      { variantId: "v1", quantity: 3, label: "Regata (Preto P)" },
      { variantId: "v2", quantity: 5, label: "Regata (Preto M)" },
      { variantId: "v3", quantity: 4, label: "Regata (Preto G)" },
    ]);
    expect(estoque).toEqual({ v1: 7, v2: 0, v3: 0 }); // nunca negativo
    expect(r.seguradas).toEqual([
      { variantId: "v1", quantity: 3 },
      { variantId: "v2", quantity: 2 },
    ]);
    expect(r.extras).toEqual([
      { variantId: "v2", label: "Regata (Preto M)", precisa: 5, doEstoque: 2, extra: 3 },
      { variantId: "v3", label: "Regata (Preto G)", precisa: 4, doEstoque: 0, extra: 4 },
    ]);
  });

  it("a mesma peça em duas linhas é uma conta só", async () => {
    const estoque = { v1: 3 };
    const r = await reservarComExtras(bancoFake(estoque) as never, [
      { variantId: "v1", quantity: 2, label: "Baby Look (Azul M)" },
      { variantId: "v1", quantity: 2, label: "Baby Look (Azul M)" },
    ]);
    expect(estoque.v1).toBe(0);
    expect(r.seguradas).toEqual([{ variantId: "v1", quantity: 3 }]);
    expect(r.extras.map((e) => e.extra)).toEqual([1]);
  });

  it("tudo em estoque: nenhum extra", async () => {
    const r = await reservarComExtras(bancoFake({ v1: 5 }) as never, [
      { variantId: "v1", quantity: 5, label: "x" },
    ]);
    expect(r.extras).toEqual([]);
  });
});

describe("a ciência: só grava o extra que a pessoa viu", () => {
  const previstos = extrasPrevistos(
    [
      { variantId: "v1", label: "A", precisa: 5 },
      { variantId: "v2", label: "B", precisa: 2 },
    ],
    new Map([
      ["v1", 2],
      ["v2", 9],
    ])
  );

  it("prevê por peça: o que há fica, o resto é extra (estoque negativo conta como zero)", () => {
    expect(previstos).toEqual([{ variantId: "v1", label: "A", precisa: 5, doEstoque: 2, extra: 3 }]);
    expect(extrasPrevistos([{ variantId: "v", label: "C", precisa: 2 }], new Map([["v", -4]]))).toEqual([
      { variantId: "v", label: "C", precisa: 2, doEstoque: 0, extra: 2 },
    ]);
  });

  it("sem confirmação, todo extra é recusado; a confirmação de volta é exatamente o que a janela mostrou", () => {
    expect(extrasSemCiencia(previstos, undefined)).toHaveLength(1);
    expect(extrasSemCiencia(previstos, confirmacaoDosExtras(previstos))).toEqual([]);
  });

  it("o estoque caiu entre a janela e o clique: o extra MAIOR que o confirmado é recusado", () => {
    const agora = [{ ...previstos[0], doEstoque: 1, extra: 4 }];
    expect(extrasSemCiencia(agora, { v1: 3 })).toEqual(agora);
    // e o estoque que SUBIU (extra menor) passa
    expect(extrasSemCiencia([{ ...previstos[0], doEstoque: 4, extra: 1 }], { v1: 3 })).toEqual([]);
  });

  it("a recusa fala a frase de sempre (as telas sem extra seguem mostrando só ela) e leva a lista", () => {
    const r = respostaDeExtras(previstos);
    expect(r.error).toBe("Estoque insuficiente de A: restam 2");
    expect(r.extras).toEqual(previstos);
  });

  it("o histórico diz quem confirmou e quais peças", () => {
    // a marca do começo é por onde a tela separa "extra confirmado" de
    // "faltou estoque e ninguém confirmou" (o pedido do catálogo)
    expect(textoDosExtras(previstos, "Lara").startsWith(MARCA_DOS_EXTRAS)).toBe(true);
    expect(textoDosExtras(previstos, "Lara")).toBe(
      "🧵 3 peças EXTRAS (sem estoque, feitas para este pedido), confirmadas por Lara — A: 3. Não saíram do estoque."
    );
  });
});

describe("quantos extras o pedido tem: pedido − o que o LIVRO diz que ele segura", () => {
  it("por peça, somando linhas repetidas; item sem vínculo não conta", () => {
    const extras = extrasDoPedido(
      [
        { variantId: "v1", quantity: 2 },
        { variantId: "v1", quantity: 3 },
        { variantId: "v2", quantity: 4 },
        { variantId: null, quantity: 9 },
      ],
      new Map([
        ["v1", 2],
        ["v2", 4],
      ])
    );
    expect([...extras]).toEqual([["v1", 3]]);
    expect(totalDeExtras(extras)).toBe(3);
  });

  it("pedido com TROCA (RN-073): a peça devolvida não vira extra falso", () => {
    // itens P×5; a cliente devolveu 1 P e levou 1 M — o livro tem P 4 e M 1
    const ajuste = new Map([
      ["P", -1],
      ["M", 1],
    ]);
    const segurado = new Map([
      ["P", 4],
      ["M", 1],
    ]);
    expect(totalDeExtras(extrasDoPedido([{ variantId: "P", quantity: 5 }], segurado, ajuste))).toBe(0);
    // sem o ajuste, a conta erraria: 1 extra que não existe
    expect(totalDeExtras(extrasDoPedido([{ variantId: "P", quantity: 5 }], segurado))).toBe(1);
  });

  it("diminuir tira primeiro do extra: pediu 5, segura 2 → cai para 4 ainda segura 2 e o extra vira 2", () => {
    expect(totalDeExtras(extrasDoPedido([{ variantId: "v1", quantity: 4 }], new Map([["v1", 2]])))).toBe(2);
  });

  const base = { status: "ORCAMENTO", stockDeducted: true, nuvemshopId: null, createdAt: INICIO_DOS_EXTRAS, temMovimento: false };
  it("cancelado, pedido que JÁ SAIU da loja, pedido que não segura estoque e da loja online não mostram extra", () => {
    expect(pedidoMostraExtras(base)).toBe(true);
    expect(pedidoMostraExtras({ ...base, status: "SEPARACAO" })).toBe(true);
    expect(pedidoMostraExtras({ ...base, status: "CANCELADO" })).toBe(false);
    // entregue há meses não segue marcado (achado da revisão)
    expect(pedidoMostraExtras({ ...base, status: "ENVIADO" })).toBe(false);
    expect(pedidoMostraExtras({ ...base, status: "ENTREGUE" })).toBe(false);
    expect(pedidoMostraExtras({ ...base, status: "ENTREGUE_A_RECEBER" })).toBe(false);
    expect(pedidoMostraExtras({ ...base, stockDeducted: false })).toBe(false);
    expect(pedidoMostraExtras({ ...base, nuvemshopId: "123" })).toBe(false);
  });

  it("pedido ANTIGO sem nenhum movimento no livro fica de fora (não dá para saber); com movimento, entra", () => {
    const antigo = { ...base, createdAt: new Date("2026-08-01T12:00:00Z") };
    expect(pedidoMostraExtras(antigo)).toBe(false);
    expect(pedidoMostraExtras({ ...antigo, temMovimento: true })).toBe(true);
  });
});

describe("a lista de 'ainda na loja' é a MESMA do reservado do Estoque", () => {
  it("lista à mão é onde status novo se perde — aqui ela é conferida", () => {
    expect([...STATUS_COM_EXTRA_PENDENTE].sort()).toEqual([...STATUS_QUE_SEGURAM_NA_LOJA].sort());
  });
});
