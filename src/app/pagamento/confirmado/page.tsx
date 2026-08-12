import { CheckCircle2, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { PAID_ORDER_STATUSES } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * PÁGINA PÚBLICA DE RETORNO DO CHECKOUT (InfinitePay) — SOMENTE LEITURA.
 *
 * A cliente paga e volta para cá. Esta página NÃO liquida nada: os parâmetros
 * da URL são forjáveis (a InfiniteTag da loja é pública; qualquer um cria um
 * checkout barato apontando para o order_nsu de um pedido caro da vítima).
 * Quem confirma pagamento é SÓ o webhook, autenticado pelo token secreto da
 * loja — auditoria 11/08/2026.
 *
 * Aqui apenas MOSTRAMOS o estado atual do pedido: se o webhook já chegou
 * (segundos), aparece "confirmado"; senão, "estamos confirmando". Nada é
 * escrito, então prefetch/preview/crawler não disparam efeito nenhum.
 */
export default async function PagamentoConfirmadoPage({
  searchParams,
}: {
  searchParams: Promise<{ order_nsu?: string }>;
}) {
  const { order_nsu } = await searchParams;

  let pago = false;
  if (order_nsu) {
    const order = await db.order.findUnique({
      where: { id: order_nsu },
      select: { status: true },
    });
    pago = !!order && (PAID_ORDER_STATUSES as readonly string[]).includes(order.status);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
        {pago ? (
          <>
            <CheckCircle2 className="size-14 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Pagamento confirmado! 🎉</h1>
            <p className="text-sm text-gray-500">
              Seu pedido já foi registrado como pago. Pode voltar para a
              conversa no WhatsApp — a loja recebeu a confirmação.
            </p>
          </>
        ) : (
          <>
            <Clock className="size-14 text-amber-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Recebemos o seu retorno</h1>
            <p className="text-sm text-gray-500">
              Estamos confirmando o pagamento com a InfinitePay. Assim que a
              confirmação chegar (normalmente em instantes), o pedido é
              atualizado sozinho — pode voltar para o WhatsApp da loja.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
