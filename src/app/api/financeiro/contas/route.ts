import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * CONTAS FINANCEIRAS (RN-027) — onde o dinheiro da loja mora.
 * Toda porta do módulo passa pela porteira: gerente+ E loja com a chave.
 */

const contaSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  tipo: z.enum(["BANCO", "CAIXINHA", "DIGITAL", "POUPANCA"]).default("BANCO"),
  saldoInicial: z.number().finite().default(0),
  saldoInicialEm: z.coerce.date().optional(),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  padrao: z.boolean().default(false),
});

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

    try {
      const conta = await db.$transaction(async (tx) => {
        // só UMA conta padrão por loja: marcar esta desmarca as outras (e o
        // índice único parcial do banco segura a corrida entre duas abas)
        if (parsed.data.padrao) {
          await tx.finConta.updateMany({
            where: { companyId: porta.user.companyId, padrao: true },
            data: { padrao: false },
          });
        }
        return tx.finConta.create({
          data: { companyId: porta.user.companyId, ...parsed.data },
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
