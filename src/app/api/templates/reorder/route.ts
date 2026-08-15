import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Reordenar as respostas rápidas: recebe a lista de ids NA ORDEM em que a
 * loja quer ver, e grava a posição de cada uma.
 *
 * Aberto para toda a equipe, igual à criação — resposta rápida é ferramenta
 * de trabalho coletiva, não configuração comercial.
 *
 * UM UPDATE só (unnest com ordinalidade): atômico, uma ida ao banco — a
 * versão com N updates numa transação fazia até centenas de round-trips ao
 * Postgres serverless por clique e abria janela de deadlock entre duas
 * pessoas reordenando ao mesmo tempo.
 *
 * Ids que não são da loja são simplesmente ignorados (o WHERE é escopado por
 * companyId): ninguém reordena — nem descobre — resposta de outra loja.
 */

const schema = z.object({
  // teto generoso: o zod aqui é só contra abuso, não um limite de produto —
  // um teto baixo (500) deixaria a loja grande sem conseguir reordenar NUNCA
  ids: z.array(z.string().min(1)).min(1).max(5000),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    await db.$executeRaw`
      UPDATE "MessageTemplate" AS m
         SET "order" = t.pos - 1
        FROM unnest(${parsed.data.ids}::text[]) WITH ORDINALITY AS t(id, pos)
       WHERE m.id = t.id
         AND m."companyId" = ${user.companyId}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ error: "Erro ao salvar a ordem" }, { status: 500 });
    }
    throw e;
  }
}
