import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import {
  TETO_DE_DESCONTO,
  podeApagarDeVez,
} from "@/lib/catalogo/condicoes-da-campanha";

/**
 * EDITAR, PAUSAR E EXCLUIR UMA CAMPANHA (RN-040).
 *
 * O `slug` NÃO está no schema de propósito, e não é esquecimento: ele é o
 * ENDEREÇO do link, já mandado no grupo, impresso no QR e colado no story
 * (pedido do dono, 01/09/2026 — "o link que gerei já não posso mudar nada
 * nele porque já estou usando na campanha"). Trocar o endereço quebraria
 * tudo isso em silêncio; o que se edita são as CONDIÇÕES.
 */
const patchSchema = z.object({
  // MESMAS RÉGUAS DO POST, de propósito: um limite aqui que não existe lá
  // torna a campanha já criada impossível de renomear — ou até de PAUSAR,
  // porque a tela reenvia o formulário inteiro (achado da revisão de
  // 01/09/2026).
  name: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  ownerId: z.string().nullable().optional(),
  goal: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
  // condições do link
  discount: z.number().int().min(0).max(TETO_DE_DESCONTO).optional(),
  // null = herda o mínimo da loja
  minOrderMode: z.enum(["NONE", "PECAS", "VALOR"]).nullable().optional(),
  minOrderPieces: z.number().int().min(0).max(9999).optional(),
  minOrderValue: z.number().nonnegative().max(9_999_999).optional(),
});

/** RN-013: a campanha tem que ser DESTA loja — o id sozinho não basta. */
async function daLoja(id: string, companyId: string) {
  return db.trackCampaign.findFirst({ where: { id, companyId } });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const atual = await daLoja(id, user.companyId);
    if (!atual) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    // RESPONSÁVEL TEM QUE SER DA LOJA: pelo `resolveRef`, o `ownerId` da
    // campanha vira `Order.sellerId` — um id de outra empresa faria o pedido
    // sumir de Comissões, do ranking e do escopo da RN-007 (achado da
    // revisão de 01/09/2026)
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
    const campaign = await db.trackCampaign.update({
      where: { id },
      // "sem responsável" é NULO, nunca texto vazio
      data: { ...parsed.data, ...(parsed.data.ownerId === "" ? { ownerId: null } : {}) },
    });
    return NextResponse.json(campaign);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/**
 * EXCLUIR. Campanha que nunca teve clique nem pedido some de vez (nasceu de
 * um erro de digitação). A que já trouxe gente vira ARQUIVADA: sai da lista e
 * o link para de aplicar as condições, mas os números continuam nos
 * relatórios — venda não se apaga (mesma régua da ficha, RN-025).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const atual = await daLoja(id, user.companyId);
    if (!atual) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

    // O PEDIDO É A PROVA MAIS FORTE (achado da revisão de 01/09/2026): contar
    // duas vezes a mesma TrackSession (`converted` é subconjunto de tudo)
    // deixava o segundo guarda inerte — e cliente com bloqueador de rastreio
    // não gera sessão nenhuma. A campanha ficava 0×0, era APAGADA, e o
    // endereço liberado herdaria os pedidos dela numa campanha futura.
    const [clicks, orders] = await Promise.all([
      db.trackSession.count({ where: { companyId: user.companyId, campaignId: id } }),
      db.order.count({ where: { companyId: user.companyId, campaignRef: atual.slug } }),
    ]);

    if (podeApagarDeVez({ clicks, orders })) {
      await db.trackCampaign.delete({ where: { id } });
      return NextResponse.json({ apagada: true, mensagem: "Campanha excluída." });
    }
    await db.trackCampaign.update({
      where: { id },
      data: { archivedAt: new Date(), active: false },
    });
    return NextResponse.json({
      apagada: false,
      clicks,
      orders,
      mensagem:
        `Campanha encerrada e tirada da lista. O link parou de valer, mas os ` +
        `${clicks} clique(s) e ${orders} pedido(s) dela continuam nos relatórios.`,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
