import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * COLEÇÕES (RN-027) — o "Projetos" dos financeiros genéricos traduzido para
 * moda: etiqueta com começo e fim para responder "a coleção deu lucro?".
 */

const colecaoSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  inicio: z.coerce.date().nullish(),
  fim: z.coerce.date().nullish(),
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
    const parsed = colecaoSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const colecao = await db.finColecao.create({
      data: { companyId: porta.user.companyId, ...parsed.data },
    });
    return NextResponse.json({ colecao });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
