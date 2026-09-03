import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { consolidateOpenConversations, repointCustomer } from "@/lib/merge-contacts";

/**
 * UNIFICAR DOIS CADASTROS ESCOLHIDOS — a ação do aviso "parece a mesma
 * pessoa" (RN-020 e o sinal do mesmo pedido por outro número, 03/09/2026).
 *
 * O cadastro da URL SOBREVIVE (é a conversa aberta — de preferência a do
 * WhatsApp por onde a cliente respondeu de verdade); o `duplicadoId` é
 * fundido nele: pedidos, conversas, etiquetas, linha do tempo e financeiro
 * vão junto, pelo MESMO caminho da unificação por telefone (repointCustomer),
 * e as conversas abertas do sobrevivente são juntadas. Gerente+: juntar
 * gente errada é decisão da loja, não da vendedora. Não dá para desfazer.
 */
const schema = z.object({ duplicadoId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { duplicadoId } = parsed.data;
    if (duplicadoId === id) {
      return NextResponse.json({ error: "É o mesmo cadastro" }, { status: 400 });
    }
    // RN-013: os DOIS têm que ser da loja de quem pede
    const [principal, duplicado] = await Promise.all([
      db.customer.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } }),
      db.customer.findFirst({
        where: { id: duplicadoId, companyId: user.companyId },
        select: { id: true },
      }),
    ]);
    if (!principal || !duplicado) {
      return NextResponse.json({ error: "Cadastro não encontrado" }, { status: 404 });
    }
    await db.$transaction(
      async (tx) => {
        await repointCustomer(tx, principal.id, duplicado.id);
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    await consolidateOpenConversations(user.companyId, principal.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
