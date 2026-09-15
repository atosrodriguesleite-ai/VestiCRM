import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { podeReajustarPreco } from "@/lib/scope";
import { aplicarReajuste, preverReajuste, validarReajuste } from "@/lib/reajuste-preco";
import { varrerEnviosDeEstoqueSeDevido } from "@/lib/nuvemshop";
import { after } from "next/server";

/**
 * REAJUSTE DE PREÇO EM LOTE POR CATEGORIA (RN-056).
 *
 * Gerência e suporte (`podeReajustarPreco`, decisão do dono em 15/09/2026:
 * o suporte já edita a ficha da peça, preço inclusive); vendedora não.
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
    if (!podeReajustarPreco(user)) {
      return NextResponse.json(
        { error: "Reajustar preço é permitido só para gerência e suporte." },
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
    // o que não coube no envio de agora (RN-057) já está na fila: a repesca
    // pega carona aqui também
    after(() => varrerEnviosDeEstoqueSeDevido(user.companyId));
    return NextResponse.json({ ok: true, resumo });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
