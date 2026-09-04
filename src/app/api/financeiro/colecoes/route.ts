import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataDoDia } from "@/lib/financeiro/lancamentos";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * COLEÇÕES (RN-029) — o "Projetos" dos financeiros genéricos traduzido para
 * moda: etiqueta com começo e fim para responder "a coleção deu lucro?".
 */

const colecaoSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  // DATA É DIA, AO MEIO-DIA EM UTC (RN-030): com `z.coerce.date()` o
  // "2026-03-01" virava meia-noite UTC e a tela mostrava 28/02 — todo
  // primeiro-de-mês no mês errado (auditoria de 03/09/2026)
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function GET() {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const colecoes = await db.finColecao.findMany({
      where: { companyId: porta.user.companyId },
      orderBy: [{ arquivadaEm: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ colecoes });
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
    const parsed = colecaoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const colecao = await db.finColecao.create({
      data: {
        companyId: porta.user.companyId,
        ...parsed.data,
        // o dia vira meio-dia UTC (RN-030)
        inicio: parsed.data.inicio ? dataDoDia(parsed.data.inicio) : null,
        fim: parsed.data.fim ? dataDoDia(parsed.data.fim) : null,
      },
    });
    return NextResponse.json({ colecao });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
