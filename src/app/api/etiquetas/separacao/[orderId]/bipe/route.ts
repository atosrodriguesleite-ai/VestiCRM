import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { registrarBipe } from "@/lib/etiquetas/separacao";

const schema = z.object({ codigo: z.string().trim().min(1).max(40) });

/**
 * UM BIPE (RN-060): o navegador já decidiu na hora com a mesma regra; aqui
 * é a segunda tranca, sobre o que está gravado, com trava por pedido.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const { orderId } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Código inválido" }, { status: 400 });
    const r = await registrarBipe(porta.user, orderId, parsed.data.codigo);
    if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
