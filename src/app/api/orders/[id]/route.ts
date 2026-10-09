import { tocarConversasDaCliente } from "@/lib/selo-da-cliente-data";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { descartarSeparacaoAtiva, desfazerCarimboDeSeparacao, travarPedido } from "@/lib/etiquetas/separacao";
import { pacoteMudou, saiuDaFila } from "@/lib/etiquetas/separacao-regra";
import { imageHref } from "@/lib/img";
import { corIgual } from "@/lib/capa-por-cor";
import { logServerError } from "@/lib/health";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport, orderScope } from "@/lib/scope";
import {
  reverseAndDeleteOrder,
  temPagamentoConfirmadoDeGateway,
  avisarIntegracoesDaDevolucao,
} from "@/lib/order-actions";
import { avisarVendaPagaSemQuebrar } from "@/lib/push";
import { espelharEstoqueSemQuebrar } from "@/lib/nuvemshop";
import { espelharJueriSemQuebrar } from "@/lib/jueri";
import { ajusteDasTrocasPorVariacao, pacoteEfetivo } from "@/lib/troca/regra";
import { aplicarCreditoAtual, desfazerCreditoDasTrocas, devolverCreditoDoPedido, reporCreditoDasTrocas, travarCreditoDaCliente } from "@/lib/troca/credito";
import {
  orderStatusLabel,
  orderNumber,
  paymentMethodLabel,
  round2,
  PAID_ORDER_STATUSES,
  COMMISSION_ORDER_STATUSES,
  ORDER_STATUS_FLOW,
  lerPrevisaoDeRecebimento,
  podeTransferirVenda,
  vendaOnline,
  resolveCancelStock,
  resolveReopenStock,
  escolherCobrancaAConfirmar,
} from "@/lib/orders";
import { computeOrderTotals } from "@/lib/orders";
import { juntarPorVariacao, reservarComExtras, reservarOQueTiver } from "@/lib/reservations";
import { variacoesSobEncomenda } from "@/lib/sob-encomenda";
import { categoriasSobEncomenda } from "@/lib/sob-encomenda-data";
import {
  ExtrasSemCiencia,
  extrasConfirmadosSchema,
  extrasPrevistos,
  extrasSemCiencia,
  respostaDeExtras,
  textoDosExtras,
  type ExtraDaPeca,
} from "@/lib/pedido-extras";
import { mpCancelPayment } from "@/lib/mercadopago";
import { baixasLiquidasDoPedido, devolverEstoqueDoPedido } from "@/lib/estoque-do-pedido";

// Pedido grande mexe estoque peça a peça com o banco na nuvem: os 10s padrão
// da Vercel derrubavam a edição no meio (a transação tem folga de 30s)
export const maxDuration = 60;

/** A trava de corrida pegou: o pedido mudou entre a leitura e a gravação. */
class StatusMudou extends Error {}
import {
  winLinkedOpportunity,
  loseLinkedOpportunity,
  reopenLinkedOpportunity,
  syncOpportunityValue,
  garantirCartaoDoPedido,
} from "@/lib/opportunity-sync";
import {
  apagarPedidoDoFinanceiroSemQuebrar,
  sincronizarPedidoSemQuebrar,
} from "@/lib/financeiro/porta-vendas";

// Estoque fica RESERVADO em qualquer etapa que não seja Cancelado (o orçamento
// já reserva). Só o cancelamento devolve. O faturamento (venda) continua sendo
// contado só a partir de Pago (PAID_ORDER_STATUSES) — reserva não é venda.
const HELD_STATUSES = new Set<string>(ORDER_STATUS_FLOW.filter((s) => s !== "CANCELADO"));

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

const patchSchema = z.object({
  status: z
    .enum([
      "ORCAMENTO",
      "AGUARDANDO_PAGAMENTO",
      "ENTREGUE_A_RECEBER",
      "PAGO",
      "EM_PRODUCAO",
      "SEPARACAO",
      "ENVIADO",
      "ENTREGUE",
      "CANCELADO",
    ])
    .optional(),
  // Ao CANCELAR: as peças voltam ao estoque? true/omitido = voltam (padrão
  // histórico); false = baixa definitiva (perda/brinde/defeito). Ignorado
  // fora do cancelamento ou quando o pedido não segura estoque.
  restock: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  // VENDA A PRAZO (RN-069): "AAAA-MM-DD" combinado com a cliente; null tira
  // (volta ao padrão de 30 dias). Só vale no status "Entregue · a receber".
  previsaoRecebimentoEm: z.string().max(10).nullable().optional(),
  trackingCode: z.string().nullable().optional(),
  shippingMethod: z.string().nullable().optional(),
  sellerId: z.string().nullable().optional(), // vendedor responsável pela venda
  customerId: z.string().optional(), // vincula o pedido a um cliente já cadastrado
  paymentMethod: z
    .enum(["PIX", "CARTAO", "BOLETO", "CHEQUE", "DINHEIRO", "OUTRO"])
    .optional(), // forma de pagamento
  items: z.array(itemSchema).min(1).optional(), // edição dos itens (antes de pagar)
  discount: z.number().nonnegative().optional(),
  discountPct: z.number().min(0).max(100).nullish(),
  surcharge: z.number().nonnegative().optional(),
  surchargePct: z.number().min(0).max(100).nullish(),
  shippingFee: z.number().nonnegative().optional(),
  // PEÇAS EXTRAS (RN-075): o que a pessoa viu na janela e confirmou, por
  // peça — vale para acrescentar peça (edição dos itens) e para reabrir
  // pedido cancelado (o que voltar a faltar vira extra de novo)
  extrasConfirmados: extrasConfirmadosSchema,
});

/**
 * Resolve o ajuste (desconto ou acréscimo) a aplicar: o que veio na
 * requisição, ou o que já estava no pedido. Porcentagem manda sobre valor —
 * mandar `pct: null` explicitamente é como se diz "volta para reais".
 */
function ajusteAtual(
  valorNovo: number | undefined,
  pctNovo: number | null | undefined,
  valorAtual: number,
  pctAtual: number | null
): { valor: number; pct: number | null } {
  if (pctNovo !== undefined) return { valor: valorNovo ?? valorAtual, pct: pctNovo };
  if (valorNovo !== undefined) return { valor: valorNovo, pct: null }; // digitou em reais
  return { valor: valorAtual, pct: pctAtual };
}

const pctResolvida = (nova: number | null | undefined, atual: number | null) =>
  nova !== undefined ? nova : atual;

