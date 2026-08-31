import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { valorMovimentado } from "@/lib/financeiro/lancamentos";
import { brl } from "@/lib/format";

/**
 * ESTORNAR uma baixa (RN-028) — baixou errado, desfaz COM RASTRO.
 *
 * A baixa não é apagada: fica marcada com quem estornou e quando, some das
 * contas (saldo, status, extrato) e continua visível no histórico. Apagar
 * seria mais simples e é exatamente o que impede uma loja de explicar o
 * próprio extrato três meses depois.
 *
 * Estorno não se desfaz: baixou de novo? É uma baixa NOVA. Assim a linha do
 * tempo conta a história inteira, na ordem em que aconteceu.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = z
      .object({ estornar: z.literal(true), motivo: z.string().trim().max(200).nullish() })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const baixa = await db.finBaixa.findFirst({
      where: { id, companyId: porta.user.companyId },
      include: {
        conta: { select: { nome: true } },
        parcela: { select: { numero: true, lancamentoId: true } },
      },
    });
    if (!baixa)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    if (baixa.estornadaEm)
      return NextResponse.json({ error: "Esta baixa já foi estornada" }, { status: 409 });

    const motivo = parsed.data.motivo?.trim();
    // updateMany com a trava de "ainda não estornada": dois cliques ao mesmo
    // tempo não geram dois estornos (o segundo casa 0 linhas)
    const r = await db.finBaixa.updateMany({
      where: { id, companyId: porta.user.companyId, estornadaEm: null },
      data: { estornadaEm: new Date(), estornoAutor: porta.user.name },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Esta baixa já foi estornada" }, { status: 409 });

    await db.finLancamentoEvento.create({
      data: {
        lancamentoId: baixa.parcela.lancamentoId,
        descricao: `Baixa estornada na parcela ${baixa.parcela.numero}: ${brl(
          valorMovimentado(baixa)
        )} em ${baixa.conta.nome}${motivo ? ` — ${motivo}` : ""}`,
        autorNome: porta.user.name,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
