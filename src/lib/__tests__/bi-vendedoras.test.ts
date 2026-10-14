// Guarda RN-083
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcularFatos, calcularFatosPorVendedora, type EntradaDosFatos } from "../bi/fatos";
import { ordenarVendedoras, somarVendedora, teveNumero } from "../bi/painel";
import { HORARIO_SUGERIDO } from "../bi/horario-comercial";

/**
 * RN-083 — o BI POR VENDEDORA recorta a mesma conta da loja por PESSOA:
 * a espera conta para quem a RESPONDEU; a sem resposta, para quem ASSUMIU a
 * conversa; o contato novo, para a dona da CARTEIRA; o pedido, para a
 * VENDEDORA dele (RN-005). Só gente DA LOJA vira linha (RN-013), só quem teve
 * número no dia, e o que sobra entre a loja e as pessoas é "sem vendedora" —
 * dito, nunca escondido.
 */

const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);
const msg = (
  conversationId: string,
  direction: "IN" | "OUT",
  quando: Date,
  extra: Partial<EntradaDosFatos["mensagens"][number]> = {}
) => ({
  conversationId,
  direction,
  kind: "TEXT" as const,
  createdAt: quando,
  authorId: direction === "OUT" ? "ana" : null,
  automatica: false,
  ...extra,
});
const regua = { horario: HORARIO_SUGERIDO, prazoMin: 30, agora: sp("2026-10-13", "12:00") };
const SEG = "2026-10-12";
const TER = "2026-10-13";
const equipe = new Set(["ana", "bia"]);

const entrada: EntradaDosFatos = {
  mensagens: [
    // c1 (assumida pela Ana): a cliente escreve 10:00, a ANA responde 10:20 — no prazo
    msg("c1", "IN", sp(SEG, "10:00")),
    msg("c1", "OUT", sp(SEG, "10:20")),
    // c2 (assumida pela Bia): 17:50 → a BIA responde terça 08:30: 40 min, fora do prazo, conta na SEGUNDA
    msg("c2", "IN", sp(SEG, "17:50")),
    msg("c2", "OUT", sp(TER, "08:30"), { authorId: "bia" }),
    // c3 (assumida pela Ana): sem resposta até agora — estourou; é da Ana (ela assumiu)
    msg("c3", "IN", sp(SEG, "16:00")),
    // c4 (na fila, sem dona): sem resposta — é de ninguém, fica só no total da loja
    msg("c4", "IN", sp(SEG, "16:30")),
    // c5: respondida pelo CELULAR da loja (eco sem autora) — só no total da loja
    msg("c5", "IN", sp(SEG, "11:00")),
    msg("c5", "OUT", sp(SEG, "11:05"), { authorId: null }),
    // c6: respondida pelo Super Admin acessando como loja (id de fora) — só no total
    msg("c6", "IN", sp(SEG, "12:00")),
    msg("c6", "OUT", sp(SEG, "12:10"), { authorId: "superadmin" }),
    // c7 (da Bia): a ANA responde — conta para quem respondeu, a Ana, não para a dona
    msg("c7", "IN", sp(SEG, "14:00")),
    msg("c7", "OUT", sp(SEG, "14:03")),
    // c8 (da Bia, encerrada): "obrigada" no fim — não é sem resposta de ninguém
    msg("c8", "IN", sp(SEG, "15:00")),
    msg("c8", "OUT", sp(SEG, "15:01"), { authorId: "bia" }),
    msg("c8", "IN", sp(SEG, "15:02")),
  ],
  conversas: [
    { id: "c1", customerId: "k1", status: "OPEN", assigneeId: "ana" },
    { id: "c2", customerId: "k2", status: "OPEN", assigneeId: "bia" },
    { id: "c3", customerId: "k3", status: "OPEN", assigneeId: "ana" },
    { id: "c4", customerId: "k4", status: "OPEN", assigneeId: null },
    { id: "c5", customerId: "k5", status: "OPEN", assigneeId: "ana" },
    { id: "c6", customerId: "k6", status: "OPEN", assigneeId: "bia" },
    { id: "c7", customerId: "k7", status: "OPEN", assigneeId: "bia" },
    { id: "c8", customerId: "k8", status: "CLOSED", assigneeId: "bia" },
  ],
  contatos: [
    // carteira da Ana: k1 (respondida, pagou), k3 (sem resposta)
    { id: "k1", createdAt: sp(SEG, "10:00"), origin: "WHATSAPP", ownerId: "ana" },
    { id: "k3", createdAt: sp(SEG, "16:00"), origin: "WHATSAPP", ownerId: "ana" },
    // carteira da Bia: k2 (respondida na terça, fez pedido sem pagar), k7 (respondida pela Ana — conta como respondida para a Bia, é lead DELA)
    { id: "k2", createdAt: sp(SEG, "17:50"), origin: "CATALOGO_PUBLICO", ownerId: "bia" },
    { id: "k7", createdAt: sp(SEG, "14:00"), origin: "WHATSAPP", ownerId: "bia" },
    // da loja (sem dona): k4 — só no total
    { id: "k4", createdAt: sp(SEG, "16:30"), origin: "WHATSAPP", ownerId: null },
    // do Super Admin (id de fora): só no total
    { id: "k6", createdAt: sp(SEG, "12:00"), origin: "MANUAL", ownerId: "superadmin" },
  ],
  pedidos: [
    // Ana: pago segunda (100,50) e um pago TERÇA (criado segunda) de 200
    { customerId: "k1", createdAt: sp(SEG, "10:30"), paidAt: sp(SEG, "11:00"), status: "PAGO", netTotal: 100.5, sellerId: "ana" },
    { customerId: "k5", createdAt: sp(SEG, "11:30"), paidAt: sp(TER, "09:00"), status: "ENVIADO", netTotal: 200, sellerId: "ana" },
    // Bia: orçamento de k2 (criado, não pago) e um cancelado (não conta em nada)
    { customerId: "k2", createdAt: sp(SEG, "18:00"), paidAt: null, status: "ORCAMENTO", netTotal: 80, sellerId: "bia" },
    { customerId: "k7", createdAt: sp(SEG, "14:30"), paidAt: null, status: "CANCELADO", netTotal: 50, sellerId: "bia" },
    // loja online: pago, sem dona (RN-005) — só no total
    { customerId: "k6", createdAt: sp(SEG, "13:00"), paidAt: sp(SEG, "13:00"), status: "PAGO", netTotal: 300, sellerId: null },
    // a prazo entregue (RN-069) da Bia: criado, não é faturamento
    { customerId: "k8", createdAt: sp(SEG, "15:10"), paidAt: null, status: "ENTREGUE_A_RECEBER", netTotal: 400, sellerId: "bia" },
  ],
  regua,
};

