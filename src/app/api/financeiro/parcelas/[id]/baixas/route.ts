import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  conferirBaixa,
  dataDoDia,
  saldoDaParcela,
  valorMovimentado,
} from "@/lib/financeiro/lancamentos";
import { brl } from "@/lib/format";

/**
 * DAR BAIXA numa parcela (RN-028) — o dinheiro andou de verdade.
 *
 * É a operação mais delicada do módulo, e por isso roda em transação
 * SERIALIZÁVEL: sem isso, duas pessoas dando baixa na mesma parcela ao mesmo
 * tempo passam as duas pela conferência (nenhuma enxerga a linha da outra) e
 * a parcela termina paga em dobro — dinheiro inventado no extrato. Com a
 * trava, a segunda perde a corrida e recebe "tente de novo".
 */

const baixaSchema = z.object({
  contaId: z.string().min(1),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  valor: z.number().finite().positive(),
  desconto: z.number().finite().min(0).default(0),
  juros: z.number().finite().min(0).default(0),
  observacao: z.string().trim().max(300).nullish(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = baixaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const data = dataDoDia(parsed.data.data);
    if (!data)
      return NextResponse.json({ error: "Data inválida" }, { status: 400 });

    const resultado = await db.$transaction(
      async (tx) => {
        const parcela = await tx.finParcela.findFirst({
          where: { id, companyId: porta.user.companyId },
          include: {
            baixas: true,
            lancamento: { select: { id: true, canceladoEm: true, tipo: true } },
          },
        });
        if (!parcela) return { erro: "Não encontrado", status: 404 };
        if (parcela.lancamento.canceladoEm)
          return { erro: "Lançamento cancelado — reabra antes de dar baixa", status: 409 };

        const conta = await tx.finConta.findFirst({
          where: {
            id: parsed.data.contaId,
            companyId: porta.user.companyId,
            arquivadaEm: null,
          },
          select: { id: true, nome: true },
        });
        if (!conta) return { erro: "Conta não encontrada", status: 400 };

        const impedimento = conferirBaixa(parcela, parsed.data);
        if (impedimento) return { erro: impedimento, status: 409 };

        const baixa = await tx.finBaixa.create({
          data: {
            companyId: porta.user.companyId,
            parcelaId: parcela.id,
            contaId: conta.id,
            data,
            valor: parsed.data.valor,
            desconto: parsed.data.desconto,
            juros: parsed.data.juros,
            observacao: parsed.data.observacao?.trim() || null,
            autorNome: porta.user.name,
          },
        });
        const movimentado = valorMovimentado(baixa);
        const recebeu = parcela.lancamento.tipo === "RECEITA";
        await tx.finLancamentoEvento.create({
          data: {
            lancamentoId: parcela.lancamento.id,
            descricao: `${recebeu ? "Recebimento" : "Pagamento"} da parcela ${parcela.numero}: ${brl(movimentado)} em ${conta.nome}`,
            autorNome: porta.user.name,
          },
        });
        return { baixaId: baixa.id, movimentado };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if ("erro" in resultado)
      return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
    return NextResponse.json(resultado);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    // a trava pegou: outra pessoa deu baixa na mesma parcela agora mesmo
    const code = (e as { code?: string })?.code;
    if (code === "P2034")
      return NextResponse.json(
        { error: "Alguém deu baixa nesta parcela agora — atualize a tela" },
        { status: 409 }
      );
    throw e;
  }
}
