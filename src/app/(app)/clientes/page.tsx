import Link from "next/link";
import { Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope } from "@/lib/scope";
import {
  customerTypeLabel,
  originLabel,
  formatPhone,
  relativeDays,
} from "@/lib/format";
import { Card, PageHeader, Avatar, Badge, EmptyState } from "@/components/ui";
import { NewCustomerButton } from "./new-customer";
import type { CustomerType, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const TYPES = Object.keys(customerTypeLabel) as CustomerType[];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tipo?: string }>;
}) {
  const user = await requireUser();
  const { q, tipo } = await searchParams;
  const scope = ownedScope(user);

  const where: Prisma.CustomerWhereInput = { ...scope };
  if (q) where.name = { contains: q };
  if (tipo && TYPES.includes(tipo as CustomerType))
    where.type = tipo as CustomerType;

  const [customers, interests] = await Promise.all([
    db.customer.findMany({
      where,
      include: {
        owner: true,
        tags: { include: { tag: true } },
        _count: { select: { opportunities: true, sales: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.interest.findMany({ where: { companyId: user.companyId } }),
  ]);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Clientes"
        subtitle={`${customers.length} cliente${customers.length === 1 ? "" : "s"} na sua carteira.`}
        action={<NewCustomerButton interests={interests} />}
      />

      {/* busca e filtros */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <form className="relative flex-1" action="/clientes">
          <Search className="size-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome..."
            className="w-full rounded-xl bg-white border border-gray-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-brand-400 transition"
          />
          {tipo && <input type="hidden" name="tipo" value={tipo} />}
        </form>
        <div className="flex gap-1.5 overflow-x-auto thin-scroll">
          <Link
            href={`/clientes${q ? `?q=${q}` : ""}`}
            className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
              !tipo
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            Todos
          </Link>
          {TYPES.map((t) => (
            <Link
              key={t}
              href={`/clientes?tipo=${t}${q ? `&q=${q}` : ""}`}
              className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
                tipo === t
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
              }`}
            >
              {customerTypeLabel[t]}
            </Link>
          ))}
        </div>
      </div>

      {customers.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum cliente encontrado"
            hint="Cadastre o primeiro cliente ou ajuste a busca."
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {customers.map((c) => (
            <Link key={c.id} href={`/clientes/${c.id}`}>
              <Card className="p-4 hover:shadow-pop transition h-full">
                <div className="flex items-start gap-3">
                  <Avatar name={c.name} color={c.owner?.color ?? "#6d28ff"} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{c.name}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {formatPhone(c.phone)}
                      {c.city ? ` · ${c.city}/${c.state ?? ""}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-3">
                  <Badge color="#0ea5e9">{customerTypeLabel[c.type]}</Badge>
                  <Badge color="#64748b">{originLabel[c.origin]}</Badge>
                  {c.tags.slice(0, 2).map((t) => (
                    <Badge key={t.tagId} color={t.tag.color}>
                      {t.tag.name}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50 text-[11px] text-gray-400">
                  <span>
                    {c._count.sales} compra{c._count.sales === 1 ? "" : "s"} ·{" "}
                    {c._count.opportunities} negócio
                    {c._count.opportunities === 1 ? "" : "s"}
                  </span>
                  <span
                    className={
                      c.lastContactAt &&
                      Date.now() - c.lastContactAt.getTime() >
                        7 * 24 * 60 * 60 * 1000
                        ? "text-amber-500 font-medium"
                        : ""
                    }
                  >
                    {c.lastContactAt
                      ? `contato ${relativeDays(c.lastContactAt)}`
                      : "sem contato"}
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
