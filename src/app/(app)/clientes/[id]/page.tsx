import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MessageCircle,
  ShoppingBag,
  CalendarClock,
  Ruler,
  Palette,
  MapPin,
  StickyNote,
  Target,
  History,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope } from "@/lib/scope";
import {
  brl,
  dateFull,
  dateShort,
  timeShort,
  formatPhone,
  relativeDays,
  customerTypeLabel,
  originLabel,
  taskTypeLabel,
  conversationStatusLabel,
} from "@/lib/format";
import {
  Card,
  Avatar,
  Badge,
  ConvStatusPill,
  PriorityDot,
  EmptyState,
} from "@/components/ui";
import {
  orderNumber,
  orderStatusLabel,
  orderStatusColor,
} from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const customer = await db.customer.findFirst({
    where: { id, ...ownedScope(user) },
    include: {
      owner: true,
      tags: { include: { tag: true } },
      interests: { include: { interest: true } },
      sales: { orderBy: { createdAt: "desc" }, include: { seller: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: true } } },
      },
      opportunities: {
        orderBy: { createdAt: "desc" },
        include: { stage: true },
      },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 3 },
          assignee: true,
        },
      },
      tasks: {
        where: { status: "PENDENTE" },
        orderBy: { dueAt: "asc" },
        include: { assignee: true },
      },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!customer) notFound();

  const totalSpent = customer.sales.reduce((s, v) => s + v.total, 0);
  const ticket = customer.sales.length ? totalSpent / customer.sales.length : 0;

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/clientes"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4 transition"
      >
        <ArrowLeft className="size-4" />
        Clientes
      </Link>

      {/* Cabeçalho */}
      <Card className="p-5 md:p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <Avatar name={customer.name} color={customer.owner?.color ?? "#7c3aed"} size="lg" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              {customer.name}
            </h1>
            <p className="text-sm text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="flex items-center gap-1">
                <MessageCircle className="size-3.5 text-emerald-500" />
                {formatPhone(customer.phone)}
              </span>
              {customer.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {customer.city}/{customer.state}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge color="#0ea5e9">{customerTypeLabel[customer.type]}</Badge>
              <Badge color="#64748b">Origem: {originLabel[customer.origin]}</Badge>
              {customer.tags.map((t) => (
                <Badge key={t.tagId} color={t.tag.color}>
                  {t.tag.name}
                </Badge>
              ))}
            </div>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <p className="text-xs text-gray-400">Total comprado</p>
            <p className="text-xl font-semibold text-emerald-600">
              {brl(totalSpent)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {customer.sales.length} compras · ticket {brl(ticket)}
            </p>
          </div>
        </div>

        {/* preferências */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-50 text-sm">
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
              <Ruler className="size-3" /> Tamanho
            </p>
            <p className="font-medium">{customer.preferredSize ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
              <Palette className="size-3" /> Cores preferidas
            </p>
            <p className="font-medium">{customer.preferredColors ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
              <ShoppingBag className="size-3" /> Última compra
            </p>
            <p className="font-medium">
              {customer.lastPurchaseAt
                ? relativeDays(customer.lastPurchaseAt)
                : "nunca"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mb-0.5">
              <CalendarClock className="size-3" /> Próximo contato
            </p>
            <p className="font-medium">
              {customer.nextContactAt ? dateFull(customer.nextContactAt) : "—"}
            </p>
          </div>
        </div>

        {customer.interests.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-1.5">Produtos de interesse</p>
            <div className="flex flex-wrap gap-1.5">
              {customer.interests.map((i) => (
                <Badge key={i.interestId} color="#7c3aed">
                  {i.interest.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {customer.notes && (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800 flex gap-2">
            <StickyNote className="size-4 shrink-0 mt-0.5" />
            {customer.notes}
          </div>
        )}

        <p className="text-xs text-gray-400 mt-4">
          Vendedor responsável:{" "}
          <span className="font-medium text-gray-600">
            {customer.owner?.name ?? "sem responsável"}
          </span>{" "}
          · Cliente desde {dateFull(customer.createdAt)}
        </p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Negociações */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Target className="size-4 text-brand-600" />
            Negociações
          </h2>
          {customer.opportunities.length === 0 ? (
            <EmptyState title="Nenhuma negociação" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {customer.opportunities.map((o) => (
                <li key={o.id} className="py-2.5 flex items-center gap-3">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: o.stage.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{o.title}</p>
                    <p className="text-xs text-gray-400">
                      {o.stage.name}
                      {o.lostReason ? ` · ${o.lostReason}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {brl(o.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Pedidos (catálogo) */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <ShoppingBag className="size-4 text-brand-600" />
            Pedidos
          </h2>
          {customer.orders.length === 0 ? (
            <EmptyState title="Nenhum pedido registrado" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {customer.orders.map((o) => (
                <li key={o.id} className="py-2.5 flex items-center gap-3">
                  <Link
                    href={`/pedidos/${o.id}`}
                    className="text-sm font-semibold text-brand-700 hover:text-brand-800 tabular-nums shrink-0"
                  >
                    {orderNumber(o.number)}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-400">
                      {dateFull(o.createdAt)} · {o._count.items}{" "}
                      {o._count.items === 1 ? "item" : "itens"}
                    </p>
                  </div>
                  <Badge color={orderStatusColor[o.status]}>
                    {orderStatusLabel[o.status]}
                  </Badge>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {brl(o.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Compras */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <ShoppingBag className="size-4 text-emerald-600" />
            Histórico de compras
          </h2>
          {customer.sales.length === 0 ? (
            <EmptyState title="Nenhuma compra registrada" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {customer.sales.map((s) => (
                <li key={s.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {s.description ?? s.category ?? "Venda"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {dateFull(s.createdAt)}
                      {s.seller ? ` · ${s.seller.name}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600 tabular-nums shrink-0">
                    {brl(s.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Conversas */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <MessageCircle className="size-4 text-emerald-500" />
            Conversas de WhatsApp
          </h2>
          {customer.conversations.length === 0 ? (
            <EmptyState title="Nenhuma conversa registrada" />
          ) : (
            <ul className="space-y-3">
              {customer.conversations.map((c) => (
                <li key={c.id} className="rounded-xl border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <ConvStatusPill
                      status={c.status}
                      label={conversationStatusLabel[c.status]}
                    />
                    <span className="text-[11px] text-gray-400">
                      {dateShort(c.lastMessageAt)} {timeShort(c.lastMessageAt)}
                    </span>
                  </div>
                  {c.messages
                    .slice()
                    .reverse()
                    .map((m) => (
                      <p
                        key={m.id}
                        className="text-xs text-gray-500 truncate leading-relaxed"
                      >
                        <span className="font-medium text-gray-600">
                          {m.direction === "IN" ? customer.name.split(" ")[0] : "Loja"}
                          :
                        </span>{" "}
                        {m.kind === "NOTE" ? "📝 " : ""}
                        {m.body}
                      </p>
                    ))}
                  <Link
                    href="/whatsapp"
                    className="text-[11px] font-medium text-brand-600 hover:text-brand-700 mt-1.5 inline-block"
                  >
                    Abrir no atendimento →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Linha do tempo (Lead Intake Engine) */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <History className="size-4 text-brand-600" />
            Linha do tempo
          </h2>
          {customer.events.length === 0 ? (
            <EmptyState title="Nenhum evento registrado" />
          ) : (
            <ul className="space-y-3">
              {customer.events.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <span
                    className={`size-2 rounded-full mt-1.5 shrink-0 ${
                      e.type === "LEAD_CRIADO"
                        ? "bg-brand-500"
                        : e.type === "OPORTUNIDADE"
                          ? "bg-amber-400"
                          : "bg-gray-300"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-gray-600 leading-snug">
                      {e.description}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {dateFull(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Tarefas */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <CalendarClock className="size-4 text-amber-500" />
            Tarefas pendentes
          </h2>
          {customer.tasks.length === 0 ? (
            <EmptyState title="Nenhuma tarefa pendente" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {customer.tasks.map((t) => (
                <li key={t.id} className="py-2.5 flex items-center gap-3">
                  <PriorityDot priority={t.priority} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-xs text-gray-400">
                      {taskTypeLabel[t.type]}
                      {t.assignee ? ` · ${t.assignee.name}` : ""}
                    </p>
                  </div>
                  <span
                    className={`text-xs tabular-nums shrink-0 ${
                      t.dueAt < new Date()
                        ? "text-rose-600 font-semibold"
                        : "text-gray-500"
                    }`}
                  >
                    {dateShort(t.dueAt)} {timeShort(t.dueAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
