import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  // CHAMADA = a vendedora mandou mensagem; RECUPERADO/PERDIDO fecham;
  // NOVO devolve para a fila (desfazer um engano)
  status: z.enum(["NOVO", "CHAMADA", "RECUPERADO", "PERDIDO"]),
});

/** Move um carrinho na esteira (sempre da própria loja). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const cart = await db.abandonedCart.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!cart) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const s = parsed.data.status;
    const agora = new Date();
    await db.abandonedCart.update({
      where: { id },
      data: {
        status: s,
        ...(s === "CHAMADA" ? { contactedAt: agora } : {}),
        ...(s === "RECUPERADO" ? { recoveredAt: agora } : {}),
        ...(s === "PERDIDO" ? { lostAt: agora } : {}),
        ...(s === "NOVO" ? { contactedAt: null, recoveredAt: null, lostAt: null } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
