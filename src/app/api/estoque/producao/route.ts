import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { porteiraEstoque, podeVerAnaliseDoEstoque } from "@/lib/estoque/gate";
import { resumoDaProducao } from "@/lib/estoque/producao";

export const dynamic = "force-dynamic";

/** A aba Produção do Estoque (RN-052): só leitura, e só com o módulo Produção ligado. */
export async function GET() {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    if (!podeVerAnaliseDoEstoque(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const company = await db.company.findUnique({
      where: { id: porta.user.companyId },
      select: { productionEnabled: true },
    });
    if (!company?.productionEnabled) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json(await resumoDaProducao(porta.user.companyId));
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
