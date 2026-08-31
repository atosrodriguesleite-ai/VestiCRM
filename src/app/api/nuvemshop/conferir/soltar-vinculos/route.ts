import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { conferirIntegracao } from "@/lib/nuvemshop-conferencia";
import { explicarNuvemshop, motivoPeloStatus } from "@/lib/nuvemshop-erros";

/**
 * SOLTAR OS VÍNCULOS TORTOS — o conserto que faltava na conferência.
 *
 * A conferência mostrava "o estoque desta peça está vindo da peça errada" e a
 * lojista não tinha como desfazer (relato de loja, 31/08/2026: 6 vínculos
 * cruzados + 6 órfãos, estoque de Lilás caindo em Preto). Diagnóstico sem
 * conserto vira lista que ninguém resolve.
 *
 * Solta só os DOIS casos em que o vínculo está objetivamente errado:
 *  • CARIMBO_CRUZADO — o vínculo aponta para uma peça de SKU DIFERENTE. Pela
 *    RN-014 quem manda é o SKU, então o vínculo é resíduo de um SKU que já
 *    esteve duplicado;
 *  • CARIMBO_ORFAO — a peça de lá não existe mais, e o vínculo velho ainda
 *    atravessa na frente do SKU.
 *
 * NÃO mexe em estoque: só tira o vínculo errado do caminho. Na próxima
 * sincronização o SKU volta a mandar e o número vem da peça certa — e a
 * variação que não casar com nenhum SKU vira pendência, com o aviso.
 *
 * O NAVEGADOR NÃO MANDA IDS: o servidor reconfere e decide sozinho. Aceitar
 * uma lista de fora seria uma porta para soltar vínculo saudável de outra loja.
 */
export const maxDuration = 60;

export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const r = await conferirIntegracao(user.companyId);
    if (!r.ok) {
      const { mensagem } =
        r.status === -1
          ? explicarNuvemshop("SEM_CONEXAO")
          : explicarNuvemshop(motivoPeloStatus(r.status));
      return NextResponse.json({ error: mensagem }, { status: 400 });
    }

    // a lista INTEIRA (a exibida na tela é recortada por tipo) e já sem o
    // órfão quando a leitura da Nuvemshop veio pela metade — quem monta é a
    // regra pura `vinculosParaSoltar`, dentro da conferência
    const ids = r.paraSoltar;
    if (ids.length === 0) {
      return NextResponse.json({ soltos: 0, mensagem: "Nenhum vínculo torto para soltar." });
    }

    // RN-013: o `product.companyId` no filtro é o que garante que a conferência
    // de uma loja nunca alcance a variação de outra
    // RASTRO: quais peças perderam o vínculo, quem mandou e quando. Sem isto,
    // um vínculo solto por engano não teria como ser identificado depois.
    const afetadas = await db.productVariant.findMany({
      where: { id: { in: ids }, product: { companyId: user.companyId } },
      select: { id: true, sku: true, color: true, size: true, nuvemshopId: true, product: { select: { name: true } } },
    });
    const { count } = await db.productVariant.updateMany({
      where: { id: { in: ids }, product: { companyId: user.companyId } },
      data: { nuvemshopId: null, nuvemshopProductId: null },
    });
    await db.commEvent
      .create({
        data: {
          companyId: user.companyId,
          direction: "OUT",
          type: "nuvemshop.vinculos.soltos",
          status: "OK",
          payload: JSON.stringify({
            porQuem: user.id,
            leituraCompleta: r.leituraCompleta,
            variacoes: afetadas.map((v) => ({
              id: v.id,
              peca: `${v.product.name} · ${v.color} ${v.size}`,
              sku: v.sku,
              vinculoSolto: v.nuvemshopId,
            })),
          }).slice(0, 8000),
        },
      })
      .catch(() => {});

    return NextResponse.json({
      soltos: count,
      // leitura pela metade: o órfão ficou de fora, e a lojista precisa saber
      // que o conserto não terminou
      leituraCompleta: r.leituraCompleta,
      mensagem:
        `${count} vínculo(s) torto(s) solto(s). O estoque NÃO foi alterado agora: ` +
        `toque em “Sincronizar agora” para o número vir da peça certa.` +
        (r.leituraCompleta
          ? ""
          : " ⚠️ A Nuvemshop não respondeu o catálogo inteiro agora, então os" +
            " vínculos de peças apagadas ficaram para depois — confira de novo" +
            " daqui a pouco."),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
