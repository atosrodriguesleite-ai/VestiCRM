import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MessageCircle,
  Smartphone,
  ShoppingBag,
  CalendarClock,
  Ruler,
  Palette,
  MapPin,
  StickyNote,
  Target,
  History,
  Brain,
} from "lucide-react";

/** Rótulo curto para um passo da jornada de navegação. */
function journeyStepLabel(step: {
  type: string;
  productName?: string | null;
  category?: string | null;
  color?: string | null;
  size?: string | null;
}): string {
  const p = step.productName;
  switch (step.type) {
    case "page_view": return "Abriu o catálogo";
    case "category_view": return `Viu ${step.category ?? "categoria"}`;
    case "product_view": return `Viu ${p ?? "produto"}`;
    case "image_zoom": return `Ampliou ${p ?? "foto"}`;
    case "color_select": return `Cor ${step.color}`;
    case "size_select": return `Tam. ${step.size}`;
    case "qty_change": return "Ajustou qtd";
    case "cart_add": return `+ ${p ?? "peça"}`;
    case "cart_remove": return `− ${p ?? "peça"}`;
    case "cart_open": return "Abriu sacola";
    case "cart_close": return "Fechou sacola";
    case "checkout_start": return "Iniciou pedido";
    case "order_submitted": return "Enviou pedido ✓";
    case "order_abandoned": return "Abandonou";
    default: return step.type;
  }
}

/** Duração amigável: "3m 20s", "45s", "1h 05m". */
function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

