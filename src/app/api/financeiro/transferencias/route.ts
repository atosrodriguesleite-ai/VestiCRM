import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { dataDoDia } from "@/lib/financeiro/lancamentos";
import { round2 } from "@/lib/orders";

/**
 * TRANSFERÊNCIA entre contas da própria loja (RN-030).
 *
 * Duas datas porque a vida tem duas: a TED sai hoje e cai amanhã, e cada
 * conta enxerga o dinheiro no SEU dia — o extrato do banco também. Uma data
 * só faria o saldo de uma das contas mentir por um dia.
 */

const schema = z.object({
  contaOrigemId: z.string().min(1),
  contaDestinoId: z.string().min(1),
  valor: z.number().finite().positive(),
  dataSaida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataEntrada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().trim().max(160).nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const d = parsed.data;

    if (d.contaOrigemId === d.contaDestinoId)
      return NextResponse.json(
        { error: "Escolha duas contas diferentes" },
        { status: 400 }
      );

    const saida = dataDoDia(d.dataSaida);
    const entrada = dataDoDia(d.dataEntrada);
    if (!saida || !entrada)
      return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    if (entrada < saida)
      return NextResponse.json(
        { error: "O dinheiro não cai antes de sair — confira as datas" },
        { status: 400 }
      );

    // as duas contas têm que ser DESTA loja (RN-013) e não arquivadas
    const contas = await db.finConta.findMany({
      where: {
        id: { in: [d.contaOrigemId, d.contaDestinoId] },
        companyId: porta.user.companyId,
        arquivadaEm: null,
      },
      select: { id: true },
    });
    if (contas.length !== 2)
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 400 });

    const t = await db.finTransferencia.create({
      data: {
        companyId: porta.user.companyId,
        contaOrigemId: d.contaOrigemId,
        contaDestinoId: d.contaDestinoId,
        valor: round2(d.valor),
        dataSaida: saida,
        dataEntrada: entrada,
        descricao: d.descricao?.trim() || null,
        autorNome: porta.user.name,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: t.id });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
