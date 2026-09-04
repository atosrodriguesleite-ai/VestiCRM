import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataDoDia } from "@/lib/financeiro/lancamentos";
import { repescarVendasSemBaixa } from "@/lib/financeiro/porta-vendas";
import { esquecerAvisoDaContaPadrao } from "@/lib/financeiro/visao";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * CONTAS FINANCEIRAS (RN-029) — onde o dinheiro da loja mora.
 * Toda porta do módulo passa pela porteira: gerente+ E loja com a chave.
 */

const contaSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  tipo: z
    .enum(["BANCO", "CAIXINHA", "DIGITAL", "POUPANCA", "CARTAO"])
    .default("BANCO"),
  saldoInicial: z.number().finite().default(0),
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
  padrao: z.boolean().default(false),
  // cartão de crédito (RN-039): os dias que decidem a fatura de cada compra.
  // `nullable` porque o formulário manda null para conta que NÃO é cartão —
  // só `optional` recusava a criação de qualquer conta (achado da revisão).
  diaFechamento: z.number().int().min(1).max(31).nullable().optional(),
  diaVencimento: z.number().int().min(1).max(31).nullable().optional(),
  contaPagamentoId: z.string().nullable().optional(),
});

/**
 * A conta que paga a fatura do cartão precisa ser desta loja (RN-013), estar
 * viva e não ser outro cartão — validar só no `<select>` deixa a porta aberta
 * para quem chamar a API direto.
 */
async function contaPagadoraValida(
  companyId: string,
  contaPagamentoId: string | null | undefined,
  proprioId?: string
): Promise<boolean> {
  if (!contaPagamentoId) return true;
  if (contaPagamentoId === proprioId) return false;
  const alvo = await db.finConta.findFirst({
    where: { id: contaPagamentoId, companyId, arquivadaEm: null },
    select: { tipo: true },
  });
  return Boolean(alvo) && alvo!.tipo !== "CARTAO";
}

export async function GET() {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const contas = await db.finConta.findMany({
      where: { companyId: porta.user.companyId },
      orderBy: [{ arquivadaEm: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ contas });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = contaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    // CARTÃO não é conta de dinheiro (RN-039): não pode ser a conta PADRÃO —
    // a porta única de entrada das vendas (RN-033) baixaria a venda paga no
    // cartão de crédito da loja — nem carrega saldo inicial.
    // o dia vira meio-dia UTC (RN-030) antes de qualquer coisa
    const quando = parsed.data.saldoInicialEm
      ? dataDoDia(parsed.data.saldoInicialEm)
      : undefined;
    if (parsed.data.saldoInicialEm && !quando)
      return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    const entrada = { ...parsed.data, saldoInicialEm: quando ?? undefined };
    const dados =
      entrada.tipo === "CARTAO"
        ? { ...entrada, padrao: false, saldoInicial: 0 }
        : {
            ...entrada,
            // conta que não é cartão não guarda regra de fatura
            diaFechamento: null,
            diaVencimento: null,
            contaPagamentoId: null,
          };
    if (!(await contaPagadoraValida(porta.user.companyId, dados.contaPagamentoId)))
      return NextResponse.json(
        { error: "Escolha uma conta desta loja (que não seja outro cartão) para pagar a fatura" },
        { status: 400 }
      );

    try {
      const conta = await db.$transaction(async (tx) => {
        // só UMA conta padrão por loja: marcar esta desmarca as outras (e o
        // índice único parcial do banco segura a corrida entre duas abas)
        if (dados.padrao) {
          await tx.finConta.updateMany({
            where: { companyId: porta.user.companyId, padrao: true },
            data: { padrao: false },
          });
        }
        return tx.finConta.create({
          data: { companyId: porta.user.companyId, ...dados },
        });
      });
      // a conta padrão acabou de nascer: as vendas pagas que ficaram sem baixa por
      // falta dela são acertadas (RN-033) — senão a lojista vê no card
      // "Atrasado" a venda que ela mesma marcou como paga.
      // NO after(): são até TETO_REPESCA sincronizações no total (as duas varreduras dividem o mesmo teto), e dentro da resposta um
      // timeout devolveria erro com a conta JÁ criada — a lojista clicaria
      // de novo e nasceria uma segunda conta com o mesmo nome. O que passar
      // do teto é repescado de carona na próxima abertura do Financeiro.
      esquecerAvisoDaContaPadrao(porta.user.companyId);
      const repescar = conta.padrao;
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
