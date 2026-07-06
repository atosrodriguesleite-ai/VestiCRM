import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { taskScope, ownedScope } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { TaskBoard, type TaskItem } from "./task-board";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const user = await requireUser();

  const [tasks, customers, team] = await Promise.all([
    db.task.findMany({
      where: taskScope(user),
      include: { customer: true, assignee: true },
      orderBy: { dueAt: "asc" },
    }),
    db.customer.findMany({
      where: ownedScope(user),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { companyId: user.companyId, active: true },
      select: { id: true, name: true, color: true },
    }),
  ]);

  const items: TaskItem[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    dueAt: t.dueAt.toISOString(),
    priority: t.priority,
    status: t.status,
    autoRule: t.autoRule,
    customer: t.customer
      ? { id: t.customer.id, name: t.customer.name }
      : null,
    assignee: t.assignee
      ? { name: t.assignee.name, color: t.assignee.color }
      : null,
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Tarefas e follow-up"
        subtitle="O que a equipe precisa fazer para não perder nenhuma venda."
      />
      <TaskBoard initialTasks={items} customers={customers} team={team} />
    </div>
  );
}
