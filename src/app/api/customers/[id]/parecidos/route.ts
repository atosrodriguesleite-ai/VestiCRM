import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { acharParecidos, partesDoTelefone } from "@/lib/contatos-parecidos";

/**
 * "Existe outro cadastro que é essa mesma pessoa?" — SÓ LEITURA.
 *
 * Nasceu do incidente da Toque Leve (20/08/2026): a mesma cliente em dois
 * cadastros com um dígito trocado no telefone; duas vendedoras atendendo
 * metades diferentes do assunto, e o que saía pelo número errado não chegava
 * em ninguém. O sistema não junta sozinho (juntar cliente errado é pior) —
 * ele mostra o parecido e deixa a loja decidir.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    // RN-013: cliente é sempre da loja de quem pergunta
    const alvo = await db.customer.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, name: true, phone: true },
    });
    if (!alvo) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    // QUEM PODE SER PARECIDO — filtro pelo TELEFONE, não pelo nome: nome no
    // banco vem com acento ("Patrícia") e a busca do banco não ignora acento,
    // então filtrar por nome deixaria passar justamente o caso real.
    //
    // Como a regra aceita no MÁXIMO um dígito de diferença, uma das duas
    // METADES do número está intacta — procurar pelas duas acha o candidato
    // sem varrer o cadastro inteiro. A regra fina fica com `acharParecidos`.
    const partes = partesDoTelefone(alvo.phone);
    if (!partes) return NextResponse.json({ parecidos: [] });
    const meio = Math.ceil(partes.numero.length / 2);
    const metades = [
      partes.numero.slice(0, meio),
      partes.numero.slice(meio),
    ].filter((m) => m.length >= 3);
    if (metades.length === 0) return NextResponse.json({ parecidos: [] });

    const candidatos = await db.customer.findMany({
      where: {
        companyId: user.companyId,
        id: { not: alvo.id },
        OR: metades.map((m) => ({ phone: { contains: m } })),
      },
      select: { id: true, name: true, phone: true },
      take: 200,
    });

    return NextResponse.json({ parecidos: acharParecidos(alvo, candidatos) });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
