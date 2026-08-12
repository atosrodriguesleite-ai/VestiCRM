import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emCentavos, metodoDaCaptura } from "../infinitepay";

/**
 * INFINITEPAY (11/08/2026) — guardas da integração de checkout por link.
 * O E2E completo (link → webhook → liquidação) roda contra o Postgres local
 * com API de mentira; aqui ficam as regras que nunca podem regredir.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("conversão de centavos (o erro de 100× mora aqui)", () => {
  it("reais → centavos inteiro, sem surpresa de ponto flutuante", () => {
    expect(emCentavos(115)).toBe(11500);
    expect(emCentavos(0.1 + 0.2)).toBe(30);
    expect(emCentavos(19.99)).toBe(1999);
    expect(emCentavos(1234.56)).toBe(123456);
  });
  it("capture_method vira nossa forma de pagamento", () => {
    expect(metodoDaCaptura("pix")).toBe("PIX");
    expect(metodoDaCaptura("PIX")).toBe("PIX");
    expect(metodoDaCaptura("credit_card")).toBe("CARTAO");
    expect(metodoDaCaptura("banana")).toBe("OUTRO");
    expect(metodoDaCaptura(null)).toBe("OUTRO");
  });
});

describe("o aviso NUNCA confirma sozinho", () => {
  const lib = ler("src/lib/infinitepay.ts");
  it("a confirmação passa pela conferência na API (payment_check)", () => {
    expect(lib).toContain("conferirPagamentoInfinitePay(conn");
    expect(lib).toContain('if (!check.paid) return { resultado: "nao-pago" }');
  });
  it("conferência fora do ar NÃO confirma — pede reenvio", () => {
    expect(lib).toContain('if (!check.ok) return { resultado: "indisponivel" }');
    const wh = ler("src/app/api/infinitepay/webhook/[token]/route.ts");
    expect(wh).toContain('r.resultado === "indisponivel"');
    expect(wh).toContain("status: 500");
  });
  it("o pedido tem que ser DA LOJA da conexão (multi-tenant)", () => {
    expect(lib).toContain("id: order_nsu, companyId");
  });
  it("a liquidação usa o settle blindado (trava, valor conferido, estoque)", () => {
    expect(lib).toContain("settleOrderPaid(order.id");
  });
  // GRAVE (auditoria 11/08/2026): sem valor liquidava um pedido de R$5000 com R$1
  it("VALOR é obrigatório — sem paid_amount, nunca liquida", () => {
    expect(lib).toContain('if (args.paid_amount == null) return { resultado: "indisponivel" }');
  });
  it("uma transação vale para UM pedido só (fecha replay e P2002)", () => {
    expect(lib).toContain("jaRegistrada.orderId !== order.id");
  });
  it("settle recusado (cancelado/divergente) NÃO diz 'pago'", () => {
    expect(lib).toContain('if (!r.ok) return { resultado: "nao-liquidado" }');
  });
  it("carimba UMA linha por id (não updateMany que estoura o índice único)", () => {
    expect(lib).toContain("db.payment.update({");
    expect(lib).toContain('(e as { code?: string })?.code !== "P2002"');
  });
  it("os fetches têm timeout (InfinitePay lenta não segura a função)", () => {
    expect(lib).toContain("AbortSignal.timeout");
  });
});

describe("as portas públicas passam pelo middleware e não escrevem à toa", () => {
  it("webhook e página de retorno estão liberados no middleware", () => {
    const mw = ler("src/middleware.ts");
    expect(mw).toContain('"/api/infinitepay/webhook"');
    expect(mw).toContain('"/pagamento/confirmado"');
  });
  it("a página de retorno é SÓ leitura — não confirma nada (params forjáveis)", () => {
    const pg = ler("src/app/pagamento/confirmado/page.tsx");
    expect(pg).not.toContain("confirmarPagamentoInfinitePay");
    expect(pg).toContain("PAID_ORDER_STATUSES");
  });
  it("edição/cancelamento invalidam o link InfinitePay (não só o do MP)", () => {
    const rota = ler("src/app/api/orders/[id]/route.ts");
    const n = rota.split('provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] }').length - 1;
    expect(n).toBeGreaterThanOrEqual(4); // 3 invalidações + guard do DELETE
  });
});

describe("portas com as regras da casa", () => {
  it("webhook: loja suspensa não ingere; token desconhecido é 200 mudo", () => {
    const wh = ler("src/app/api/infinitepay/webhook/[token]/route.ts");
    expect(wh).toContain("suspended");
    expect(wh).toContain("if (!conn) return NextResponse.json({ success: true })");
  });
  it("conectar: só admin, token criptografado, webhook token estável", () => {
    const rota = ler("src/app/api/infinitepay/conectar/route.ts");
    expect(rota).toContain("podeOperarIntegracoes");
    expect(rota).toContain("encryptSecret");
    expect(rota).toContain("existente?.webhookToken ??");
  });
  it("conectar: salvar sem digitar o token NÃO apaga o guardado", () => {
    const rota = ler("src/app/api/infinitepay/conectar/route.ts");
    expect(rota).toContain("apiToken === undefined");
  });
  it("webhook aceita valor em paid_amount OU amount", () => {
    const wh = ler("src/app/api/infinitepay/webhook/[token]/route.ts");
    expect(wh).toContain("body.paid_amount ?? body.amount");
  });
  it("gerar link: escopo do pedido, reaproveita link vigente do MESMO valor", () => {
    const rota = ler("src/app/api/orders/[id]/infinitepay/route.ts");
    expect(rota).toContain("orderScope(user)");
    expect(rota).toContain("Math.abs(existente.amount - order.total) < 0.005");
  });
  it("página de retorno é SÓ leitura (não liquida — params forjáveis)", () => {
    const pg = ler("src/app/pagamento/confirmado/page.tsx");
    expect(pg).not.toContain("confirmarPagamentoInfinitePay");
    expect(pg).not.toContain('status: "PAGO"');
  });
  it("pagar por um caminho invalida as cobranças irmãs (MP e InfinitePay)", () => {
    expect(ler("src/lib/settle-order.ts")).toContain(
      'provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] }'
    );
  });
  it("a migração é reexecutável e está na lista do destravador", () => {
    expect(ler("prisma/migrations/20260811120000_infinitepay/migration.sql")).toContain(
      "IF NOT EXISTS"
    );
    expect(ler("scripts/migrate-deploy.mjs")).toContain("20260811120000_infinitepay");
  });
});