/** O item do pedido como a reserva de estoque o lê (nome legível para as frases). */
const itemDeEstoque = (i: {
  variantId: string | null;
  quantity: number;
  name: string;
  color: string | null;
  size: string | null;
}) => ({
  variantId: i.variantId,
  quantity: i.quantity,
  label: `${i.name}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(" ")})` : ""}`,
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      include: {
        items: true,
        payments: true,
        // RN-073: as trocas entram na conta do pacote efetivo (itens ± trocas)
        trocas: { include: { itens: { select: { sentido: true, variantId: true, quantity: true, name: true, color: true, size: true } } } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    // VISÃO TOTAL EDITA, COM REGISTRO (decisão do dono, 18/08/2026 — antes
    // era "mostra, não mexe"): a vendedora com a chavinha pedidosVisaoTotal
    // pode alterar qualquer pedido da loja, porque TODA mexida deste PATCH
    // fica carimbada no histórico do pedido (OrderEvent com quem fez: status,
    // valores/frete, itens, envio, forma de pagamento, vendedor, cliente).
    // O que ela segue NÃO podendo é mexer em comissão: trocar o vendedor de
    // pedido de colega ou assumir pedido sem dona continua na régua do
    // podeTransferirVenda, logo abaixo. Sem a chavinha, a trava permanece
    // (o escopo já esconde o pedido; isto é o cinto de segurança).
    if (
      user.role === "SELLER" &&
      order.sellerId !== user.id &&
      !user.pedidosVisaoTotal
    ) {
      return NextResponse.json(
        { error: "Este pedido é de outra vendedora — só a gerência pode alterá-lo." },
        { status: 403 }
      );
    }

    // Perfil Suporte: gerencia o pedido (status, rastreio, pagamento), mas
    // cancelamento e desconto são decisões comerciais — gerente pra cima.
    if (isSupport(user)) {
      // a previsão de recebimento (RN-069) muda o vencimento da conta a
      // receber — decisão comercial; a tela esconde o botão e o servidor é a
      // segunda tranca (achado da revisão)
      if (parsed.data.previsaoRecebimentoEm !== undefined) {
        return NextResponse.json(
          { error: "Combinar a previsão de recebimento é permitido só para a equipe comercial." },
          { status: 403 }
        );
      }
      if (parsed.data.status === "CANCELADO" && order.status !== "CANCELADO") {
        return NextResponse.json(
          { error: "Cancelar pedido é permitido só para gerente ou admin." },
          { status: 403 }
        );
      }
      const mexeuNoValor =
        (parsed.data.discount !== undefined && parsed.data.discount !== order.discount) ||
        parsed.data.discountPct !== undefined ||
        (parsed.data.surcharge !== undefined && parsed.data.surcharge !== order.surcharge) ||
        parsed.data.surchargePct !== undefined;
      if (mexeuNoValor) {
        return NextResponse.json(
          { error: "Alterar desconto ou acréscimo é permitido só para gerente ou admin." },
          { status: 403 }
        );
      }
    }

    // ---- Edição dos itens (permitida a qualquer momento, exceto cancelado) ----
    if (parsed.data.items) {
      if (order.status === "CANCELADO") {
        return NextResponse.json(
          { error: "Pedido cancelado não pode ser editado. Reabra mudando o status antes." },
          { status: 409 }
        );
      }
      // RN-073: pedido com TROCA registrada não edita itens — os itens são o
      // retrato da venda e o que a cliente tem é itens ± trocas; "ajustar os
      // itens para refletir a troca" devolveria ao estoque a peça devolvida e
      // baixaria de novo a levada (achado da revisão)
      if (order.trocas.length > 0) {
        return NextResponse.json(
          { error: "Este pedido tem troca registrada: os itens ficam como foram vendidos. Para mudar o que a cliente tem, registre outra troca; para desfazer a venda, cancele o pedido." },
          { status: 409 }
        );
      }
      const variantIds = parsed.data.items.map((i) => i.variantId);
      // as categorias que vendem sob encomenda (RN-076) vêm junto, não em série
      const catsSobEncomenda = categoriasSobEncomenda(user.companyId);
      const variants = await db.productVariant.findMany({
        where: { id: { in: variantIds }, product: { companyId: user.companyId } },
        // SÓ id+cor DA FOTO (o base64 fica no banco). Todas as fotos: o item
        // guarda a foto DA COR escolhida, não a capa geral — mesma régua da
        // criação do pedido (incidente Entre Linhas: item Azul c/ foto Preta)
        include: {
          product: {
            include: {
              images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
            },
          },
        },
      });
      const variantById = new Map(variants.map((v) => [v.id, v]));
      // a peça que vende SOB ENCOMENDA (RN-076) passa livre nesta edição:
      // não vira extra e a baixa dela não para no estoque
      const livres = variacoesSobEncomenda(variants, await catsSobEncomenda);
      for (const item of parsed.data.items) {
        const v = variantById.get(item.variantId);
        // a cor SEPARADA em produto próprio (RN-050) ainda vale pelo
        // produto de antes (tela aberta antes da separação)
        if (!v || (v.productId !== item.productId && v.separadaDeId !== item.productId)) {
          return NextResponse.json({ error: "Produto inválido no pedido" }, { status: 404 });
        }
      }

      // Se o pedido já baixou estoque (está pago/em produção...), reconcilia:
      // devolve o que saiu e baixa o que entrou, comparando itens antigos × novos.
      // Pedido da NUVEMSHOP fica de fora: a Nuvemshop é a DONA do estoque —
      // baixar/devolver aqui contava a mesma venda duas vezes (o espelho chega
      // pelo sync dela).
      const reconciliaEstoque = order.stockDeducted && !order.nuvemshopId;
      const deltas = new Map<string, number>(); // variantId → variação (novo - antigo)
      const pedidoAntigo = new Map<string, number>(); // variantId → qtde nos itens antigos
      const pedidoNovo = new Map<string, number>(); // variantId → qtde nos itens novos
      // os extras que a conferência previu (RN-075): na corrida, a janela
      // reabre com TODOS eles, não só com a peça que acabou no meio
      let previstosDaEdicao: ExtraDaPeca[] = [];
      if (reconciliaEstoque) {
        for (const old of order.items) {
          if (old.variantId)
            pedidoAntigo.set(old.variantId, (pedidoAntigo.get(old.variantId) ?? 0) + old.quantity);
        }
        for (const it of parsed.data.items) {
          pedidoNovo.set(it.variantId, (pedidoNovo.get(it.variantId) ?? 0) + it.quantity);
        }
        for (const [variantId, q] of pedidoNovo) deltas.set(variantId, q);
        for (const [variantId, q] of pedidoAntigo)
          deltas.set(variantId, (deltas.get(variantId) ?? 0) - q);
        // valida disponibilidade para os itens que vão baixar MAIS estoque: o
        // que passar do estoque só entra como EXTRA, com a ciência da pessoa
        // (RN-075); sem ela, o 409 de sempre — agora com a lista para a tela
        // perguntar
        const previstos = (previstosDaEdicao = extrasPrevistos(
          [...deltas]
            .filter(([, delta]) => delta > 0)
            .map(([variantId, delta]) => {
              const v = variantById.get(variantId);
              return {
                variantId,
                label: v ? `${v.product.name} (${v.color} ${v.size})` : "item",
                precisa: delta,
              };
            }),
          new Map(variants.map((v) => [v.id, v.stock])),
          livres
        ));
        if (extrasSemCiencia(previstos, parsed.data.extrasConfirmados).length > 0) {
          return NextResponse.json(respostaDeExtras(previstos), { status: 409 });
        }
      }

      // SEM o crédito de troca aqui: ele é relido DENTRO da transação, sob a
      // trava do pedido (RN-074, `aplicarCreditoAtual`)
      let totals = computeOrderTotals(
        parsed.data.items,
        ajusteAtual(parsed.data.discount, parsed.data.discountPct, order.discount, order.discountPct),
        parsed.data.shippingFee ?? order.shippingFee,
        ajusteAtual(parsed.data.surcharge, parsed.data.surchargePct, order.surcharge, order.surchargePct)
      );
      // o que a edição REALMENTE mexeu no estoque (baixa − devolução), por
      // variação — é o que as integrações espelham depois da transação
      const efetivos: { variantId: string; delta: number }[] = [];
      // as peças que esta edição acrescentou como EXTRA (RN-075)
      const extrasDaEdicao: ExtraDaPeca[] = [];
      // FOLGA DE TEMPO (incidente Entre Linhas, 05/08/2026): pedido pago com
      // vários itens ajusta estoque peça a peça dentro da transação; no
      // limite padrão de 5s o banco na nuvem fechava a transação NO MEIO
      // ("Transaction not found") e a edição não salvava.
      await db.$transaction(async (tx) => {
        // a mesma trava da troca e do cancelamento: a edição lê o livro do
        // pedido e uma troca commitando no meio deixava a devolução em dobro
        await travarPedido(tx, order.id);
        // RN-074: o crédito de troca segue abatido — relido sob a trava e
        // limitado ao valor novo; a sobra volta à ficha da cliente
        totals = await aplicarCreditoAtual(tx, {
          companyId: user.companyId,
          orderId: order.id,
          numeroDoPedido: orderNumber(order.number),
          autorNome: user.name,
          totais: totals,
        });
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.orderItem.createMany({
          data: parsed.data.items!.map((i) => {
            const v = variantById.get(i.variantId)!;
            // SKU da VARIAÇÃO e foto DA COR — igual à criação do pedido
            const fotoItem =
              v.product.images.find((im) => corIgual(im.color, v.color)) ??
              v.product.images[0];
            return {
              orderId: order.id,
              productId: v.productId,
              variantId: v.id,
              name: v.product.name,
              sku: v.sku ?? v.product.sku,
              imageUrl: fotoItem ? imageHref(fotoItem.id) : null,
              color: v.color,
              size: v.size,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              total: i.quantity * i.unitPrice,
            };
          }),
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            subtotal: totals.subtotal,
            discount: totals.discount,
            discountPct: pctResolvida(parsed.data.discountPct, order.discountPct),
            surcharge: totals.surcharge,
            surchargePct: pctResolvida(parsed.data.surchargePct, order.surchargePct),
            shippingFee: totals.shippingFee,
            netTotal: totals.netTotal,
            total: totals.total,
            creditoTroca: totals.credito,
          },
        });
        // o PACOTE mudou (variação × quantidade; só preço não conta): o
        // separado antes não é mais este pedido — volta para a fila (RN-060)
        if (pacoteMudou(order.items, parsed.data.items!)) await desfazerCarimboDeSeparacao(tx, user.companyId, order.id);
        // ajuste de estoque (só quando o pedido já estava com baixa).
        // A DEVOLUÇÃO é limitada ao que o LIVRO DE MOVIMENTOS diz que o
        // pedido segurou de verdade: reserva parcial do catálogo (pediu 10,
        // havia 4) devolvia a quantidade do item e criava estoque fantasma —
        // mesma raiz do bug já consertado no cancelamento (auditoria
        // 07/08/2026). A baixa extra continua estrita (novo > antigo exige
        // estoque); a falta antiga do pedido parcial permanece só anotada.
        if (reconciliaEstoque) {
          const seguradasNoLivro = await baixasLiquidasDoPedido(tx, order.id);
          // RN-073: o livro do pedido já conta as TROCAS (a peça devolvida
          // voltou, a levada saiu) e os itens não — comparar livro × itens
          // sem isso "devolvia" ao estoque a peça que a cliente levou na
          // troca e baixava de novo a que ela devolveu (achado da revisão).
          // O pacote que a cliente TEM é itens ± trocas, nunca negativo.
          const ajusteTrocas = ajusteDasTrocasPorVariacao(order.trocas);
          const variantesTocadas = new Set([
            ...pedidoAntigo.keys(),
            ...pedidoNovo.keys(),
            ...seguradasNoLivro.keys(),
            ...ajusteTrocas.keys(),
          ]);
          for (const variantId of variantesTocadas) {
            const troca = ajusteTrocas.get(variantId) ?? 0;
            const antes = Math.max(0, (pedidoAntigo.get(variantId) ?? 0) + troca);
            const agora = Math.max(0, (pedidoNovo.get(variantId) ?? 0) + troca);
            const segurado = seguradasNoLivro.get(variantId) ?? 0;
            // baixa a MAIS que o pedido passou a pedir (mesma régua de antes)
            const baixar = Math.max(0, agora - antes);
            // o que de fato saiu agora: tudo, ou — com extra confirmado — o
            // que havia (o resto é EXTRA e não sai de estoque nenhum, RN-075)
            let baixou = 0;
            if (baixar > 0) {
              // baixa CONDICIONADA: a conferência lá em cima e a baixa aqui
              // são dois momentos — outra venda pode levar a peça no meio.
              // Sem a condição, o estoque ficava negativo na corrida.
              // (a reserva parcial tenta a quantidade inteira primeiro, numa
              // ida só; só a peça curta faz a segunda)
              const v = variantById.get(variantId);
              const label = v ? `${v.product.name} (${v.color} ${v.size})` : "uma das peças";
              const reserva = await reservarOQueTiver(tx, [{ variantId, quantity: baixar, label }], livres);
              baixou = reserva.seguradas.reduce((s, x) => s + x.quantity, 0);
              if (baixou < baixar) {
                const extra: ExtraDaPeca = {
                  variantId,
                  label,
                  precisa: baixar,
                  doEstoque: baixou,
                  extra: baixar - baixou,
                };
                // extra que ninguém confirmou (a peça acabou entre a janela
                // e o clique): desfaz tudo e a janela reabre com a lista
                // INTEIRA desta edição — só a peça da corrida faria a
                // confirmação de volta perder as outras (achado da revisão)
                if (extrasSemCiencia([extra], parsed.data.extrasConfirmados).length > 0) {
                  throw new ExtrasSemCiencia([
                    ...previstosDaEdicao.filter((p) => p.variantId !== variantId),
                    extra,
                  ]);
                }
                extrasDaEdicao.push(extra);
              }
            }
            // devolve só o que está segurado ALÉM do que o pedido ainda pede
            // (diminuir tira primeiro do EXTRA: ele não saiu do estoque, então
            // não há o que devolver por ele)
            const devolver = Math.max(0, segurado + baixou - agora);
            if (devolver > 0) {
              await tx.productVariant.update({
                where: { id: variantId },
                data: { stock: { increment: devolver } },
              });
            }
            const efetivo = baixou - devolver; // >0 saiu do estoque, <0 voltou
            if (efetivo !== 0) {
              await tx.inventoryMovement.create({
                data: {
                  companyId: user.companyId,
                  variantId,
                  orderId: order.id,
                  type: efetivo > 0 ? "SAIDA" : "ENTRADA",
                  quantity: Math.abs(efetivo),
                  reason: `Edição do pedido ${orderNumber(order.number)}`,
                },
              });
              efetivos.push({ variantId, delta: efetivo });
            }
          }
        }
        if (order.stockDeducted) {
          // faturamento acompanha o novo VALOR VENDIDO (sem frete)
          await tx.sale.updateMany({
            where: { orderId: order.id },
            data: { total: totals.netTotal },
          });
        }
        // o painel de Envio lê o custo daqui — acompanha o frete editado
        await tx.shipping.updateMany({
          where: { orderId: order.id },
          data: { cost: totals.shippingFee },
        });
        // valor da cobrança acompanha o novo total — SÓ a pendente: pagamento
        // CONFIRMADO é registro histórico do que entrou de verdade (reescrever
        // quebrava a conciliação com o Mercado Pago)
        await tx.payment.updateMany({
          where: { orderId: order.id, status: "PENDENTE" },
          data: { amount: totals.total },
        });
        // cobrança Pix/cartão do MP gerada com o valor ANTIGO: expira agora —
        // senão a cliente pagava o QR velho e o pedido inteiro virava PAGO.
        // SÓ quando o total REALMENTE mudou: invalidar à toa (edição que não
        // mexe no valor) fazia o novo Pix reusar a mesma Idempotency-Key e
        // estourar P2002 (auditoria 07/08/2026).
        if (totals.total !== order.total) {
          const invalidadas = await tx.payment.updateMany({
            where: {
              orderId: order.id,
              status: "PENDENTE",
              // MP e InfinitePay: o link/QR do valor antigo para de valer —
              // filtrar só o MP deixava o link InfinitePay velho pagável e o
              // reuso o servia como se fosse do valor novo (auditoria 11/08/2026)
              provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] },
              dueAt: { gt: new Date() },
            },
            data: { dueAt: new Date() },
          });
          if (invalidadas.count > 0) {
            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                type: "NOTA",
                description:
                  "⚠️ O valor do pedido mudou: a cobrança Pix/cartão anterior foi invalidada — gere uma nova antes de enviar à cliente.",
                userId: user.id,
              },
            });
          }
        }
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: `Itens do pedido editados por ${user.name} — valor vendido R$ ${totals.netTotal.toFixed(2)}, total a pagar R$ ${totals.total.toFixed(2)}`,
            userId: user.id,
          },
        });
        if (extrasDaEdicao.length > 0) {
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: "NOTA",
              description: textoDosExtras(extrasDaEdicao, user.name),
              userId: user.id,
            },
          });
        }
      }, { timeout: 30_000, maxWait: 10_000 });

      // PORTA ÚNICA DO FINANCEIRO (RN-033): editar itens/valores MUDA o que a
      // cliente deve, e o financeiro só era avisado na TROCA DE STATUS — lá
      // embaixo, depois de respostas antecipadas e de validações que ainda
      // podem recusar a chamada. O lançamento ficava congelado no valor
      // VELHO: foi assim que a venda #0076 continuou R$ 554,50 na conciliação
      // com o pedido valendo R$ 553,50. Fica AQUI, colado na transação que já
      // gravou o novo valor, para valer também quando o resto do PATCH falhar.
      sincronizarPedidoSemQuebrar(order.id);

      // Integrações espelham o ajuste de estoque da edição (uma venda, uma
      // baixa) — antes a Nuvemshop/Jueri nunca ficavam sabendo e os canais
      // divergiam para sempre. Pelo delta EFETIVO (o que de fato saiu/voltou
      // do estoque), não pela diferença dos itens.
      if (efetivos.length > 0) {
        espelharEstoqueSemQuebrar(
          user.companyId,
          efetivos.map((e) => e.variantId)
        );
        espelharJueriSemQuebrar(
          user.companyId,
          // efetivo>0 = baixou mais no CRM → Jueri desconta; <0 devolve
          efetivos.map((e) => ({ variantId: e.variantId, delta: -e.delta }))
        );
      }
      // o funil acompanha o VALOR VENDIDO (frete não é negociação)
      await syncOpportunityValue(user.companyId, order.opportunityId, totals.netTotal);
      // se veio SÓ a edição de itens, responde aqui
      if (!parsed.data.status && parsed.data.notes === undefined && parsed.data.sellerId === undefined && !parsed.data.customerId && !parsed.data.paymentMethod && parsed.data.trackingCode === undefined && parsed.data.shippingMethod === undefined && parsed.data.previsaoRecebimentoEm === undefined) {
        // PORTA ÚNICA DO FINANCEIRO (RN-033) ANTES de responder: editar os
        // itens muda o que a cliente paga, e este caminho saía sem avisar o
        // financeiro — o pedido de R$ 100 virava R$ 450 e o lançamento
        // continuava R$ 100 PARA SEMPRE (a repescagem também não alcança:
        // a parcela está quitada, sem saldo em aberto). Achado da auditoria
        // completa do módulo, 03/09/2026.
        sincronizarPedidoSemQuebrar(order.id);
        const updated = await db.order.findUnique({ where: { id: order.id } });
        return NextResponse.json(updated);
      }
    }

    // ---- Só os VALORES mudaram (desconto, acréscimo ou frete) ----
    // Sem este caminho, mexer no desconto exigia reenviar o pedido inteiro.
    // Aqui o cálculo sai dos itens que JÁ estão gravados.
    const mexeuSoNosValores =
      !parsed.data.items &&
      (parsed.data.discount !== undefined ||
        parsed.data.discountPct !== undefined ||
        parsed.data.surcharge !== undefined ||
        parsed.data.surchargePct !== undefined ||
        parsed.data.shippingFee !== undefined);

    if (mexeuSoNosValores) {
      if (order.status === "CANCELADO") {
        return NextResponse.json(
          { error: "Pedido cancelado não pode ser editado. Reabra mudando o status antes." },
          { status: 409 }
        );
      }
      // A tela reenvia desconto/acréscimo mesmo quando só o FRETE mudou. Se
      // os ajustes vieram IGUAIS aos gravados, o dinheiro gravado não se
      // recalcula: a regra do desconto global (dono, 21/08/2026) vale para
      // quem MEXE no desconto — nunca para reescrever, de carona num ajuste
      // de frete, o faturamento de pedido antigo calculado pela regra da
      // época (pago, mês fechado, comissão paga).
      const pctDescFinal = pctResolvida(parsed.data.discountPct, order.discountPct);
      const pctAcrFinal = pctResolvida(parsed.data.surchargePct, order.surchargePct);
      const descontoIntacto =
        pctDescFinal === order.discountPct &&
        (pctDescFinal != null ||
          (parsed.data.discount ?? order.discount) === order.discount);
      const acrescimoIntacto =
        pctAcrFinal === order.surchargePct &&
        (pctAcrFinal != null ||
          (parsed.data.surcharge ?? order.surcharge) === order.surcharge);

      const freteNovo = round2(
        Math.max(parsed.data.shippingFee ?? order.shippingFee, 0)
      );
      // SEM o crédito de troca: ele é relido dentro da transação (RN-074)
      let totals =
        descontoIntacto && acrescimoIntacto
          ? {
              // só o frete muda: valor vendido e ajustes ficam como estão
              // (o valor de ANTES do crédito; o crédito volta a sair lá dentro)
              subtotal: order.subtotal,
              discount: order.discount,
              surcharge: order.surcharge,
              shippingFee: freteNovo,
              netTotal: round2(order.netTotal + order.creditoTroca),
              total: round2(order.netTotal + order.creditoTroca + freteNovo),
              credito: 0,
            }
          : computeOrderTotals(
              order.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
              ajusteAtual(parsed.data.discount, parsed.data.discountPct, order.discount, order.discountPct),
              parsed.data.shippingFee ?? order.shippingFee,
              ajusteAtual(parsed.data.surcharge, parsed.data.surchargePct, order.surcharge, order.surchargePct)
            );

      // AUDITORIA: mexer no valor do pedido é decisão comercial e mexe em
      // comissão — fica registrado quem mudou, de quanto para quanto.
      const mudancas: string[] = [];
      const brl = (v: number) => `R$ ${v.toFixed(2)}`;
      if (totals.discount !== order.discount)
        mudancas.push(`desconto ${brl(order.discount)} → ${brl(totals.discount)}`);
      if (totals.surcharge !== order.surcharge)
        mudancas.push(`acréscimo ${brl(order.surcharge)} → ${brl(totals.surcharge)}`);
      if (totals.shippingFee !== order.shippingFee)
        mudancas.push(`frete ${brl(order.shippingFee)} → ${brl(totals.shippingFee)}`);

      await db.$transaction(async (tx) => {
        // a mesma fila do pedido (troca, crédito, status): sem ela, um "Usar
        // crédito" no meio era sobrescrito por esta gravação (RN-074)
        await travarPedido(tx, order.id);
        totals = await aplicarCreditoAtual(tx, {
          companyId: user.companyId,
          orderId: order.id,
          numeroDoPedido: orderNumber(order.number),
          autorNome: user.name,
          totais: totals,
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            discount: totals.discount,
            discountPct: pctResolvida(parsed.data.discountPct, order.discountPct),
            surcharge: totals.surcharge,
            surchargePct: pctResolvida(parsed.data.surchargePct, order.surchargePct),
            shippingFee: totals.shippingFee,
            netTotal: totals.netTotal,
            total: totals.total,
            creditoTroca: totals.credito,
          },
        });
        // o painel de Envio lê o custo daqui — sem isso o frete editado não
        // aparecia na etiqueta/declaração
        await tx.shipping.updateMany({
          where: { orderId: order.id },
          data: { cost: totals.shippingFee },
        });
        // a cobrança acompanha o que a cliente paga (COM frete) — SÓ a
        // pendente; pagamento confirmado é histórico e não se reescreve
        await tx.payment.updateMany({
          where: { orderId: order.id, status: "PENDENTE" },
          data: { amount: totals.total },
        });
        // cobrança do valor antigo expira (mesma regra da edição de itens) —
        // MP e InfinitePay, senão o link InfinitePay velho seguia pagável
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            status: "PENDENTE",
            provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] },
            dueAt: { gt: new Date() },
          },
          data: { dueAt: new Date() },
        });
        if (order.stockDeducted) {
          await tx.sale.updateMany({
            where: { orderId: order.id },
            data: { total: totals.netTotal },
          });
        }
        if (mudancas.length) {
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: "NOTA",
              description: `Valores alterados por ${user.name}: ${mudancas.join("; ")}. Valor vendido ${brl(totals.netTotal)} · total a pagar ${brl(totals.total)}`,
              userId: user.id,
            },
          });
        }
      }, { timeout: 30_000, maxWait: 10_000 });
      // PORTA ÚNICA DO FINANCEIRO (RN-033): editar itens/valores MUDA o que a
      // cliente deve, e o financeiro só era avisado na TROCA DE STATUS — lá
      // embaixo, depois de respostas antecipadas e de validações que ainda
      // podem recusar a chamada. O lançamento ficava congelado no valor
      // VELHO: foi assim que a venda #0076 continuou R$ 554,50 na conciliação
      // com o pedido valendo R$ 553,50. Fica AQUI, colado na transação que já
      // gravou o novo valor, para valer também quando o resto do PATCH falhar.
      sincronizarPedidoSemQuebrar(order.id);
      // o funil acompanha o VALOR VENDIDO (frete não é negociação)
      await syncOpportunityValue(user.companyId, order.opportunityId, totals.netTotal);

      if (
        !parsed.data.status &&
        parsed.data.notes === undefined &&
        parsed.data.sellerId === undefined &&
        !parsed.data.customerId &&
        !parsed.data.paymentMethod &&
        parsed.data.trackingCode === undefined &&
        parsed.data.shippingMethod === undefined &&
        parsed.data.previsaoRecebimentoEm === undefined
      ) {
        // mesma coisa aqui (RN-033): mexer no frete, no desconto ou no
        // acréscimo muda o que a cliente paga e tem que chegar ao financeiro
        sincronizarPedidoSemQuebrar(order.id);
        const updated = await db.order.findUnique({ where: { id: order.id } });
        return NextResponse.json(updated);
      }
    }

    const newStatus = parsed.data.status;
    const PAID_STATUSES = new Set<string>(PAID_ORDER_STATUSES);
    const willChangeStatus = !!newStatus && newStatus !== order.status;
    // ESTOQUE (reserva/hold): segura ao entrar numa etapa não cancelada;
    // devolve só ao cancelar. Assim o orçamento já reserva a peça.
    // Pedido da NUVEMSHOP NÃO mexe em estoque aqui: a Nuvemshop é a dona (a
    // baixa aconteceu lá; o espelho chega pelo sync). Cancelar e reabrir um
    // pedido dela baixava a MESMA venda de novo no CRM — e o número dobrado
    // ainda era empurrado de volta para a loja online (auditoria 07/08/2026).
    const estoqueDaqui = !order.nuvemshopId;
    const needStockDeduct =
      willChangeStatus && HELD_STATUSES.has(newStatus!) && !order.stockDeducted && estoqueDaqui;
    const needStockReturn =
      willChangeStatus && !HELD_STATUSES.has(newStatus!) && order.stockDeducted && estoqueDaqui;
    // Cancelando: o vendedor escolheu devolver as peças ou baixar de vez?
    const cancelStock = needStockReturn
      ? resolveCancelStock(order.stockDeducted, parsed.data.restock)
      : "NADA";
    // Reabrindo: pedido que cancelou SEM devolver não desconta de novo — as
    // peças já saíram; a baixa original só "recola" no pedido.
    const reopenStock = needStockDeduct
      ? resolveReopenStock(order.stockDeducted, order.stockWrittenOff)
      : "NADA";
    // FATURAMENTO (venda): entra/sai de etapa paga — independente do estoque.
    const enteringPaid =
      willChangeStatus && PAID_STATUSES.has(newStatus!) && !PAID_STATUSES.has(order.status);
    const leavingPaid =
      willChangeStatus && !PAID_STATUSES.has(newStatus!) && PAID_STATUSES.has(order.status);
    // COMISSÃO: a venda a prazo (RN-069) paga comissão na entrega, então a
    // régua "define a dona antes" vale para ela também — sem isso o pedido
    // entregue sem dona em setembro só ganhava vendedora ao virar pago em
    // outubro, e a comissão caía num mês já fechado e lançado (achado da
    // revisão)
    const COMISSAO_STATUSES = new Set<string>(COMMISSION_ORDER_STATUSES);
    const enteringComissao =
      willChangeStatus &&
      COMISSAO_STATUSES.has(newStatus!) &&
      !COMISSAO_STATUSES.has(order.status);

    // Regra: um pedido só pode virar PAGO (ou entregue a receber) com um
    // vendedor atribuído (RN-006). EXCEÇÃO: venda da loja online (Nuvemshop)
    // não tem vendedora por regra (RN-005) — sem a exceção, um pedido
    // Nuvemshop cancelado nunca mais poderia reabrir: exigiria a vendedora
    // que ele não pode ter.
    if (enteringComissao && !vendaOnline(order)) {
      const effectiveSeller =
        parsed.data.sellerId !== undefined ? parsed.data.sellerId : order.sellerId;
      if (!effectiveSeller) {
        return NextResponse.json(
          {
            error:
              newStatus === "ENTREGUE_A_RECEBER"
                ? "Atribua um vendedor ao pedido antes de marcá-lo como entregue a receber (em \"Editar dados\") — a comissão conta na entrega."
                : "Atribua um vendedor ao pedido antes de marcá-lo como pago (em \"Editar dados\").",
          },
          { status: 409 }
        );
      }
    }

    // ITENS ATUAIS para a régua de estoque: se os itens foram editados NESTA
    // MESMA chamada, `order.items` (lido no começo) está velho — a baixa
    // reservava as peças antigas (auditoria 05/08/2026).
    // RN-073: o que o pedido volta a segurar é o PACOTE EFETIVO (itens ±
    // trocas) — restaurar um pedido cancelado que teve troca reservava as
    // peças originais, que pela troca já tinham voltado todas, e deixava fora
    // as que a cliente de fato levou (achado da revisão)
    const itensParaEstoque = pacoteEfetivo(
      parsed.data.items
        ? await db.orderItem.findMany({
            where: { orderId: order.id },
            select: { variantId: true, quantity: true, name: true, color: true, size: true },
          })
        : order.items,
      order.trocas
    );

    // Antes de escrever: se o pedido vai segurar estoque agora (reserva/baixa),
    // confere disponibilidade e bloqueia se faltar. Reanexar não desconta
    // nada, então não há disponibilidade a conferir.
    // as peças que vendem SOB ENCOMENDA (RN-076) entre as do pedido que
    // volta a segurar estoque: baixa sem condição, nunca extra
    let livresDoRestauro: ReadonlySet<string> = new Set();
    if (needStockDeduct && reopenStock !== "REANEXAR") {
      const variantIds = itensParaEstoque
        .map((i) => i.variantId)
        .filter((v): v is string => !!v);
      const [variants, catsSobEncomenda] = await Promise.all([
        db.productVariant.findMany({
          where: { id: { in: variantIds } },
          include: { product: { select: { sobEncomenda: true, category: true, jueriId: true } } },
        }),
        categoriasSobEncomenda(user.companyId),
      ]);
      const stockById = new Map(variants.map((v) => [v.id, v.stock]));
      livresDoRestauro = variacoesSobEncomenda(variants, catsSobEncomenda);
      // pela SOMA de cada peça (duas linhas da mesma peça passavam uma a uma
      // com estoque para só uma delas). O que faltar volta a ser EXTRA, com a
      // ciência da pessoa (RN-075) — sem ela, a recusa de sempre: a peça foi
      // vendida para outra cliente enquanto o pedido estava cancelado.
      const previstos = extrasPrevistos(
        juntarPorVariacao(itensParaEstoque.map(itemDeEstoque)).map((p) => ({
          ...p,
          precisa: p.quantity,
        })),
        stockById,
        livresDoRestauro
      );
      if (extrasSemCiencia(previstos, parsed.data.extrasConfirmados).length > 0) {
        return NextResponse.json(respostaDeExtras(previstos), { status: 409 });
      }
    }

    const data: Record<string, unknown> = {};
    // eventos de troca de vendedor/cliente esperam a gravação dar certo
    const eventosPendentes: string[] = [];
    if (parsed.data.notes !== undefined) {
      data.notes = parsed.data.notes;
      // observações também deixam rastro (condição da visão total que
      // edita) — sem isto dava para reescrever o bilhete do pedido em silêncio
      if ((parsed.data.notes ?? "") !== (order.notes ?? "")) {
        eventosPendentes.push(`Observações do pedido atualizadas por ${user.name}`);
      }
    }
    if (parsed.data.previsaoRecebimentoEm !== undefined) {
      // PREVISÃO DE RECEBIMENTO (RN-069): só tem sentido enquanto o pedido
      // está a receber — fora dele não há conta em aberto para vencer
      const statusFinal = parsed.data.status ?? order.status;
      if (statusFinal !== "ENTREGUE_A_RECEBER") {
        return NextResponse.json(
          { error: "A previsão de recebimento só vale no status \"Entregue · a receber\"." },
          { status: 409 }
        );
      }
      // a entrega pode estar acontecendo NESTA chamada (status junto): aí o
      // carimbo ainda não existe e a referência é agora
      const entregueEm = order.entregueAReceberEm ?? order.paidAt ?? new Date();
      const lida = lerPrevisaoDeRecebimento(parsed.data.previsaoRecebimentoEm, entregueEm);
      if (!lida.ok) return NextResponse.json({ error: lida.erro }, { status: 400 });
      const atual = order.previsaoRecebimentoEm?.getTime() ?? null;
      const nova = lida.data?.getTime() ?? null;
      if (atual !== nova) {
        data.previsaoRecebimentoEm = lida.data;
        eventosPendentes.push(
          lida.data
            ? `Previsão de recebimento combinada: ${lida.data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} (por ${user.name})`
            : `Previsão de recebimento removida por ${user.name} — volta aos 30 dias da entrega`
        );
      }
    }
    if (parsed.data.sellerId !== undefined && parsed.data.sellerId !== order.sellerId) {
      // Venda da loja online não aceita vendedora (RN-005): a mensagem é
      // específica — a genérica de permissão mandaria "pedir à gerência",
      // e a gerência também não pode ATRIBUIR. REMOVER pode (e é o único
      // jeito de consertar o legado de antes da regra, que segue gerando
      // comissão indevida) — coisa de gerência, com registro no histórico.
      if (vendaOnline(order)) {
        if (parsed.data.sellerId) {
          return NextResponse.json(
            {
              error:
                "Venda da loja online (Nuvemshop) não tem vendedora e não gera comissão — não dá para atribuir.",
            },
            { status: 409 }
          );
        }
        if (!isManagerUp(user)) {
          return NextResponse.json(
            { error: "Remover a vendedora de uma venda da loja online é da gerência." },
            { status: 403 }
          );
        }
      }
      // MESMA REGRA do botão "Transferir venda": a vendedora só mexe no
      // pedido dela. Sem isso, bastaria usar "Editar dados" para desviar a
      // comissão de uma colega — a regra do botão seria só enfeite.
      else if (!podeTransferirVenda(user, order)) {
        return NextResponse.json(
          {
            error:
              "Você só pode mudar o vendedor de pedidos que são seus. Peça para a gerente ou a administradora.",
          },
          { status: 403 }
        );
      }
    }
    if (parsed.data.sellerId !== undefined) {
      let newSellerName: string | null = null;
      if (parsed.data.sellerId) {
        // Vendedor da venda tem que ser alguém que VENDE: ativo e fora do
        // perfil Suporte (que não tem poderes comerciais). Aceitar usuário
        // desligado sumia com a comissão do painel de equipe.
        const seller = await db.user.findFirst({
          where: {
            id: parsed.data.sellerId,
            companyId: user.companyId,
            active: true,
            role: { not: "SUPPORT" },
          },
        });
        if (!seller) {
          return NextResponse.json(
            { error: "Vendedor inválido: precisa ser um usuário ativo da equipe comercial." },
            { status: 404 }
          );
        }
        newSellerName = seller.name;
      } else if (
        // pago E a venda a prazo (RN-069): os dois contam comissão
        COMISSAO_STATUSES.has(parsed.data.status ?? order.status) &&
        // exceção RN-005: a venda online É paga e sem dona — inclusive quando
        // a gerência REMOVE a vendedora legada de antes da regra
        !vendaOnline(order)
      ) {
        // a regra que obriga vendedor para faturar vale também ao EDITAR:
        // sem isso dava para tirar a dona de um pedido já pago
        return NextResponse.json(
          { error: "Pedido pago (ou entregue a receber) precisa de um vendedor. Transfira a venda em vez de deixá-la sem dona." },
          { status: 409 }
        );
      }
      data.sellerId = parsed.data.sellerId;
      // troca de vendedor mexe em COMISSÃO: fica sempre registrada no
      // histórico do pedido (quem trocou, de quem para quem) — sem rastro
      // seria possível redirecionar a comissão em silêncio.
      // O EVENTO SÓ É GRAVADO DEPOIS que a alteração salvar de verdade
      // (eventosPendentes): antes ele era escrito aqui e, se a transação de
      // status caísse (409/erro), a linha do tempo afirmava uma transferência
      // que nunca aconteceu (auditoria 07/08/2026).
      if (parsed.data.sellerId !== order.sellerId) {
        const oldSeller = order.sellerId
          ? await db.user.findUnique({
              where: { id: order.sellerId },
              select: { name: true },
            })
          : null;
        eventosPendentes.push(
          `Vendedor alterado de ${oldSeller?.name ?? "(sem vendedor)"} para ${newSellerName ?? "(sem vendedor)"} por ${user.name}`
        );
      }
    }
    // RN-074: o crédito abatido é DA cliente do pedido — trocar a cliente com
    // ele no pedido mandaria o crédito de uma para a ficha da outra no
    // cancelamento (achado da revisão)
    if (parsed.data.customerId && parsed.data.customerId !== order.customerId && order.creditoTroca > 0.005) {
      return NextResponse.json(
        { error: "Este pedido usa crédito de troca da cliente. Tire o crédito antes de trocar a cliente do pedido." },
        { status: 409 }
      );
    }
    if (parsed.data.customerId && parsed.data.customerId !== order.customerId) {
      const customer = await db.customer.findFirst({
        where: { id: parsed.data.customerId, companyId: user.companyId },
      });
      if (!customer) {
        return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
      }
      data.customerId = customer.id;
      eventosPendentes.push(
        `Pedido vinculado ao cliente ${customer.name} por ${user.name}`
      );
    }

    // cliente/vendedor FINAIS desta chamada: quando eles mudam JUNTO com o
    // status→PAGO, a venda e o "última compra" gravavam nos ANTIGOS (lidos no
    // começo) e o aviso anunciava o nome errado (auditoria 07/08/2026)
    const clienteFinalId = (data.customerId as string | undefined) ?? order.customerId;
    const vendedorFinalId =
      parsed.data.sellerId !== undefined ? parsed.data.sellerId : order.sellerId;

    if (newStatus && newStatus !== order.status) {
      /**
       * TUDO NUMA TRANSAÇÃO COM TRAVA DE CORRIDA (auditoria 05/08/2026).
       * Antes eram ~15 escritas soltas: duplo clique em Cancelar devolvia o
       * estoque em dobro, e uma falha no meio deixava pagamento confirmado
       * sem o status mudar. Agora: o update do status é CONDICIONADO ao
       * status que lemos (a segunda chamada simultânea não passa) e todos os
       * efeitos (estoque, venda, pagamento, envio) entram ou saem JUNTOS.
       */
      let mexidas: { variantId: string; delta: number }[] = [];
      /** QRs do Mercado Pago a cancelar NO PROVEDOR depois da transação (RN-047) */
      let cancelarNoMp: string[] = [];
      try {
        mexidas = await db.$transaction(
          async (tx) => {
            // a mesma trava por pedido da separação (RN-060): o descarte do
            // rascunho e o primeiro bipe não se cruzam
            await travarPedido(tx, order.id);
            const trava = await tx.order.updateMany({
              where: { id: order.id, status: order.status },
              data: {
                status: newStatus,
                // DATA DO DINHEIRO: carimba quando virou pago; sai ao voltar
                ...(enteringPaid ? { paidAt: order.paidAt ?? new Date() } : {}),
                ...(leavingPaid ? { paidAt: null } : {}),
                // VENDA A PRAZO (RN-069): carimba QUANDO a cliente levou — é a
                // data da comissão e a base do vencimento (+30 dias). Nunca é
                // apagado depois: a comissão contou no mês da entrega e não pode
                // contar de novo quando virar pago. E o pedido que JÁ ERA PAGO
                // (o Pix voltou) leva a data do pagamento, não a de hoje: a
                // comissão dele já contou naquele mês — carimbar hoje a faria
                // contar de novo no mês da volta (achado da revisão).
                ...(newStatus === "ENTREGUE_A_RECEBER"
                  ? { entregueAReceberEm: order.entregueAReceberEm ?? order.paidAt ?? new Date() }
                  : {}),
                // a previsão combinada é da conta em aberto: ao receber, ela
                // se cumpriu e sai — se a venda voltar a prazo (o Pix voltou),
                // vale o padrão de 30 dias até a vendedora combinar de novo;
                // reaplicar uma data velha punha a cliente atrasada na hora
                // (achado da revisão). A história do pedido guarda o que foi.
                ...(enteringPaid ? { previsaoRecebimentoEm: null } : {}),
                // voltou a ser pago (reaberto de cancelado/orçamento): a
                // separação de antes não vale mais — volta para a fila (RN-060)
                ...(enteringPaid ? { separadoEm: null } : {}),
                ...(needStockDeduct ? { stockDeducted: true } : {}),
                ...(needStockReturn ? { stockDeducted: false } : {}),
                // baixa definitiva liga a marca; reanexar (ou devolver) limpa
                ...(cancelStock === "BAIXAR" ? { stockWrittenOff: true } : {}),
                ...(reopenStock === "REANEXAR" || cancelStock === "DEVOLVER"
                  ? { stockWrittenOff: false }
                  : {}),
              },
            });
            if (trava.count === 0) throw new StatusMudou();
            // saiu da fila de separação (RN-060): o rascunho em andamento não vale mais
            if (saiuDaFila(order.status, newStatus!)) await descartarSeparacaoAtiva(tx, user.companyId, order.id);

            await tx.orderEvent.create({
              data: {
                orderId: order.id,
                type: "STATUS",
                description: `Status alterado para "${orderStatusLabel[newStatus]}" por ${user.name}`,
                userId: user.id,
              },
            });

            // REABRIR pedido cancelado: a cobrança estornada volta a valer.
            // Sem isso o pedido reaberto ficava com pagamento "ESTORNADO"
            // para sempre — não dava para cobrar de novo.
            if (order.status === "CANCELADO") {
              await tx.payment.updateMany({
                where: { orderId: order.id, status: "ESTORNADO" },
                data: { status: "PENDENTE", paidAt: null },
              });
            }

            // Pular etapas segue a lógica completa: entrar em etapa paga
            // vindo de não paga confirma o pagamento e registra a venda.
            if (enteringPaid) {
              // UMA cobrança vira "pago", nunca todas (RN-047). O mesmo pedido
              // costuma ter duas pendentes — a que nasce com ele e o link/QR
              // que a vendedora gerou — e são caminhos ALTERNATIVOS do mesmo
              // dinheiro: confirmar as duas fazia o pedido constar como pago
              // em DOBRO ("pago a mais R$ 555,50", pedido #0076, 03/09/2026).
              const cobrancas = await tx.payment.findMany({
                where: { orderId: order.id },
                select: {
                  id: true, status: true, amount: true, mpPaymentId: true, createdAt: true,
                  provider: true, pixCopiaECola: true,
                },
              });
              const totalAgora = await tx.order.findUnique({
                where: { id: order.id },
                // frete-ok: a cobrança é do que a cliente paga
                select: { total: true },
              });
              const decisao = escolherCobrancaAConfirmar(
                cobrancas,
                totalAgora?.total ?? order.total
              );
              if (decisao.confirmar) {
                await tx.payment.update({
                  where: { id: decisao.confirmar },
                  data: {
                    status: "CONFIRMADO",
                    paidAt: new Date(),
                    ...(decisao.ajustarPara != null ? { amount: decisao.ajustarPara } : {}),
                  },
                });
              }
              // as irmãs NÃO viram pagamento — só param de valer, senão o QR
              // no WhatsApp da cliente continuava pagável num pedido já pago
              if (decisao.invalidar.length > 0) {
                await tx.payment.updateMany({
                  where: { id: { in: decisao.invalidar }, status: "PENDENTE" },
                  data: { dueAt: new Date() },
                });
                // ...e o QR do Mercado Pago para de valer LÁ TAMBÉM. Vencer só
                // aqui dentro não impede a cliente de pagar o código que já
                // está no WhatsApp dela — é o mesmo cuidado que o caminho
                // automático toma (`settleOrderPaid`). O link de cartão/
                // InfinitePay não vira pagamento antes de pagar: não há o que
                // cancelar, e a linha pendente segura o alarme de segundo
                // pagamento.
                cancelarNoMp = cobrancas
                  .filter(
                    (c) =>
                      decisao.invalidar.includes(c.id) &&
                      c.provider === "MERCADO_PAGO" &&
                      c.pixCopiaECola &&
                      c.mpPaymentId
                  )
                  .map((c) => c.mpPaymentId!);
              }
              // valor ATUAL do banco: se os itens foram editados nesta mesma
              // chamada, o valor lido no começo estaria desatualizado.
              // A venda registra o VALOR VENDIDO (sem frete) — mesma régua
              // da edição de itens, que já gravava netTotal.
              const atual = await tx.order.findUnique({
                where: { id: order.id },
                select: { netTotal: true },
              });
              await tx.sale.create({
                data: {
                  companyId: user.companyId,
                  // cliente/vendedor FINAIS (podem ter mudado nesta chamada)
                  customerId: clienteFinalId,
                  sellerId: vendedorFinalId,
                  orderId: order.id,
                  total: atual?.netTotal ?? order.netTotal,
                  description: `Pedido ${orderNumber(order.number)}`,
                  category: "Pedido",
                },
              });
              await tx.customer.update({
                where: { id: clienteFinalId },
                data: { lastPurchaseAt: new Date() },
              });
            }

            // Envio: Enviado marca a saída; Entregue marca saída + entrega.
            if (newStatus === "ENVIADO" || newStatus === "ENTREGUE") {
              const now = new Date();
              const shipData = {
                shippedAt: now,
                ...(newStatus === "ENTREGUE" ? { deliveredAt: now } : {}),
              };
              // NÃO carimba por cima da postagem que já existe: a data real
              // vem da transportadora, e sobrescrevê-la ao confirmar a entrega
              // na mão ("a cliente avisou no WhatsApp que recebeu") fazia o
              // envio entrar na média de entrega como ZERO DIA — a média da
              // tela Envios saía pela metade (achado da revisão).
              const envioAtual = await tx.shipping.findUnique({
                where: { orderId: order.id },
                select: { shippedAt: true },
              });
              await tx.shipping.upsert({
                where: { orderId: order.id },
                update: {
                  ...(newStatus === "ENTREGUE" ? { deliveredAt: now } : {}),
                  ...(envioAtual?.shippedAt ? {} : { shippedAt: now }),
                },
                create: { orderId: order.id, cost: order.shippingFee, ...shipData },
              });
            }
            // Voltar para antes do envio (ou cancelar) limpa as marcas
            if (["ORCAMENTO", "AGUARDANDO_PAGAMENTO", "ENTREGUE_A_RECEBER", "PAGO", "EM_PRODUCAO", "SEPARACAO", "CANCELADO"].includes(newStatus)) {
              await tx.shipping.updateMany({
                where: { orderId: order.id },
                data: { shippedAt: null, deliveredAt: null },
              });
            }

            // ---- Estoque ----
            const efeitos: { variantId: string; delta: number }[] = [];
            if (needStockDeduct && reopenStock === "REANEXAR") {
              // Pedido cancelado sem devolução voltou à ativa: as peças já
              // estavam fora do estoque — nada desconta. O líquido do livro
              // de movimentos deste pedido continua positivo, então um novo
              // cancelamento COM devolução devolve exatamente o que saiu.
              await tx.orderEvent.create({
                data: {
                  orderId: order.id,
                  type: "NOTA",
                  description: `Pedido reaberto por ${user.name}: as peças já haviam sido baixadas no cancelamento e NÃO foram descontadas de novo.`,
                  userId: user.id,
                },
              });
            } else if (needStockDeduct) {
              // Baixa condicionada, em lote (a mesma reserva da criação):
              // segura o que existe, nunca negativa. O que faltar só fica
              // como EXTRA se a pessoa confirmou AQUELA quantidade (RN-075);
              // a peça que acabou entre a janela e o clique desfaz a
              // transação e a janela reabre com os números de agora — antes,
              // essa falta entrava calada (com aviso à gerência) e o pedido
              // voltava devendo peça que ninguém viu (achado da revisão).
              const reserva = await reservarComExtras(tx, itensParaEstoque.map(itemDeEstoque), livresDoRestauro);
              if (extrasSemCiencia(reserva.extras, parsed.data.extrasConfirmados).length > 0) {
                throw new ExtrasSemCiencia(reserva.extras);
              }
              if (reserva.extras.length > 0) {
                await tx.orderEvent.create({
                  data: {
                    orderId: order.id,
                    type: "NOTA",
                    description: textoDosExtras(reserva.extras, user.name),
                    userId: user.id,
                  },
                });
              }
              // movimento pelo que foi DE FATO segurado (não pela quantidade
              // pedida) — é o que a devolução vai ler no cancelamento
              const motivo = enteringPaid
                ? `Baixa por pagamento — pedido ${orderNumber(order.number)}`
                : `Reserva — pedido ${orderNumber(order.number)}`;
              if (reserva.seguradas.length > 0) {
                await tx.inventoryMovement.createMany({
                  data: reserva.seguradas.map((s) => ({
                    companyId: user.companyId,
                    variantId: s.variantId,
                    orderId: order.id,
                    type: "SAIDA" as const,
                    quantity: s.quantity,
                    reason: motivo,
                  })),
                });
              }
              efeitos.push(
                ...reserva.seguradas.map((s) => ({ variantId: s.variantId, delta: -s.quantity }))
              );
            } else if (needStockReturn && cancelStock === "BAIXAR") {
              // Vendedor escolheu NÃO devolver: baixa definitiva. O estoque
              // fica como está — a SAÍDA original do livro de movimentos
              // vira a baixa — e a decisão fica registrada no histórico.
              await tx.orderEvent.create({
                data: {
                  orderId: order.id,
                  type: "NOTA",
                  description: `Cancelado SEM devolver as peças ao estoque (baixa definitiva) — decisão de ${user.name}.`,
                  userId: user.id,
                },
              });
            } else if (needStockReturn) {
              // devolve EXATAMENTE o que o pedido segurou (livro de
              // movimentos), nunca a quantidade do item — reserva parcial e
              // item religado deixam de criar estoque fantasma
              const devolvidas = await devolverEstoqueDoPedido(tx, {
                companyId: user.companyId,
                orderId: order.id,
                motivo: `Cancelamento do pedido ${orderNumber(order.number)}`,
              });
              efeitos.push(
                ...devolvidas.map((d) => ({ variantId: d.variantId, delta: d.quantity }))
              );
            }

            // RN-073: cancelar desfaz o crédito que as trocas deram à cliente
            // (a venda inteira está sendo devolvida) e DIZ na história a
            // diferença ainda não acertada; restaurar repõe o crédito
            if (willChangeStatus && newStatus === "CANCELADO") {
              // RN-074: PRIMEIRO o crédito que ESTE pedido usou volta para a
              // ficha (a venda não aconteceu, o crédito continua sendo dela);
              // DEPOIS o crédito que as trocas DELE deram é estornado, com o
              // saldo já de volta — na ordem inversa, o pedido que usou o
              // crédito da própria troca devolvia o crédito por cima do
              // estorno e a cliente ficava com ele (achado da revisão). O
              // número é RELIDO sob a trava; restaurar o pedido NÃO reaplica.
              const agora = await tx.order.findUnique({
                where: { id: order.id },
                select: { creditoTroca: true, netTotal: true, total: true, customerId: true },
              });
              if (agora && agora.creditoTroca > 0.005) {
                await travarCreditoDaCliente(tx, agora.customerId);
                const devolvido = await devolverCreditoDoPedido(tx, {
                  companyId: user.companyId,
                  customerId: agora.customerId,
                  orderId: order.id,
                  numeroDoPedido: orderNumber(order.number),
                  valor: agora.creditoTroca,
                  autorNome: user.name,
                  motivo: "cancelado",
                });
                await tx.order.update({
                  where: { id: order.id },
                  data: {
                    creditoTroca: 0,
                    netTotal: round2(agora.netTotal + devolvido),
                    total: round2(agora.total + devolvido),
                  },
                });
                await tx.orderEvent.create({
                  data: {
                    orderId: order.id,
                    type: "NOTA",
                    description: `Crédito de troca de R$ ${devolvido.toFixed(2).replace(".", ",")} devolvido à ficha da cliente com o cancelamento.`,
                    userId: user.id,
                  },
                });
              }
              await desfazerCreditoDasTrocas(tx, { companyId: user.companyId, orderId: order.id, autorNome: user.name, motivo: "cancelado" });
            } else if (willChangeStatus && order.status === "CANCELADO") {
              await reporCreditoDasTrocas(tx, { companyId: user.companyId, orderId: order.id, autorNome: user.name });
            }

            // FATURAMENTO: sair de etapa paga estorna o pagamento e tira a
            // venda do faturamento — independente do estoque.
            if (leavingPaid) {
              await tx.payment.updateMany({
                where: { orderId: order.id, status: "CONFIRMADO" },
                data: { status: newStatus === "CANCELADO" ? "ESTORNADO" : "PENDENTE" },
              });
              await tx.sale.deleteMany({ where: { orderId: order.id } });
            }

            // CANCELAMENTO — dinheiro e frete (auditoria 07/08/2026):
            if (newStatus === "CANCELADO") {
              // 1) cobrança Pix/cartão pendente NÃO pode continuar pagável:
              // se a cliente pagasse o QR, o dinheiro entrava num pedido morto
              const pend = await tx.payment.updateMany({
                where: {
                  orderId: order.id,
                  status: "PENDENTE",
                  // MP e InfinitePay: o link/QR pendente para de valer no
                  // cancelamento (o link InfinitePay velho seguia pagável)
                  provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] },
                  dueAt: { gt: new Date() },
                },
                data: { dueAt: new Date() },
              });
              // 2) havia pagamento confirmado? o status ESTORNADO no sistema
              // NÃO devolve o dinheiro no gateway — o estorno é manual, e no
              // lugar CERTO: InfinitePay ou Mercado Pago, conforme quem
              // recebeu (dizer "Mercado Pago" para um pedido da InfinitePay
              // mandava a loja procurar o estorno na conta errada — 12/08/2026)
              const estornados = await tx.payment.findMany({
                where: { orderId: order.id, status: "ESTORNADO" },
                select: { provider: true },
              });
              if (estornados.length > 0) {
                const temIp = estornados.some((p) => p.provider === "INFINITEPAY");
                const temMp = estornados.some((p) => p.provider === "MERCADO_PAGO");
                const onde = temIp && temMp
                  ? "no app da InfinitePay e no painel do Mercado Pago (conforme onde a cliente pagou)"
                  : temIp
                    ? "no app da InfinitePay (aba Vendas → a venda desta cliente → Estornar)"
                    : "no painel do Mercado Pago";
                await tx.orderEvent.create({
                  data: {
                    orderId: order.id,
                    type: "NOTA",
                    description: `⚠️ Pedido cancelado tinha pagamento confirmado — o valor NÃO volta sozinho para a cliente. Faça o estorno ${onde}.`,
                    userId: user.id,
                  },
                });
              }
              if (pend.count > 0) {
                await tx.orderEvent.create({
                  data: {
                    orderId: order.id,
                    type: "NOTA",
                    description: "Cobrança Pix/cartão pendente foi invalidada pelo cancelamento.",
                    userId: user.id,
                  },
                });
              }
              // 3) etiqueta ME comprada e não postada: lembrar de cancelar
              // (o valor só volta para a carteira ME se a loja cancelar lá)
              const envio = await tx.shipping.findUnique({
                where: { orderId: order.id },
                select: { meOrderId: true, meStatus: true, mePrice: true },
              });
              if (envio?.meOrderId && envio.meStatus !== "CANCELADO") {
                await tx.orderEvent.create({
                  data: {
                    orderId: order.id,
                    type: "ENVIO",
                    description: `⚠️ Este pedido tem etiqueta do Melhor Envio${envio.mePrice ? ` (R$ ${envio.mePrice.toFixed(2).replace(".", ",")})` : ""}. Cancele a etiqueta no painel de Envio para o valor voltar à carteira.`,
                    userId: user.id,
                  },
                });
              }
            }
            return efeitos;
          },
          { timeout: 30_000, maxWait: 10_000 }
        );
      } catch (e) {
        if (e instanceof StatusMudou) {
          return NextResponse.json(
            { error: "O pedido acabou de ser alterado por outra pessoa. Recarregue a página e confira antes de tentar de novo." },
            { status: 409 }
          );
        }
        throw e;
      }

      // ---- fora da transação: efeitos não-críticos ----
      // o QR que sobrou para de valer no Mercado Pago (RN-047). Best-effort:
      // falhar aqui não desfaz o pedido pago — a linha continua pendente e o
      // alarme de segundo pagamento segue armado.
      if (cancelarNoMp.length > 0) {
        await Promise.allSettled(
          cancelarNoMp.map((idMp) => mpCancelPayment(user.companyId, idMp))
        ).catch(() => {});
      }
      // FUNIL acompanha o pedido: pago → GANHO; cancelado → PERDIDO;
      // reaberto → volta a ABERTA. Pedido sem cartão que virou pago ganha
      // o seu na hora — venda paga nunca fica fora do "Pedido fechado".
      if (enteringPaid) {
        if (order.opportunityId) {
          await winLinkedOpportunity(user.companyId, order.opportunityId);
        } else {
          await garantirCartaoDoPedido(user.companyId, order.id);
        }
      } else if (newStatus === "CANCELADO") {
        await loseLinkedOpportunity(user.companyId, order.opportunityId);
      } else if (leavingPaid || order.status === "CANCELADO") {
        await reopenLinkedOpportunity(user.companyId, order.opportunityId);
      }

      // Integrações espelham o que REALMENTE mexeu no estoque (uma venda,
      // uma baixa) — pelo delta efetivo, não pela quantidade do item.
      if (mexidas.length > 0) {
        espelharEstoqueSemQuebrar(
          user.companyId,
          mexidas.map((m) => m.variantId)
        );
        espelharJueriSemQuebrar(user.companyId, mexidas);
      }
    }

    if (parsed.data.paymentMethod) {
      // o evento só existe se alguma cobrança PENDENTE realmente trocar de
      // forma — pedido com pagamento confirmado (ou já na forma pedida) não
      // muda nada, e histórico registrando troca que não houve é mentira
      const trocouForma = order.payments.some(
        (p) => p.status !== "CONFIRMADO" && p.method !== parsed.data.paymentMethod
      );
      // só a cobrança pendente muda de forma — a confirmada é histórico
      await db.payment.updateMany({
        where: { orderId: order.id, status: { not: "CONFIRMADO" } },
        data: { method: parsed.data.paymentMethod },
      });
      if (trocouForma) {
        // forma de pagamento também é dinheiro: fica no histórico como as
        // demais mexidas (condição da visão total que edita: tudo registrado)
        await db.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: `Forma de pagamento alterada para ${paymentMethodLabel[parsed.data.paymentMethod]} por ${user.name}`,
            userId: user.id,
          },
        });
      }
    }

    if (
      parsed.data.trackingCode !== undefined ||
      parsed.data.shippingMethod !== undefined
    ) {
      const shipData = {
        ...(parsed.data.trackingCode !== undefined
          ? { trackingCode: parsed.data.trackingCode }
          : {}),
        ...(parsed.data.shippingMethod !== undefined
          ? { method: parsed.data.shippingMethod }
          : {}),
      };
      // upsert: cria a linha de envio se ainda não existir (pedido novo/manual)
      await db.shipping.upsert({
        where: { orderId: order.id },
        update: shipData,
        create: { orderId: order.id, cost: order.shippingFee, ...shipData },
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ENVIO",
          description: `Dados de envio atualizados por ${user.name}`,
          userId: user.id,
        },
      });
    }

    // o status já foi gravado com trava dentro da transação; aqui entram só
    // os demais campos (notas, vendedor, cliente, rastreio...)
    const updated = Object.keys(data).length
      ? await db.order.update({ where: { id }, data })
      : (await db.order.findUnique({ where: { id } }))!;
    // RN-063: pedido TRANSFERIDO para outra cliente deixa `updatedAt` só na
    // nova; a antiga perde o pedido sem rastro e o selo dela ficava "Cliente"
    // na Central aberta até o F5 (achado da revisão). Tocar as conversas dela
    // faz o sync recalcular — mesma porta do pedido apagado.
    if (data.customerId && data.customerId !== order.customerId) {
      await tocarConversasDaCliente(db, user.companyId, order.customerId);
    }

    // linha do tempo SÓ do que aconteceu de verdade: os eventos de troca de
    // vendedor/cliente são gravados depois que a alteração salvou
    for (const descricao of eventosPendentes) {
      await db.orderEvent.create({
        data: { orderId: order.id, type: "NOTA", description: descricao, userId: user.id },
      });
    }

    // 💰 Notificação de venda: dispara quando o pedido ACABOU de virar pago —
    // para QUALQUER status pago (PAID_ORDER_STATUSES), vindo de um não pago.
    // Vai no after(): chamada solta era congelada pela Vercel junto com a
    // resposta, e o celular não tocava (relato do dono, 11/09/2026).
    if (enteringPaid) {
      const customer = await db.customer.findUnique({
        where: { id: clienteFinalId },
        select: { name: true },
      });
      avisarVendaPagaSemQuebrar(user.companyId, {
        id: order.id,
        number: order.number,
        total: updated.total,
        customerName: customer?.name ?? "Cliente",
      });
    }

    // PORTA ÚNICA DO FINANCEIRO (RN-033): qualquer mexida no pedido põe o
    // lançamento em dia — virou pago, voltou para aguardando, cancelou,
    // reabriu. Sem o módulo sai calada; falhando, não segura a resposta.
    sincronizarPedidoSemQuebrar(order.id);

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof ExtrasSemCiencia) {
      return NextResponse.json(respostaDeExtras(e.extras), { status: 409 });
    }
    // ERRO INESPERADO NÃO PODE SER MUDO (incidente Entre Linhas, 05/08/2026):
    // a tela mostrava só "Não foi possível salvar os itens" e ninguém sabia o
    // porquê. Agora o detalhe fica no painel Saúde e a resposta explica.
    await logServerError({
      source: "server",
      path: "/api/orders/[id]",
      message: "Pedido: falha inesperada ao salvar edição",
      detail: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
    }).catch(() => {});
    return NextResponse.json(
      {
        error:
          "Algo inesperado impediu de salvar. Tente de novo em instantes — o detalhe técnico já foi registrado para o suporte (painel Saúde).",
      },
      { status: 500 }
    );
  }
}

/**
 * Excluir um pedido de vez — usado para limpar testes.
 * Desfaz TODO o efeito do pedido, como se ele nunca tivesse existido:
 *  1. devolve o estoque ao catálogo (se estava baixado);
 *  2. remove a venda do faturamento;
 *  3. apaga o histórico de estoque ligado a ele;
 *  4. apaga o pedido (itens, pagamentos, envio e eventos caem por cascata).
 * Permitido apenas para dono/admin/gerente — vendedor comum não exclui.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Você não tem permissão para excluir pedidos." },
        { status: 403 }
      );
    }
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      include: { items: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    // Pedido com pagamento automático CONFIRMADO não se exclui: a cascata
    // apagaria o rastro do dinheiro real que entrou (Mercado Pago ou
    // InfinitePay — auditoria 07/08 e 11/08/2026). Para desfazer, CANCELE o
    // pedido (que trata o estorno). Mesma trava do DELETE pelo funil.
    if (await temPagamentoConfirmadoDeGateway(order.id)) {
      return NextResponse.json(
        {
          error:
            "Este pedido tem pagamento confirmado (Mercado Pago ou InfinitePay) e não pode ser excluído. Cancele o pedido (isso trata o estorno) em vez de apagar.",
        },
        { status: 409 }
      );
    }

    // o lançamento do financeiro não pode ficar vivo apontando para uma
    // venda que deixou de existir (RN-033) — dinheiro fantasma no extrato
    apagarPedidoDoFinanceiroSemQuebrar(user.companyId, order.id);
    const { devolvidas, oppReaberta } = await db.$transaction(async (tx) => {
      const oppId = order.opportunityId;
      // Desfaz o pedido (estoque + faturamento) e o apaga.
      const resultado = await reverseAndDeleteOrder(tx, order);
      // A oportunidade que NASCEU JUNTO com o pedido sai do funil também
      // (catálogo cria as duas coisas no mesmo instante). Mas a negociação
      // que JÁ EXISTIA no funil e foi apenas LIGADA ao pedido é trabalho da
      // vendedora — apagá-la sumia com o cartão e o histórico da negociação.
      // Essa volta ao funil como aberta (o pedido é que deixou de existir).
      let reabrir: string | null = null;
      if (oppId) {
        const opp = await tx.opportunity.findFirst({
          where: { id: oppId, companyId: user.companyId },
          select: { id: true, createdAt: true },
        });
        if (opp) {
          const nasceuComOPedido =
            Math.abs(opp.createdAt.getTime() - order.createdAt.getTime()) <
            10 * 60 * 1000;
          if (nasceuComOPedido) {
            await tx.opportunity.delete({ where: { id: opp.id } });
          } else {
            reabrir = opp.id;
          }
        }
      }
      // mesma folga da edição: desfazer pedido grande peça a peça não cabe
      // nos 5s padrão com o banco na nuvem
      return { ...resultado, oppReaberta: reabrir };
    }, { timeout: 30_000, maxWait: 10_000 });

    // a negociação preservada volta para uma etapa aberta do funil
    if (oppReaberta) {
      await reopenLinkedOpportunity(user.companyId, oppReaberta);
    }

    // Integrações donas de estoque precisam saber que as peças voltaram —
    // sem isso a Nuvemshop continuava vendendo com o número velho.
    avisarIntegracoesDaDevolucao(user.companyId, devolvidas);

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
