import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  garantirCategoriasPadrao,
  proximoCodigo,
} from "@/lib/financeiro/cadastros";

/**
 * CATEGORIAS FINANCEIRAS (RN-027) — a etiqueta do dinheiro, em árvore.
 * O GET semeia a árvore padrão de moda na primeira abertura (idempotente).
 * Quem numera o código é o SERVIDOR — código digitado colide.
 */

export async function GET() {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    await garantirCategoriasPadrao(porta.user.companyId);
    const categorias = await db.finCategoria.findMany({
      where: { companyId: porta.user.companyId },
      orderBy: { codigo: "asc" },
    });
    return NextResponse.json({ categorias });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const criarSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  // sem pai: precisa dizer o tipo; com pai: o tipo é HERDADO do pai
  tipo: z.enum(["RECEITA", "DESPESA"]).optional(),
  paiId: z.string().min(1).nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = criarSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { nome, paiId } = parsed.data;

    // pai da MESMA loja (RN-013) e NÃO arquivado ("arquivado some das
    // escolhas novas"); filha herda o tipo dele — categoria de receita
    // debaixo de despesa faria o DRE somar errado sem ninguém ver
    const pai = paiId
      ? await db.finCategoria.findFirst({
          where: { id: paiId, companyId: porta.user.companyId, arquivadaEm: null },
        })
      : null;
    if (paiId && !pai)
      return NextResponse.json({ error: "Categoria-mãe não encontrada" }, { status: 400 });
    const tipo = pai ? pai.tipo : parsed.data.tipo;
    if (!tipo)
      return NextResponse.json({ error: "Escolha receita ou despesa" }, { status: 400 });

    // duas abas criando juntas: o único (companyId+codigo) derruba a segunda
    // (P2002) e a tentativa seguinte pega o próximo número
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const existentes = await db.finCategoria.findMany({
        where: { companyId: porta.user.companyId },
        select: { codigo: true },
      });
      const codigo = proximoCodigo(
        existentes.map((c) => c.codigo),
        pai?.codigo ?? null
      );
      try {
        const categoria = await db.finCategoria.create({
          data: {
            companyId: porta.user.companyId,
            nome,
            tipo,
            codigo,
            paiId: pai?.id ?? null,
          },
        });
        return NextResponse.json({ categoria });
      } catch (e) {
        const p2002 =
          typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
        if (!p2002) throw e;
      }
    }
    return NextResponse.json({ error: "Tente de novo" }, { status: 409 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
