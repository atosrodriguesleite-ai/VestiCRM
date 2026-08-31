import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * ANEXAR ao lançamento (RN-028): foto do boleto, PDF da nota, comprovante.
 *
 * Teto de ~4 MB por arquivo (data-URL, dívida técnica nº 1): foto de celular
 * passa; scanner em resolução de pôster não — e o servidor cortaria o pedido
 * de qualquer jeito, melhor recusar com mensagem clara.
 */

const schema = z.object({
  fileName: z.string().trim().min(1).max(160),
  arquivo: z.string().startsWith("data:").max(5_500_000),
});

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Arquivo grande demais (máximo ~4 MB) ou inválido." },
        { status: 400 }
      );

    const lancamento = await db.finLancamento.findFirst({
      where: { id, companyId: porta.user.companyId },
      select: { id: true },
    });
    if (!lancamento)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const anexo = await db.finAnexo.create({
      data: {
        companyId: porta.user.companyId,
        lancamentoId: id,
        fileName: parsed.data.fileName,
        arquivo: parsed.data.arquivo,
        autorNome: porta.user.name,
      },
      select: { id: true, fileName: true, createdAt: true },
    });
    await db.finLancamentoEvento.create({
      data: {
        lancamentoId: id,
        descricao: `Anexo adicionado: ${anexo.fileName}`,
        autorNome: porta.user.name,
      },
    });
    return NextResponse.json({ anexo });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
