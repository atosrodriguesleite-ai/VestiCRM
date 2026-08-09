import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { itensDaNotaFiscal } from "../bling";
import { round2 } from "../orders";

/**
 * DINHEIRO E NOTA FISCAL BLINDADOS (auditoria 09/08/2026).
 *
 * O dono pediu a auditoria antes de ligar o Mercado Pago e o Bling em
 * produção: "não pode ter erros nesse módulo". A revisão especialista achou
 * 10 problemas; este arquivo prende as correções no lugar.
 */

const somaDaNota = (itens: { valor: number; quantidade: number }[]) =>
  round2(itens.reduce((s, it) => s + round2(it.valor * it.quantidade), 0));

const item = (quantity: number, unitPrice: number, name = "Peça") => ({
  name,
  color: null,
  size: null,
  sku: null,
  quantity,
  unitPrice,
});

describe("a nota fecha NO CENTAVO com o valor cobrado", () => {
  it("o caso impossível em 2 casas: 3 peças somando R$ 20,00", () => {
    // 3 × 6,67 = 20,01 e 3 × 6,66 = 19,98 — em 2 casas não existe resposta.
    // Em 4 casas existe: 6,6667 × 3 = 20,0001 → R$ 20,00.
    const r = itensDaNotaFiscal([item(3, 10)], 30, 20);
    expect(r.fecha).toBe(true);
    expect(somaDaNota(r.itens)).toBe(20);
  });

  it("sem desconto, os preços saem como estão", () => {
    const r = itensDaNotaFiscal([item(2, 49.9), item(1, 99.8)], 199.6, 199.6);
    expect(r.fecha).toBe(true);
    expect(somaDaNota(r.itens)).toBe(199.6);
  });

  it("desconto quebrado em vários itens de quantidades diferentes", () => {
    const itens = [item(3, 39.9), item(7, 12.5), item(2, 89.0), item(1, 15.0)];
    const subtotal = round2(3 * 39.9 + 7 * 12.5 + 2 * 89.0 + 15.0);
    const netTotal = round2(subtotal - 33.33); // desconto feio de propósito
    const r = itensDaNotaFiscal(itens, subtotal, netTotal);
    expect(r.fecha).toBe(true);
    expect(somaDaNota(r.itens)).toBe(netTotal);
  });

  it("acréscimo (netTotal MAIOR que o subtotal) também fecha", () => {
    const r = itensDaNotaFiscal([item(3, 33.33)], 99.99, 105.0);
    expect(r.fecha).toBe(true);
    expect(somaDaNota(r.itens)).toBe(105.0);
  });

  it("varredura: 200 combinações de quantidades e descontos fecham todas", () => {
    for (let q = 1; q <= 20; q++) {
      for (let d = 0; d < 10; d++) {
        const preco = 9.9 + d * 3.37;
        const subtotal = round2(q * preco + 37.7);
        const netTotal = round2(subtotal - d * 1.11);
        const r = itensDaNotaFiscal([item(q, preco), item(1, 37.7)], subtotal, netTotal);
        expect(r.fecha, `qtd=${q} desc=${d}`).toBe(true);
        expect(somaDaNota(r.itens), `qtd=${q} desc=${d}`).toBe(netTotal);
      }
    }
  });

  it("nenhum item sai com valor negativo ou zerado", () => {
    const r = itensDaNotaFiscal([item(1, 10), item(1, 0.05)], 10.05, 10.0);
    for (const it of r.itens) expect(it.valor).toBeGreaterThan(0);
  });

  it("quando NÃO fecha, avisa em vez de emitir nota divergente", () => {
    // a função é honesta: `fecha` é conferido de verdade, não presumido
    const fonte = readFileSync(join(process.cwd(), "src/lib/bling.ts"), "utf8");
    expect(fonte).toContain("fecha: soma() === alvo");
    expect(fonte).toContain("if (!conta.fecha)");
  });
});

