import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEstoque, podeAjustarEstoque } from "@/lib/estoque/gate";
import { ajustarEstoque } from "@/lib/estoque/ajuste";
import { TETO_DO_MOTIVO } from "@/lib/estoque/dono-do-estoque";

const schema = z.object({
  /** o número novo */
  estoque: z.number().int().min(0).max(1_000_000),
  /** o número que a tela mostrava — a porta recusa se já mudou */
  visto: z.number().int().min(0).optional(),
  motivo: z.string().max(TETO_DO_MOTIVO * 2),
});

/**
 * Ajuste digitado de UMA variação (RN-050). A decisão inteira mora na porta
 * única (`ajustarEstoque`): loja, papel, dono externo, motivo, gravação
 * condicional e a linha do livro. Aqui só se traduz o pedido e a resposta.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await ajustarEstoque({
      user: porta.user,
      podeAjustar: podeAjustarEstoque(porta.user),
      variantId: id,
      novoEstoque: parsed.data.estoque,
      estoqueVisto: parsed.data.visto,
      motivo: parsed.data.motivo,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, dono: r.dono ?? null, estoqueAtual: r.estoqueAtual },
        { status: r.status }
      );
    }
    return NextResponse.json({ ok: true, mexeu: r.mexeu, estoque: r.estoque });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
