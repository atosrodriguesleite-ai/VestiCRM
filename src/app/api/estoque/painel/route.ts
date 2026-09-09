import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraEstoque, podeVerAnaliseDoEstoque } from "@/lib/estoque/gate";
import { montarPainel } from "@/lib/estoque/analise";

export const dynamic = "force-dynamic";

/** O painel do Estoque (RN-052): totais, o que repor, o que encalhou, o que mais vende. */
export async function GET() {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    if (!podeVerAnaliseDoEstoque(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    return NextResponse.json(await montarPainel(porta.user.companyId));
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
