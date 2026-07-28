import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { ensurePlatformCompany } from "@/lib/platform";
import { PORTFOLIO_STATUS, MATERIAL_KINDS, DRE_SIGNS } from "@/lib/portfolio";

/**
 * Um produto do portfólio — gravar e apagar.
 *
 * A gravação é do DOCUMENTO INTEIRO: a tela manda o produto com todos os
 * blocos e aqui as linhas filhas são regravadas dentro de uma transação.
 * É simples de raciocinar (o que está na tela é o que fica no banco) e não
 * deixa bloco órfão quando o dono apaga uma linha no meio da edição.
 */

const texto = (max: number) => z.string().max(max).nullable().optional();
const numero = z.number().finite().nullable().optional();

const schema = z.object({
  name: z.string().min(1).max(160),
  shortDesc: texto(400),
  category: texto(80),
  status: z.enum(PORTFOLIO_STATUS),
  duration: texto(80),
  baseValue: numero,
  ownerName: texto(120),

  fullDesc: texto(20000),
  icpText: texto(20000),
  icpForWhom: texto(20000),
  icpHowValue: texto(20000),

  scope: texto(20000),
  deliveryFormat: texto(20000),
  teamInvolved: texto(20000),

  howToSell: texto(20000),
  howToDeliver: texto(20000),
  notes: texto(20000),

  variants: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        baseValue: numero,
        description: texto(2000),
      })
    )
    .max(50)
    .optional(),

  positions: z
    .array(
      z.object({
        role: z.string().min(1).max(120),
        hours: z.number().finite().min(0).optional(),
        cost: z.number().finite().min(0).optional(),
        note: texto(500),
      })
    )
    .max(100)
    .optional(),

  dreLines: z
    .array(
      z.object({
        label: z.string().min(1).max(160),
        sign: z.enum(DRE_SIGNS).optional(),
        percent: numero,
        value: numero,
        highlight: z.boolean().optional(),
      })
    )
    .max(100)
    .optional(),

  steps: z
    .array(
      z.object({
        stage: texto(120),
        task: z.string().min(1).max(400),
        detail: texto(2000),
        executor: texto(160),
        estimate: texto(60),
        popUrl: texto(600),
      })
    )
    .max(300)
    .optional(),

  materials: z
    .array(
      z.object({
        kind: z.enum(MATERIAL_KINDS).optional(),
        title: z.string().min(1).max(200),
        tag: texto(60),
        url: texto(600),
      })
    )
    .max(200)
    .optional(),

  salesFrames: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        subtitle: texto(300),
        colA: texto(120),
        colB: texto(120),
        colC: texto(120),
        rows: z
          .array(
            z.object({
              label: z.string().min(1).max(160),
              valueA: texto(8000),
              valueB: texto(8000),
              valueC: texto(8000),
            })
          )
          .max(60)
          .optional(),
      })
    )
    .max(20)
    .optional(),
});