describe("NF-e não duplica na SEFAZ", () => {
  const bling = readFileSync(join(process.cwd(), "src/lib/bling.ts"), "utf8");

  it("a emissão tem TRAVA ATÔMICA (dois cliques juntos → uma nota)", () => {
    // ler-e-checar deixava os dois cliques passarem; só o updateMany
    // condicional garante um vencedor único
    expect(bling).toContain('data: { nfeStatus: "EMITINDO" }');
    expect(/trava\.count === 0/.test(bling)).toBe(true);
  });

  it("nota com ERRO é RETOMADA, nunca recriada às cegas", () => {
    // o caso traiçoeiro: timeout DEPOIS de a SEFAZ aceitar. Reemitir sem
    // consultar criava a segunda nota do mesmo pedido.
    expect(bling).toContain("retomarNfeComErro");
    expect(/if \(consulta\.situacao === "AUTORIZADA"\)/.test(bling)).toBe(true);
    // rascunho pendente reenvia O MESMO id
    expect(bling).toContain("transmitirEGravar(companyId, orderId, blingId)");
  });

  it("consulta falhada não vira 'pendente' — senão apagava nota autorizada", () => {
    expect(bling).toContain("ok: false, situacao:");
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/orders/[id]/nfe/route.ts"),
      "utf8"
    );
    expect(rota).toContain("if (!c.ok)");
  });

  it("renovação de token sem refresh novo não derruba a emissão", () => {
    expect(bling).not.toContain("t.refresh_token!");
    // e a PRIMEIRA conexão sem refresh é recusada (morreria sozinha em ~6h)
    expect(bling).toContain("if (!existente && !refresh) return null;");
  });

  it("nota CANCELADA no Bling não prende o pedido sem nota (revisão 2ª volta)", () => {
    expect(bling).toContain('{ nfeStatus: "CANCELADA" }');
  });

  it("a consulta não passa por cima da máquina de estados da emissão", () => {
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/orders/[id]/nfe/route.ts"),
      "utf8"
    );
    // EMITINDO da consulta não apaga ERRO recuperável; REJEITADA/CANCELADA
    // de nota velha não derruba a trava de uma emissão em andamento
    expect(rota).toContain('nfeStatus: { not: "ERRO" }');
    expect(rota).toContain('nfeStatus: { not: "EMITINDO" }');
  });

  it("falha no meio da emissão SOLTA a trava (o pedido não fica preso)", () => {
    expect(bling).toContain("soltarTrava");
  });
});

describe("Mercado Pago: um pagamento, uma confirmação", () => {
  const settle = readFileSync(join(process.cwd(), "src/lib/settle-order.ts"), "utf8");
  const mp = readFileSync(join(process.cwd(), "src/lib/mercadopago.ts"), "utf8");
  const webhook = readFileSync(
    join(process.cwd(), "src/app/api/mercadopago/webhook/[token]/route.ts"),
    "utf8"
  );
  const pix = readFileSync(
    join(process.cwd(), "src/app/api/orders/[id]/pix/route.ts"),
    "utf8"
  );

  it("a liquidação confirma SÓ a cobrança paga (não todas as pendentes)", () => {
    // confirmar todas escondia o segundo pagamento real da cliente
    expect(settle).toContain("...(mpPaymentId ? { mpPaymentId } : {})");
  });

  it("segundo pagamento em pedido JÁ PAGO vira alarme de duplicidade", () => {
    expect(settle).toContain("pago duas vezes");
  });

  it("a cobrança irmã é cancelada NA FONTE (o QR antigo para de valer)", () => {
    expect(mp).toContain("export async function mpCancelPayment");
    // AGUARDADO: na Vercel, disparo sem await morre quando a resposta sai
    expect(settle).toContain("await Promise.allSettled(");
    // o link de cartão (sem mpPaymentId) também é invalidado localmente
    expect(settle).not.toContain("mpPaymentId: { not: null }");
  });

  it("pagou A MAIS: liquida, mas o troco a devolver fica registrado", () => {
    expect(settle).toContain("trocoADevolver");
    expect(settle).toContain("estorno parcial");
  });

  it("o webhook informa QUAL cobrança foi paga", () => {
    expect(webhook).toContain("mpPaymentId\n      );");
  });

  it("token do webhook é DETERMINÍSTICO — reconectar não mata cobrança antiga", () => {
    // a URL de aviso fica gravada em cada cobrança; token sorteado a cada
    // conexão deixava o pedido pago preso em 'aguardando' para sempre
    expect(mp).toContain("mpWebhookToken");
    expect(mp).toContain('createHmac("sha256", CRED_SECRET)');
    expect(mp).not.toContain("randomBytes(24)");
  });

  it("reaproveitar Pix filtra POR MÉTODO (link de cartão não esconde o QR)", () => {
    expect(pix).toContain('method: "PIX"');
    // e confere o VALOR: QR antigo com valor errado nunca é devolvido
    expect(pix).toContain("Math.abs(existente.amount - order.total) < 0.005");
  });

  it("a chave de idempotência muda a cada tentativa (100→120→100 não trava)", () => {
    expect(mp).toContain("-t${input.tentativa}");
    expect(pix).toContain("const tentativa = await db.payment.count(");
  });

  it("dois cliques simultâneos no Pix devolvem a MESMA cobrança (sem 500)", () => {
    expect(pix).toContain("const gemea = await db.payment.findUnique(");
  });
});
