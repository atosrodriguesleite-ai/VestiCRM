// Guarda RN-069
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  A_RECEBER_STATUSES,
  COMMISSION_ORDER_STATUSES,
  ORDER_STATUS_FLOW,
  PAID_ORDER_STATUSES,
  PRAZO_ENTREGUE_A_RECEBER_DIAS,
  TETO_PREVISAO_DIAS,
  lerPrevisaoDeRecebimento,
  orderStatusColor,
  orderStatusLabel,
  vencimentoDaVendaAPrazo,
  whereComissaoNoPeriodo,
} from "../orders";
import { decidirAcaoDaPorta, vencimentoAlvo } from "../financeiro/porta-vendas";
import { STATUS_QUE_SEGURAM_NA_LOJA } from "../estoque/inventario";

/**
 * RN-069 · VENDA A PRAZO — "Entregue · a receber".
 *
 * A cliente levou e paga depois. O que a regra promete, e o que cada teste
 * aqui defende: NÃO é faturamento (pedido do dono: não contar dinheiro que não
 * entrou); É conta a receber com vencimento; CONTA comissão na entrega; SAIU
 * do estoque da loja; e, quando virar pago, entra no faturamento e o dinheiro
 * entra na conta — uma vez só.
 */

const semLancamento = {
  existe: false,
  valor: 0,
  cancelado: false,
  canceladoPelaPorta: false,
  saldo: 0,
  temBaixaManualViva: false,
  temBaixaAutomaticaViva: false,
  temEstornoManual: false,
};

