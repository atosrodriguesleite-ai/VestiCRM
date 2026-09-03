import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { TETO_DE_DESCONTO } from "@/lib/catalogo/condicoes-da-campanha";

const schema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen"),
  channel: z.string().min(1).default("campanha"),
  ownerId: z.string().nullable().optional(),
  goal: z.number().nonnegative().default(0),
  // CONDIÇÕES DO LINK (RN-040) — já na criação, e editáveis depois pelo
  // PATCH. O `slug` acima é a única coisa que nunca mais muda.
  discount: z.number().int().min(0).max(TETO_DE_DESCONTO).default(0),
  minOrderMode: z.enum(["NONE", "PECAS", "VALOR"]).nullable().default(null),
  minOrderPieces: z.number().int().min(0).max(9999).default(0),
  minOrderValue: z.number().nonnegative().max(9_999_999).default(0),
});

/** Campanhas/links inteligentes (cada uma vira ?ref= + QR Code). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    // mesma trava do PATCH: o `ownerId` da campanha vira `Order.sellerId`
    // `!= null` e não "se tem valor": string VAZIA passava pela conferência e
    // era gravada, e `Order.sellerId` tem chave estrangeira de verdade — todo
    // pedido por aquele link quebrava com P2003, e a fila da RN-010 tentava
    // para sempre (achado da revisão de 01/09/2026)
    if (parsed.data.ownerId != null && parsed.data.ownerId !== "") {
      const dono = await db.user.findFirst({
        where: { id: parsed.data.ownerId, companyId: user.companyId },
        select: { id: true },
      });
      if (!dono) {
        return NextResponse.json(
          { error: "Responsável não faz parte desta loja" },
          { status: 400 }
        );
      }
    }
    const exists = await db.trackCampaign.findFirst({
      where: { companyId: user.companyId, slug: parsed.data.slug },
    });
    if (exists) {
      // CAMPANHA ENCERRADA CONTINUA SEGURANDO O ENDEREÇO, mas some da lista:
      // sem dizer isso, a lojista via "já existe" apontando para uma coisa
      // que ela não enxerga em lugar nenhum (achado da revisão de
      // 01/09/2026). O endereço fica preso de propósito — recriar o mesmo
      // `?ref=` herdaria os cliques da campanha antiga.
      return NextResponse.json(
        {
          error: exists.archivedAt
            ? `O endereço “${parsed.data.slug}” pertence à campanha encerrada “${exists.name}” e continua reservado (os números dela seguem no relatório). Escolha outro endereço.`
            : "Já existe um link com este ref",
        },
        { status: 409 }
      );
    }
    const campaign = await db.trackCampaign.create({
      // "sem responsável" é NULO, nunca texto vazio (a FK de Order.sellerId
      // não perdoa: pedido pelo link quebrava com P2003)
      data: {
        ...parsed.data,
        ownerId: parsed.data.ownerId || null,
        companyId: user.companyId,
      },
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
