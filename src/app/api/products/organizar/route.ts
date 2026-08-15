import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";

/**
 * ORGANIZADOR DE CATÁLOGO — muda a categoria de VÁRIOS produtos de uma vez.
 *
 * Usado pela seleção em massa e pela sugestão automática da tela Produtos
 * (loja nova com centenas de peças: organizar uma a uma levava dias). A
 * escolha do que muda é feita NA TELA, com revisão humana — aqui só se
 * aplica, sempre dentro da própria loja.
 *
 * Mesma régua do gerenciador de categorias: gerente+ e Suporte (organizar
 * catálogo é trabalho operacional, não decisão comercial).
 */

const schema = z.object({
  itens: z
    .array(
      z.object({
        id: z.string().min(1),
        category: z.string().trim().min(1).max(60),
      })
    )
    .min(1)
    .max(1000),
});

export const maxDuration = 30;

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user) && !isSupport(user)) {
      return NextResponse.json(
        { error: "Organizar categorias é permitido para gerência e suporte." },
        { status: 403 }
      );
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    // agrupa por categoria de destino: um comando por categoria, não por
    // produto (500 peças viram ~10 comandos, não 500)
    const porCategoria = new Map<string, string[]>();
    for (const item of parsed.data.itens) {
      const lista = porCategoria.get(item.category) ?? [];
      lista.push(item.id);
      porCategoria.set(item.category, lista);
    }

    let alterados = 0;
    for (const [category, ids] of porCategoria) {
      const r = await db.product.updateMany({
        // companyId no filtro: id de produto de OUTRA loja é ignorado
        where: { id: { in: ids }, companyId: user.companyId },
        data: { category },
      });
      alterados += r.count;
    }

    return NextResponse.json({ ok: true, alterados });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
