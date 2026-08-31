// Guarda RN-036, RN-037
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { faturaDaCompra, ultimoDiaDoMes } from "../financeiro/cartao-fatura";
import {
  chaveDaComissao,
  lerChaveDaComissao,
  periodosSeCruzam,
} from "../financeiro/comissoes";
import { janelaDoPeriodo } from "../financeiro/comissoes";

/**
 * RN-036 · Nota fiscal vista do financeiro e comissão virando conta a pagar.
 * RN-037 · Cartão de crédito: a conta do cartão não guarda dinheiro, junta as
 * compras numa fatura; o dinheiro sai da conta do banco no vencimento.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("em qual fatura a compra cai (RN-037)", () => {
  // cartão que fecha dia 28 e vence dia 5 (o mais comum)
  const cartao = { diaFechamento: 28, diaVencimento: 5 };

  it("compra ANTES do fechamento cai na fatura que vence logo", () => {
    expect(faturaDaCompra("2026-09-10", cartao)).toEqual({
      fatura: "2026-10",
      vencimento: "2026-10-05",
    });
  });

  it("compra NO DIA do fechamento já é da fatura seguinte", () => {
    // é assim que o cartão funciona: o dia do fechamento já entrou na próxima
    expect(faturaDaCompra("2026-09-28", cartao).vencimento).toBe("2026-11-05");
  });

  it("compra depois do fechamento cai na próxima", () => {
    expect(faturaDaCompra("2026-09-29", cartao).vencimento).toBe("2026-11-05");
  });

  it("vira o ano sem tropeçar", () => {
    expect(faturaDaCompra("2026-12-29", cartao).vencimento).toBe("2027-02-05");
    expect(faturaDaCompra("2026-12-10", cartao).vencimento).toBe("2027-01-05");
  });

  it("cartão que fecha e vence no mesmo ciclo (fecha 5, vence 15)", () => {
    const outro = { diaFechamento: 5, diaVencimento: 15 };
    expect(faturaDaCompra("2026-09-01", outro).vencimento).toBe("2026-09-15");
    expect(faturaDaCompra("2026-09-05", outro).vencimento).toBe("2026-10-15");
  });

  it("dia 31 num mês curto cai no último dia — nunca vaza para o mês seguinte", () => {
    const dia31 = { diaFechamento: 20, diaVencimento: 31 };
    expect(faturaDaCompra("2026-01-25", dia31).vencimento).toBe("2026-02-28");
    expect(ultimoDiaDoMes(2026, 2)).toBe(28);
    expect(ultimoDiaDoMes(2028, 2)).toBe(29); // bissexto
  });

  it("fechamento dia 31 em fevereiro usa o último dia do mês", () => {
    const fecha31 = { diaFechamento: 31, diaVencimento: 10 };
    // em fevereiro o fechamento é dia 28: comprou no dia 28, já é a próxima
    expect(faturaDaCompra("2026-02-28", fecha31).vencimento).toBe("2026-04-10");
    expect(faturaDaCompra("2026-02-27", fecha31).vencimento).toBe("2026-03-10");
  });
});

describe("o cartão não guarda dinheiro (RN-037)", () => {
  const motor = ler("src/lib/financeiro/cartao.ts");

  it("pagar a fatura dá baixa na conta do BANCO, não no cartão", () => {
    expect(motor).toContain("A fatura de um cartão não se paga com outro cartão");
    expect(motor).toContain("contaId: conta.id");
  });

  it("a fatura já paga não é paga de novo", () => {
    expect(motor).toContain("if (saldo <= 0) continue;");
    expect(motor).toContain("Esta fatura já está paga");
  });

  it("o pagamento roda em transação SERIALIZÁVEL (RN-028)", () => {
    // duas pessoas pagando a mesma fatura junto pagariam em dobro
    expect(motor).toContain("Serializable");
    expect(motor).toContain("P2034");
  });

  it("cartão nunca vira a conta PADRÃO (a venda paga cairia nele)", () => {
    const post = ler("src/app/api/financeiro/contas/route.ts");
    const patch = ler("src/app/api/financeiro/contas/[id]/route.ts");
    expect(post).toContain('parsed.data.tipo === "CARTAO"');
    expect(post).toContain("padrao: false");
    expect(patch).toContain('(campos.tipo ?? alvo.tipo) === "CARTAO"');
  });

  it("a porta da fatura é gated como todas as do módulo (RN-027)", () => {
    expect(ler("src/app/api/financeiro/cartoes/[id]/fatura/route.ts")).toContain(
      "porteiraFinanceiro"
    );
    expect(ler("src/app/(app)/financeiro/cartoes/page.tsx")).toContain(
      "financeiroLiberado"
    );
  });
});

describe("comissão vira conta a pagar (RN-036)", () => {
  const motor = ler("src/lib/financeiro/comissoes.ts");

  it("a chave guarda vendedora e período — e volta a ser lida", () => {
    const chave = chaveDaComissao("v1", "2026-09-01", "2026-09-30");
    expect(chave).toBe("v1:2026-09-01:2026-09-30");
    expect(lerChaveDaComissao(chave)).toEqual({
      sellerId: "v1",
      de: "2026-09-01",
      ate: "2026-09-30",
    });
    expect(lerChaveDaComissao("lixo")).toBeNull();
  });

  it("o ÚLTIMO DIA do período entra na comissão", () => {
    // parar às 02:59 do próprio dia 30 (o engano fácil) deixaria o dia
    // inteiro de fora — e é no fim do mês que a loja mais vende
    const j = janelaDoPeriodo("2026-09-01", "2026-09-30");
    expect(j.de.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-10-01T02:59:59.999Z");
    // uma venda paga às 22h do dia 30 (01/10 01:00 UTC) está dentro
    expect(new Date("2026-10-01T01:00:00.000Z") <= j.ate).toBe(true);
    // e a do dia 1º de outubro, fora
    expect(new Date("2026-10-01T15:00:00.000Z") <= j.ate).toBe(false);
  });

  it("período que ENCOSTA em outro é recusado (pagaria duas vezes)", () => {
    const setembro = { de: "2026-09-01", ate: "2026-09-30" };
    expect(periodosSeCruzam(setembro, { de: "2026-09-15", ate: "2026-10-15" })).toBe(true);
    expect(periodosSeCruzam(setembro, { de: "2026-09-30", ate: "2026-10-31" })).toBe(true);
    expect(periodosSeCruzam(setembro, { de: "2026-10-01", ate: "2026-10-31" })).toBe(false);
    expect(periodosSeCruzam(setembro, { de: "2026-08-01", ate: "2026-08-31" })).toBe(false);
  });

  it("1 comissão = 1 conta a pagar (o único do banco segura a corrida)", () => {
    expect(motor).toContain("origem: ORIGEM_COMISSAO");
    expect(motor).toContain("const chaveBase = chaveDaComissao(sellerId, de, ate)");
    expect(motor).toContain('e.code === "P2002"');
    expect(ler("prisma/schema.prisma")).toContain("@@unique([companyId, origem, origemId])");
  });

  it("comissão CANCELADA pode ser lançada de novo (a chave ganha sufixo)", () => {
    // o único vale para cancelado também: sem chave nova, a lojista cancela
    // (como a própria mensagem manda) e nunca mais lança aquele período
    expect(motor).toContain("`${chaveBase}#${mesmasChaves + 1}`");
    // e o período que a chave representa continua legível
    expect(lerChaveDaComissao("v1:2026-09-01:2026-09-30#2")).toEqual({
      sellerId: "v1",
      de: "2026-09-01",
      ate: "2026-09-30",
    });
  });

  it("período que ainda NÃO fechou não vira conta a pagar", () => {
    // a venda de hoje à tarde ficaria dentro do período e fora do valor
    expect(motor).toContain("Este período ainda não fechou");
    expect(motor).toContain("ate >= diaSP(hoje)");
  });

  it("a conta da comissão é a MESMA da tela (nunca soma frete)", () => {
    // dois números diferentes para a mesma comissão começam uma discussão
    // com a equipe — e frete não é venda (RN-002)
    expect(motor).toContain("PAID_ORDER_STATUSES");
    expect(motor).toContain("commissionBase");
    expect(motor).toContain("usaVendido ? o.netTotal : o.subtotal");
    expect(motor).not.toMatch(/o\.total/);
  });

  it("a comissão entra na categoria de despesa com vendas", () => {
    expect(motor).toContain('CODIGO_CATEGORIA_COMISSAO = "04.01"');
  });

  it("a porta exige a chave do módulo e gerente+ (RN-027)", () => {
    expect(ler("src/app/api/financeiro/comissoes/route.ts")).toContain(
      "porteiraFinanceiro"
    );
  });
});

describe("a nota fiscal vista do financeiro (RN-036)", () => {
  const motor = ler("src/lib/financeiro/nota-do-lancamento.ts");

  it("quem emite continua sendo o Bling (RN-016), o financeiro só mostra", () => {
    expect(motor).toContain("O financeiro NÃO emite nota");
    // a ficha chama a MESMA porta do pedido
    expect(ler("src/app/(app)/financeiro/lancamentos/[id]/ficha-view.tsx")).toContain(
      "/nfe"
    );
  });

  it("nota AUTORIZADA não se emite de novo (viraria nota em dobro)", () => {
    expect(motor).toContain('pedido.nfeStatus !== "AUTORIZADA"');
  });

  it("só lançamento de PEDIDO tem nota — conta de luz não tem de onde tirar", () => {
    expect(motor).toContain("lancamento.origem !== ORIGEM_PEDIDO");
    expect(motor).toContain('lancamento.tipo !== "RECEITA"');
  });
});
