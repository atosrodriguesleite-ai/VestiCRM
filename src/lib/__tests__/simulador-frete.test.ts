// Guarda RN-019
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ordenarEmbalagens,
  toleranciaDePecas,
  lerVolumesJson,
  pesoTotalKg,
  type EmbalagemCandidata,
} from "../envios/simulador";
import {
  estaParado,
  resumoDosEnvios,
  DIAS_PARA_PARADO,
  inicioDoMesSP,
  lerValorBR,
} from "../envios/painel";

/**
 * RN-019 — Simulador de frete (tela Envios).
 *
 * O combinado com o dono (19/08/2026): o sistema NÃO CHUTA embalagem — ele
 * mostra envios REAIS parecidos e a vendedora escolhe. Para isso a compra da
 * etiqueta grava a memória (volumes + peças), a memória é POR LOJA, e o
 * recurso inteiro fica atrás de um interruptor que nasce DESLIGADO: loja que
 * não liga não vê nada de novo.
 */

const ler = (p: string) => readFileSync(p, "utf8");

function candidata(parte: Partial<EmbalagemCandidata>): EmbalagemCandidata {
  return {
    id: "s1",
    orderId: "o1",
    orderNumber: 1,
    compradoEm: new Date("2026-08-01"),
    pecas: 23,
    volumes: [{ pesoKg: 2.8, alturaCm: 10, larguraCm: 29, comprimentoCm: 37 }],
    pesoKg: 2.8,
    ...parte,
  };
}

describe("RN-019 · escolha de embalagens parecidas", () => {
  it("quem tem o número de peças mais perto vence", () => {
    const lista = [
      candidata({ orderId: "longe", pecas: 27 }),
      candidata({ orderId: "exato", pecas: 23 }),
      candidata({ orderId: "perto", pecas: 24 }),
    ];
    expect(ordenarEmbalagens(23, lista).map((c) => c.orderId)).toEqual([
      "exato",
      "perto",
      "longe",
    ]);
  });

  it("empate no número de peças: a mais recente vence (a expedição de hoje)", () => {
    const lista = [
      candidata({ orderId: "velha", pecas: 23, compradoEm: new Date("2026-02-01") }),
      candidata({ orderId: "nova", pecas: 23, compradoEm: new Date("2026-08-10") }),
    ];
    expect(ordenarEmbalagens(23, lista)[0].orderId).toBe("nova");
  });

  it("envio longe demais não vira referência (23 peças não sugere caixa de 40)", () => {
    const lista = [candidata({ orderId: "outra-escala", pecas: 40 })];
    expect(ordenarEmbalagens(23, lista)).toEqual([]);
  });

  it("tolerância: 3 peças no pedido pequeno, 20% no grande", () => {
    expect(toleranciaDePecas(5)).toBe(3); // mínimo absoluto
    expect(toleranciaDePecas(100)).toBe(20); // 20%
  });

  it("registro torto no banco não derruba o simulador — vira null e sai da lista", () => {
    expect(lerVolumesJson(null)).toBeNull();
    expect(lerVolumesJson("não é json")).toBeNull();
    expect(lerVolumesJson("[]")).toBeNull();
    expect(lerVolumesJson('[{"pesoKg":0,"alturaCm":10,"larguraCm":29,"comprimentoCm":37}]')).toBeNull();
    expect(
      lerVolumesJson('[{"pesoKg":2.8,"alturaCm":10,"larguraCm":29,"comprimentoCm":37}]')
    ).toEqual([{ pesoKg: 2.8, alturaCm: 10, larguraCm: 29, comprimentoCm: 37 }]);
  });

  it("peso somado dos volumes com o mesmo arredondamento da cotação (3 casas)", () => {
    expect(
      pesoTotalKg([
        { pesoKg: 1.1005, alturaCm: 1, larguraCm: 1, comprimentoCm: 1 },
        { pesoKg: 2.2, alturaCm: 1, larguraCm: 1, comprimentoCm: 1 },
      ])
    ).toBe(3.301);
  });
});

describe("RN-019 · a memória nasce na compra da etiqueta", () => {
  const rota = ler("src/app/api/orders/[id]/frete/route.ts");

  it("a compra grava volumes declarados, nº de peças e a data da compra", () => {
    // fonte única: os MESMOS volumes que a etiqueta declarou (volumesDoEnvio)
    expect(rota).toContain("volumesDoEnvio(volumes, pesoKg, conn)");
    // no update E no create do upsert (senão a memória depende do caminho)
    expect(rota.match(/volumesJson: volumesDaEtiqueta/g)?.length).toBe(2);
    expect(rota.match(/pieces: pecasDoPedido/g)?.length).toBe(2);
    expect(rota.match(/meCompradoEm: new Date\(\)/g)?.length).toBe(2);
  });
});