describe("a conta por vendedora", () => {
  const linhas = calcularFatosPorVendedora(entrada, [SEG, TER], equipe);
  const ana = linhas.find((l) => l.dia === SEG && l.userId === "ana")!;
  const bia = linhas.find((l) => l.dia === SEG && l.userId === "bia")!;

  it("a espera conta para quem RESPONDEU, a sem resposta para quem ASSUMIU, no dia da chegada", () => {
    // Ana respondeu c1 (20 min, no prazo) e c7 (3 min, no prazo); c3 é dela e está sem resposta (estourou) —
    // e isso NÃO vira "fora do prazo" da Ana: no prazo/fora são só das que ela respondeu
    expect([ana.respondidas, ana.noPrazo, ana.foraDoPrazo, ana.semResposta]).toEqual([2, 2, 0, 1]);
    expect(ana.medianaMin).toBe(11.5);
    expect(ana.hist).toEqual([1, 0, 1, 0, 0, 0, 0]); // 3 min (≤5) e 20 min (≤30)
    // Bia respondeu c2 (40 min, fora do prazo) e c8 (1 min, antes do "obrigada") — e c7, que era dela, foi para a Ana
    expect([bia.respondidas, bia.noPrazo, bia.foraDoPrazo, bia.semResposta]).toEqual([2, 1, 1, 0]);
    expect(bia.medianaMin).toBe(20.5);
    // a espera de c2 conta na SEGUNDA (dia da chegada), não na terça da resposta
    expect(linhas.find((l) => l.dia === TER && l.userId === "bia")).toBeUndefined();
  });

  it("o contato novo é da dona da carteira, com o funil dele", () => {
    expect([ana.leads, ana.leadsRespondidos, ana.leadsComPedido, ana.leadsPagaram]).toEqual([2, 1, 1, 1]);
    expect([bia.leads, bia.leadsRespondidos, bia.leadsComPedido, bia.leadsPagaram]).toEqual([2, 2, 1, 0]);
  });

  it("o pedido é da vendedora dele: criados fora cancelado, pagos pela data do pagamento, netTotal", () => {
    expect([ana.pedidos, ana.pedidosPagos, ana.vendido]).toEqual([2, 1, 100.5]);
    const anaTer = linhas.find((l) => l.dia === TER && l.userId === "ana")!;
    expect([anaTer.pedidos, anaTer.pedidosPagos, anaTer.vendido]).toEqual([0, 1, 200]);
    // a prazo entregue conta como criado, não como vendido (RN-069)
    expect([bia.pedidos, bia.pedidosPagos, bia.vendido]).toEqual([2, 0, 0]);
  });

  it("quem é de FORA da loja não vira linha, e quem não teve número no dia também não", () => {
    expect(linhas.some((l) => l.userId === "superadmin")).toBe(false);
    expect(linhas.map((l) => `${l.dia}|${l.userId}`)).toEqual([`${SEG}|ana`, `${SEG}|bia`, `${TER}|ana`]);
    // a Bia fora da equipe: as esperas que ela respondeu ficam só no total da loja
    const soAna = calcularFatosPorVendedora(entrada, [SEG], new Set(["ana"]));
    expect(soAna.map((l) => l.userId)).toEqual(["ana"]);
  });

  it("a soma das pessoas NUNCA passa do total da loja — e a diferença é o que não tem dona", () => {
    const loja = calcularFatos(entrada, [SEG])[0];
    const soma = (k: "respondidas" | "semResposta" | "leads" | "pedidosPagos" | "vendido") =>
      linhas.filter((l) => l.dia === SEG).reduce((a, l) => a + l[k], 0);
    expect(loja.respondidas).toBe(6); // Ana 2 + Bia 2 + celular 1 + superadmin 1
    // a loja conta a aberta estourada como fora do prazo (RN-082); a pessoa não — então a soma das
    // "fora do prazo" das pessoas fica ABAIXO da loja de propósito, e a tela explica
    expect(loja.foraDoPrazo).toBe(3); // c2 (Bia, 40 min) + c3 e c4 abertas estouradas
    expect(soma("respondidas") + 2).toBe(loja.respondidas);
    expect(loja.respondidas - soma("respondidas")).toBe(2);
    expect(loja.semResposta - soma("semResposta")).toBe(1); // c4, na fila
    expect(loja.leads - soma("leads")).toBe(2); // k4 da loja + k6 do superadmin
    expect(loja.pedidosPagos - soma("pedidosPagos")).toBe(1); // a loja online
    expect(loja.vendido - soma("vendido")).toBe(300);
  });
});

