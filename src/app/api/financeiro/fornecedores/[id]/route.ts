import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  corpoDoFornecedor,
  fornecedorSchema,
  type FornecedorData,
} from "@/lib/financeiro/fornecedor";

/**
 * Editar/arquivar fornecedor (RN-027; sem DELETE — arquiva). Dois corpos
 * aceitos: a FICHA INTEIRA (o formulário de edição manda tudo) ou só
 * `{ arquivar }` (o botão de arquivar não conhece a ficha).
 */

const patchSchema = z.union([
  fornecedorSchema.extend({ arquivar: z.boolean().optional() }),
  z.object({ arquivar: z.boolean() }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const data: Partial<FornecedorData> & { arquivadoEm?: Date | null } = {};
    if ("nome" in parsed.data) {
      const { arquivar: _arquivar, ...dados } = parsed.data;
      const corpo = await corpoDoFornecedor(porta.user.companyId, dados);
      if ("erro" in corpo)
        return NextResponse.json({ error: corpo.erro }, { status: 400 });
      Object.assign(data, corpo.data);
    }
    if (parsed.data.arquivar !== undefined)
      data.arquivadoEm = parsed.data.arquivar ? new Date() : null;

    const r = await db.fornecedor.updateMany({
      where: { id, companyId: porta.user.companyId },
      data,
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const fornecedor = await db.fornecedor.findUnique({
      where: { id },
      include: { categoriaPadrao: { select: { id: true, nome: true, codigo: true } } },
    });
    return NextResponse.json({ fornecedor });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