describe("RN-019 · o interruptor e as travas", () => {
  const simulador = ler("src/app/api/envios/simulador/route.ts");
  const ativar = ler("src/app/api/envios/simulador/ativar/route.ts");
  const schema = ler("prisma/schema.prisma");
  const motor = ler("src/lib/envios/simulador.ts");

  it("o interruptor nasce DESLIGADO — loja que não liga não vê nada de novo", () => {
    expect(schema).toMatch(/freteSimuladorEnabled Boolean @default\(false\)/);
  });

  it("simular exige o módulo Envios E o interruptor da loja", () => {
    expect(simulador).toContain("shippingEnabled");
    expect(simulador).toContain("freteSimuladorEnabled");
  });

  it("ligar/desligar é da gerência, e só com o módulo Envios contratado", () => {
    expect(ativar).toContain("isManagerUp");
    // a condição na query: sem shippingEnabled o update não acha a loja
    expect(ativar).toContain("shippingEnabled: true");
  });

  it("a memória é por loja (multi-tenant, RN-013) e ignora etiqueta cancelada", () => {
    expect(motor).toContain("order: { companyId");
    expect(motor).toContain('meStatus: { not: "CANCELADO" }');
  });
});

describe("painel da tela Envios", () => {
  it("envio postado há mais que o prazo, sem entregar, está parado", () => {
    const agora = new Date("2026-08-19T12:00:00");
    const antes = new Date(agora.getTime() - (DIAS_PARA_PARADO + 1) * 24 * 60 * 60 * 1000);
    expect(estaParado("POSTADO", antes, agora)).toBe(true);
    expect(estaParado("POSTADO", agora, agora)).toBe(false);
    expect(estaParado("ENTREGUE", antes, agora)).toBe(false);
    expect(estaParado("POSTADO", null, agora)).toBe(false);
  });

  it("o resumo soma cada situação no balde certo e tira a média de entrega", () => {
    const r = resumoDosEnvios({
      porStatus: [
        { meStatus: "COMPRADO", quantidade: 1 },
        { meStatus: "ETIQUETA", quantidade: 2 },
        { meStatus: "POSTADO", quantidade: 4 },
        { meStatus: "ENTREGUE", quantidade: 7 },
        { meStatus: "DEVOLVIDO", quantidade: 1 },
        { meStatus: "CANCELADO", quantidade: 9 }, // não entra em balde nenhum
        { meStatus: null, quantidade: 5 }, // envio manual antigo: fora
      ],
      gastoMes: 123.456,
      parados: 2,
      entregues: [
        { shippedAt: new Date("2026-08-01"), deliveredAt: new Date("2026-08-03") },
        { shippedAt: new Date("2026-08-01"), deliveredAt: new Date("2026-08-05") },
        { shippedAt: null, deliveredAt: new Date("2026-08-05") }, // sem postagem: fora da média
      ],
    });
    expect(r.aguardandoPostagem).toBe(3);
    expect(r.emTransito).toBe(4);
    expect(r.entregues).toBe(7);
    expect(r.devolvidos).toBe(1);
    expect(r.parados).toBe(2);
    expect(r.gastoMes).toBe(123.46);
    expect(r.mediaEntregaDias).toBe(3); // (2 + 4) / 2
  });

  it("sem entrega recente a média é null (a tela diz 'sem dado', não zero)", () => {
    const r = resumoDosEnvios({ porStatus: [], gastoMes: 0, parados: 0, entregues: [] });
    expect(r.mediaEntregaDias).toBeNull();
  });

  it("o mês vira à meia-noite de SÃO PAULO, não de Londres (lição do lib/periodo.ts)", () => {
    // 31/08 às 22h em SP = 01/09 01:00 UTC — ainda é agosto para a lojista
    const fimDeAgostoSP = new Date("2026-09-01T01:00:00Z");
    expect(inicioDoMesSP(fimDeAgostoSP).toISOString()).toBe("2026-08-01T03:00:00.000Z");
    // e 01/09 às 00:30 em SP já é setembro
    const comecoDeSetembroSP = new Date("2026-09-01T03:30:00Z");
    expect(inicioDoMesSP(comecoDeSetembroSP).toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("valor em reais digitado de qualquer jeito vira o número certo", () => {
    expect(lerValorBR("1.500,50")).toBe(1500.5);
    expect(lerValorBR("150,5")).toBe(150.5);
    // ponto como decimal ("150.50") não pode virar R$ 15.050 de seguro
    expect(lerValorBR("150.50")).toBe(150.5);
    expect(lerValorBR("1.500")).toBe(1500); // ponto de milhar
    expect(lerValorBR("R$ 230")).toBe(230);
    expect(lerValorBR("")).toBeNaN();
  });
});
