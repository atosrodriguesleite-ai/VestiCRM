import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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
  saldoInicialEm: z.coerce.date().optional(),
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
    const parsed = contaSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    // CARTÃO não é conta de dinheiro (RN-039): não pode ser a conta PADRÃO —
    // a porta única de entrada das vendas (RN-033) baixaria a venda paga no
    // cartão de crédito da loja — nem carrega saldo inicial.
    const dados =
      parsed.data.tipo === "CARTAO"
        ? { ...parsed.data, padrao: false, saldoInicial: 0 }
        : {
            ...parsed.data,
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
      return NextResponse.json({ conta });
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
