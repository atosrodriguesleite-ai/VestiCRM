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
  // início do MÊS no fuso de São Paulo — a meta é mensal, e usar 30 dias
  // corridos misturava vendas do mês passado na barra (a mesma venda contava
  // para duas metas; auditoria 07/08/2026). Mesma régua do Dashboard.
  const spMonth = new Date(Date.now() - 3 * 60 * 60 * 1000);
  spMonth.setUTCDate(1);
  spMonth.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(spMonth.getTime() + 3 * 60 * 60 * 1000);
  // uma janela só cobre as duas contas (30d para o cartão, mês para a meta)
  const desde = startOfMonth < days30 ? startOfMonth : days30;

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
          paidAt: { gte: desde },
          status: { in: PAID_ORDER_STATUSES },
        },
        select: { netTotal: true, paidAt: true },
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
      sales30: m.orders
        .filter((v) => v.paidAt && v.paidAt >= days30)
        .reduce((s, v) => s + v.netTotal, 0),
      // a barra da meta soma SÓ o mês corrente (fuso SP)
      soldMonth: m.orders
        .filter((v) => v.paidAt && v.paidAt >= startOfMonth)
        .reduce((s, v) => s + v.netTotal, 0),
      monthlyGoal: m.monthlyGoal,
      chatVisaoTotal: m.chatVisaoTotal,
      pedidosVisaoTotal: m.pedidosVisaoTotal,
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
