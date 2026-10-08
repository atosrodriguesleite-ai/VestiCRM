import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { acertarTroca, registrarTroca } from "@/lib/troca/registrar";

/**
 * TROCA DE PEÇAS (RN-073): a vendedora registra o que a cliente devolveu e
 * o que levou. POST registra; PATCH confirma que o dinheiro da diferença
 * andou. Quem decide tudo é `lib/troca` — aqui só a leitura do pedido.
 */
const trocaSchema = z.object({
  volta: z
    .array(
      z.object({
        chave: z.string().min(1).max(400),
        quantity: z.number().int().min(1).max(10_000),
        destino: z.enum(["ESTOQUE", "DEFEITO"]),
      })
    )
    .max(200),
  sai: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(10_000),
        unitPrice: z.number().min(0).max(1_000_000),
      })
    )
    .max(200),
  resolucao: z.enum(["SEM_DIFERENCA", "COBRAR", "CREDITO", "DEVOLUCAO"]),
  motivo: z.string().max(300).optional().nullable(),
  freteCombinado: z.string().max(200).optional().nullable(),
  observacoes: z.string().max(1000).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = trocaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const r = await registrarTroca(user, id, parsed.data);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json({ ok: true, trocaId: r.trocaId, numero: r.numero });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = z.object({ trocaId: z.string().min(1), acertada: z.literal(true) }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const r = await acertarTroca(user, id, parsed.data.trocaId);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
