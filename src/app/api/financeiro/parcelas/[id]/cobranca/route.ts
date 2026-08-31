import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { cobrarParcelaNoWhatsapp } from "@/lib/financeiro/cobranca";

/**
 * COBRAR pelo WhatsApp (RN-032). A mensagem é montada pelo sistema e enviada
 * por uma PESSOA clicando — disparo automático para cliente é decisão da
 * loja, não nossa. Sai pela Central de sempre, com o ritmo anti-ban (RN-017).
 */
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const r = await cobrarParcelaNoWhatsapp(porta.user.companyId, id, {
      id: porta.user.id,
      name: porta.user.name,
    });
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json({ ok: true, conversationId: r.conversationId });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
