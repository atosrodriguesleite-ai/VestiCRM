import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

/**
 * Transferir carteira: move em massa TUDO que está em aberto no nome de um
 * membro (clientes, negociações abertas, tarefas pendentes e conversas) para
 * outro vendedor — ou redistribui no rodízio entre os vendedores ativos.
 *
 * O histórico NÃO muda de dono: vendas fechadas, comissões, pedidos e
 * negociações ganhas/perdidas continuam no nome de quem fez — só o trabalho
 * em aberto troca de mãos (cenário de férias ou saída da empresa).
 */

const schema = z.object({
  // id do destino, ou null = redistribuir entre os vendedores ativos
  toUserId: z.string().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id: fromId } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const from = await db.user.findFirst({
      where: { id: fromId, companyId: user.companyId },
    });
    if (!from) {
      return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
    }

    // destinos possíveis
    let targets: { id: string }[];
    if (parsed.data.toUserId) {
      const to =
        parsed.data.toUserId === fromId
          ? null
          : await db.user.findFirst({
              where: {
                id: parsed.data.toUserId,
                companyId: user.companyId,
                active: true,
                role: { not: "SUPERADMIN" },
              },
            });
      if (!to) {
        return NextResponse.json(
          { error: "Destino inválido: escolha um membro ativo diferente da origem." },
          { status: 400 }
        );
      }
      targets = [{ id: to.id }];
    } else {
      // rodízio: vendedores ativos; sem vendedor, qualquer membro ativo
      const sellers = await db.user.findMany({
        where: { companyId: user.companyId, active: true, role: "SELLER", id: { not: fromId } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      targets = sellers.length
        ? sellers
        : await db.user.findMany({
            where: {
              companyId: user.companyId,
              active: true,
              role: { not: "SUPERADMIN" },
              id: { not: fromId },
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "Nenhum membro ativo disponível para receber a carteira." },
          { status: 400 }
        );
      }
    }

    // clientes do membro, distribuídos em rodízio (1 destino = tudo pra ele)
    const customers = await db.customer.findMany({
      where: { companyId: user.companyId, ownerId: fromId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    let negociacoes = 0;
    let tarefas = 0;
    let conversas = 0;
    for (let i = 0; i < customers.length; i++) {
      const novo = targets[i % targets.length].id;
      const c = customers[i];
      await db.customer.update({ where: { id: c.id }, data: { ownerId: novo } });
      negociacoes += (
        await db.opportunity.updateMany({
          where: { companyId: user.companyId, customerId: c.id, ownerId: fromId, status: "OPEN" },
          data: { ownerId: novo },
        })
      ).count;
      tarefas += (
        await db.task.updateMany({
          where: { companyId: user.companyId, customerId: c.id, assigneeId: fromId, status: "PENDENTE" },
          data: { assigneeId: novo },
        })
      ).count;
      conversas += (
        await db.conversation.updateMany({
          where: { companyId: user.companyId, customerId: c.id, assigneeId: fromId, status: { not: "CLOSED" } },
          data: { assigneeId: novo },
        })
      ).count;
    }

    // sobras sem cliente próprio (tarefas avulsas, conversas de clientes de
    // outros donos): vão pro primeiro destino
    const alvo = targets[0].id;
    tarefas += (
      await db.task.updateMany({
        where: { companyId: user.companyId, assigneeId: fromId, status: "PENDENTE" },
        data: { assigneeId: alvo },
      })
    ).count;
    conversas += (
      await db.conversation.updateMany({
        where: { companyId: user.companyId, assigneeId: fromId, status: { not: "CLOSED" } },
        data: { assigneeId: alvo },
      })
    ).count;
    negociacoes += (
      await db.opportunity.updateMany({
        where: { companyId: user.companyId, ownerId: fromId, status: "OPEN" },
        data: { ownerId: alvo },
      })
    ).count;

    // vendedor fixo da distribuição era ele? cai pro rodízio automático
    await db.company.updateMany({
      where: { id: user.companyId, intakeDefaultUserId: fromId },
      data: { intakeDefaultUserId: null },
    });

    return NextResponse.json({
      ok: true,
      clientes: customers.length,
      negociacoes,
      tarefas,
      conversas,
      destinos: targets.length,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
