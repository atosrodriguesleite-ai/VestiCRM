/**
 * A FAIXA "HOJE" AO VIVO (RN-088): os quatro números de hoje — contatos
 * novos, pedidos pagos, vendido e quem está esperando agora — calculados
 * NA HORA, não dos fatos do dia (que a rodada de carona refaz a cada 30
 * min, RN-082). São três consultas baratas por colunas indexadas, as mesmas
 * réguas de sempre: cliente cadastrada hoje (calendário de SP), pedido pago
 * hoje pela data do pagamento com `netTotal` (RN-001/RN-002) e a cláusula do
 * "esperando agora" do painel. A tela pede de novo a cada 30 s enquanto a
 * aba está visível (escondida, para — ninguém olha, e cada pedido é banco).
 * A parte pura (intervalo, textos, tipo) mora em `hoje-regra.ts`.
 */
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import { diaSP } from "../dia";
import { r2 } from "../tracking/insights-puro";
import { inicioDoDiaSP } from "./fatos";

import { type NumerosDeHoje } from "./hoje-regra";
export { INTERVALO_DA_FAIXA_MS, avisoDaFalha, textoDeAtualizado, type NumerosDeHoje } from "./hoje-regra";

const PAGOS = [...PAID_ORDER_STATUSES];

export async function numerosDeHoje(companyId: string, agora = new Date()): Promise<NumerosDeHoje> {
  const dia = diaSP(agora);
  const inicio = inicioDoDiaSP(dia);
  const [leads, vendas, esperandoRaw] = await Promise.all([
    db.customer.count({ where: { companyId, createdAt: { gte: inicio } } }),
    db.order.aggregate({
      where: { companyId, status: { in: PAGOS }, paidAt: { gte: inicio } },
      _sum: { netTotal: true },
      _count: true,
    }),
    db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "Conversation"
      WHERE "companyId" = ${companyId}
        AND "status" <> 'CLOSED'
        AND "lastInboundAt" IS NOT NULL
        AND "lastInboundAt" > COALESCE("lastOutboundAt", '-infinity'::timestamp)
    `,
  ]);
  return {
    dia,
    leads,
    pedidosPagos: vendas._count,
    vendido: r2(vendas._sum.netTotal ?? 0),
    esperandoAgora: Number(esperandoRaw[0]?.n ?? 0),
    em: agora.toISOString(),
  };
}

