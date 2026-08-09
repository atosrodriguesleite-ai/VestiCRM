import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { taskScope } from "@/lib/scope";

/**
 * CONCLUIR (OU REABRIR) VÁRIAS TAREFAS DE UMA VEZ.
 *
 * A Toque Leve chegou a 162 tarefas atrasadas — quase todas criadas pelas
 * automações em dias em que ninguém abriu a agenda. Limpar uma a uma, com um
 * clique cada, é trabalho que ninguém faz: a lista vira paisagem e a agenda
 * inteira perde a serventia.
 *
 * A régua de quem pode mexer é a MESMA da tela (`taskScope`): vendedora mexe
 * só nas dela, gerência/admin na loja inteira. Sem isso, o botão de massa
 * viraria um jeito de uma vendedora fechar a agenda das outras.
 */
const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  status: z.enum(["CONCLUIDA", "PENDENTE"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { ids, status } = parsed.data;

    // só as que ESTA pessoa pode mexer (o resto é ignorado, não é erro)
    const permitidas = await db.task.findMany({
      where: { ...taskScope(user), id: { in: ids } },
      select: { id: true, customerId: true },
    });
    if (permitidas.length === 0) {
      return NextResponse.json({ atualizadas: 0 });
    }

    const r = await db.task.updateMany({
      where: { id: { in: permitidas.map((t) => t.id) } },
      data: { status },
    });

    // concluir tarefa de contato atualiza o "último contato" da cliente —
    // mesma regra da conclusão avulsa, para as duas portas não divergirem
    if (status === "CONCLUIDA") {
      const clientes = [
        ...new Set(permitidas.map((t) => t.customerId).filter((v): v is string => !!v)),
      ];
      if (clientes.length) {
        await db.customer.updateMany({
          where: { companyId: user.companyId, id: { in: clientes } },
          data: { lastContactAt: new Date() },
        });
      }
    }

    return NextResponse.json({ atualizadas: r.count });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Erro ao atualizar as tarefas" }, { status: 500 });
  }
}
