import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser, AuthError } from "@/lib/auth";
import { separarEmProdutoProprio } from "@/lib/estoque/separar-variacoes";

const schema = z.object({ nsProdutoId: z.string().trim().min(1).max(64) });

/**
 * Separa em produto próprio as cores desta peça que já são de OUTRO
 * produto na Nuvemshop (RN-050) — move, nunca apaga. Quem edita produto
 * separa (a régua da ficha da peça).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const r = await separarEmProdutoProprio(user, id, parsed.data.nsProdutoId);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    // corrida rara (código do modelo tomado no mesmo instante): frase, não 500
    // P2034 = conflito/deadlock com outra gravação da mesma peça (a edição de
    // um pedido com essa cor no mesmo segundo): nada ficou pela metade
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2002" || e.code === "P2034")) {
      return NextResponse.json(
        { error: "A peça estava sendo mexida no mesmo instante (outra separação ou um pedido). Nada mudou — recarregue a página e tente de novo." },
        { status: 409 }
      );
    }
    throw e;
  }
}
