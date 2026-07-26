import { describe, expect, it } from "vitest";
import {
  custoMedioFaccao,
  loteAtrasado,
  pagamentoVencido,
  precoDoItem,
  valoresDoLote,
  type LoteCusto,
} from "../producao-faccao";

const item = (
  sent: number,
  good: number,
  defect: number,
  pricePerPiece = 0
) => ({ sent, good, defect, pricePerPiece });

const lote = (over: Partial<LoteCusto> = {}): LoteCusto => ({
  destination: "FACCAO",
  status: "FECHADO",
  paymentStatus: "PENDENTE",
  paidAmount: null,
  items: [item(10, 10, 0, 5)],
  faction: { pricePerPiece: 3 },
  ...over,
});

describe("preço por peça (histórico)", () => {
  it("usa o preço CONGELADO no item, não o da facção", () => {
    expect(precoDoItem({ pricePerPiece: 5 }, { pricePerPiece: 3 })).toBe(5);
  });

  it("item sem snapshot (legado) cai no preço atual da facção", () => {
    expect(precoDoItem({ pricePerPiece: 0 }, { pricePerPiece: 3 })).toBe(3);
  });

  it("sem facção e sem snapshot vale zero", () => {
    expect(precoDoItem({ pricePerPiece: 0 }, null)).toBe(0);
  });

  it("reajustar a facção NÃO muda o custo de lote já enviado", () => {
    const antes = valoresDoLote(lote()).aPagar;
    const depois = valoresDoLote(lote({ faction: { pricePerPiece: 99 } })).aPagar;
    expect(antes).toBe(50); // 10 boas × R$ 5 congelados
    expect(depois).toBe(antes);
  });
});

describe("valores do lote", () => {
  it("previsto usa enviadas; a pagar usa só as BOAS", () => {
    const v = valoresDoLote(lote({ items: [item(10, 7, 2, 4)] }));
    expect(v.previsto).toBe(40); // 10 × 4
    expect(v.aPagar).toBe(28); // 7 boas × 4 (defeito e faltante não pagam)
    expect(v.pecasBoas).toBe(7);
    expect(v.pecasEnviadas).toBe(10);
  });

  it("pendente: saldo é tudo que a facção ganhou", () => {
    const v = valoresDoLote(lote());
    expect(v.pago).toBe(0);
    expect(v.saldo).toBe(50);
  });

  it("marcado como PAGO sem valor: quita pelo calculado", () => {
    const v = valoresDoLote(lote({ paymentStatus: "PAGO" }));
    expect(v.pago).toBe(50);
    expect(v.saldo).toBe(0);
  });

  it("valor pago informado manda (desconto acordado)", () => {
    const v = valoresDoLote(lote({ paymentStatus: "PAGO", paidAmount: 45 }));
    expect(v.pago).toBe(45);
    expect(v.saldo).toBe(5);
  });

  it("adiantamento em lote ainda pendente reduz o saldo", () => {
    const v = valoresDoLote(lote({ paidAmount: 20 }));
    expect(v.pago).toBe(20);
    expect(v.saldo).toBe(30);
  });

  it("preços diferentes por modelo somam certo", () => {
    const v = valoresDoLote(
      lote({ items: [item(5, 5, 0, 4), item(10, 8, 1, 2.5)] })
    );
    expect(v.aPagar).toBe(40); // 5×4 + 8×2,5
  });
});

describe("custo médio da facção (entra no custo por peça)", () => {
  it("média ponderada pelas peças boas de lotes fechados", () => {
    const media = custoMedioFaccao([
      lote({ items: [item(10, 10, 0, 4)] }),
      lote({ items: [item(10, 10, 0, 6)] }),
    ]);
    expect(media).toBe(5);
  });

  it("ignora lote em aberto (conta ainda não fechou)", () => {
    const media = custoMedioFaccao([
      lote({ status: "PARCIAL", items: [item(10, 5, 0, 100)] }),
      lote({ items: [item(10, 10, 0, 4)] }),
    ]);
    expect(media).toBe(4);
  });

  it("ignora costura interna (não tem custo de facção)", () => {
    const media = custoMedioFaccao([
      lote({ destination: "INTERNA", items: [item(10, 10, 0, 99)] }),
      lote({ items: [item(10, 10, 0, 4)] }),
    ]);
    expect(media).toBe(4);
  });

  it("ignora peça sem preço conhecido em vez de contar como zero", () => {
    const media = custoMedioFaccao([
      lote({ items: [item(10, 10, 0, 0)], faction: null }),
      lote({ items: [item(10, 10, 0, 4)] }),
    ]);
    expect(media).toBe(4); // sem preço não puxa a média pra baixo
  });

  it("sem nada fechado devolve null (não inventa custo)", () => {
    expect(custoMedioFaccao([])).toBeNull();
  });
});

describe("alertas de prazo", () => {
  const ontem = new Date("2026-07-20T12:00:00Z");
  const hoje = new Date("2026-07-25T12:00:00Z");
  const amanha = new Date("2026-07-30T12:00:00Z");

  it("lote atrasado: prazo venceu e ainda tem peça fora", () => {
    expect(loteAtrasado({ status: "ENVIADO", dueBackDate: ontem }, 5, hoje)).toBe(true);
  });

  it("dentro do prazo não é atraso", () => {
    expect(loteAtrasado({ status: "ENVIADO", dueBackDate: amanha }, 5, hoje)).toBe(false);
  });

  it("lote fechado nunca é atrasado", () => {
    expect(loteAtrasado({ status: "FECHADO", dueBackDate: ontem }, 5, hoje)).toBe(false);
  });

  it("tudo voltou: não é atraso mesmo com prazo vencido", () => {
    expect(loteAtrasado({ status: "PARCIAL", dueBackDate: ontem }, 0, hoje)).toBe(false);
  });

  it("sem prazo combinado não cobra atraso", () => {
    expect(loteAtrasado({ status: "ENVIADO", dueBackDate: null }, 5, hoje)).toBe(false);
  });

  it("pagamento vencido só enquanto pendente", () => {
    expect(pagamentoVencido({ paymentStatus: "PENDENTE", dueDate: ontem }, hoje)).toBe(true);
    expect(pagamentoVencido({ paymentStatus: "PAGO", dueDate: ontem }, hoje)).toBe(false);
    expect(pagamentoVencido({ paymentStatus: "PENDENTE", dueDate: amanha }, hoje)).toBe(false);
  });
});
