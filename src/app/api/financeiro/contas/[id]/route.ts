import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataDoDia } from "@/lib/financeiro/lancamentos";
import { repescarVendasSemBaixa } from "@/lib/financeiro/porta-vendas";
import { esquecerAvisoDaContaPadrao } from "@/lib/financeiro/visao";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * Editar/arquivar uma conta (RN-029). NÃO existe DELETE de propósito:
 * quando os lançamentos chegarem, apagar conta com histórico quebraria o
 * extrato — arquivar tira das escolhas novas e preserva o passado.
 */

/** A trava pegou: a conta não existe ou é de outra loja. */
class ContaForaDaLoja extends Error {}
class ContaComDinheiro extends Error {}

const patchSchema = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  tipo: z.enum(["BANCO", "CAIXINHA", "DIGITAL", "POUPANCA", "CARTAO"]).optional(),
  saldoInicial: z.number().finite().optional(),
  /**
   * DATA É DIA, GUARDADO AO MEIO-DIA EM UTC (RN-030). Com `z.coerce.date()`
   * o "2026-09-01" da tela virava meia-noite UTC, e `diaSP` devolvia
   * 2026-08-31: a abertura da conta aparecia um dia antes no extrato e um
   * MÊS antes no fluxo de caixa, fazendo duas telas de dinheiro discordarem
   * (auditoria completa do módulo, 03/09/2026).
   */
  saldoInicialEm: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    .optional(),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  padrao: z.boolean().optional(),
  arquivar: z.boolean().optional(),
  // cartão de crédito (RN-039)
  diaFechamento: z.number().int().min(1).max(31).nullable().optional(),
  diaVencimento: z.number().int().min(1).max(31).nullable().optional(),
  contaPagamentoId: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { arquivar, padrao, saldoInicialEm, ...resto } = parsed.data;
    // o dia vira meio-dia UTC (RN-030): meia-noite viraria o dia anterior
    const quando = saldoInicialEm ? dataDoDia(saldoInicialEm) : undefined;
    if (saldoInicialEm && !quando)
      return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    const campos = { ...resto, ...(quando ? { saldoInicialEm: quando } : {}) };

    // a conta que paga a fatura precisa ser desta loja, viva e não ser cartão
    if (campos.contaPagamentoId) {
      const pagadora = await db.finConta.findFirst({
        where: {
          id: campos.contaPagamentoId,
          companyId: porta.user.companyId,
          arquivadaEm: null,
        },
        select: { id: true, tipo: true },
      });
      if (!pagadora || pagadora.tipo === "CARTAO" || pagadora.id === id)
        return NextResponse.json(
          { error: "Escolha uma conta desta loja (que não seja outro cartão) para pagar a fatura" },
          { status: 400 }
        );
    }

    let eraPadrao = false;
    try {
      const conta = await db.$transaction(async (tx) => {
        // posse conferida ANTES de mexer em qualquer coisa: se a conta não é
        // desta loja (RN-013) ou não existe, um THROW desfaz a transação —
        // um return não desfaria, e o desmarque abaixo ficaria commitado
        const alvo = await tx.finConta.findFirst({
          where: { id, companyId: porta.user.companyId },
          select: { id: true, tipo: true, padrao: true },
        });
        if (!alvo) throw new ContaForaDaLoja();
        eraPadrao = alvo.padrao;
        /**
         * CONVERTER EM CARTÃO É RECUSADO quando a conta já guardou dinheiro.
         * Cartão não carrega saldo inicial (RN-039), então a conversão o
         * ZERARIA — apagando de vez o saldo declarado e o histórico de
         * movimento, sem volta. Melhor dizer não (auditoria de 03/09/2026).
         */
        if (alvo.tipo !== "CARTAO" && campos.tipo === "CARTAO") {
          const [comMovimento, comSaldo] = await Promise.all([
            tx.finBaixa.count({
              where: { companyId: porta.user.companyId, contaId: id },
            }),
            tx.finConta.count({
              where: { id, saldoInicial: { not: 0 } },
            }),
          ]);
          if (comMovimento > 0 || comSaldo > 0) throw new ContaComDinheiro();
        }
        // cartão nunca vira conta padrão (RN-039): a porta única de entrada
        // das vendas (RN-033) baixaria a venda paga no cartão de crédito
        const ehCartao = (campos.tipo ?? alvo.tipo) === "CARTAO";
        // virou cartão? deixa de ser padrão AGORA — continuar padrão faria a
        // porta única de vendas (RN-033) baixar venda paga dentro do cartão
        const querPadrao = padrao === true && !ehCartao;
        if (querPadrao) {
          await tx.finConta.updateMany({
            where: { companyId: porta.user.companyId, padrao: true, id: { not: id } },
            data: { padrao: false },
          });
        }
        return tx.finConta.update({
          where: { id },
          data: {
            ...campos,
            // AS MESMAS REGRAS DO CADASTRO NOVO, no servidor: o POST já
            // zerava o saldo do cartão e limpava a regra de fatura de quem
            // não é cartão; o PATCH não, e a trava ficava só na tela. Um
            // PATCH direto convertendo a "Caixinha" de R$ 5.000 em CARTÃO
            // deixava esse dinheiro entrando no "saldo hoje" e no saldo
            // previsto, dentro de um cartão de crédito (RN-039).
            ...(ehCartao
              ? { padrao: false, saldoInicial: 0 }
              : {
                  diaFechamento: null,
                  diaVencimento: null,
                  contaPagamentoId: null,
                  ...(padrao !== undefined ? { padrao: querPadrao } : {}),
                }),
            ...(arquivar !== undefined
              ? { arquivadaEm: arquivar ? new Date() : null, ...(arquivar ? { padrao: false } : {}) }
              : {}),
          },
        });
      });
      // a conta ACABOU de virar a padrão: as vendas pagas que ficaram sem baixa por
      // falta dela são acertadas (RN-033) — senão a lojista vê no card
      // "Atrasado" a venda que ela mesma marcou como paga.
      // NO after(): são até 50 sincronizações, e dentro da resposta um
      // timeout devolveria erro com a conta JÁ criada — a lojista clicaria
      // de novo e nasceria uma segunda conta com o mesmo nome. O que passar
      // do teto é repescado de carona na próxima abertura do Financeiro.
      esquecerAvisoDaContaPadrao(porta.user.companyId);
      const repescar = conta.padrao && !eraPadrao;
      if (repescar)
        after(async () => {
          try {
            await repescarVendasSemBaixa(porta.user.companyId);
          } catch (e) {
            console.error("[contas] repescagem falhou", e);
          }
        });
      return NextResponse.json({ conta, repescando: repescar });
    } catch (e) {
      if (e instanceof ContaForaDaLoja)
        return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
      if (e instanceof ContaComDinheiro)
        return NextResponse.json(
          {
            error:
              "Esta conta já tem saldo ou movimento — não dá para transformar em cartão de crédito. Arquive esta e cadastre o cartão à parte.",
          },
          { status: 409 }
        );
      // corrida com outra aba marcando padrão: o índice único parcial derruba
      if ((e as { code?: string })?.code === "P2002")
        return NextResponse.json({ error: "Tente de novo" }, { status: 409 });
      throw e;
    }
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