describe("o lugar do status nas listas", () => {
  it("aparece no fluxo da tela, entre aguardando pagamento e pago", () => {
    const i = ORDER_STATUS_FLOW.indexOf("ENTREGUE_A_RECEBER");
    expect(i).toBeGreaterThan(ORDER_STATUS_FLOW.indexOf("AGUARDANDO_PAGAMENTO"));
    expect(i).toBeLessThan(ORDER_STATUS_FLOW.indexOf("PAGO"));
  });

  it("NÃO é faturamento — fica fora da lista de venda paga (RN-001)", () => {
    expect(PAID_ORDER_STATUSES).not.toContain("ENTREGUE_A_RECEBER");
  });

  it("vale dinheiro ainda não recebido, como o aguardando pagamento", () => {
    expect(A_RECEBER_STATUSES).toEqual(["AGUARDANDO_PAGAMENTO", "ENTREGUE_A_RECEBER"]);
  });

  it("paga comissão na entrega: a lista da comissão é a do faturamento MAIS ele, e só ele", () => {
    expect(COMMISSION_ORDER_STATUSES).toEqual([...PAID_ORDER_STATUSES, "ENTREGUE_A_RECEBER"]);
  });

  it("a mercadoria SAIU da loja: não segura peça na arara (Estoque, RN-050)", () => {
    expect(STATUS_QUE_SEGURAM_NA_LOJA as readonly string[]).not.toContain("ENTREGUE_A_RECEBER");
  });

  it("tem rótulo e cor próprios (a tela não mostra código cru)", () => {
    expect(orderStatusLabel.ENTREGUE_A_RECEBER).toBe("Entregue · a receber");
    expect(orderStatusColor.ENTREGUE_A_RECEBER).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("o financeiro (porta única, RN-033)", () => {
  it("nasce como conta a receber EM ABERTO: cria, não baixa", () => {
    const a = decidirAcaoDaPorta({ status: "ENTREGUE_A_RECEBER", valor: 530 }, semLancamento);
    expect(a.criar).toBe(true);
    expect(a.darBaixa).toBeNull();
  });

  it("quando vira pago, o dinheiro entra: baixa do que falta", () => {
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 530 },
      { ...semLancamento, existe: true, valor: 530, saldo: 530 }
    );
    expect(a.darBaixa).toBe(530);
  });

  it("voltar de pago para a receber estorna só a baixa automática (o dinheiro não entrou)", () => {
    const a = decidirAcaoDaPorta(
      { status: "ENTREGUE_A_RECEBER", valor: 530 },
      { ...semLancamento, existe: true, valor: 530, saldo: 0, temBaixaAutomaticaViva: true }
    );
    expect(a.estornarAutomaticas).toBe(true);
    expect(a.cancelar).toBe(false);
  });

  it("vira a receber vindo de PAGO (o Pix voltou): estorna a baixa automática E move o vencimento", () => {
    // a primeira versão decidia o vencimento DEPOIS, com a foto de antes do
    // estorno — a baixa ainda parecia viva e a parcela seguia vencendo no
    // dia da venda (a cliente caía na Inadimplência no mesmo dia)
    const a = decidirAcaoDaPorta(
      { status: "ENTREGUE_A_RECEBER", valor: 530 },
      { ...semLancamento, existe: true, valor: 530, saldo: 0, temBaixaAutomaticaViva: true }
    );
    expect(a.estornarAutomaticas).toBe(true);
    expect(a.moverVencimento).toBe(true);
  });

  it("baixa registrada À MÃO fica com a data dela, mas o vencimento (que é do pedido) vai para o combinado", () => {
    // o sinal de R$ 200 à mão deixava a cliente "atrasada" numa data que
    // ninguém combinou (achado da revisão)
    const a = decidirAcaoDaPorta(
      { status: "ENTREGUE_A_RECEBER", valor: 530 },
      { ...semLancamento, existe: true, valor: 530, saldo: 330, temBaixaManualViva: true }
    );
    expect(a.moverVencimento).toBe(true);
    expect(a.estornarAutomaticas).toBe(false);
    // e também quando o valor mudou com baixa à mão (a porta só avisa do valor)
    const b = decidirAcaoDaPorta(
      { status: "ENTREGUE_A_RECEBER", valor: 600 },
      { ...semLancamento, existe: true, valor: 530, saldo: 330, temBaixaManualViva: true }
    );
    expect(b.aviso).toMatch(/baixa registrada à mão/);
    expect(b.moverVencimento).toBe(true);
  });

  it("os outros status nunca movem o vencimento", () => {
    for (const status of ["AGUARDANDO_PAGAMENTO", "PAGO", "ORCAMENTO", "CANCELADO"]) {
      const a = decidirAcaoDaPorta(
        { status, valor: 530 },
        { ...semLancamento, existe: true, valor: 530, saldo: 530 }
      );
      expect(a.moverVencimento, status).toBe(false);
    }
  });

  it("a previsão combinada com a cliente MANDA no vencimento; sem ela, os 30 dias", () => {
    const entrega = new Date("2026-10-05T15:00:00Z");
    const combinada = new Date("2026-10-20T12:00:00Z");
    expect(vencimentoDaVendaAPrazo(entrega, combinada)).toEqual(combinada);
    expect(vencimentoDaVendaAPrazo(entrega, null)).toEqual(vencimentoDaVendaAPrazo(entrega));
  });

  it("a previsão digitada é lida como DIA ao meio-dia UTC; vazio tira; o que não faz sentido é recusado", () => {
    const entrega = new Date("2026-10-05T15:00:00Z");
    expect(lerPrevisaoDeRecebimento("2026-10-20", entrega)).toEqual({
      ok: true,
      data: new Date("2026-10-20T12:00:00.000Z"),
    });
    expect(lerPrevisaoDeRecebimento("", entrega)).toEqual({ ok: true, data: null });
    expect(lerPrevisaoDeRecebimento(null, entrega)).toEqual({ ok: true, data: null });
    // o próprio dia da entrega vale ("paga hoje à noite")
    expect(lerPrevisaoDeRecebimento("2026-10-05", entrega).ok).toBe(true);
    // antes da entrega não é previsão
    expect(lerPrevisaoDeRecebimento("2026-10-04", entrega).ok).toBe(false);
    // dia que não existe
    expect(lerPrevisaoDeRecebimento("2026-02-30", entrega).ok).toBe(false);
    // formato torto
    expect(lerPrevisaoDeRecebimento("20/10/2026", entrega).ok).toBe(false);
    // mais de um ano depois é dedo errado
    const longe = new Date(entrega.getTime() + (TETO_PREVISAO_DIAS + 2) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(lerPrevisaoDeRecebimento(longe, entrega).ok).toBe(false);
  });

  it("o alvo do vencimento na porta: a previsão combinada; sem ela, 30 dias; fora do status, nada", () => {
    const entrega = new Date("2026-10-05T15:00:00Z");
    const previsao = new Date("2026-10-20T12:00:00.000Z");
    expect(
      vencimentoAlvo({ status: "ENTREGUE_A_RECEBER", entregueAReceberEm: entrega, previsaoRecebimentoEm: previsao })
    ).toEqual(previsao);
    const padrao = vencimentoAlvo({
      status: "ENTREGUE_A_RECEBER",
      entregueAReceberEm: entrega,
      previsaoRecebimentoEm: null,
    });
    // 30 dias depois, no DIA (meio-dia UTC, RN-030)
    expect(padrao?.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(
      vencimentoAlvo({ status: "PAGO", entregueAReceberEm: entrega, previsaoRecebimentoEm: previsao })
    ).toBeNull();
    expect(
      vencimentoAlvo({ status: "ENTREGUE_A_RECEBER", entregueAReceberEm: null, previsaoRecebimentoEm: previsao })
    ).toBeNull();
  });

  it("a rota só aceita a previsão no status a receber, a apaga ao virar pago e a trava para o suporte", () => {
    const rota = readFileSync("src/app/api/orders/[id]/route.ts", "utf8");
    expect(rota).toMatch(/enteringPaid \? \{ previsaoRecebimentoEm: null \}/);
    expect(rota).toMatch(/Combinar a previsão de recebimento é permitido só para a equipe comercial/);
    // os dois atalhos do PATCH (só itens, só valores) não podem engolir a previsão
    expect(rota.match(/parsed\.data\.previsaoRecebimentoEm === undefined/g)?.length).toBe(2);
    expect(rota).toMatch(/previsaoRecebimentoEm: z\.string\(\)\.max\(10\)\.nullable\(\)\.optional\(\)/);
    expect(rota).toMatch(/statusFinal !== "ENTREGUE_A_RECEBER"/);
    expect(rota).toMatch(/lerPrevisaoDeRecebimento\(parsed\.data\.previsaoRecebimentoEm/);
    // toda mudança fica na história do pedido
    expect(rota).toMatch(/Previsão de recebimento combinada/);
    expect(rota).toMatch(/Previsão de recebimento removida/);
  });

  it("o vencimento é 30 dias depois da entrega — não 'vencida hoje'", () => {
    const entrega = new Date("2026-10-03T15:00:00Z");
    const v = vencimentoDaVendaAPrazo(entrega);
    expect((v.getTime() - entrega.getTime()) / 86_400_000).toBe(PRAZO_ENTREGUE_A_RECEBER_DIAS);
    expect(PRAZO_ENTREGUE_A_RECEBER_DIAS).toBe(30);
  });
});

describe("a comissão conta UMA vez, no mês da entrega", () => {
  const de = new Date("2026-10-01T03:00:00Z");
  const ate = new Date("2026-10-31T03:00:00Z");
  const where = whereComissaoNoPeriodo(de, ate);

  it("quem nunca foi a prazo conta pela data do pagamento", () => {
    expect(where.OR?.[0]).toMatchObject({
      entregueAReceberEm: null,
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { gte: de, lte: ate },
    });
  });

  it("quem foi a prazo conta pela data da ENTREGA — mesmo depois de pago", () => {
    // sem isso a venda entregue em setembro e paga em outubro pagaria
    // comissão nos dois meses
    expect(where.OR?.[1]).toMatchObject({
      entregueAReceberEm: { gte: de, lte: ate },
      status: { in: COMMISSION_ORDER_STATUSES },
    });
  });

  it("as três portas da comissão usam a MESMA régua", () => {
    for (const p of [
      "src/lib/financeiro/comissoes.ts",
      "src/app/(app)/comissoes/page.tsx",
      "src/app/api/comissoes/relatorio/route.ts",
    ]) {
      const fonte = readFileSync(p, "utf8");
      expect(fonte, p).toMatch(/whereComissaoNoPeriodo\(/);
      // a lista antiga, escrita à mão, não pode voltar em nenhuma das três
      expect(fonte, p).not.toMatch(/status: \{ in: PAID_ORDER_STATUSES \},\s*paidAt/);
    }
  });
});

describe("o carimbo da entrega", () => {
  const rota = readFileSync("src/app/api/orders/[id]/route.ts", "utf8");

  it("entrar no status carimba a data, e nunca a apaga depois", () => {
    // quem já era PAGO leva a data do pagamento: a comissão dele já contou
    // naquele mês, e carimbar hoje a faria contar de novo (achado da revisão)
    expect(rota).toMatch(
      /entregueAReceberEm: order\.entregueAReceberEm \?\? order\.paidAt \?\? new Date\(\)/
    );
    expect(rota).not.toMatch(/entregueAReceberEm: null/);
  });

  it("exige vendedora para entrar em a receber, e não deixa tirá-la depois (RN-006 vale para comissão)", () => {
    expect(rota).toMatch(/COMISSAO_STATUSES = new Set<string>\(COMMISSION_ORDER_STATUSES\)/);
    expect(rota).toMatch(/if \(enteringComissao && !vendaOnline\(order\)\)/);
    expect(rota).toMatch(/COMISSAO_STATUSES\.has\(parsed\.data\.status \?\? order\.status\)/);
  });

  it("o extrato de comissão em PDF explica a venda a prazo e ordena pela data que contou", () => {
    const pdf = readFileSync("src/app/api/comissoes/relatorio/route.ts", "utf8");
    expect(pdf).not.toMatch(/Só entra pedido PAGO/);
    expect(pdf).toMatch(/DATA DA ENTREGA/);
    expect(pdf).toMatch(/dataQueContou/);
    expect(pdf).not.toMatch(/orderBy: \[\{ entregueAReceberEm/);
  });

  it("a ficha do pedido não manda 'cancelar para liberar' peça que já saiu com a cliente", () => {
    const ficha = readFileSync("src/app/(app)/pedidos/[id]/page.tsx", "utf8");
    expect(ficha).toMatch(/order\.status !== "ENTREGUE_A_RECEBER" &&\s*order\.status !== "CANCELADO"/);
    expect(ficha).toMatch(/Entregue à cliente, a receber/);
    // e a trilha só pinta a etapa como feita em quem passou por ela
    const trilha = readFileSync("src/app/(app)/pedidos/[id]/status-changer.tsx", "utf8");
    expect(trilha).toMatch(/s !== "ENTREGUE_A_RECEBER" \|\| passouPorAReceber/);
  });

  it("o status está no cardápio da troca de status", () => {
    expect(rota).toMatch(/"ENTREGUE_A_RECEBER",\s*"PAGO"/);
  });

  it("o Dashboard mostra o dinheiro na rua, fora de 'Vendas'", () => {
    const dash = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(dash).toMatch(/status: "ENTREGUE_A_RECEBER"/);
    expect(dash).toMatch(/Entregue · a receber/);
  });
});
