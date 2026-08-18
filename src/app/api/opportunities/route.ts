import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { canSeeAll } from "@/lib/scope";

const createSchema = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1),
  value: z.number().nonnegative().default(0),
  stageId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { customerId, title, value, stageId } = parsed.data;

    // valida que cliente e etapa pertencem à empresa do usuário (multi-tenant).
    // Vendedora só abre negociação na PRÓPRIA carteira OU em cliente SEM dona
    // (lead da fila/catálogo sem ?ref — trabalhá-lo é legítimo); o cliente de
    // uma COLEGA é barrado (a API aceitava qualquer um — revisão 18/08/2026).
    // Gerente/admin seguem com tudo.
    const escopoCliente = canSeeAll(user)
      ? { companyId: user.companyId }
      : {
          companyId: user.companyId,
          OR: [{ ownerId: user.id }, { ownerId: null }],
        };
    const [customer, stage] = await Promise.all([
      db.customer.findFirst({ where: { id: customerId, ...escopoCliente } }),
      db.stage.findFirst({
        where: { id: stageId, pipeline: { companyId: user.companyId } },
      }),
    ]);
    if (!customer || !stage) {
      // caso comum: o "lead novo" digitado no funil tinha o telefone de um
      // cliente que JÁ pertence a outra vendedora (o cadastro dedupa e
      // devolve a ficha existente) — explicar é melhor que "não encontrado"
      if (!customer && stage) {
        const daLoja = await db.customer.count({
          where: { id: customerId, companyId: user.companyId },
        });
        if (daLoja > 0) {
          return NextResponse.json(
            {
              error:
                "Este cliente já está na carteira de outra vendedora. Peça para a gerência criar a oportunidade ou transferir o cliente.",
            },
            { status: 403 }
          );
        }
      }
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const opp = await db.opportunity.create({
      data: {
        companyId: user.companyId,
        customerId,
        stageId,
        title,
        value,
        ownerId: user.id,
        status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
      },
    });
    return NextResponse.json(opp, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
