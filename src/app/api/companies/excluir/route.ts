import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { PLATFORM_SLUG } from "@/lib/platform";

/**
 * EXCLUIR UMA LOJA — apaga a empresa e TUDO que é dela (clientes, conversas,
 * pedidos, produtos, financeiro...) por cascata no banco. Não tem desfazer.
 *
 * Por isso a porta é estreita:
 *  1. só o Super Admin;
 *  2. a empresa-plataforma NUNCA pode ser apagada (seria o suicídio do
 *     sistema — é a dona dos leads e do painel);
 *  3. quem chama precisa DIGITAR o nome exato da loja (2ª confirmação, que
 *     obriga a ler o que está prestes a apagar);
 *  4. o que foi apagado fica registrado: quem apagou, quando, e o tamanho do
 *     estrago (contagens), porque depois não há como conferir no banco.
 */

const schema = z.object({
  companyId: z.string().min(1),
  confirmacao: z.string().min(1), // o nome da loja, digitado
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const company = await db.company.findUnique({
      where: { id: parsed.data.companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { users: true, customers: true, orders: true, products: true } },
      },
    });
    if (!company) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }
    if (company.slug === PLATFORM_SLUG) {
      return NextResponse.json(
        { error: "A empresa da plataforma não pode ser excluída." },
        { status: 409 }
      );
    }

    // 2ª confirmação: o nome digitado tem que bater exatamente (sem depender
    // de maiúscula/acento sobrando nas pontas)
    const digitado = parsed.data.confirmacao.trim().toLocaleLowerCase("pt-BR");
    const esperado = company.name.trim().toLocaleLowerCase("pt-BR");
    if (digitado !== esperado) {
      return NextResponse.json(
        { error: `Para excluir, digite exatamente o nome da loja: ${company.name}` },
        { status: 409 }
      );
    }

    const resumo = {
      usuarios: company._count.users,
      clientes: company._count.customers,
      pedidos: company._count.orders,
      produtos: company._count.products,
    };

    // registra ANTES de apagar: depois não existe mais de onde tirar isso
    await db.errorLog
      .create({
        data: {
          source: "superadmin",
          path: "/gestao",
          message: `Loja EXCLUÍDA: ${company.name} (${company.slug}) por ${user.name}`,
          detail: JSON.stringify(resumo),
        },
      })
      .catch(() => {});

    await db.company.delete({ where: { id: company.id } });

    return NextResponse.json({ ok: true, nome: company.name, resumo });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
