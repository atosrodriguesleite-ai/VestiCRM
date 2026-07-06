"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Send,
  StickyNote,
  FileText,
  ArrowLeft,
  Search,
  MessageCircle,
  Info,
} from "lucide-react";
import {
  formatPhone,
  timeShort,
  dateShort,
  conversationStatusLabel,
} from "@/lib/format";
import { Avatar, Badge, ConvStatusPill, EmptyState } from "@/components/ui";

export type InboxMessage = {
  id: string;
  direction: "IN" | "OUT";
  kind: "TEXT" | "NOTE";
  body: string;
  authorName: string | null;
  createdAt: string;
};

export type InboxConversation = {
  id: string;
  status: "OPEN" | "WAITING_CLIENT" | "WAITING_PAYMENT" | "CLOSED";
  unreadCount: number;
  lastMessageAt: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    city: string | null;
    tags: { name: string; color: string }[];
  };
  assignee: { id: string; name: string; color: string } | null;
  messages: InboxMessage[];
};

const STATUS_OPTIONS = [
  "OPEN",
  "WAITING_CLIENT",
  "WAITING_PAYMENT",
  "CLOSED",
] as const;

export function Inbox({
  conversations,
  templates,
  team,
  currentUserName,
}: {
  conversations: InboxConversation[];
  templates: { id: string; title: string; body: string }[];
  team: { id: string; name: string; color: string }[];
  currentUserName: string;
}) {
  const router = useRouter();
  const [convs, setConvs] = useState(conversations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected = convs.find((c) => c.id === selectedId) ?? null;

  const filtered = useMemo(
    () =>
      convs.filter((c) => {
        if (filter !== "ALL" && c.status !== filter) return false;
        if (
          search &&
          !c.customer.name.toLowerCase().includes(search.toLowerCase())
        )
          return false;
        return true;
      }),
    [convs, filter, search]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, [selectedId, selected?.messages.length]);

  function selectConv(id: string) {
    setSelectedId(id);
    setConvs((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    );
    fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markRead: true }),
    });
  }

  async function sendMessage() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    const body = draft.trim();
    const kind = noteMode ? "NOTE" : "TEXT";
    const res = await fetch(`/api/conversations/${selected.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, kind }),
    });
    setSending(false);
    if (res.ok) {
      const msg = await res.json();
      setConvs((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? {
                ...c,
                lastMessageAt: msg.createdAt,
                messages: [
                  ...c.messages,
                  {
                    id: msg.id,
                    direction: "OUT",
                    kind,
                    body,
                    authorName: currentUserName,
                    createdAt: msg.createdAt,
                  },
                ],
              }
            : c
        )
      );
      setDraft("");
      setNoteMode(false);
    }
  }

  async function updateConv(
    id: string,
    patch: { status?: string; assigneeId?: string }
  ) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setConvs((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const next = { ...c };
          if (patch.status)
            next.status = patch.status as InboxConversation["status"];
          if (patch.assigneeId) {
            const member = team.find((t) => t.id === patch.assigneeId);
            next.assignee = member ?? null;
          }
          return next;
        })
      );
    } else {
      router.refresh();
    }
  }

  const applyTemplate = (body: string) => {
    const name = selected?.customer.name.split(" ")[0] ?? "";
    setDraft(
      body
        .replaceAll("{{nome}}", name)
        .replaceAll("{{vendedora}}", currentUserName.split(" ")[0])
    );
    setShowTemplates(false);
  };

  return (
    <div className="max-w-7xl mx-auto h-[calc(100dvh-160px)] md:h-[calc(100dvh-120px)] flex rounded-2xl overflow-hidden border border-gray-100 bg-white shadow-card">
      {/* Lista de conversas */}
      <div
        className={`w-full md:w-[340px] md:border-r border-gray-100 flex-col shrink-0 ${
          selected ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-4 pb-2 shrink-0">
          <h1 className="font-semibold text-lg mb-3 flex items-center gap-2">
            <MessageCircle className="size-5 text-emerald-500" />
            Atendimento
          </h1>
          <div className="relative mb-2">
            <Search className="size-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-xl bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white pl-9 pr-3 py-2 text-sm outline-none transition"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto thin-scroll pb-1">
            {["ALL", ...STATUS_OPTIONS].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition ${
                  filter === s
                    ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {s === "ALL"
                  ? "Todas"
                  : conversationStatusLabel[s as keyof typeof conversationStatusLabel]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll">
          {filtered.length === 0 && (
            <EmptyState title="Nenhuma conversa" hint="Ajuste os filtros ou aguarde novas mensagens." />
          )}
          {filtered.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <button
                key={c.id}
                onClick={() => selectConv(c.id)}
                className={`w-full text-left px-4 py-3 flex gap-3 items-start border-b border-gray-50 transition hover:bg-gray-50 ${
                  selectedId === c.id ? "bg-brand-50/60" : ""
                }`}
              >
                <Avatar name={c.customer.name} color="#7c3aed" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">
                      {c.customer.name}
                    </p>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {dateShort(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {last
                      ? (last.kind === "NOTE" ? "📝 " : "") + last.body
                      : "Sem mensagens"}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <ConvStatusPill
                      status={c.status}
                      label={conversationStatusLabel[c.status]}
                    />
                    {c.assignee && (
                      <span className="text-[10px] text-gray-400 truncate">
                        {c.assignee.name.split(" ")[0]}
                      </span>
                    )}
                  </div>
                </div>
                {c.unreadCount > 0 && (
                  <span className="size-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-1">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Painel do chat */}
      <div
        className={`flex-1 flex-col min-w-0 ${selected ? "flex" : "hidden md:flex"}`}
      >
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<MessageCircle />}
              title="Selecione uma conversa"
              hint="O histórico completo do cliente fica registrado aqui e no perfil dele."
            />
          </div>
        ) : (
          <>
            {/* header do chat */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
              <button
                onClick={() => setSelectedId(null)}
                className="md:hidden p-1 -ml-1 text-gray-400"
              >
                <ArrowLeft className="size-5" />
              </button>
              <Avatar name={selected.customer.name} color="#7c3aed" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/clientes/${selected.customer.id}`}
                  className="text-sm font-semibold hover:text-brand-600 truncate block"
                >
                  {selected.customer.name}
                </Link>
                <p className="text-xs text-gray-400 truncate">
                  {formatPhone(selected.customer.phone)}
                  {selected.customer.city ? ` · ${selected.customer.city}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selected.status}
                  onChange={(e) =>
                    updateConv(selected.id, { status: e.target.value })
                  }
                  className="text-xs rounded-lg border border-gray-200 px-2 py-1.5 bg-white outline-none"
                  title="Status da conversa"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {conversationStatusLabel[s]}
                    </option>
                  ))}
                </select>
                <select
                  value={selected.assignee?.id ?? ""}
                  onChange={(e) =>
                    updateConv(selected.id, { assigneeId: e.target.value })
                  }
                  className="hidden sm:block text-xs rounded-lg border border-gray-200 px-2 py-1.5 bg-white outline-none max-w-28"
                  title="Transferir atendimento"
                >
                  <option value="" disabled>
                    Transferir
                  </option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* tags do cliente */}
            {selected.customer.tags.length > 0 && (
              <div className="flex gap-1.5 px-4 py-2 border-b border-gray-50 overflow-x-auto thin-scroll shrink-0">
                {selected.customer.tags.map((t) => (
                  <Badge key={t.name} color={t.color}>
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}

            {/* mensagens */}
            <div className="flex-1 overflow-y-auto thin-scroll px-4 py-4 space-y-2 bg-[#f4f1f8]">
              {selected.messages.map((m) => {
                if (m.kind === "NOTE") {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="max-w-[85%] rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                        <p className="flex items-center gap-1 font-semibold mb-0.5">
                          <StickyNote className="size-3" />
                          Nota interna · {m.authorName ?? "equipe"}
                        </p>
                        {m.body}
                      </div>
                    </div>
                  );
                }
                const mine = m.direction === "OUT";
                return (
                  <div
                    key={m.id}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        mine
                          ? "bg-brand-600 text-white rounded-br-md"
                          : "bg-white text-ink rounded-bl-md"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`text-[10px] mt-1 text-right ${mine ? "text-white/60" : "text-gray-300"}`}
                      >
                        {mine && m.authorName
                          ? `${m.authorName.split(" ")[0]} · `
                          : ""}
                        {timeShort(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* aviso modo simulado */}
            <div className="px-4 py-1.5 bg-sky-50 border-t border-sky-100 flex items-center gap-2 text-[11px] text-sky-700 shrink-0">
              <Info className="size-3.5 shrink-0" />
              Modo simulado: mensagens ficam registradas no CRM. Conecte a API
              oficial do WhatsApp em Configurações.
            </div>

            {/* composer */}
            <div className="p-3 border-t border-gray-100 shrink-0 relative">
              {showTemplates && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop max-h-64 overflow-y-auto thin-scroll z-10">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t.body)}
                      className="w-full text-left px-4 py-2.5 hover:bg-brand-50 transition border-b border-gray-50 last:border-0"
                    >
                      <p className="text-xs font-semibold text-brand-700">
                        {t.title}
                      </p>
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {t.body}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              <div
                className={`flex items-end gap-2 rounded-2xl border px-2 py-1.5 transition ${
                  noteMode
                    ? "border-amber-300 bg-amber-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <button
                  onClick={() => setShowTemplates((v) => !v)}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Modelos de mensagem"
                >
                  <FileText className="size-4.5" />
                </button>
                <button
                  onClick={() => setNoteMode((v) => !v)}
                  className={`p-2 transition shrink-0 ${
                    noteMode
                      ? "text-amber-600"
                      : "text-gray-400 hover:text-amber-600"
                  }`}
                  title="Nota interna (não é enviada ao cliente)"
                >
                  <StickyNote className="size-4.5" />
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                  placeholder={
                    noteMode
                      ? "Escrever nota interna..."
                      : "Escrever mensagem... (Enter envia)"
                  }
                  className="flex-1 resize-none bg-transparent text-sm outline-none py-2 max-h-32"
                />
                <button
                  onClick={sendMessage}
                  disabled={!draft.trim() || sending}
                  className={`p-2.5 rounded-xl text-white transition shrink-0 disabled:opacity-40 ${
                    noteMode
                      ? "bg-amber-500 hover:bg-amber-600"
                      : "bg-brand-600 hover:bg-brand-700"
                  }`}
                  title={noteMode ? "Salvar nota" : "Enviar"}
                >
                  {noteMode ? (
                    <StickyNote className="size-4" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
              <div className="sm:hidden mt-2">
                <select
                  value={selected.assignee?.id ?? ""}
                  onChange={(e) =>
                    updateConv(selected.id, { assigneeId: e.target.value })
                  }
                  className="w-full text-xs rounded-lg border border-gray-200 px-2 py-2 bg-white outline-none"
                >
                  <option value="" disabled>
                    Transferir atendimento
                  </option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      Transferir para {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
