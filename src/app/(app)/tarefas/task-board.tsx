"use client";

import { useEffect, useMemo, useState } from "react";
import { Portal } from "@/components/portal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, X, Zap, MessageCircle, Clock3, Search, CalendarDays } from "lucide-react";
import {
  dateShort,
  timeShort,
  taskTypeLabel,
  priorityLabel,
} from "@/lib/format";
import { Card, Avatar, PriorityDot, EmptyState } from "@/components/ui";
import { contarPorAba, tarefasDaAba, type AbaDaAgenda } from "@/lib/agenda";

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

  /**
   * A LISTA TEM QUE VOLTAR A ACREDITAR NO SERVIDOR.
   *
   * ESTE ERA O BUG DO "CONCLUÍ E CONTINUA ATRASADA". `useState(initialTasks)`
   * guarda a lista UMA VEZ e nunca mais olha para o servidor. O código pedia
   * `router.refresh()` quando o salvamento falhava — o servidor até mandava a
   * verdade de volta, mas a tela ignorava. Resultado: a tarefa ficava verde
   * na tela, o banco continuava com ela PENDENTE, e no dia seguinte ela
   * reaparecia atrasada. A pessoa jurava que tinha concluído — e tinha
   * mesmo, só que o sistema nunca contou que o salvamento falhou.
   *
   * Também é o que fazia "Guardar como tarefa" parecer não funcionar: a
   * tarefa era criada e não aparecia na lista até recarregar a página.
   */
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const [filter, setFilter] = useState<AbaDaAgenda>("hoje");
  const [showNew, setShowNew] = useState(false);
  // sugestões dispensadas nesta visita (some da tela sem virar tarefa)
  const [dispensadas, setDispensadas] = useState<string[]>([]);
  const [abrindoConversa, setAbrindoConversa] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  /** seleção para concluir em massa (162 atrasadas não se limpam uma a uma) */
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [emMassa, setEmMassa] = useState(false);
  /** aviso na tela: erro de salvamento NUNCA pode ser silencioso */
  const [aviso, setAviso] = useState<{
    texto: string;
    tom: "erro" | "ok";
    desfazer?: () => void;
  } | null>(null);

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

  // uma referência de "agora" por montagem: recalcular a cada render fazia
  // a lista "pular" de aba no meio de um clique
  const now = useMemo(() => new Date(), []);

  // contagem dos botões: SEMPRE a lista inteira (a lupa não pode mudar o
  // número da aba, senão "Atrasadas 3" mente enquanto se procura algo)
  const counts = useMemo(() => contarPorAba(tasks, now), [tasks, now]);
  const visible = useMemo(
    () => tarefasDaAba(tasks, filter, busca, now),
    [tasks, filter, busca, now]
  );

  const podeSelecionar = filter !== "concluidas";
  const todasMarcadas =
    visible.length > 0 && visible.every((t) => selecionadas.has(t.id));
  function alternarSelecao(id: string) {
    setSelecionadas((prev) => {
      const p = new Set(prev);
      if (p.has(id)) p.delete(id);
      else p.add(id);
      return p;
    });
  }
  function marcarTodasVisiveis() {
    setSelecionadas(todasMarcadas ? new Set() : new Set(visible.map((t) => t.id)));
  }

  /**
   * ADIAR — a API já aceitava mudar a data; faltava o botão.
   * Sem isso, a tarefa que a cliente pediu para retomar "semana que vem"
   * vencia e virava mancha vermelha, e a lojista parava de olhar a lista.
   */
  async function adiar(task: TaskItem, dias: number, dataEscolhida?: string) {
    let iso: string;
    if (dataEscolhida) {
      // data escolhida no calendário: vence no fim daquele dia
      const [a, m, d] = dataEscolhida.split("-").map(Number);
      iso = new Date(a, m - 1, d, 23, 59, 0, 0).toISOString();
    } else {
      const nova = new Date();
      nova.setDate(nova.getDate() + dias);
      nova.setHours(23, 59, 0, 0);
      iso = nova.toISOString();
    }
    const antes = task.dueAt;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, dueAt: iso } : t))
    );
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueAt: iso }),
    });
    if (!res.ok) {
      // volta atrás NA TELA e avisa — antes o adiamento parecia ter dado
      // certo e a tarefa reaparecia atrasada no dia seguinte
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, dueAt: antes } : t))
      );
      setAviso({ texto: "Não consegui adiar. Tente de novo.", tom: "erro" });
    }
  }

  /** Sugestão vira tarefa de verdade (com o motivo junto). */
  async function virarTarefa(s: SugestaoItem) {
    setDispensadas((d) => [...d, s.key]);
    const res = await fetch("/api/automations/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: s.key }),
    });
    if (res.ok) {
      router.refresh(); // agora a lista escuta o refresh (efeito acima)
      setAviso({ texto: `“${s.title}” virou tarefa.`, tom: "ok" });
    } else {
      setDispensadas((d) => d.filter((k) => k !== s.key));
      setAviso({ texto: "Não consegui guardar como tarefa.", tom: "erro" });
    }
  }

  /** Grava o status de UMA tarefa; devolve se deu certo. */
  async function gravarStatus(id: string, status: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  }

  async function toggleDone(task: TaskItem) {
    const antes = task.status;
    const novo = antes === "CONCLUIDA" ? "PENDENTE" : "CONCLUIDA";
    const aplicar = (s: string) =>
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: s } : t)));

    aplicar(novo);
    const ok = await gravarStatus(task.id, novo);
    if (!ok) {
      aplicar(antes); // a tela volta a dizer a verdade
      setAviso({
        texto: "Não consegui salvar. A tarefa continua em aberto.",
        tom: "erro",
      });
      return;
    }
    if (novo === "CONCLUIDA") {
      setAviso({
        texto: "Tarefa concluída.",
        tom: "ok",
        // clique errado acontece — e desfazer é mais rápido que caçar na aba
        desfazer: async () => {
          aplicar(antes);
          setAviso(null);
          if (!(await gravarStatus(task.id, antes))) {
            aplicar(novo);
            setAviso({ texto: "Não consegui reabrir a tarefa.", tom: "erro" });
          }
        },
      });
    }
  }

  /**
   * CONCLUIR EM MASSA — o que faz uma lista de 162 atrasadas voltar a ser
   * usável. Uma chamada só; se falhar, a tela inteira volta ao que era.
   */
  async function concluirSelecionadas() {
    const ids = [...selecionadas];
    if (ids.length === 0 || emMassa) return;
    setEmMassa(true);
    const antes = tasks;
    setTasks((prev) =>
      prev.map((t) => (selecionadas.has(t.id) ? { ...t, status: "CONCLUIDA" } : t))
    );
    const res = await fetch("/api/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status: "CONCLUIDA" }),
    });
    setEmMassa(false);
    if (!res.ok) {
      setTasks(antes);
      setAviso({ texto: "Não consegui concluir. Nada foi alterado.", tom: "erro" });
      return;
    }
    setSelecionadas(new Set());
    setAviso({
      texto: `${ids.length} ${ids.length === 1 ? "tarefa concluída" : "tarefas concluídas"}.`,
      tom: "ok",
      desfazer: async () => {
        setTasks(antes);
        setAviso(null);
        await fetch("/api/tasks/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, status: "PENDENTE" }),
        }).catch(() => {});
        router.refresh();
      },
    });
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

      {/* AVISO — salvamento que falha nunca mais some em silêncio */}
      {aviso && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-3 text-sm ${
            aviso.tom === "erro"
              ? "bg-rose-50 border border-rose-200 text-rose-800"
              : "bg-emerald-50 border border-emerald-200 text-emerald-800"
          }`}
        >
          <span className="flex-1 min-w-0">{aviso.texto}</span>
          {aviso.desfazer && (
            <button
              onClick={aviso.desfazer}
              className="shrink-0 rounded-lg bg-white/70 hover:bg-white border border-current/20 text-xs font-semibold px-2.5 py-1 transition"
            >
              Desfazer
            </button>
          )}
          <button
            onClick={() => setAviso(null)}
            aria-label="Fechar aviso"
            className="shrink-0 opacity-50 hover:opacity-100 transition"
          >
            <X className="size-4" />
          </button>
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

      {/* LUPA + SELEÇÃO EM MASSA — 162 atrasadas não se limpam de uma em uma,
          e achar "a da Alaute" rolando a lista também não é trabalho. */}
      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-44">
            <Search className="size-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por tarefa ou cliente..."
              className="w-full rounded-xl bg-white border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400 transition"
            />
          </div>
          {podeSelecionar && visible.length > 0 && (
            <button
              onClick={marcarTodasVisiveis}
              className="rounded-xl border border-gray-200 bg-white hover:border-brand-300 text-xs font-medium text-gray-600 px-3 py-2 transition whitespace-nowrap"
            >
              {todasMarcadas ? "Desmarcar todas" : `Selecionar as ${visible.length}`}
            </button>
          )}
          {selecionadas.size > 0 && (
            <button
              onClick={concluirSelecionadas}
              disabled={emMassa}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 transition disabled:opacity-60 whitespace-nowrap"
            >
              <Check className="size-3.5" />
              {emMassa
                ? "Concluindo…"
                : `Concluir ${selecionadas.size} ${selecionadas.size === 1 ? "tarefa" : "tarefas"}`}
            </button>
          )}
        </div>
      )}

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            title={
              busca.trim()
                ? `Nada encontrado para “${busca.trim()}”`
                : filter === "atrasadas"
                  ? "Nenhuma tarefa atrasada 🎉"
                  : "Nenhuma tarefa aqui"
            }
            hint={
              busca.trim()
                ? "A busca vale só para esta aba — experimente outra, ou limpe o campo."
                : filter === "atrasadas"
                  ? undefined
                  : "Use as tarefas para não esquecer de dar retorno a uma cliente."
            }
            action={
              busca.trim() ? (
                <button
                  onClick={() => setBusca("")}
                  className="rounded-xl border border-gray-200 hover:border-brand-400 text-sm font-medium text-gray-600 px-4 py-2 transition"
                >
                  Limpar busca
                </button>
              ) : filter === "atrasadas" ? undefined : (
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
                <li
                  key={t.id}
                  className={`flex items-start gap-2 px-2 py-1.5 sm:px-4 sm:py-3 ${
                    selecionadas.has(t.id) ? "bg-emerald-50/60" : ""
                  }`}
                >
                  {/* ALVO DE TOQUE DE VERDADE: a bolinha tinha 20px — no
                      celular o dedo errava e "concluir" simplesmente não
                      acontecia, sem nenhuma reação na tela. A área clicável
                      agora tem 44px (a bolinha continua discreta). */}
                  <button
                    onClick={() => toggleDone(t)}
                    className="size-11 -m-1.5 flex items-center justify-center shrink-0 group/check"
                    title={done ? "Reabrir" : "Concluir"}
                    aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
                  >
                    <span
                      className={`size-5 rounded-full border-2 flex items-center justify-center transition ${
                        done
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "border-gray-300 group-hover/check:border-brand-500 group-active/check:scale-90"
                      }`}
                    >
                      {done && <Check className="size-3" />}
                    </span>
                  </button>
                  {podeSelecionar && (
                    <label
                      className="size-11 -ml-2.5 -my-1.5 flex items-center justify-center shrink-0 cursor-pointer"
                      title="Selecionar para concluir em massa"
                    >
                      <input
                        type="checkbox"
                        checked={selecionadas.has(t.id)}
                        onChange={() => alternarSelecao(t.id)}
                        className="size-4 accent-emerald-600"
                      />
                    </label>
                  )}
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
                        {/* "a cliente pediu para voltar dia 20" não cabe em
                            1/3/7 dias — sem data livre, a tarefa vencia e
                            virava mancha vermelha */}
                        <label
                          className="relative inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:border-brand-400 hover:bg-gray-50 transition cursor-pointer"
                          title="Escolher a data"
                        >
                          <CalendarDays className="size-3" />
                          data
                          <input
                            type="date"
                            onChange={(e) =>
                              e.target.value && adiar(t, 0, e.target.value)
                            }
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </label>
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
