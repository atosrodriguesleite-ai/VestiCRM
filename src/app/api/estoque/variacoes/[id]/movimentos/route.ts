import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraEstoque } from "@/lib/estoque/gate";
import { historicoDaVariacao } from "@/lib/estoque/inventario";

/** Histórico de uma variação (RN-050): quem mexeu, quando, por quê. Só leitura. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const h = await historicoDaVariacao(porta.user, id);
    if (!h) return NextResponse.json({ error: "Peça não encontrada" }, { status: 404 });
    return NextResponse.json(h);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
