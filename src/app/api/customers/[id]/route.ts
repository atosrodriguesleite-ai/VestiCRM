import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { normalizePhone } from "@/lib/intake";

/** Ficha do contato para o painel lateral do atendimento. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const customer = await db.customer.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        owner: { select: { name: true } },
        tags: { include: { tag: true } },
        interests: { include: { interest: true } },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, number: true, total: true, status: true, createdAt: true },
        },
      },
    });
    if (!customer) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    const paid = customer.orders.filter((o) =>
      PAID_ORDER_STATUSES.includes(o.status)
    );
    // total gasto e nº de pedidos pagos considerando TODO o histórico
    const agg = await db.order.aggregate({
      where: { customerId: id, status: { in: PAID_ORDER_STATUSES } },
      _sum: { netTotal: true },
      _count: { _all: true },
    });

    return NextResponse.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      city: customer.city,
      state: customer.state,
      type: customer.type,
      origin: customer.origin,
      notes: customer.notes,
      preferredSize: customer.preferredSize,
      preferredColors: customer.preferredColors,
      ownerName: customer.owner?.name ?? null,
      lastPurchaseAt: customer.lastPurchaseAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
      totalSpent: agg._sum.netTotal ?? 0,
      paidOrders: agg._count._all,
      tags: customer.tags.map((t) => ({ name: t.tag.name, color: t.tag.color })),
      interests: customer.interests.map((i) => i.interest.name),
      orders: customer.orders.map((o) => ({
        id: o.id,
        number: o.number,
        total: o.total,
        status: o.status,
        paid: paid.some((p) => p.id === o.id),
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(8).optional(),
  email: z.string().email().nullable().optional().or(z.literal("").transform(() => null)),
  document: z.string().max(20).nullable().optional(), // CPF/CNPJ
  zip: z.string().max(10).nullable().optional(),
  street: z.string().max(120).nullable().optional(),
  // "Número" costuma vir com complemento (apto, bloco, loja) — cabe folgado
  streetNumber: z.string().max(80).nullable().optional(),
  complement: z.string().max(120).nullable().optional(),
  district: z.string().max(80).nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  type: z
    .enum(["VAREJO", "ATACADO", "REVENDEDORA", "LOJISTA", "BOUTIQUE", "SACOLEIRA"])
    .optional(),
  origin: z
    .enum([
      "WHATSAPP", "CATALOGO_PUBLICO", "INSTAGRAM", "FACEBOOK", "SITE",
      "NUVEMSHOP", "BLING", "MARKETPLACE", "INDICACAO", "LOJA_FISICA",
      "TRAFEGO_PAGO", "GOOGLE", "EVENTO", "MANUAL",
    ])
    .optional(),
  notes: z.string().nullable().optional(),
  preferredSize: z.string().nullable().optional(),
  preferredColors: z.string().nullable().optional(),
  nextContactAt: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      // mensagem que diz QUAL campo travou (antes só dizia "Dados inválidos"
      // e ninguém sabia onde estava o problema)
      const rotulos: Record<string, string> = {
        name: "Nome", phone: "Telefone", email: "E-mail", document: "CPF/CNPJ",
        zip: "CEP", street: "Rua", streetNumber: "Número", complement: "Complemento", district: "Bairro",
        city: "Cidade", state: "Estado", notes: "Observações",
      };
      const issue = parsed.error.issues[0];
      const campo = rotulos[String(issue?.path[0])] ?? "";
      const max = issue?.code === "too_big" ? (issue as { maximum?: number }).maximum : undefined;
      const detalhe =
        issue?.code === "too_big"
          ? `está muito longo${max ? ` (máximo ${max} caracteres)` : ""}`
          : issue?.code === "too_small"
          ? "está faltando ou muito curto"
          : issue?.code === "invalid_format"
          ? "está num formato inválido"
          : "está inválido";
      return NextResponse.json(
        { error: campo ? `O campo "${campo}" ${detalhe}.` : "Dados inválidos" },
        { status: 400 }
      );
    }

    const customer = await db.customer.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const { nextContactAt, ownerId, ...rest } = parsed.data;
    const data: Record<string, unknown> = { ...rest };
    // telefone entra SEMPRE padronizado (só dígitos, com DDI 55) — salvar com
    // formatação furava o casamento do WhatsApp e criava contato duplicado
    if (typeof data.phone === "string") data.phone = normalizePhone(data.phone);
    if (nextContactAt !== undefined) {
      data.nextContactAt = nextContactAt ? new Date(nextContactAt) : null;
    }
    if (ownerId !== undefined) {
      if (ownerId) {
        const owner = await db.user.findFirst({
          where: { id: ownerId, companyId: user.companyId },
        });
        if (!owner) {
          return NextResponse.json({ error: "Usuário inválido" }, { status: 404 });
        }
      }
      data.ownerId = ownerId;
      // troca de responsável fica registrada na linha do tempo
      if (ownerId !== customer.ownerId) {
        const nome = ownerId
          ? (await db.user.findUnique({ where: { id: ownerId } }))?.name
          : null;
        await db.customerEvent.create({
          data: {
            companyId: user.companyId,
            customerId: customer.id,
            type: "OUTRO",
            description: nome
              ? `Responsável alterado para ${nome} (por ${user.name})`
              : `Responsável removido (por ${user.name})`,
          },
        });
      }
    }

    const updated = await db.customer.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
