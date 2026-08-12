import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  category: z
    .enum([
      "PRIMEIRO_ATENDIMENTO", "CATALOGO", "COBRANCA", "POS_VENDA",
      "RECOMPRA", "PROMOCAO", "CLIENTE_FRIO", "ANIVERSARIO", "OUTRO",
    ])
    .default("OUTRO"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    // resposta nova entra no FIM da lista — a ordem escolhida pela loja
    // (setinhas ↑↓) não pode ser bagunçada por uma criação.
    // Duas criações no MESMO instante podem empatar o order (leitura e escrita
    // não são atômicas): empate é inofensivo — desempata por categoria/título
    // e a primeira reordenação normaliza tudo. Não vale um lock por isso.
    const ultimo = await db.messageTemplate.aggregate({
      where: { companyId: user.companyId },
      _max: { order: true },
    });
    const template = await db.messageTemplate.create({
      data: {
        ...parsed.data,
        companyId: user.companyId,
        order: (ultimo._max.order ?? -1) + 1,
      },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
