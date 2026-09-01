import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  conferirLancamento,
  lancamentoSchema,
} from "@/lib/financeiro/lancamento-form";

/**
 * CRIAR LANÇAMENTO (RN-030) — conta a receber ou a pagar, com suas parcelas.
 * A leitura da lista mora na própria tela (server component, com filtros pela
 * URL); aqui fica a escrita, que é onde as regras precisam morar.
 */
export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = lancamentoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const conferido = await conferirLancamento(porta.user.companyId, parsed.data);
    if ("erro" in conferido)
      return NextResponse.json({ error: conferido.erro }, { status: 400 });

    const lancamento = await db.finLancamento.create({
      data: {
        companyId: porta.user.companyId,
        ...conferido.dados.cabecalho,
        parcelas: {
          create: conferido.dados.parcelas.map((p) => ({
            companyId: porta.user.companyId,
            ...p,
          })),
        },
        eventos: {
          create: {
            descricao: `Lançamento criado em ${conferido.dados.parcelas.length}× no valor de R$ ${conferido.dados.cabecalho.valor.toFixed(2)}`,
            autorNome: porta.user.name,
          },
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ id: lancamento.id });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
