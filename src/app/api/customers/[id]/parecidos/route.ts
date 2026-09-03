import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import {
  acharParecidos,
  ehTextoDePedidoDoCatalogo,
  JANELA_MESMO_PEDIDO_MS,
  partesDoTelefone,
  type ContatoBasico,
} from "@/lib/contatos-parecidos";

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
    const meio = partes ? Math.ceil(partes.numero.length / 2) : 0;
    const metades = partes
      ? [partes.numero.slice(0, meio), partes.numero.slice(meio)].filter((m) => m.length >= 3)
      : [];
    const candidatos = metades.length
      ? await db.customer.findMany({
          where: {
            companyId: user.companyId,
            id: { not: alvo.id },
            OR: metades.map((m) => ({ phone: { contains: m } })),
          },
          select: { id: true, name: true, phone: true },
          take: 200,
        })
      : [];
    const parecidos: ContatoBasico[] = acharParecidos(alvo, candidatos);

    // ---- SEGUNDO SINAL: o MESMO pedido do catálogo, vindo de OUTRO número ----
    // (Toque Leve, 03/09/2026: telefone pessoal no formulário, "enviar" pelo
    // WhatsApp da loja dela — dois cadastros, um pedido). O texto do pedido é
    // a impressão digital: bolha do catálogo de um lado, mensagem do WhatsApp
    // do outro, dentro de 2h. Funciona aberto de qualquer um dos dois lados.
    const desde = new Date(Date.now() - JANELA_MESMO_PEDIDO_MS);
    const pedidosDoAlvo = await db.message.findMany({
      where: {
        conversation: { companyId: user.companyId, customerId: alvo.id },
        createdAt: { gte: desde },
        body: { startsWith: "*Novo pedido" },
      },
      select: { body: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const textos = pedidosDoAlvo.map((m) => m.body).filter(ehTextoDePedidoDoCatalogo);
    if (textos.length > 0) {
      const iguais = await db.message.findMany({
        where: {
          conversation: { companyId: user.companyId, customerId: { not: alvo.id } },
          createdAt: { gte: desde },
          body: { in: textos },
        },
        select: {
          conversation: { select: { customer: { select: { id: true, name: true, phone: true } } } },
        },
        take: 20,
      });
      const jaListados = new Set(parecidos.map((p) => p.id));
      for (const m of iguais) {
        const outro = m.conversation.customer;
        if (jaListados.has(outro.id)) continue;
        jaListados.add(outro.id);
        // o pedido mora num dos dois cadastros — diz qual, com o número
        const pedido = await db.order.findFirst({
          where: {
            companyId: user.companyId,
            customerId: { in: [alvo.id, outro.id] },
            createdAt: { gte: desde },
            source: { not: "NUVEMSHOP" },
          },
          orderBy: { createdAt: "desc" },
          select: { number: true, customerId: true },
        });
        const onde = pedido
          ? `o pedido #${String(pedido.number).padStart(4, "0")} está no cadastro ${
              pedido.customerId === alvo.id ? "desta conversa" : `de ${outro.name}`
            }`
          : "o mesmo texto de pedido do catálogo";
        parecidos.push({
          ...outro,
          motivo: `O mesmo pedido do catálogo chegou dos dois números (${onde}) — provavelmente a mesma pessoa com dois telefones.`,
        });
      }
    }

    return NextResponse.json({ parecidos });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