const deviceLabel: Record<string, string> = {
  mobile: "Celular",
  desktop: "Computador",
  tablet: "Tablet",
};
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope, isManagerUp } from "@/lib/scope";
import { OwnerSelect } from "./owner-select";
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
  PAID_ORDER_STATUSES,
} from "@/lib/orders";
import { customerJourney } from "@/lib/tracking/insights";
import { catalogUrl, trackedCatalogLink } from "@/lib/catalog-url";
import { CatalogLinkButton } from "./catalog-link-button";
import { AbrirConversa } from "./abrir-conversa";

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

  // equipe ativa para a troca manual de responsável (gerente/admin)
  const team = isManagerUp(user)
    ? await db.user.findMany({
        where: { companyId: user.companyId, active: true, role: { not: "SUPERADMIN" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Link rastreado do catálogo para este cliente: quem abrir já entra
  // identificado (?c). Se quem copiou atende clientes (vendedor/gerente),
  // o link leva também a atribuição (?ref = primeiro nome) e o pedido
  // chega com o vendedor preenchido.
  const companyRow = await db.company.findUnique({
    where: { id: user.companyId },
    select: { slug: true },
  });
  const sellerRef =
    user.role === "SELLER" || user.role === "MANAGER"
      ? user.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/\s+/)[0]
      : null;
  const base = catalogUrl(companyRow?.slug ?? "");
  const trackedCatalogUrl = trackedCatalogLink(
    base,
    sellerRef,
    customer.linkCode ?? customer.id
  );

  // Total gasto = pedidos PAGOS (fonte única — inclui vendas integradas
  // tipo Nuvemshop, que não passam pelo modelo Sale)
  const paidOrders = customer.orders.filter((o) =>
    (PAID_ORDER_STATUSES as readonly string[]).includes(o.status)
  );
  const totalSpent = paidOrders.reduce((s, v) => s + v.total, 0);
  const ticket = paidOrders.length ? totalSpent / paidOrders.length : 0;

  // link para chamar o cliente direto no WhatsApp
  const waDigits = customer.phone.replace(/\D/g, "");
  const waHref =
    waDigits.length >= 10
      ? `https://wa.me/${waDigits.length <= 11 ? "55" + waDigits : waDigits}`
      : null;

  // Jornada de navegação (Tracking Engine / Inteligência Comercial)
  const journey = await customerJourney(user.companyId, customer.id);

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
          <Avatar name={customer.name} color={customer.owner?.color ?? "#c4622d"} size="lg" />
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
              {paidOrders.length} compras · ticket {brl(ticket)}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:items-end">
              {/* CONVERSAR PELO SISTEMA é o caminho principal: o atendimento
                  fica registrado, com nome de quem falou, e não cai na fila.
                  O link do aplicativo continua ali para quem preferir falar
                  pelo celular — mas agora é a opção secundária. */}
              <AbrirConversa customerId={customer.id} />
              {waHref && (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abre o aplicativo do WhatsApp no celular. A conversa aparece no sistema, mas sem o nome de quem escreveu."
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm font-medium px-4 py-2.5 transition"
                >
                  <Smartphone className="size-4" />
                  Abrir no celular
                </a>
              )}
              <CatalogLinkButton url={trackedCatalogUrl} />
            </div>
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
                <Badge key={i.interestId} color="#c4622d">
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

        <p className="text-xs text-gray-400 mt-4 flex items-center gap-1.5 flex-wrap">
          Vendedor responsável:{" "}
          {isManagerUp(user) ? (
            <OwnerSelect
              customerId={customer.id}
              ownerId={customer.ownerId}
              sellers={team.map((t) => ({ id: t.id, name: t.name }))}
            />
          ) : (
            <span className="font-medium text-gray-600">
              {customer.owner?.name ?? "sem responsável"}
            </span>
          )}{" "}
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
                <li key={o.id} className="py-2.5 flex items-start gap-3">
                  <span
                    className="size-2.5 rounded-full shrink-0 mt-1"
                    style={{ backgroundColor: o.stage.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{o.title}</p>
                    <p className="text-xs text-gray-400">
                      {o.stage.name}
                      {o.lostReason ? ` · ${o.lostReason}` : ""}
                    </p>
                    {o.details && (
                      <ul className="mt-1.5 space-y-0.5">
                        {o.details.split("\n").filter(Boolean).map((it, i) => (
                          <li
                            key={i}
                            className="text-xs text-gray-600 flex items-center gap-1.5"
                          >
                            <span className="size-1 rounded-full bg-amber-400 shrink-0" />
                            {it}
                          </li>
                        ))}
                      </ul>
                    )}
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

        {/* Comportamento no catálogo (Inteligência Comercial) */}
        <Card className="p-5 md:col-span-2">
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Brain className="size-4 text-brand-600" />
            Comportamento no catálogo
          </h2>
          {!journey || journey.visits === 0 ? (
            <EmptyState
              title="Sem navegação registrada ainda"
              hint="Assim que este cliente abrir o catálogo pelo link rastreado, tudo que ele fizer — peças que viu, colocou ou tirou da sacola, tempo no catálogo — aparece aqui automaticamente."
            />
          ) : (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              {[
                ["Visitas", String(journey.visits)],
                ["Tempo total", fmtDuration(journey.totalSeconds)],
                ["Produtos vistos", String(journey.productsViewed)],
                ["Colocou na sacola", String(journey.added)],
                ["Tirou da sacola", String(journey.removed)],
                ["Carrinhos largados", String(journey.abandonedCarts)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-gray-50 px-3 py-2 text-center">
                  <p className="text-lg font-semibold tabular-nums">{value}</p>
                  <p className="text-[10px] text-gray-400 leading-tight">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Primeira visita {dateFull(journey.firstVisit)} · última{" "}
              {dateFull(journey.lastVisit)}
              {journey.channels.length > 0 && ` · via ${journey.channels.join(", ")}`}
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              {/* Colocou na sacola */}
              {journey.addedItems.length > 0 && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                  <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide mb-2">
                    Colocou na sacola
                  </p>
                  <ul className="space-y-1">
                    {journey.addedItems.map((it) => (
                      <li key={it.label} className="text-xs text-gray-700 flex items-center gap-1.5">
                        <span className="text-emerald-500 font-semibold shrink-0">
                          {it.qty}×
                        </span>
                        <span className="truncate">{it.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Tirou da sacola */}
              {journey.removedItems.length > 0 && (
                <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3">
                  <p className="text-[11px] font-semibold text-rose-600 uppercase tracking-wide mb-2">
                    Tirou da sacola
                  </p>
                  <ul className="space-y-1">
                    {journey.removedItems.map((it) => (
                      <li key={it.label} className="text-xs text-gray-700 flex items-center gap-1.5">
                        <span className="text-rose-500 font-semibold shrink-0">
                          {it.qty}×
                        </span>
                        <span className="truncate">{it.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Produtos que abriu */}
            {journey.viewedProducts.length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Produtos que abriu
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {journey.viewedProducts.map((p) => (
                    <span
                      key={p.name}
                      className="text-[11px] rounded-lg bg-gray-100 text-gray-600 px-2 py-1 font-medium"
                    >
                      {p.name}
                      {p.times > 1 && (
                        <span className="text-gray-400"> ·{p.times}×</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Cada visita, passo a passo */}
            {journey.sessions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Cada visita, passo a passo
                </p>
                <div className="space-y-3">
                  {journey.sessions.map((s, si) => (
                    <div key={si} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-2 text-[11px] text-gray-500">
                        <span className="font-semibold text-gray-700">
                          {dateFull(s.startedAt)} {timeShort(s.startedAt)}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span>{fmtDuration(s.seconds)} no catálogo</span>
                        <span className="text-gray-300">·</span>
                        <span>{s.channel}</span>
                        {s.device && (
                          <>
                            <span className="text-gray-300">·</span>
                            <span>{deviceLabel[s.device] ?? s.device}</span>
                          </>
                        )}
                        {s.converted ? (
                          <Badge color="#059669">Enviou pedido</Badge>
                        ) : s.cartValue > 0 ? (
                          <Badge color="#d97706">Deixou {brl(s.cartValue)} na sacola</Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.steps.map((step, i) => (
                          <span key={i} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-gray-300">→</span>}
                            <span
                              className={`text-[11px] rounded-lg px-2 py-1 font-medium ${
                                step.type === "cart_add"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : step.type === "cart_remove"
                                    ? "bg-rose-50 text-rose-600"
                                    : step.type === "order_submitted"
                                      ? "bg-emerald-600 text-white"
                                      : "bg-brand-50 text-brand-700"
                              }`}
                            >
                              {journeyStepLabel(step)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>
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
