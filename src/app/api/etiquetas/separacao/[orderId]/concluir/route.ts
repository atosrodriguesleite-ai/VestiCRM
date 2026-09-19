import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { concluirSeparacao } from "@/lib/etiquetas/separacao";

const schema = z.object({
  faltas: z.array(z.object({ variantId: z.string().min(1).max(60), falta: z.number().int().min(0).max(100000) })).max(500),
  /** o `separadoEm` que a tela carregou (null = nunca separado): mudou, outra tela concluiu */
  carimbo: z.string().max(40).nullable().optional(),
});

/**
 * CONCLUIR a separação (RN-060): só com toda linha fechada. A contagem que
 * vale é a do SERVIDOR (bipe a bipe); do navegador entra só a falta
 * declarada. Carimba o pedido, muda o status para Separação e escreve quem
 * separou no histórico.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const { orderId } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const r = await concluirSeparacao(porta.user, orderId, parsed.data.faltas, parsed.data.carimbo);
    if ("erro" in r) return NextResponse.json({ error: r.erro, motivo: r.motivo ?? null }, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
