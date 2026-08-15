import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";
import {
  LIMITE_DESCRICAO,
  definirDescricao,
  definirTipo,
  descricaoDaCategoria,
  parseCategoryDescriptions,
  parseCategoryOrder,
  parseCategoryTypes,
  removerDescricao,
  removerTipo,
  renomearDescricao,
  renomearTipo,
  tipoDaCategoria,
} from "@/lib/categories";

/**
 * Categorias do catálogo. As categorias "vivem" nos produtos (campo category);
 * as criadas à mão que ainda não têm produto ficam em Company.extraCategories.
 * Gerência liberada para gerente/admin E para o perfil Suporte.
 */

async function gate() {
  const user = await requireUser();
  if (!(isManagerUp(user) || isSupport(user))) {
    return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

/** Lista as categorias (produtos + extras) com a contagem de produtos. */
export async function GET() {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const companyId = g.user.companyId;
    const [company, grouped] = await Promise.all([
      db.company.findUnique({
        where: { id: companyId },
        select: {
          extraCategories: true,
          categoryDescriptions: true,
          categoryTypes: true,
        },
      }),
      db.product.groupBy({ by: ["category"], where: { companyId }, _count: { _all: true } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.category, g._count._all]));
    const extras = parseCategoryOrder(company?.extraCategories);
    const descricoes = parseCategoryDescriptions(company?.categoryDescriptions);
    const tipos = parseCategoryTypes(company?.categoryTypes);
    const nomes = new Set<string>([...counts.keys(), ...extras]);
    const categories = [...nomes]
      .map((name) => ({
        name,
        count: counts.get(name) ?? 0,
        description: descricaoDaCategoria(descricoes, name),
        type: tipoDaCategoria(tipos, name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return NextResponse.json({ categories });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const createSchema = z.object({ name: z.string().min(1).max(40) });

/** Cria uma categoria (mesmo sem produto ainda) — fica disponível no cadastro. */
export async function POST(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Informe o nome da categoria." }, { status: 400 });
    const name = parsed.data.name.trim();
    const companyId = g.user.companyId;

    const company = await db.company.findUnique({ where: { id: companyId }, select: { extraCategories: true } });
    const extras = parseCategoryOrder(company?.extraCategories);
    const jaProduto = await db.product.findFirst({ where: { companyId, category: { equals: name, mode: "insensitive" } }, select: { id: true } });
    const jaExtra = extras.some((c) => c.toLowerCase() === name.toLowerCase());
    if (jaProduto || jaExtra) {
      return NextResponse.json({ error: "Essa categoria já existe." }, { status: 409 });
    }
    await db.company.update({
      where: { id: companyId },
      data: { extraCategories: JSON.stringify([...extras, name]) },
    });
    return NextResponse.json({ ok: true, name }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const patchSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1).max(40).optional(),
  // texto que aparece embaixo do nome da categoria no catálogo público.
  // String vazia = apagar o texto (volta ao comportamento antigo).
  description: z.string().max(LIMITE_DESCRICAO).optional(),
  // guarda-chuva da categoria no catálogo ("Blusas"). Vazio = tirar.
  type: z.string().max(40).optional(),
});

/**
 * Renomeia uma categoria em todos os produtos (e nas listas salvas) e/ou
 * grava a descrição que aparece no catálogo. Dá pra mandar só a descrição.
 */
export async function PATCH(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const companyId = g.user.companyId;
    const from = parsed.data.from.trim();
    const to = (parsed.data.to ?? from).trim();
    const renomeando = from !== to;
    if (
      !renomeando &&
      parsed.data.description === undefined &&
      parsed.data.type === undefined
    ) {
      return NextResponse.json({ ok: true, name: to });
    }

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: {
        extraCategories: true,
        categoryOrder: true,
        categoryDescriptions: true,
        categoryTypes: true,
      },
    });
    let descricoes = parseCategoryDescriptions(company?.categoryDescriptions);
    let tipos = parseCategoryTypes(company?.categoryTypes);

    if (renomeando) {
      await db.product.updateMany({ where: { companyId, category: from }, data: { category: to } });
      // a descrição acompanha o novo nome (senão sumia ao renomear)
      descricoes = renomearDescricao(descricoes, from, to);
      tipos = renomearTipo(tipos, from, to);
    }
    if (parsed.data.description !== undefined) {
      descricoes = definirDescricao(descricoes, to, parsed.data.description);
    }
    if (parsed.data.type !== undefined) {
      tipos = definirTipo(tipos, to, parsed.data.type);
    }

    const swap = (list: string[]) => {
      const next = list.map((c) => (c === from ? to : c));
      return [...new Set(next)];
    };
    await db.company.update({
      where: { id: companyId },
      data: {
        ...(renomeando
          ? {
              extraCategories: JSON.stringify(swap(parseCategoryOrder(company?.extraCategories))),
              categoryOrder: JSON.stringify(swap(parseCategoryOrder(company?.categoryOrder))),
            }
          : {}),
        categoryDescriptions: JSON.stringify(descricoes),
        categoryTypes: JSON.stringify(tipos),
      },
    });
    return NextResponse.json({
      ok: true,
      name: to,
      description: descricaoDaCategoria(descricoes, to),
      type: tipoDaCategoria(tipos, to),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const deleteSchema = z.object({
  name: z.string().min(1),
  moveTo: z.string().min(1).optional(), // move os produtos para esta categoria
  deleteProducts: z.boolean().optional(), // OU apaga os produtos da categoria
});

/** Apaga uma categoria. Se tiver produtos, exige mover ou apagar os produtos. */
export async function DELETE(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const companyId = g.user.companyId;
    const name = parsed.data.name.trim();

    const count = await db.product.count({ where: { companyId, category: name } });
    if (count > 0) {
      if (parsed.data.moveTo) {
        await db.product.updateMany({ where: { companyId, category: name }, data: { category: parsed.data.moveTo.trim() } });
      } else if (parsed.data.deleteProducts) {
        // itens de pedidos antigos ficam preservados (productId vira null)
        await db.product.deleteMany({ where: { companyId, category: name } });
      } else {
        return NextResponse.json(
          { error: "Categoria com produtos", count, needsChoice: true },
          { status: 409 }
        );
      }
    }

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: {
        extraCategories: true,
        categoryOrder: true,
        categoryDescriptions: true,
        categoryTypes: true,
      },
    });
    const drop = (list: string[]) => list.filter((c) => c !== name);
    await db.company.update({
      where: { id: companyId },
      data: {
        // categoria apagada não deixa descrição órfã no banco
        categoryDescriptions: JSON.stringify(
          removerDescricao(parseCategoryDescriptions(company?.categoryDescriptions), name)
        ),
        categoryTypes: JSON.stringify(
          removerTipo(parseCategoryTypes(company?.categoryTypes), name)
        ),
        extraCategories: JSON.stringify(drop(parseCategoryOrder(company?.extraCategories))),
        categoryOrder: JSON.stringify(drop(parseCategoryOrder(company?.categoryOrder))),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