/** Confere que o produto existe E pertence à empresa-plataforma. */
async function owned(id: string) {
  const companyId = await ensurePlatformCompany();
  const found = await db.portfolioProduct.findFirst({
    where: { id, companyId },
    select: { id: true },
  });
  return found ? companyId : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const companyId = await ensurePlatformCompany();
    const product = await db.portfolioProduct.findFirst({
      where: { id, companyId },
      include: {
        variants: { orderBy: { order: "asc" } },
        positions: { orderBy: { order: "asc" } },
        dreLines: { orderBy: { order: "asc" } },
        steps: { orderBy: { order: "asc" } },
        materials: { orderBy: { order: "asc" } },
        salesFrames: {
          orderBy: { order: "asc" },
          include: { rows: { orderBy: { order: "asc" } } },
        },
      },
    });
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }
    return NextResponse.json(product);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao carregar" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    if (!(await owned(id))) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    const d = parsed.data;

    await db.$transaction(async (tx) => {
      await tx.portfolioProduct.update({
        where: { id },
        data: {
          name: d.name.trim(),
          shortDesc: d.shortDesc ?? null,
          category: d.category?.trim() || null,
          status: d.status,
          duration: d.duration ?? null,
          baseValue: d.baseValue ?? null,
          ownerName: d.ownerName ?? null,
          fullDesc: d.fullDesc ?? null,
          icpText: d.icpText ?? null,
          icpForWhom: d.icpForWhom ?? null,
          icpHowValue: d.icpHowValue ?? null,
          scope: d.scope ?? null,
          deliveryFormat: d.deliveryFormat ?? null,
          teamInvolved: d.teamInvolved ?? null,
          howToSell: d.howToSell ?? null,
          howToDeliver: d.howToDeliver ?? null,
          notes: d.notes ?? null,
        },
      });

      // Regrava os blocos: apaga e recria na ordem que veio da tela.
      // O quadro de vendas some junto com suas linhas (cascade no banco).
      await tx.portfolioVariant.deleteMany({ where: { productId: id } });
      await tx.portfolioPosition.deleteMany({ where: { productId: id } });
      await tx.portfolioDreLine.deleteMany({ where: { productId: id } });
      await tx.portfolioStep.deleteMany({ where: { productId: id } });
      await tx.portfolioMaterial.deleteMany({ where: { productId: id } });
      await tx.portfolioSalesFrame.deleteMany({ where: { productId: id } });

      if (d.variants?.length) {
        await tx.portfolioVariant.createMany({
          data: d.variants.map((v, i) => ({
            productId: id,
            name: v.name.trim(),
            baseValue: v.baseValue ?? null,
            description: v.description ?? null,
            order: i,
          })),
        });
      }
      if (d.positions?.length) {
        await tx.portfolioPosition.createMany({
          data: d.positions.map((p, i) => ({
            productId: id,
            role: p.role.trim(),
            hours: p.hours ?? 0,
            cost: p.cost ?? 0,
            note: p.note ?? null,
            order: i,
          })),
        });
      }
      if (d.dreLines?.length) {
        await tx.portfolioDreLine.createMany({
          data: d.dreLines.map((l, i) => ({
            productId: id,
            label: l.label.trim(),
            sign: l.sign ?? "NEUTRO",
            percent: l.percent ?? null,
            value: l.value ?? null,
            highlight: l.highlight ?? false,
            order: i,
          })),
        });
      }
      if (d.steps?.length) {
        await tx.portfolioStep.createMany({
          data: d.steps.map((s, i) => ({
            productId: id,
            stage: s.stage ?? null,
            task: s.task.trim(),
            detail: s.detail ?? null,
            executor: s.executor ?? null,
            estimate: s.estimate ?? null,
            popUrl: s.popUrl ?? null,
            order: i,
          })),
        });
      }
      if (d.materials?.length) {
        await tx.portfolioMaterial.createMany({
          data: d.materials.map((m, i) => ({
            productId: id,
            kind: m.kind ?? "VENDAS",
            title: m.title.trim(),
            tag: m.tag ?? null,
            url: m.url ?? null,
            order: i,
          })),
        });
      }
      for (const [i, f] of (d.salesFrames ?? []).entries()) {
        const frame = await tx.portfolioSalesFrame.create({
          data: {
            productId: id,
            title: f.title.trim(),
            subtitle: f.subtitle ?? null,
            colA: f.colA ?? null,
            colB: f.colB ?? null,
            colC: f.colC ?? null,
            order: i,
          },
          select: { id: true },
        });
        if (f.rows?.length) {
          await tx.portfolioSalesFrameRow.createMany({
            data: f.rows.map((r, j) => ({
              frameId: frame.id,
              label: r.label.trim(),
              valueA: r.valueA ?? null,
              valueB: r.valueB ?? null,
              valueC: r.valueC ?? null,
              order: j,
            })),
          });
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao salvar" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    if (!(await owned(id))) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }
    await db.portfolioProduct.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao apagar" }, { status: 500 });
  }
}
