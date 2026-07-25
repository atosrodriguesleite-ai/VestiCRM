import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp, isAdmin } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { PageHeader } from "@/components/ui";
import { TeamView, type TeamMember } from "./team-view";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const days30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const members = await db.user.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: {
          customers: true,
          conversations: true,
          tasks: { where: { status: "PENDENTE" } },
        },
      },
      // vendas = pedidos PAGOS (fonte única; inclui integrações tipo Nuvemshop)
      orders: {
        where: {
          createdAt: { gte: days30 },
          status: { in: PAID_ORDER_STATUSES },
        },
        select: { total: true },
      },
    },
  });

  const data: TeamMember[] = members
    .filter((m) => m.role !== "SUPERADMIN")
    .map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      username: m.username,
      role: m.role,
      color: m.color,
      avatarUrl: m.avatarUrl,
      active: m.active,
      customers: m._count.customers,
      conversations: m._count.conversations,
      pendingTasks: m._count.tasks,
      sales30: m.orders.reduce((s, v) => s + v.total, 0),
      monthlyGoal: m.monthlyGoal,
      isMe: m.id === user.id,
    }));

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Equipe"
        subtitle="Papéis e desempenho de cada pessoa. Vendedores veem apenas a própria carteira."
      />
      <TeamView members={data} canManage={isAdmin(user)} />
    </div>
  );
}
