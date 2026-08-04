"use client";

import { useMemo, useState } from "react";
import { Portal } from "@/components/portal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, X, Zap, MessageCircle, Clock3 } from "lucide-react";
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
  /** POR QUE a tarefa existe — o motivo que a automação escreveu */
  description: string | null;
  type: string;
  dueAt: string;
  priority: string;
  status: string;
  autoRule: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    /** mensagem pronta (texto da loja) para abrir o WhatsApp já escrito */
    mensagem: string;
  } | null;
  assignee: { name: string; color: string } | null;
};

/** Sugestão do motor que ainda não virou tarefa. */
export type SugestaoItem = {
  key: string;
  rule: string;
  title: string;
  description: string;
  customerId: string;
  customerName: string;
  phone: string;
  mensagem: string;
};

/** Link do WhatsApp com a mensagem já digitada. */
export function waHref(phone: string, msg: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? "55" + d : d}?text=${encodeURIComponent(msg)}`;
}

const FILTERS = [
  { key: "hoje", label: "Hoje" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "proximas", label: "Próximas" },
  { key: "concluidas", label: "Concluídas" },
] as const;

export function TaskBoard({
  initialTasks,
  sugestoes,
  customers,
  team,
}: {
  initialTasks: TaskItem[];
  sugestoes: SugestaoItem[];
  customers: { id: string; name: string }[];
  team: { id: string; name: string; color: string }[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("hoje");
  const [showNew, setShowNew] = useState(false);
  // sugestões dispensadas nesta visita (some da tela sem virar tarefa)
  const [dispensadas, setDispensadas] = useState<string[]>([]);
  const [abrindoConversa, setAbrindoConversa] = useState<string | null>(null);

  /**
   * CONVERSAR DENTRO DO SISTEMA (pedido do dono, 04/08/2026): o botão abria
   * o aplicativo do WhatsApp — a conversa acontecia fora e a Central nunca
   * ficava sabendo. Agora abre a Central com a conversa da cliente e a
   * mensagem sugerida JÁ NO CAMPO: é revisar e enviar. Depois do envio, a
   * sugestão some sozinha (a Agenda pula quem já recebeu mensagem hoje).
   */
  async function conversarNoSistema(customerId: string, mensagem: string) {
    if (abrindoConversa) return;
    setAbrindoConversa(customerId);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
    const d = await res.json().catch(() => ({}));
    setAbrindoConversa(null);
    if (res.ok && d.id) {
      router.push(`/whatsapp?conv=${d.id}&texto=${encodeURIComponent(mensagem)}`);
    } else {
      alert(d.error ?? "Não foi possível abrir a conversa. Tente de novo.");
    }
  }

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

  /**
   * ADIAR — a API já aceitava mudar a data; faltava o botão.
   * Sem isso, a tarefa que a cliente pediu para retomar "semana que vem"
   * vencia e virava mancha vermelha, e a lojista parava de olhar a lista.
   */
  async function adiar(task: TaskItem, dias: number) {
    const nova = new Date();
    nova.setDate(nova.getDate() + dias);
    nova.setHours(23, 59, 0, 0);
    const iso = nova.toISOString();
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, dueAt: iso } : t))
    );
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueAt: iso }),
    });
    if (!res.ok) router.refresh();
  }

  /** Sugestão vira tarefa de verdade (com o motivo junto). */
  async function virarTarefa(s: SugestaoItem) {
    setDispensadas((d) => [...d, s.key]);
    const res = await fetch("/api/automations/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: s.key }),
    });
    if (res.ok) router.refresh();
  }

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
      {/* SUGESTÕES DO MOTOR — a agenda e as tarefas na mesma tela.
          Antes isso vivia em /automacoes, uma aba que ninguém abria: o
          trabalho existia e não chegava a quem devia fazer. */}
      {sugestoes.filter((s) => !dispensadas.includes(s.key)).length > 0 && (
        <div className="rounded-2xl border border-brand-200 bg-white overflow-hidden mb-4">
          <div className="px-4 py-2.5 bg-brand-50 border-b border-brand-100">
            <p className="text-sm font-semibold text-brand-800">
              ☀️ O sistema encontrou{" "}
              {sugestoes.filter((s) => !dispensadas.includes(s.key)).length}{" "}
              {sugestoes.filter((s) => !dispensadas.includes(s.key)).length === 1
                ? "cliente para você chamar"
                : "clientes para você chamar"}
            </p>
            <p className="text-[11px] text-brand-700/70">
              Aniversário, hora de comprar de novo, conversa parada. Chame
              direto ou guarde como tarefa.
            </p>
          </div>
          <ul className="divide-y divide-gray-50">
            {sugestoes
              .filter((s) => !dispensadas.includes(s.key))
              .slice(0, 10)
              .map((s) => (
                <li key={s.key} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {s.customerName}
                      </p>
                      <p className="text-xs text-gray-500">{s.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold px-2 py-0.5">
                      {s.rule}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <button
                      onClick={() => conversarNoSistema(s.customerId, s.mensagem)}
                      disabled={abrindoConversa === s.customerId}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold px-2.5 py-1.5 transition disabled:opacity-60"
                    >
                      <MessageCircle className="size-3" />
                      {abrindoConversa === s.customerId ? "Abrindo…" : "Conversar"}
                    </button>
                    <button
                      onClick={() => virarTarefa(s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-400 text-[11px] font-medium text-gray-600 px-2.5 py-1.5 transition"
                    >
                      <Plus className="size-3" />
                      Guardar como tarefa
                    </button>
                    <button
                      onClick={() => setDispensadas((d) => [...d, s.key])}
                      className="ml-auto text-[11px] text-gray-300 hover:text-gray-500 px-2 py-1.5 transition"
                    >
                      Agora não
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

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
            hint={
              filter === "atrasadas"
                ? undefined
                : "Use as tarefas para não esquecer de dar retorno a uma cliente."
            }
            action={
              filter === "atrasadas" ? undefined : (
                <button
                  onClick={() => setShowNew(true)}
                  className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
                >
                  <Plus className="size-4" />
                  Criar primeira tarefa
                </button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {visible.map((t) => {
              const late =
                t.status === "PENDENTE" && new Date(t.dueAt) < now;
              const done = t.status === "CONCLUIDA";
              return (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3">
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
                    {/* CELULAR: o título não pode ser cortado. "Primeiro
                        atendimento —..." não diz com quem é. Quebra em duas
                        linhas em vez de esconder o que importa. */}
                    <p
                      className={`text-sm font-medium leading-snug ${done ? "line-through text-gray-400" : ""}`}
                    >
                      {t.title}
                      {t.autoRule && (
                        <Zap
                          className="size-3 text-brand-400 inline ml-1.5 -mt-0.5"
                          aria-label="Criada por automação"
                        />
                      )}
                    </p>
                    {/* O MOTIVO — antes era calculado pela automação e
                        descartado. É o que faz a vendedora entender a tarefa
                        sem precisar sair da tela para investigar. */}
                    {t.description && !done && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
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
                      {/* no celular a data vem aqui: a coluna da direita
                          roubava metade da largura do cartão */}
                      <span className="sm:hidden">
                        {" · "}
                        <span className={late ? "text-rose-600 font-semibold" : ""}>
                          {dateShort(t.dueAt)}
                        </span>
                      </span>
                    </p>

                    {/* AÇÃO na própria linha: chamar e adiar. Sem isso a lista
                        só sabia dizer "faça" — a vendedora tinha de sair para
                        agir e não voltava. */}
                    {!done && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {t.customer && (
                          <button
                            onClick={() =>
                              conversarNoSistema(t.customer!.id, t.customer!.mensagem)
                            }
                            disabled={abrindoConversa === t.customer.id}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold px-2.5 py-1.5 transition disabled:opacity-60"
                          >
                            <MessageCircle className="size-3" />
                            {abrindoConversa === t.customer.id ? "Abrindo…" : "Conversar"}
                          </button>
                        )}
                        {/* botões SOLTOS, não um bloco só: emendados, o
                            "1 semana" saía pela direita da tela no celular */}
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 mr-0.5">
                          <Clock3 className="size-3" />
                          Adiar
                        </span>
                        {[
                          { d: 1, r: "amanhã" },
                          { d: 3, r: "3 dias" },
                          { d: 7, r: "1 sem" },
                        ].map((o) => (
                          <button
                            key={o.d}
                            onClick={() => adiar(t, o.d)}
                            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:border-brand-400 hover:bg-gray-50 transition"
                          >
                            {o.r}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* NO CELULAR ESTA COLUNA SOME. Ela levava avatar + data
                      completa e comia quase metade da largura — era o motivo
                      de o título e o nome da cliente aparecerem cortados. */}
                  {t.assignee && (
                    <span className="hidden sm:block shrink-0">
                      <Avatar name={t.assignee.name} color={t.assignee.color} size="sm" />
                    </span>
                  )}
                  <span
                    className={`hidden sm:block text-xs tabular-nums shrink-0 ${
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
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // data de hoje em São Paulo (UTC-3)

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up"
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
    </div></Portal>
  );
}
