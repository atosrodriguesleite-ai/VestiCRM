"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, X, Zap } from "lucide-react";
import {
  dateShort,
  timeShort,
  taskTypeLabel,
  priorityLabel,
} from "@/lib/format";
import { Card, Avatar, PriorityDot, EmptyState } from "@/components/ui";

export type TaskItem = {
  id: string;
  title: string;
  type: string;
  dueAt: string;
  priority: string;
  status: string;
  autoRule: string | null;
  customer: { id: string; name: string } | null;
  assignee: { name: string; color: string } | null;
};

const FILTERS = [
  { key: "hoje", label: "Hoje" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "proximas", label: "Próximas" },
  { key: "concluidas", label: "Concluídas" },
] as const;

export function TaskBoard({
  initialTasks,
  customers,
  team,
}: {
  initialTasks: TaskItem[];
  customers: { id: string; name: string }[];
  team: { id: string; name: string; color: string }[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("hoje");
  const [showNew, setShowNew] = useState(false);

  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59);

  const counts = useMemo(() => {
    const pending = tasks.filter((t) => t.status === "PENDENTE");
    return {
      hoje: pending.filter(
        (t) => new Date(t.dueAt) >= now && new Date(t.dueAt) <= endOfDay
      ).length,
      atrasadas: pending.filter((t) => new Date(t.dueAt) < now).length,
      proximas: pending.filter((t) => new Date(t.dueAt) > endOfDay).length,
      concluidas: tasks.filter((t) => t.status === "CONCLUIDA").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const visible = tasks.filter((t) => {
    const due = new Date(t.dueAt);
    switch (filter) {
      case "hoje":
        return t.status === "PENDENTE" && due >= now && due <= endOfDay;
      case "atrasadas":
        return t.status === "PENDENTE" && due < now;
      case "proximas":
        return t.status === "PENDENTE" && due > endOfDay;
      case "concluidas":
        return t.status === "CONCLUIDA";
    }
  });

  async function toggleDone(task: TaskItem) {
    const newStatus = task.status === "CONCLUIDA" ? "PENDENTE" : "CONCLUIDA";
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t))
    );
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) router.refresh();
  }

  return (
    <>
      <div className="flex gap-1.5 mb-4 overflow-x-auto thin-scroll">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition flex items-center gap-1.5 ${
              filter === f.key
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {f.label}
            <span
              className={`rounded-full px-1.5 text-[10px] font-bold ${
                filter === f.key
                  ? "bg-white/20"
                  : f.key === "atrasadas" && counts[f.key] > 0
                    ? "bg-rose-100 text-rose-600"
                    : "bg-gray-100"
              }`}
            >
              {counts[f.key]}
            </span>
          </button>
        ))}
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-2 transition shrink-0"
        >
          <Plus className="size-3.5" />
          Nova tarefa
        </button>
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            title={
              filter === "atrasadas"
                ? "Nenhuma tarefa atrasada 🎉"
                : "Nenhuma tarefa aqui"
            }
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {visible.map((t) => {
              const late =
                t.status === "PENDENTE" && new Date(t.dueAt) < now;
              const done = t.status === "CONCLUIDA";
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleDone(t)}
                    className={`size-5 rounded-full border-2 flex items-center justify-center transition shrink-0 ${
                      done
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-gray-300 hover:border-brand-500"
                    }`}
                    title={done ? "Reabrir" : "Concluir"}
                  >
                    {done && <Check className="size-3" />}
                  </button>
                  <PriorityDot priority={t.priority} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium truncate ${done ? "line-through text-gray-400" : ""}`}
                    >
                      {t.title}
                      {t.autoRule && (
                        <Zap
                          className="size-3 text-brand-400 inline ml-1.5 -mt-0.5"
                          aria-label="Criada por automação"
                        />
                      )}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {taskTypeLabel[t.type as keyof typeof taskTypeLabel]}
                      {t.customer && (
                        <>
                          {" · "}
                          <Link
                            href={`/clientes/${t.customer.id}`}
                            className="hover:text-brand-600"
                          >
                            {t.customer.name}
                          </Link>
                        </>
                      )}
                      {" · "}
                      {priorityLabel[t.priority as keyof typeof priorityLabel]}
                    </p>
                  </div>
                  {t.assignee && (
                    <Avatar
                      name={t.assignee.name}
                      color={t.assignee.color}
                      size="sm"
                    />
                  )}
                  <span
                    className={`text-xs tabular-nums shrink-0 ${
                      late ? "text-rose-600 font-semibold" : "text-gray-500"
                    }`}
                  >
                    {dateShort(t.dueAt)} {timeShort(t.dueAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {showNew && (
        <NewTaskModal
          customers={customers}
          team={team}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewTaskModal({
  customers,
  team,
  onClose,
  onCreated,
}: {
  customers: { id: string; name: string }[];
  team: { id: string; name: string; color: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const date = fd.get("date") as string;
    const time = (fd.get("time") as string) || "09:00";
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: fd.get("title"),
        type: fd.get("type"),
        customerId: fd.get("customerId") || undefined,
        dueAt: new Date(`${date}T${time}`).toISOString(),
        priority: fd.get("priority"),
        assigneeId: fd.get("assigneeId") || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md max-h-[92dvh] overflow-y-auto thin-scroll p-6 animate-fade-up"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">Nova tarefa</h3>
          <button type="button" onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className={label}>O que precisa ser feito? *</label>
            <input
              name="title"
              required
              className={input}
              placeholder="Ex.: Enviar catálogo novo para a Mariana"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Tipo</label>
              <select name="type" className={`${input} bg-white`}>
                {Object.entries(taskTypeLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Prioridade</label>
              <select name="priority" defaultValue="MEDIA" className={`${input} bg-white`}>
                {Object.entries(priorityLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>Cliente</label>
            <select name="customerId" className={`${input} bg-white`}>
              <option value="">Sem cliente vinculado</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Data *</label>
              <input name="date" type="date" required defaultValue={today} className={input} />
            </div>
            <div>
              <label className={label}>Hora</label>
              <input name="time" type="time" defaultValue="09:00" className={input} />
            </div>
          </div>
          <div>
            <label className={label}>Responsável</label>
            <select name="assigneeId" className={`${input} bg-white`}>
              <option value="">Eu mesmo(a)</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={saving}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            {saving ? "Criando..." : "Criar tarefa"}
          </button>
        </div>
      </form>
    </div>
  );
}
