import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { mexerNoCreditoDoPedido } from "@/lib/troca/credito-no-pedido";

/**
 * RN-074 · usar (ou tirar) o crédito de troca da cliente neste pedido.
 * Quem decide tudo é `lib/troca/credito-no-pedido` — aqui só a leitura.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = z.object({ acao: z.enum(["usar", "tirar"]) }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const r = await mexerNoCreditoDoPedido(user, id, parsed.data.acao);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json({ ok: true, abatido: r.abatido });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
