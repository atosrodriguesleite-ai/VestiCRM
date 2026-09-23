import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resumoDosEnvios } from "../envios/painel";
import { detalheDoFreteRecebido } from "../../app/(app)/envios/envios-view";

// Guarda RN-065
//
// FRETE RECEBIDO NO MÊS (pedido do dono, 23/09/2026): o campo de frete dos
// pedidos PAGOS do mês, pela data do pagamento, todos os canais — e o saldo
// contra as etiquetas comparando OS MESMOS pedidos (só os que têm etiqueta
// daqui), nunca o "gasto do mês", que é outra população.

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const base = { porStatus: [], parados: 0, entregues: [] as { shippedAt: Date | null; deliveredAt: Date | null }[] };
const NBSP = "\u00a0";

describe("a conta pura do frete recebido", () => {
  it("soma em centavos e o saldo é sobre os pedidos COM etiqueta daqui", () => {
    const r = resumoDosEnvios({
      ...base,
      gastoMes: 1171.46, // etiquetas compradas no mês — NÃO entra no saldo
      freteRecebidoMes: {
        soma: 200.004,
        pedidos: 3,
        comEtiqueta: { frete: 120.1, custo: 95.55, pedidos: 2 },
      },
    });
    expect(r.freteRecebidoMes).toBe(200);
    expect(r.pedidosComFreteMes).toBe(3);
    expect(r.freteComEtiquetaMes).toBe(120.1);
    expect(r.custoDasEtiquetasMes).toBe(95.55);
    expect(r.saldoFreteMes).toBe(24.55); // 120,10 − 95,55, nunca 24.549999
    expect(r.gastoMes).toBe(1171.46);
  });

  it("etiqueta mais cara que o frete cobrado dá saldo negativo", () => {
    const r = resumoDosEnvios({
      ...base,
      gastoMes: 0,
      freteRecebidoMes: { soma: 900.1, pedidos: 12, comEtiqueta: { frete: 900.1, custo: 1171.46, pedidos: 12 } },
    });
    expect(r.saldoFreteMes).toBe(-271.36);
  });

  it("sem pedido pago com etiqueta daqui não há saldo (null) — nem quando o mês tem etiqueta comprada", () => {
    // o caso da revisão: pedido pago dia 30, etiqueta comprada dia 1º do mês
    // seguinte — o gasto do mês tem R$ 35 e nenhum pedido pago do mês tem
    // etiqueta; a versão antiga dizia "faltou R$ 35" em vermelho
    const r = resumoDosEnvios({
      ...base,
      gastoMes: 35,
      freteRecebidoMes: { soma: 0, pedidos: 0, comEtiqueta: { frete: 0, custo: 0, pedidos: 0 } },
    });
    expect(r.saldoFreteMes).toBeNull();
  });
});

describe("a legenda do cartão", () => {
  it("diz quantos cobraram frete e o saldo com sinal, curta", () => {
    expect(detalheDoFreteRecebido({ pedidosComFreteMes: 12, saldoFreteMes: -271.36 })).toBe(
      `12 pedidos cobraram frete · vs. etiquetas −R$${NBSP}271,36`
    );
    expect(detalheDoFreteRecebido({ pedidosComFreteMes: 1, saldoFreteMes: 24.55 })).toBe(
      `1 pedido cobrou frete · vs. etiquetas +R$${NBSP}24,55`
    );
  });
  it("sem saldo (nenhum pedido com etiqueta) não inventa comparação", () => {
    expect(detalheDoFreteRecebido({ pedidosComFreteMes: 0, saldoFreteMes: null })).toBe(
      "nenhum pedido pago cobrou frete"
    );
    expect(detalheDoFreteRecebido({ pedidosComFreteMes: 3, saldoFreteMes: null })).toBe(
      "3 pedidos cobraram frete"
    );
  });
});

describe("a consulta", () => {
  it("é pedido PAGO pela data do pagamento, no recorte de quem vê, somando o FRETE (nunca o total); o saldo usa a MESMA turma", () => {
    const rota = ler("src/app/api/envios/route.ts");
    const turma = rota.slice(rota.indexOf("const pagosDoMes = {"), rota.indexOf("const etiquetaViva"));
    expect(turma).toContain("...escopoDoUsuario");
    expect(turma).toContain("status: { in: PAID_ORDER_STATUSES }");
    expect(turma).toContain("paidAt: { gte: inicioDoMes }");
    expect(rota).toContain("where: { ...pagosDoMes, shippingFee: { gt: 0 } }");
    expect(rota).toContain("where: { ...pagosDoMes, shipping: { is: etiquetaViva } }");
    expect(rota).toContain("where: { ...etiquetaViva, order: pagosDoMes }");
    expect(rota).not.toContain("_sum: { total: true }");
  });
});
