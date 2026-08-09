import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LOTE 2 — DINHEIRO (auditoria 07/08/2026). Guardas de arquivo das correções
 * de NF-e, etiqueta Melhor Envio, Mercado Pago, cancelamento e MRR.
 * (MP/Bling/ME não estão conectados em produção — estes guardas travam a
 * regra no código; o E2E fica para a homologação quando as chaves entrarem.)
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("NF-e bate com o que a cliente paga", () => {
  const bling = ler("src/lib/bling.ts");
  it("distribui desconto nos itens e destaca frete no transporte", () => {
    // a conta virou função pura (itensDaNotaFiscal) na blindagem 09/08 —
    // os casos de centavo vivem em nfe-e-pix-blindados.test.ts
    expect(bling).toContain("netTotal / subtotal");
    expect(bling).toContain("itensDaNotaFiscal(order.items, order.subtotal, order.netTotal)");
    expect(bling).toContain("transporte: { frete:");
  });
  it("descrição do item sem 'null null'", () => {
    expect(bling).toContain('[i.name, i.color, i.size].filter(Boolean).join(" ")');
  });
  it("não emite duas notas nem nota de pedido não pago", () => {
    expect(bling).toContain("order.nfeBlingId && order.nfeStatus");
    expect(bling).toContain("PAID_ORDER_STATUSES");
  });
});

describe("etiqueta Melhor Envio: dinheiro pago nunca se perde", () => {
  const me = ler("src/lib/melhorenvio.ts");
  it("checkout ok + generate falho retorna pendente (não erro)", () => {
    expect(me).toContain("pendente: true");
    expect(me).toContain("meRetomarEtiqueta");
  });
  it("a rota grava GERANDO e tem a ação 'gerar' para retomar", () => {
    const rota = ler("src/app/api/orders/[id]/frete/route.ts");
    expect(rota).toContain('r.pendente ? "GERANDO"');
    expect(rota).toContain('action === "gerar"');
  });
});

describe("cancelamento trata dinheiro e frete", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");
  it("expira cobrança MP pendente, avisa estorno manual e lembra etiqueta ME", () => {
    expect(rota).toContain("o valor NÃO volta sozinho");
    expect(rota).toContain("Cancele a etiqueta no painel de Envio");
  });
  it("editar sem mudar o total NÃO invalida o Pix (evita P2002)", () => {
    expect(rota).toContain("if (totals.total !== order.total)");
  });
  it("não exclui pedido com pagamento MP confirmado", () => {
    expect(rota).toContain('provider: "MERCADO_PAGO", status: "CONFIRMADO"');
    expect(rota).toContain("não pode ser excluído");
  });
});

describe("webhook MP não sobrescreve o mpPaymentId do outro método", () => {
  it("amarra à pendente do MESMO método (Pix/Cartão)", () => {
    const wh = ler("src/app/api/mercadopago/webhook/[token]/route.ts");
    expect(wh).toContain("method: metodo");
    expect(wh).not.toContain("...(cartao ? { method: \"CARTAO\" } : {})");
  });
});

describe("MRR de módulos deixa de ser sempre R$0", () => {
  const mod = ler("src/lib/modulos.ts");
  it("o cálculo deriva das chavinhas de Company (não da tabela vazia)", () => {
    expect(mod).toContain("ativosDosFlags");
    expect(mod).toContain("m.flag && flags[m.flag]");
  });
});

describe("Financeiro e CSV honestos", () => {
  it("Pix aguardando não conta pedido cancelado", () => {
    expect(ler("src/app/(app)/financeiro/page.tsx")).toContain(
      'status: { not: "CANCELADO" }'
    );
  });
  it("CSV de pedidos: coluna de acréscimo + valor vendido + neutraliza fórmula", () => {
    const csv = ler("src/app/api/export/pedidos/route.ts");
    expect(csv).toContain("Acréscimo (R$)");
    expect(csv).toContain("Valor vendido (R$)");
    expect(csv).toContain("^[=+\\-@\\t\\r]");
  });
});
