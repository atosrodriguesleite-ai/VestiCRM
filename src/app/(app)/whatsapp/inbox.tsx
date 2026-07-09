"use client";

/* eslint-disable @next/next/no-img-element */

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
  ShoppingBag,
  Paperclip,
  Image as ImageIcon,
  Mic,
  File,
  Check,
  CheckCheck,
  Clock,
  AlertTriangle,
  RotateCcw,
  Flag,
} from "lucide-react";
import { OrderComposer } from "@/components/order-composer";
import { orderNumber } from "@/lib/orders";
import {
  formatPhone,
  timeShort,
  dateShort,
  conversationStatusLabel,
  templateCategoryLabel,
  relativeDays,
} from "@/lib/format";
import { Avatar, Badge, ConvStatusPill, EmptyState } from "@/components/ui";

export type InboxMessage = {
  id: string;
  direction: "IN" | "OUT";
  kind: "TEXT" | "NOTE";
  mediaType: "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT" | "VIDEO" | "TEMPLATE";
  mediaUrl: string | null;
  fileName: string | null;
  status: string;
  error: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
};

export type InboxConversation = {
  id: string;
  channel: string;
  status: "OPEN" | "WAITING_CLIENT" | "WAITING_PAYMENT" | "CLOSED";
  priority: "BAIXA" | "NORMAL" | "ALTA";
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    city: string | null;
    wholesale: boolean;
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

/** hh/dias desde a data — "2h", "3d" */
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}min`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / (60 * 24))}d`;
}

function StatusTicks({ m }: { m: InboxMessage }) {
  if (m.direction !== "OUT" || m.kind === "NOTE") return null;
  switch (m.status) {
    case "ENVIANDO":
      return <Clock className="size-3 inline" aria-label="Enviando" />;
    case "ENVIADA":
    case "REENVIADA":
      return <Check className="size-3 inline" aria-label="Enviada" />;
    case "ENTREGUE":
      return <CheckCheck className="size-3 inline" aria-label="Entregue" />;
    case "LIDA":
      return (
        <CheckCheck
          className="size-3 inline text-sky-300"
          aria-label="Lida"
        />
      );
    case "FALHOU":
      return (
        <AlertTriangle
          className="size-3 inline text-amber-300"
          aria-label="Falhou"
        />
      );
    default:
      return null;
  }
}

function MediaContent({ m }: { m: InboxMessage }) {
  if (m.mediaType === "IMAGE" && m.mediaUrl) {
    return (
      <img
        src={m.mediaUrl}
        alt="Imagem"
        className="rounded-xl max-w-full w-52 mb-1"
      />
    );
  }
  if (m.mediaType === "AUDIO") {
    return (
      <span className="flex items-center gap-2 py-1">
        <span className="size-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Mic className="size-4" />
        </span>
        <span className="flex-1 h-1.5 rounded-full bg-white/25 min-w-28">
          <span className="block h-full w-1/3 rounded-full bg-white/70" />
        </span>
      </span>
    );
  }
  if (m.mediaType === "DOCUMENT") {
    return (
      <span className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 mb-1">
        <File className="size-4 shrink-0" />
        <span className="text-xs font-medium truncate">
          {m.fileName ?? "documento"}
        </span>
      </span>
    );
  }
  return null;
}

