import Link from "next/link";
import { ShoppingBag, Download, Search, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeAll } from "@/lib/scope";
import { brl, dateShort, timeShort } from "@/lib/format";
import {
  orderStatusLabel,
  orderStatusColor,
  orderNumber,
  ORDER_STATUS_FLOW,
} from "@/lib/orders";
import { Card, PageHeader, Avatar, Badge, EmptyState } from "@/components/ui";
import { NewOrderButton } from "./new-order";
import type { OrderStatus, Prisma } from "@prisma/client";

// converte YYYY-MM-DD (fuso de São Paulo, UTC-3) em Date UTC
const SP_OFFSET = 3 * 60 * 60 * 1000;
function spDayStart(d: string) {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
}
function spDayEnd(d: string) {
  const t = Date.parse(`${d}T23:59:59.999Z`);
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
}

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; de?: string; ate?: string; canal?: string; q?: string }>;
}) {
  const user = await requireUser();
  const { status, de, ate, canal: canalRaw, q: qRaw } = await searchParams;
  // canal da venda: nuvemshop | atacadopro (catálogo/WhatsApp/manual) | todos
  const canal = canalRaw === "nuvemshop" || canalRaw === "atacadopro" ? canalRaw : null;
  // busca pelo código do pedido (nº) — só os dígitos importam (#0042, 42, "42")
  const q = (qRaw ?? "").trim();
  const buscaNumero = q ? Number(q.replace(/\D/g, "")) : NaN;
  const buscando = q.length > 0;

  const from = de ? spDayStart(de) : null;
  const to = ate ? spDayEnd(ate) : null;

  const where: Prisma.OrderWhereInput = canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
  // busca por código: encontra o pedido em qualquer status/período
  if (buscando) {
    where.number = Number.isFinite(buscaNumero) && buscaNumero > 0 ? buscaNumero : -1;
  }
  if (!buscando && status && ORDER_STATUS_FLOW.includes(status as OrderStatus)) {
    where.status = status as OrderStatus;
  }
  if (from || to) {
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (canal === "nuvemshop") where.source = "NUVEMSHOP";
  if (canal === "atacadopro") where.source = { not: "NUVEMSHOP" };
  const dateQS = `${de ? `&de=${de}` : ""}${ate ? `&ate=${ate}` : ""}${canal ? `&canal=${canal}` : ""}`;

  const [orders, counts] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        customer: true,
        seller: true,
        items: { take: 3 },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.order.groupBy({
      by: ["status"],
      where: {
        ...(canSeeAll(user)
          ? { companyId: user.companyId }
          : { companyId: user.companyId, sellerId: user.id }),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      _count: true,
    }),
  ]);

  const countByStatus = Object.fromEntries(
    counts.map((c) => [c.status, c._count])
  );
  const totalCount = counts.reduce((s, c) => s + c._count, 0);

  const bySource = await db.order.groupBy({
    by: ["source"],
    where: {
      ...(canSeeAll(user)
        ? { companyId: user.companyId }
        : { companyId: user.companyId, sellerId: user.id }),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    _count: true,
  });
  const nsCount = bySource.find((r) => r.source === "NUVEMSHOP")?._count ?? 0;
  const apCount = bySource.filter((r) => r.source !== "NUVEMSHOP").reduce((a, r) => a + r._count, 0);
  const canalHref = (c: string | null) =>
    `/pedidos?${[
      status ? `status=${status}` : "",
      de ? `de=${de}` : "",
      ate ? `ate=${ate}` : "",
      c ? `canal=${c}` : "",
    ].filter(Boolean).join("&")}`.replace(/\?$/, "");

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Pedidos"
        subtitle="Todos os pedidos e orçamentos da loja, do carrinho à entrega."
        action={
          <div className="flex items-center gap-2">
            <a
              href="/api/export/pedidos"
              download
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition"
            >
              <Download className="size-4" />
              CSV
            </a>
            <NewOrderButton />
          </div>
        }
      />

      {/* Busca pelo código do pedido — disponível para todos os usuários */}
      <form method="GET" className="mb-4">
        <div className="relative">
          <Search className="size-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={q}
            inputMode="numeric"
            placeholder="Buscar pelo código do pedido (ex.: 42 ou #0042)"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-24 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-1.5 transition">
            Buscar
          </button>
        </div>
      </form>

      {buscando && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-2.5">
          <p className="text-sm text-slate-600">
            {orders.length > 0 ? (
              <>Resultado para o código <b className="text-slate-800">{q.startsWith("#") ? q : `#${q.replace(/\D/g, "")}`}</b></>
            ) : (
              <>Nenhum pedido com o código <b className="text-slate-800">{q}</b>.</>
            )}
          </p>
          <Link href="/pedidos" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            <X className="size-3.5" /> Limpar busca
          </Link>
        </div>
      )}

      {/* Filtro de período (fuso de São Paulo) */}
      {!buscando && (
      <>
      <form className="flex flex-wrap items-end gap-2 mb-4" method="GET">
        {status && <input type="hidden" name="status" value={status} />}
        {canal && <input type="hidden" name="canal" value={canal} />}
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
          <input type="date" name="de" defaultValue={de ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
        </div>
        <button className="rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition">
          Filtrar
        </button>
        {(de || ate) && (
          <Link href={status ? `/pedidos?status=${status}` : "/pedidos"} className="text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-2.5">
            Limpar período
          </Link>
        )}
      </form>

      {/* Canal da venda: tudo, só AtacadoPro (catálogo/WhatsApp/manual) ou só Nuvemshop */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[
          { c: null, label: `Todos os canais (${apCount + nsCount})` },
          { c: "atacadopro", label: `AtacadoPro (${apCount})` },
          { c: "nuvemshop", label: `Nuvemshop (${nsCount})` },
        ].map((o) => (
          <Link
            key={o.label}
            href={canalHref(o.c)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              canal === o.c
                ? o.c === "nuvemshop"
                  ? "bg-cyan-700 text-white"
                  : "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4 pb-1">
        <Link
          href={`/pedidos${dateQS ? `?${dateQS.slice(1)}` : ""}`}
          className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
            !status
              ? "bg-brand-600 text-white"
              : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
          }`}
        >
          Todos ({totalCount})
        </Link>
        {ORDER_STATUS_FLOW.map((s) => (
          <Link
            key={s}
            href={`/pedidos?status=${s}${dateQS}`}
            className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
              status === s
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {orderStatusLabel[s]}
            {countByStatus[s] ? ` (${countByStatus[s]})` : ""}
          </Link>
        ))}
      </div>
      </>
      )}

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag />}
            title={buscando ? "Nenhum pedido com esse código" : "Nenhum pedido aqui"}
            hint={buscando ? "Confira o número do pedido e tente de novo." : "Monte um pedido direto da conversa do WhatsApp com o botão de sacola."}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Link key={o.id} href={`/pedidos/${o.id}`} className="block">
              <Card className="p-4 hover:shadow-pop transition">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <span className="text-sm font-bold text-brand-700 tabular-nums shrink-0 w-11 sm:w-14">
                    {orderNumber(o.number)}
                  </span>
                  <Avatar name={o.customer.name} color={o.seller?.color ?? "#c4622d"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {o.customer.name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {o._count.items}{" "}
                      {o._count.items === 1 ? "item" : "itens"} ·{" "}
                      {o.items.map((i) => i.name).join(", ")}
                    </p>
                    {/* celular: selos numa 2ª linha, dentro da coluna (cabe na tela) */}
                    <div className="sm:hidden mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {o.source === "NUVEMSHOP" ? (
                        <Badge color="#0891B2">Nuvemshop</Badge>
                      ) : (
                        <Badge color="#C4622D">AtacadoPro</Badge>
                      )}
                      <Badge color={orderStatusColor[o.status]}>
                        {orderStatusLabel[o.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="hidden sm:block text-right shrink-0">
                    <p className="text-xs text-gray-400">
                      {dateShort(o.createdAt)} {timeShort(o.createdAt)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {o.seller?.name ?? "—"}
                    </p>
                  </div>
                  {/* selos no computador (inalterado) */}
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    {o.source === "NUVEMSHOP" ? (
                      <Badge color="#0891B2">Nuvemshop</Badge>
                    ) : (
                      <Badge color="#C4622D">AtacadoPro</Badge>
                    )}
                    <Badge color={orderStatusColor[o.status]}>
                      {orderStatusLabel[o.status]}
                    </Badge>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0 w-20 sm:w-24 text-right whitespace-nowrap">
                    {brl(o.total)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
