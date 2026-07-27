import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Wallet,
  Clock,
  AlertTriangle,
  CheckCircle2,
  QrCode,
  Users,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { PAID_ORDER_STATUSES, orderNumber } from "@/lib/orders";
import { brl, dateShort } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { StatTile as UITile } from "@/components/charts";

export const dynamic = "force-dynamic";

/**
 * Financeiro — Contas a Receber. Responde as perguntas do caixa:
 * quem me deve, quanto, desde quando — e quanto já entrou no mês.
 * "A receber" = pedidos aguardando pagamento (a prazo/cobrança enviada).
 */
export default async function FinanceiroPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const agora = new Date();
  // início do mês no fuso de São Paulo — MESMA régua do Dashboard (antes
  // usava o fuso do servidor/UTC e a virada do mês divergia em 3 horas)
  const spMes = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  spMes.setUTCDate(1);
  spMes.setUTCHours(0, 0, 0, 0);
  const inicioMes = new Date(spMes.getTime() + 3 * 60 * 60 * 1000);

  const [pendentes, recebidoMesAgg, pixAtivos] = await Promise.all([
    db.order.findMany({
      where: { companyId: user.companyId, status: "AGUARDANDO_PAGAMENTO" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        seller: { select: { name: true } },
        payments: {
          where: { status: "PENDENTE" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.order.aggregate({
      where: {
        companyId: user.companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: inicioMes },
      },
      _sum: { netTotal: true },
      _count: true,
    }),
    db.payment.count({
      where: {
        order: { companyId: user.companyId },
        provider: "MERCADO_PAGO",
        method: "PIX", // o cartão tem link próprio — este cartão é só Pix
        status: "PENDENTE",
        dueAt: { gt: agora },
      },
    }),
  ]);

  const totalAReceber = pendentes.reduce((s, o) => s + o.total, 0);
  const diasDe = (d: Date) =>
    Math.floor((agora.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  const vencidos = pendentes.filter((o) => diasDe(o.createdAt) > 7);
  const totalVencido = vencidos.reduce((s, o) => s + o.total, 0);

  // agrupado por cliente (quem mais deve primeiro)
  const porCliente = new Map<string, { nome: string; total: number; qtd: number }>();
  for (const o of pendentes) {
    const atual = porCliente.get(o.customer.id) ?? {
      nome: o.customer.name,
      total: 0,
      qtd: 0,
    };
    atual.total += o.total;
    atual.qtd += 1;
    porCliente.set(o.customer.id, atual);
  }
  const devedores = [...porCliente.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Financeiro — Contas a Receber"
        subtitle="Quem deve, quanto e desde quando — e o que já entrou no mês."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <UITile
          label="A receber"
          value={brl(totalAReceber)}
          hint={`${pendentes.length} pedido(s) aguardando`}
          icon={<Wallet />}
        />
        <UITile
          label="Atrasados (7d+)"
          value={brl(totalVencido)}
          hint={`${vencidos.length} pedido(s)`}
          icon={<AlertTriangle />}
          tone={vencidos.length > 0 ? "warn" : "good"}
        />
        <UITile
          label="Recebido no mês"
          value={brl(recebidoMesAgg._sum.netTotal ?? 0)}
          hint={`${recebidoMesAgg._count} venda(s) paga(s)`}
          icon={<CheckCircle2 />}
        />
        <UITile
          label="Pix aguardando"
          value={String(pixAtivos)}
          hint="cobranças automáticas ativas"
          icon={<QrCode />}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* lista de pedidos aguardando pagamento */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Clock className="size-4 text-amber-600" />
            Aguardando pagamento
          </h2>
          {pendentes.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <CheckCircle2 className="size-4" />
              Nada pendente — caixa em dia! 🎉
            </p>
          ) : (
            <div className="space-y-1.5">
              {pendentes.map((o) => {
                const dias = diasDe(o.createdAt);
                const pix = o.payments[0];
                return (
                  <Link
                    key={o.id}
                    href={`/pedidos/${o.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3.5 py-2.5 hover:border-brand-200 hover:bg-brand-50/30 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {orderNumber(o.number)} · {o.customer.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {dateShort(o.createdAt)}
                        {o.seller ? ` · ${o.seller.name.split(" ")[0]}` : ""}
                        {pix?.provider === "MERCADO_PAGO" &&
                        pix.dueAt &&
                        pix.dueAt > agora
                          ? pix.method === "PIX"
                            ? " · Pix enviado ⏳"
                            : " · link do cartão enviado ⏳"
                          : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums">{brl(o.total)}</p>
                      <p
                        className={`text-[11px] font-semibold ${
                          dias > 7 ? "text-rose-500" : "text-gray-400"
                        }`}
                      >
                        há {dias} {dias === 1 ? "dia" : "dias"}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* quem mais deve */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Users className="size-4 text-brand-600" />
            Por cliente
          </h2>
          {devedores.length === 0 ? (
            <p className="text-sm text-gray-400">Ninguém devendo. 👏</p>
          ) : (
            <div className="space-y-1.5">
              {devedores.map((d) => (
                <Link
                  key={d.id}
                  href={`/clientes/${d.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-gray-50 transition"
                >
                  <span className="text-sm truncate">{d.nome}</span>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {brl(d.total)}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-3 leading-snug">
            💡 Dica: abra o pedido e use <b>Cobrar via Pix</b> — o cliente paga
            e o pedido baixa sozinho.
          </p>
        </Card>
      </div>
    </div>
  );
}
