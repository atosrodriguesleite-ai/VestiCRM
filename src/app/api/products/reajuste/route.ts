import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { aplicarReajuste, preverReajuste, validarReajuste } from "@/lib/reajuste-preco";

/**
 * REAJUSTE DE PREÇO EM LOTE POR CATEGORIA (RN-056).
 *
 * Só gerência: preço é decisão comercial (a régua de Relatórios e do
 * Financeiro) — o Suporte organiza categoria, mas não mexe em dinheiro.
 * `aplicar: false` devolve a prévia; `true` grava. A conta é a MESMA nos
 * dois, feita aqui, sobre o que está no banco agora.
 */
const schema = z.object({
  categoria: z.string().trim().min(1).max(60),
  campos: z.array(z.enum(["atacado", "varejo"])).min(1).max(2),
  modo: z.enum(["percentual", "fixo"]),
  valor: z.number(),
  aplicar: z.boolean().default(false),
});

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Reajustar preço é permitido só para gerência." },
        { status: 403 }
      );
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { aplicar, ...pedido } = parsed.data;
    const campos = [...new Set(pedido.campos)];
    const erro = validarReajuste(pedido.modo, pedido.valor);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });

    if (!aplicar) {
      return NextResponse.json(await preverReajuste(user.companyId, { ...pedido, campos }));
    }
    const resumo = await aplicarReajuste(user.companyId, { ...pedido, campos }, user);
    return NextResponse.json({ ok: true, resumo });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