export function Inbox({
  conversations,
  templates,
  team,
  currentUserName,
}: {
  conversations: InboxConversation[];
  templates: { id: string; title: string; body: string; category: string }[];
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
  const [showAttach, setShowAttach] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
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

  function appendMessage(convId: string, msg: InboxMessage) {
    setConvs((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastMessageAt: msg.createdAt,
              messages: [...c.messages, msg],
            }
          : c
      )
    );
  }

  async function sendPayload(payload: Record<string, unknown>) {
    if (!selected || sending) return;
    setSending(true);
    const res = await fetch(`/api/conversations/${selected.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSending(false);
    if (res.ok) {
      const msg = await res.json();
      appendMessage(selected.id, {
        id: msg.id,
        direction: "OUT",
        kind: msg.kind,
        mediaType: msg.mediaType,
        mediaUrl: msg.mediaUrl,
        fileName: msg.fileName,
        status: msg.status,
        error: msg.error,
        body: msg.body,
        authorName: currentUserName,
        createdAt: msg.createdAt,
      });
      return true;
    }
    return false;
  }

  async function sendMessage() {
    if (!draft.trim()) return;
    const ok = await sendPayload({
      body: draft.trim(),
      kind: noteMode ? "NOTE" : "TEXT",
    });
    if (ok) {
      setDraft("");
      setNoteMode(false);
    }
  }

  async function sendAttachment(kind: "IMAGE" | "AUDIO" | "DOCUMENT") {
    setShowAttach(false);
    const payloads = {
      IMAGE: {
        body: "📷 Foto do catálogo",
        mediaType: "IMAGE",
        mediaUrl: "/products/conjunto-linho.svg",
      },
      AUDIO: { body: "🎤 Áudio (0:08)", mediaType: "AUDIO" },
      DOCUMENT: {
        body: "📎 Tabela de medidas",
        mediaType: "DOCUMENT",
        fileName: "tabela-medidas.pdf",
      },
    } as const;
    await sendPayload({ ...payloads[kind], kind: "TEXT" });
  }

  async function resend(messageId: string) {
    if (!selected) return;
    const res = await fetch(`/api/messages/${messageId}/resend`, {
      method: "POST",
    });
    if (res.ok) {
      const updated = await res.json();
      setConvs((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? { ...m, status: updated.status, error: updated.error }
                    : m
                ),
              }
            : c
        )
      );
    }
  }

  async function updateConv(
    id: string,
    patch: { status?: string; assigneeId?: string; priority?: string }
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
          if (patch.priority)
            next.priority = patch.priority as InboxConversation["priority"];
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

  const templatesByCategory = useMemo(() => {
    const map = new Map<string, typeof templates>();
    for (const t of templates) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [templates]);

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
                <Avatar name={c.customer.name} color="#6d28ff" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {c.priority === "ALTA" && (
                        <Flag className="size-3 text-rose-500 shrink-0" />
                      )}
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
              <Avatar name={selected.customer.name} color="#6d28ff" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/clientes/${selected.customer.id}`}
                  className="text-sm font-semibold hover:text-brand-600 truncate block"
                >
                  {selected.customer.name}
                </Link>
                <p className="text-[11px] text-gray-400 truncate">
                  {formatPhone(selected.customer.phone)} · aberta{" "}
                  {relativeDays(selected.createdAt)}
                  {selected.lastInboundAt &&
                  (!selected.lastOutboundAt ||
                    selected.lastInboundAt > selected.lastOutboundAt)
                    ? ` · cliente aguarda há ${ago(selected.lastInboundAt)}`
                    : selected.lastOutboundAt
                      ? ` · aguardando cliente há ${ago(selected.lastOutboundAt)}`
                      : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={selected.priority}
                  onChange={(e) =>
                    updateConv(selected.id, { priority: e.target.value })
                  }
                  className={`text-xs rounded-lg border px-1.5 py-1.5 bg-white outline-none ${
                    selected.priority === "ALTA"
                      ? "border-rose-300 text-rose-600"
                      : "border-gray-200"
                  }`}
                  title="Prioridade"
                >
                  <option value="BAIXA">Baixa</option>
                  <option value="NORMAL">Normal</option>
                  <option value="ALTA">🔥 Alta</option>
                </select>
                <select
                  value={selected.status}
                  onChange={(e) =>
                    updateConv(selected.id, { status: e.target.value })
                  }
                  className="text-xs rounded-lg border border-gray-200 px-1.5 py-1.5 bg-white outline-none max-w-32"
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
                  className="hidden sm:block text-xs rounded-lg border border-gray-200 px-1.5 py-1.5 bg-white outline-none max-w-24"
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
                        <span className="whitespace-pre-wrap">{m.body}</span>
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
                      <MediaContent m={m} />
                      {(m.mediaType === "TEXT" || m.mediaType === "TEMPLATE") && (
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      )}
                      {m.status === "FALHOU" && (
                        <div className="flex items-center gap-2 mt-1.5 rounded-lg bg-black/15 px-2 py-1">
                          <span className="text-[10px] flex-1">
                            {m.error ?? "Falha no envio"}
                          </span>
                          <button
                            onClick={() => resend(m.id)}
                            className="flex items-center gap-1 text-[10px] font-semibold underline underline-offset-2"
                          >
                            <RotateCcw className="size-3" />
                            Reenviar
                          </button>
                        </div>
                      )}
                      <p
                        className={`text-[10px] mt-1 text-right flex items-center gap-1 justify-end ${mine ? "text-white/60" : "text-gray-300"}`}
                      >
                        {mine && m.authorName
                          ? `${m.authorName.split(" ")[0]} · `
                          : ""}
                        {timeShort(m.createdAt)}
                        <StatusTicks m={m} />
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
              Communication Engine em modo simulado (Mock Provider). Ative a
              Cloud API em Configurações → Comunicação.
            </div>

            {/* composer */}
            <div className="p-3 border-t border-gray-100 shrink-0 relative">
              {showTemplates && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop max-h-72 overflow-y-auto thin-scroll z-10">
                  {[...templatesByCategory.entries()].map(([cat, list]) => (
                    <div key={cat}>
                      <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 bg-gray-50/60">
                        {templateCategoryLabel[cat as keyof typeof templateCategoryLabel] ?? cat}
                      </p>
                      {list.map((t) => (
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
                  ))}
                </div>
              )}
              {showAttach && (
                <div className="absolute bottom-full left-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop z-10 p-1.5 flex gap-1.5">
                  <button
                    onClick={() => sendAttachment("IMAGE")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <ImageIcon className="size-5 text-brand-600" />
                    <span className="text-[10px] font-medium">Imagem</span>
                  </button>
                  <button
                    onClick={() => sendAttachment("AUDIO")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <Mic className="size-5 text-emerald-600" />
                    <span className="text-[10px] font-medium">Áudio</span>
                  </button>
                  <button
                    onClick={() => sendAttachment("DOCUMENT")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <File className="size-5 text-sky-600" />
                    <span className="text-[10px] font-medium">Documento</span>
                  </button>
                </div>
              )}
              <div
                className={`flex items-end gap-1.5 rounded-2xl border px-2 py-1.5 transition ${
                  noteMode
                    ? "border-amber-300 bg-amber-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <button
                  onClick={() => {
                    setShowTemplates((v) => !v);
                    setShowAttach(false);
                  }}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Modelos de mensagem"
                >
                  <FileText className="size-4.5" />
                </button>
                <button
                  onClick={() => {
                    setShowAttach((v) => !v);
                    setShowTemplates(false);
                  }}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Anexar (simulado)"
                >
                  <Paperclip className="size-4.5" />
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
                <button
                  onClick={() => setShowOrder(true)}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Adicionar produto ao pedido"
                >
                  <ShoppingBag className="size-4.5" />
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

            {showOrder && (
              <OrderComposer
                customerId={selected.customer.id}
                customerName={selected.customer.name}
                wholesaleCustomer={selected.customer.wholesale}
                conversationId={selected.id}
                onClose={() => setShowOrder(false)}
                onCreated={(order) => {
                  setShowOrder(false);
                  const body = `🛍️ Pedido ${orderNumber(order.number)} criado — total R$ ${order.total.toFixed(2).replace(".", ",")}`;
                  const nowIso = new Date().toISOString();
                  appendMessage(selected.id, {
                    id: `local-${order.id}`,
                    direction: "OUT",
                    kind: "NOTE",
                    mediaType: "TEXT",
                    mediaUrl: null,
                    fileName: null,
                    status: "ENVIADA",
                    error: null,
                    body,
                    authorName: currentUserName,
                    createdAt: nowIso,
                  });
                  setDraft(
                    `Seu pedido ${orderNumber(order.number)} ficou em R$ ${order.total
                      .toFixed(2)
                      .replace(".", ",")} 💜 Te enviei o orçamento em PDF, qualquer ajuste me avisa!`
                  );
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
