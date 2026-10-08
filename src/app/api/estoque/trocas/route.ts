import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraEstoque, podeVerAnaliseDoEstoque } from "@/lib/estoque/gate";
import { carregarRelatorioDeTrocas } from "@/lib/troca/relatorio";

export const dynamic = "force-dynamic";

const PERIODOS = [7, 30, 90, 365];

/** Relatório de trocas (RN-073): qual peça volta, por quê, e o dinheiro. Gerência. */
export async function GET(req: NextRequest) {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    if (!podeVerAnaliseDoEstoque(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const pedido = Number(req.nextUrl.searchParams.get("dias"));
    const dias = PERIODOS.includes(pedido) ? pedido : 30;
    return NextResponse.json({ dias, ...(await carregarRelatorioDeTrocas(porta.user.companyId, dias)) });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
