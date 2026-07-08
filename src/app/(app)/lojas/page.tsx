import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";
import { PageHeader } from "@/components/ui";
import { LojasView, type Loja } from "./lojas-view";

export const dynamic = "force-dynamic";

export default async function LojasPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const companies = await db.company.findMany({
    where: { slug: { not: PLATFORM_SLUG } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, customers: true, orders: true } },
      users: {
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { name: true, email: true },
      },
    },
  });

  const lojas: Loja[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    createdAt: c.createdAt.toISOString(),
    admin: c.users[0] ?? null,
    users: c._count.users,
    customers: c._count.customers,
    orders: c._count.orders,
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Lojas"
        subtitle="Cadastre e acompanhe as lojas clientes do VestiCRM. Cada loja nasce com funil, cores e tamanhos prontos e um login de administrador."
      />
      <LojasView initial={lojas} />
    </div>
  );
}
