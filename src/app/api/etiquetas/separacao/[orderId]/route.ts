import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { estadoDaSeparacao } from "@/lib/etiquetas/separacao";

/**
 * O ESTADO da separação do pedido (RN-060): as peças com o código de cada
 * uma e o andamento gravado. Só leitura — a separação ativa nasce no
 * primeiro bipe.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const { orderId } = await params;
    const estado = await estadoDaSeparacao(porta.user, orderId);
    if ("erro" in estado) return NextResponse.json({ error: estado.erro }, { status: 404 });
    return NextResponse.json(estado);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