describe("a soma da aba", () => {
  const pessoa = { id: "ana", name: "Ana", color: "#000", active: true };
  it("soma os dias, lê % no prazo, conversão e ticket; sem número é nulo e a pessoa não vira linha", () => {
    const s = somarVendedora(pessoa, [
      { userId: "ana", leads: 4, leadsRespondidos: 3, leadsComPedido: 2, leadsPagaram: 1, respondidas: 3, noPrazo: 2, foraDoPrazo: 2, semResposta: 1, hist: "[2,1,0,0,0,0,0]", pedidos: 3, pedidosPagos: 2, vendido: 100 },
      { userId: "ana", leads: 0, leadsRespondidos: 0, leadsComPedido: 0, leadsPagaram: 1, respondidas: 1, noPrazo: 1, foraDoPrazo: 0, semResposta: 0, hist: "[0,0,1,0,0,0,0]", pedidos: 0, pedidosPagos: 1, vendido: 50.5 },
    ]);
    expect([s.respondidas, s.pctNoPrazo, s.conversaoPct, s.pedidosPagos, s.vendido, s.ticket]).toEqual([4, 60, 50, 3, 150.5, 50.17]);
    expect(s.hist).toEqual([2, 1, 1, 0, 0, 0, 0]);
    expect(s.medianaAproxMin).toBe(5);
    expect(teveNumero(s)).toBe(true);
    const vazia = somarVendedora(pessoa, []);
    expect([vazia.pctNoPrazo, vazia.conversaoPct, vazia.ticket, vazia.medianaAproxMin]).toEqual([null, null, null, null]);
    expect(teveNumero(vazia)).toBe(false);
  });
  it("ordena pelo vendido, depois pelo que respondeu, depois pelo nome", () => {
    const base = somarVendedora(pessoa, []);
    const lista = [
      { ...base, nome: "Carla", vendido: 10, respondidas: 1 },
      { ...base, nome: "Bia", vendido: 0, respondidas: 5 },
      { ...base, nome: "Ana", vendido: 0, respondidas: 5 },
      { ...base, nome: "Dani", vendido: 50, respondidas: 0 },
    ];
    expect(ordenarVendedoras(lista).map((p) => p.nome)).toEqual(["Dani", "Carla", "Ana", "Bia"]);
  });
});

describe("o motor grava as linhas por vendedora na mesma rodada, derivadas", () => {
  const src = readFileSync(join(__dirname, "../bi/fatos.ts"), "utf8");
  it("apaga e refaz as linhas dos dias da rodada numa transação com os fatos da loja (o cancelamento de hoje tira a venda de ontem)", () => {
    expect(src).toMatch(/biDiaVendedora\.deleteMany\(\{ where: \{ companyId, dia: \{ in: dias \} \} \}\)/);
    expect(src).toMatch(/biDiaVendedora\.createMany/);
    // o histórico gravado ANTES desta aba (versão velha) conta como dia que falta e é refeito com as pessoas
    expect(src).toMatch(/versao: \{ gte: VERSAO_DOS_FATOS \}/);
    expect(src).toMatch(/versao: VERSAO_DOS_FATOS,/);
    // só gente DA LOJA (RN-013)
    expect(src).toMatch(/db\.user\.findMany\(\{ where: \{ companyId \}, select: \{ id: true \} \}\)/);
  });
  it("a aba Vendedoras existe no BI e leva o período junto", () => {
    const abas = readFileSync(join(__dirname, "../../app/(app)/bi/abas.tsx"), "utf8");
    expect(abas).toMatch(/id: "vendedoras"/);
    const page = readFileSync(join(__dirname, "../../app/(app)/bi/page.tsx"), "utf8");
    expect(page).toMatch(/montarVendedoras\(user\.companyId, periodo\)/);
  });
});
