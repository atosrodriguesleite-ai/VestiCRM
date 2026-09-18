import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { composicoesPorCategoria, salvarComposicaoDaCategoria } from "@/lib/etiquetas/modelos";

/** Composição (tecido) por categoria — o padrão que a etiqueta de composição imprime. */
export async function GET() {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    return NextResponse.json({ composicoes: await composicoesPorCategoria(porta.user.companyId) });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({ category: z.string().trim().min(1).max(80), composition: z.string().trim().max(300) });

export async function PATCH(req: NextRequest) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    if (!isManagerUp(porta.user) && !isSupport(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    await salvarComposicaoDaCategoria(porta.user.companyId, parsed.data.category, parsed.data.composition);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
