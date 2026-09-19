import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { registrarFalta } from "@/lib/etiquetas/separacao";

const schema = z.object({
  variantId: z.string().min(1).max(60),
  falta: z.number().int().min(0).max(100000),
  /** o `separadoEm` que a tela carregou (null = nunca separado): mudou, outra tela concluiu */
  carimbo: z.string().max(40).nullable().optional(),
});

/** DECLARAR FALTA numa linha (RN-060): a peça não estava na arara. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const { orderId } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const r = await registrarFalta(porta.user, orderId, parsed.data.variantId, parsed.data.falta, parsed.data.carimbo);
    if ("erro" in r) return NextResponse.json({ error: r.erro, motivo: r.motivo ?? null }, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
