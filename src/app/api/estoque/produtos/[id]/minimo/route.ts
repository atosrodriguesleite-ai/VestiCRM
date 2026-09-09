import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEstoque, podeAjustarEstoque } from "@/lib/estoque/gate";
import { salvarMinimoDaPeca, TETO_DO_MINIMO } from "@/lib/estoque/minimos";

const schema = z.object({
  /** null = limpa (volta a valer o da categoria/loja) */
  minimo: z.number().int().min(0).max(TETO_DO_MINIMO).nullable(),
});

/** Mínimo de UMA peça (RN-051) — vale para cada cor × tamanho dela. Gerência. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    if (!podeAjustarEstoque(porta.user)) {
      return NextResponse.json({ error: "Só gerente ou admin define mínimos." }, { status: 403 });
    }
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const ok = await salvarMinimoDaPeca(porta.user.companyId, id, parsed.data.minimo);
    if (!ok) return NextResponse.json({ error: "Peça não encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
