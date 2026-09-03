import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  MessageCircle,
  Truck,
  CreditCard,
  History,
  PackageCheck,
} from "lucide-react";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { isManagerUp, orderScope } from "@/lib/scope";
import {
  gravarRetratoDosItens,
  religarItensDoPedido,
  retratoCerto,
} from "@/lib/religar-itens";
import { db } from "@/lib/db";
import { brl, dateFull, dateShort, timeShort } from "@/lib/format";
import {
  orderStatusLabel,
  orderStatusColor,
  orderNumber,
  PAID_ORDER_STATUSES,
} from "@/lib/orders";
import { Card, Badge } from "@/components/ui";
import { StatusChanger } from "./status-changer";
import { StatusLive } from "./status-live";
import { CustomerEditor } from "./customer-editor";
import { ItemsEditor } from "./items-editor";
import { PaymentMethodChanger } from "./payment-method";
import { ShippingMethodChanger } from "./shipping-method";
import { DeleteOrder } from "./delete-order";
import { ResaleCatalog } from "./resale-catalog";
import { CobrancaNfe } from "./cobranca-nfe";
import { EnvioFrete } from "./envio-frete";
import { TransferirVenda } from "./transferir-venda";
import { ValoresEditor } from "./valores-editor";
import { ObservacoesEditor } from "./observacoes-editor";
import { DataDaVenda } from "./data-da-venda";
import { podeTransferirVenda, vendaOnline } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // TUDO O QUE A TELA PRECISA, DE UMA VEZ SÓ (velocidade, 20/08/2026).
  //
  // Antes eram SEIS idas ao banco em fila indiana — conferir permissão,
  // religar itens, consertar retrato, ler o pedido, listar vendedores, ler as
  // conexões —, cada uma esperando a anterior terminar. Como o banco fica
  // longe (Neon), o que pesava não era a consulta (todas custam poucos
  // milissegundos) e sim a viagem: seis idas e voltas de rede antes de a
  // página começar a ser desenhada. Agora tudo sai junto, numa viagem só.
  //
  // Os CONSERTOS saíram da frente da tela sem atrasar a verdade: o retrato
  // certo (SKU/foto) é calculado aqui mesmo, em memória (`retratoCerto`), e
  // gravado depois da entrega (`after`). A única exceção é o item ÓRFÃO —
  // raro e barulhento —, tratado logo abaixo.
  const lerPedido = () =>
    db.order.findFirst({
      where: { id, ...orderScope(user) },
      include: {
          customer: true,
          seller: true,
          conversation: true,
          items: {
            include: {
              variant: {
                select: {
                  stock: true,
                  // o que o conserto de retrato precisa para decidir o SKU e a
                  // foto certos — vem junto, sem consulta extra
                  sku: true,
                  color: true,
                  product: {
                    select: {
                      sku: true,
                      images: {
                        orderBy: { order: "asc" },
                        select: { id: true, color: true },
                      },
                    },
                  },
                },
              },
            },
          },
        payments: { orderBy: { createdAt: "asc" } },
        shipping: true,
        events: { orderBy: { createdAt: "desc" }, include: { user: true } },
      },
    });

  const [pedidoLido, sellers, mpConn, ipConn, blingConn, meConn, company] =
    await Promise.all([
      lerPedido(),
      db.user.findMany({
        // vendedor da venda: ativo e fora do perfil Suporte (não comercial) —
        // mesma régua que a API passou a aplicar
        where: { companyId: user.companyId, active: true, role: { not: "SUPPORT" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.mercadoPagoConnection.findUnique({
        where: { companyId: user.companyId },
        select: { id: true },
      }),
      db.infinitePayConnection.findUnique({
        where: { companyId: user.companyId },
        select: { id: true },
      }),
      db.blingConnection.findUnique({
        where: { companyId: user.companyId },
        select: { id: true },
      }),
      db.melhorEnvioConnection.findUnique({
        where: { companyId: user.companyId },
        select: { id: true },
      }),
      db.company.findUnique({
        where: { id: user.companyId },
        select: { shippingEnabled: true, catalogPriceMode: true },
      }),
    ]);
  // A RÉGUA DE VISIBILIDADE CONTINUA VALENDO ANTES DE QUALQUER ESCRITA: a
  // consulta acima já filtra por `orderScope`, e nada foi gravado até aqui —
  // a vendedora que abre a URL do pedido de uma colega cai no 404 sem
  // disparar conserto nenhum, como antes.
  if (!pedidoLido) notFound();
  // `let` porque o caso raro abaixo relê o pedido depois de religar os itens
  let order = pedidoLido;

  // CASO RARO — PEÇA REIMPORTADA (incidente Toque Leve, 30/07/2026): o item
  // ficou sem ponteiro para a variação. Este conserto NÃO pode esperar o
  // `after`: sem o vínculo a tela mostra "estoque 0" e o aviso âmbar manda a
  // vendedora APAGAR a linha — conselho destrutivo, e falso. Então religa
  // agora e relê. Custa duas idas ao banco, mas só no pedido quebrado; o
  // pedido normal (a esmagadora maioria) não paga nada por isso.
  if (order.items.some((i) => !i.variantId)) {
    const religados = await religarItensDoPedido(id, user.companyId).catch(() => 0);
    if (religados > 0) order = (await lerPedido()) ?? order;
  }

  // O retrato certo, aplicado NA TELA (o banco recebe depois, no `after`):
  // pedido antigo do catálogo gravou o SKU e a foto da 1ª variação em vez da
  // cor escolhida (incidente Entre Linhas, 04/08/2026).
  const itensParaGravar = order.items.map((i) => ({
    id: i.id,
    sku: i.sku,
    imageUrl: i.imageUrl,
    variant: i.variant,
  }));
  for (const item of order.items) {
    const certo = retratoCerto(item);
    if (certo.sku !== undefined) item.sku = certo.sku;
    if (certo.imageUrl !== undefined) item.imageUrl = certo.imageUrl;
  }
  // ...e a gravação acontece DEPOIS de a página ser entregue: a pessoa já
  // está lendo a tela certa enquanto o banco se atualiza atrás.
  after(async () => {
    await gravarRetratoDosItens(itensParaGravar, id, user.companyId).catch(() => 0);
  });

  // VISÃO TOTAL EDITA, COM REGISTRO (decisão do dono, 18/08/2026): a
  // vendedora com a chavinha pedidosVisaoTotal altera pedido de colega/da
  // loja, e toda mexida fica no histórico do pedido — o aviso âmbar abaixo
  // diz isso a ela. Comissão continua intocável: transferir venda é régua
  // própria. Não existe mais estado "só leitura" nesta tela: vendedora SEM
  // a chavinha nem chega aqui (o orderScope esconde o pedido → 404).
  const pedidoDeColega = user.role === "SELLER" && order.sellerId !== user.id;

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/pedidos"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4 transition"
      >
        <ArrowLeft className="size-4" />
        Pedidos
      </Link>

      {/* enquanto espera o pagamento (Pix/cartão), a tela vira "Pago" sozinha
          quando o webhook confirmar — sem refresh na mão */}
      <StatusLive orderId={order.id} statusInicial={order.status} />

      <Card className="p-5 md:p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight">
                Pedido {orderNumber(order.number)}
              </h1>
              <Badge color={orderStatusColor[order.status]}>
                {orderStatusLabel[order.status]}
              </Badge>
              {/* veio por um link de tabela de preço: a lojista precisa saber
                  por que a peça saiu por outro valor */}
              {order.priceMode && (
                <Badge color={order.priceMode === "ATACADO" ? "#d97706" : "#0284c7"}>
                  {order.priceMode === "ATACADO" ? "Preço de atacado" : "Preço de varejo"}
                </Badge>
              )}
            </div>
            {/* data automática no dia a dia; o lápis é o caso à parte do
                lançamento retroativo (gerente+, auditado em OrderEvent) */}
            <DataDaVenda
              orderId={order.id}
              createdAt={order.createdAt.toISOString()}
              pago={(PAID_ORDER_STATUSES as readonly string[]).includes(order.status)}
              sellerName={order.seller?.name ?? null}
              podeEditar={isManagerUp(user)}
            />
            <CustomerEditor
              customerId={order.customerId}
              orderId={order.id}
              customer={{
                name: order.customer.name,
                phone: order.customer.phone,
                email: order.customer.email,
                cpf: order.customer.cpf,
                cnpj: order.customer.cnpj,
                stateRegistration: order.customer.stateRegistration,
                legalName: order.customer.legalName,
                zip: order.customer.zip,
                street: order.customer.street,
                streetNumber: order.customer.streetNumber,
                complement: order.customer.complement,
                district: order.customer.district,
                city: order.customer.city,
                state: order.customer.state,
                origin: order.customer.origin,
              }}
              sellerId={order.sellerId}
              sellers={sellers}
              vendaOnline={vendaOnline(order)}
              sellerName={order.seller?.name ?? null}
            />
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {/* transferir a venda: só aparece para quem pode (dona do pedido,
                gerente ou admin) — a regra vale no servidor também */}
            {podeTransferirVenda(user, order) && (
              <TransferirVenda
                orderId={order.id}
                sellerId={order.sellerId}
                sellers={sellers}
              />
            )}
            {/* abre o VISUALIZADOR do romaneio (página do app), não o PDF cru:
                no app instalado no celular, o PDF direto tomava a tela sem
                botão de voltar e a lojista tinha que fechar o app */}
            <Link
              href={`/pedidos/${order.id}/romaneio`}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
            >
              <FileText className="size-4" />
              Romaneio em PDF
            </Link>
            {(PAID_ORDER_STATUSES as readonly string[]).includes(order.status) && (
              <ResaleCatalog
                orderId={order.id}
                customerName={order.customer.name}
                savedMarkup={order.customer.resaleMarkup}
                savedRound={order.customer.resaleRound}
                savedStoreName={order.customer.resaleStoreName}
              />
            )}
            {order.conversationId && (
              <Link
                href="/whatsapp"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 hover:border-emerald-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
              >
                <MessageCircle className="size-4 text-emerald-500" />
                Ver conversa
              </Link>
            )}
            {isManagerUp(user) && (
              <DeleteOrder orderId={order.id} number={orderNumber(order.number)} />
            )}
          </div>
        </div>

        {/* PEÇAS SEGURADAS: a reserva não tem prazo — some do estoque no
            orçamento e só volta no cancelamento. Sem este aviso, orçamento
            esquecido vira peça sumida do estoque sem ninguém entender. */}
        {order.stockDeducted &&
          !(PAID_ORDER_STATUSES as readonly string[]).includes(order.status) &&
          order.status !== "CANCELADO" && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <PackageCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>
                  {order.items.reduce((s, i) => s + i.quantity, 0)}{" "}
                  {order.items.reduce((s, i) => s + i.quantity, 0) === 1 ? "peça" : "peças"}{" "}
                  reservadas
                </b>{" "}
                para esta cliente — elas estão fora do estoque e não têm prazo
                para voltar. Se a venda não sair, <b>cancele o pedido</b> para
                liberar.
              </span>
            </p>
          )}

        <div className="mt-5 pt-5 border-t border-gray-50 min-w-0 overflow-hidden">
          <StatusChanger orderId={order.id} current={order.status} />
        </div>
        {pedidoDeColega && (
          <p className="mt-3 text-xs text-amber-600">
            ✍️ Pedido {order.seller ? "de outra vendedora" : "da loja"} — você
            pode editar, e cada alteração fica registrada no histórico com o
            seu nome.
          </p>
        )}
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Itens */}
        {/* min-w-0: item de grid não encolhe sozinho — sem isso um nome de peça
            longo (ou a régua de status) faz o cartão passar da largura do
            celular e a tela inteira anda para o lado */}
        <Card className="p-5 md:col-span-2 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">
              Itens do pedido
              {/* quem separa/confere precisa da conta total de peças de cara */}
              <span className="ml-2 text-xs font-normal text-gray-400">
                {order.items.length} {order.items.length === 1 ? "item" : "itens"} ·{" "}
                {order.items.reduce((a, i) => a + i.quantity, 0)}{" "}
                {order.items.reduce((a, i) => a + i.quantity, 0) === 1 ? "peça" : "peças"}
              </span>
            </h2>
            {order.status !== "CANCELADO" && (
              <ItemsEditor
                orderId={order.id}
                // peça acrescentada depois segue o MESMO preço do pedido: a
                // regra é a ORIGEM dele (RN-041), não um carimbo só
                priceMode={order.priceMode}
                source={order.source}
                catalogPriceMode={company?.catalogPriceMode}
                campaignDiscount={order.campaignDiscount}
                discount={order.discount}
                shippingFee={order.shippingFee}
                alreadyPaid={order.stockDeducted}
                initialItems={order.items.map((i) => ({
                  productId: i.productId ?? "",
                  variantId: i.variantId ?? "",
                  name: i.name,
                  variant: [i.color, i.size].filter(Boolean).join(" · "),
                  stock: i.variant?.stock ?? 0,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                }))}
              />
            )}
          </div>
          <ul className="divide-y divide-gray-50">
            {order.items.map((item) => (
              <li key={item.id} className="py-3 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="size-12 rounded-xl object-cover bg-gray-50 shrink-0"
                  />
                ) : (
                  <div className="size-12 rounded-xl bg-gray-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">
                    {[item.color, item.size].filter(Boolean).join(" · ")}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </p>
                </div>
                <span className="text-xs text-gray-500 tabular-nums shrink-0">
                  {item.quantity} × {brl(item.unitPrice)}
                </span>
                <span className="text-sm font-semibold tabular-nums shrink-0 w-20 text-right">
                  {brl(item.total)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Total de peças</span>
              <span className="tabular-nums">
                {order.items.reduce((a, i) => a + i.quantity, 0)}
              </span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{brl(order.subtotal)}</span>
            </div>
            {/* ordem da conta (dono, 21/08/2026): acréscimo entra primeiro,
                o desconto — global, sobre o total com acréscimo — sai depois */}
            {order.surcharge > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>
                  Acréscimo
                  {order.surchargePct != null && (
                    <span className="ml-1 text-xs text-emerald-500">
                      ({String(order.surchargePct).replace(".", ",")}%)
                    </span>
                  )}
                </span>
                <span className="tabular-nums">+ {brl(order.surcharge)}</span>
              </div>
            )}
            {order.discount > 0 && (
              <div className="flex justify-between text-rose-500">
                <span>
                  Desconto
                  {order.discountPct != null && (
                    <span className="ml-1 text-xs text-rose-400">
                      ({String(order.discountPct).replace(".", ",")}%)
                    </span>
                  )}
                </span>
                <span className="tabular-nums">− {brl(order.discount)}</span>
              </div>
            )}
            {/*
              DOIS totais, de propósito: o de cima é o que a loja faturou (e a
              base da comissão); o de baixo é o que a cliente paga. Sem essa
              separação o frete voltaria a ser confundido com venda.
            */}
            <div className="flex justify-between border-t border-gray-100 pt-1.5 font-semibold">
              <span>Valor vendido</span>
              <span className="tabular-nums">{brl(order.netTotal)}</span>
            </div>
            {order.shippingFee > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Frete</span>
                <span className="tabular-nums">+ {brl(order.shippingFee)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-1">
              <span>Total a pagar</span>
              <span className="tabular-nums text-brand-700">
                {brl(order.total)}
              </span>
            </div>
            {order.shippingFee > 0 && (
              <p className="pt-1 text-[11px] leading-snug text-gray-400">
                O frete não entra no faturamento da loja nem na comissão da vendedora.
              </p>
            )}
          </div>
          <ValoresEditor
            orderId={order.id}
            subtotal={order.subtotal}
            discount={order.discount}
            discountPct={order.discountPct}
            surcharge={order.surcharge}
            surchargePct={order.surchargePct}
            shippingFee={order.shippingFee}
            podeEditar={user.role !== "SUPPORT"}
            bloqueado={order.status === "CANCELADO"}
          />
          {/* O bilhete do pedido agora é EDITÁVEL: era só leitura, e o aviso
              que o "Colar pedido do WhatsApp" escreve ("está faltando…")
              ficava mentindo depois que a loja resolvia a falta. */}
          <ObservacoesEditor
            orderId={order.id}
            notes={order.notes}
            bloqueado={order.status === "CANCELADO"}
          />
        </Card>

        {/* min-w-0: mesma proteção do cartão de Itens — sem ela, o link da
            InfinitePay (comprido e sem espaços) alarga esta coluna além da
            tela do celular e a página inteira anda para o lado */}
        <div className="space-y-4 min-w-0">
          {/* Cobrança Pix automática + NF-e (aparece se a loja conectou) */}
          <CobrancaNfe
            orderId={order.id}
            total={order.total}
            isPaid={(PAID_ORDER_STATUSES as readonly string[]).includes(order.status)}
            isCancelled={order.status === "CANCELADO"}
            mpConnected={Boolean(mpConn)}
            ipConnected={Boolean(ipConn)}
            blingConnected={Boolean(blingConn)}
            canNfe={isManagerUp(user)}
            nfe={{ status: order.nfeStatus, number: order.nfeNumber, url: order.nfeUrl }}
          />

          {/* Envio via Melhor Envio (módulo pago à parte + conexão da loja) */}
          {company?.shippingEnabled && meConn && (
            <EnvioFrete
              orderId={order.id}
              customerName={order.customer.name}
              hasZip={(order.customer.zip ?? "").replace(/\D/g, "").length === 8}
              canBuy={isManagerUp(user)}
              isCancelled={order.status === "CANCELADO"}
              // "você já mandou o link em ..." — sem isso duas pessoas mandam
              // de novo, porque o "Enviado!" some em 4 segundos
              jaEnviadoEm={(() => {
                const ev = order.events.find(
                  (e) => e.type === "ENVIO" && e.description.startsWith("Link de rastreio enviado")
                );
                return ev ? `${dateShort(ev.createdAt)} às ${timeShort(ev.createdAt)}` : null;
              })()}
              initialShipping={
                order.shipping
                  ? {
                      meOrderId: order.shipping.meOrderId,
                      meService: order.shipping.meService,
                      meCarrier: order.shipping.meCarrier,
                      mePrice: order.shipping.mePrice,
                      meStatus: order.shipping.meStatus,
                      labelUrl: order.shipping.labelUrl,
                      trackingCode: order.shipping.trackingCode,
                      weightKg: order.shipping.weightKg,
                      nfeKey: order.shipping.nfeKey,
                    }
                  : null
              }
            />
          )}

          {/* Pagamento */}
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <CreditCard className="size-4 text-brand-600" />
              Pagamento
            </h2>
            {order.payments.map((p) => (
              <div key={p.id} className="text-sm space-y-1.5">
                <div className="flex justify-between items-center gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <PaymentMethodChanger orderId={order.id} current={p.method} />
                    {/* como a cliente pagou de verdade: 6x no cartão vira "6x"
                        aqui, sem ninguém digitar (vem da confirmação) */}
                    {p.installments && p.installments > 1 && (
                      <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        {p.installments}x
                      </span>
                    )}
                  </div>
                  <span className="font-semibold tabular-nums">
                    {brl(p.amount)}
                  </span>
                </div>
                <Badge
                  color={
                    p.status === "CONFIRMADO"
                      ? "#059669"
                      : p.status === "ESTORNADO"
                        ? "#e11d48"
                        : "#d97706"
                  }
                >
                  {p.status === "CONFIRMADO"
                    ? `Pago ${p.paidAt ? dateShort(p.paidAt) : ""}`
                    : p.status === "ESTORNADO"
                      ? "Estornado"
                      : "Pendente"}
                </Badge>
              </div>
            ))}
            {/* Valor editado DEPOIS do pagamento (frete/desconto): o pago
                confirmado é história e não se reescreve — então a diferença
                tem que ser DITA aqui, senão "Pago R$ 535" com total R$ 571
                parecia que o ajuste não pegou (relato Entre Linhas, 02/09) */}
            {(() => {
              const pagoConfirmado = order.payments
                .filter((p) => p.status === "CONFIRMADO")
                .reduce((s, p) => s + p.amount, 0);
              const diferenca = Math.round((order.total - pagoConfirmado) * 100) / 100;
              if (pagoConfirmado <= 0 || Math.abs(diferenca) < 0.01) return null;
              return (
                <div className="mt-3 pt-3 border-t border-gray-100 text-sm space-y-1">
                  <div className="flex justify-between text-gray-500">
                    <span>Total a pagar (com os ajustes)</span>
                    <span className="tabular-nums">{brl(order.total)}</span>
                  </div>
                  {diferenca > 0 ? (
                    <div className="flex justify-between font-semibold text-amber-700">
                      <span>⚠️ Falta cobrar</span>
                      <span className="tabular-nums">{brl(diferenca)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between font-semibold text-sky-700">
                      <span>Pago a mais (combinar devolução/crédito)</span>
                      <span className="tabular-nums">{brl(-diferenca)}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>

          {/* Frete */}
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <Truck className="size-4 text-brand-600" />
              Entrega
              <Badge
                color={
                  order.status === "ENTREGUE" || order.shipping?.deliveredAt
                    ? "#059669"
                    : order.status === "CANCELADO"
                      ? "#94a3b8"
                      : "#d97706"
                }
              >
                {order.status === "ENTREGUE" || order.shipping?.deliveredAt
                  ? "Concluída"
                  : order.status === "CANCELADO"
                    ? "Cancelada"
                    : "Pendente"}
              </Badge>
            </h2>
            <div className="text-sm space-y-1 text-gray-500">
              <p>
                {[order.shipping?.city, order.shipping?.state]
                  .filter(Boolean)
                  .join("/") || "Endereço a definir"}
              </p>
              {/* meio de envio: seletor da lista cadastrada pela loja */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-xs font-medium text-gray-400 shrink-0">Meio de envio</span>
                <div className="min-w-0 max-w-[62%]">
                  <ShippingMethodChanger
                    orderId={order.id}
                    current={order.shipping?.method ?? null}
                    canManage
                  />
                </div>
              </div>
              {order.shipping?.trackingCode && (
                <p className="font-mono text-xs bg-gray-50 rounded-lg px-2 py-1">
                  {order.shipping.trackingCode}
                </p>
              )}
              {order.shipping?.shippedAt && (
                <p className="text-xs">
                  Enviado em {dateFull(order.shipping.shippedAt)}
                </p>
              )}
              {order.shipping?.deliveredAt && (
                <p className="text-xs text-emerald-600">
                  Entregue em {dateFull(order.shipping.deliveredAt)}
                </p>
              )}
            </div>
          </Card>

          {/* Timeline */}
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <History className="size-4 text-brand-600" />
              Histórico
            </h2>
            <ul className="space-y-3">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <span className="size-2 rounded-full bg-brand-300 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-600 leading-snug">
                      {e.description}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {dateShort(e.createdAt)} {timeShort(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
