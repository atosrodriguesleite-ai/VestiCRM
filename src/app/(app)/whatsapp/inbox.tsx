"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Send,
  StickyNote,
  ArrowLeft,
  Search,
  MessageCircle,
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
  Inbox as InboxIcon,
  Hand,
  CheckCircle2,
  Users,
  ArrowRightLeft,
  Tag as TagIcon,
  Plus,
  X,
  AtSign,
  Info,
  Zap,
  Link2,
  Download,
} from "lucide-react";
import { OrderComposer } from "@/components/order-composer";
import { ContactPanel } from "./contact-panel";
import { orderNumber } from "@/lib/orders";
import {
  formatPhone,
  timeShort,
  dateShort,
  conversationStatusLabel,
  templateCategoryLabel,
  relativeDays,
} from "@/lib/format";
import { Avatar, EmptyState } from "@/components/ui";

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
    catalogLink: string;
    tags: { id: string; name: string; color: string }[];
  };
  assignee: { id: string; name: string; color: string } | null;
  setor: { id: string; name: string; color: string } | null;
  messages: InboxMessage[];
};

type Tab = "chats" | "fila" | "contatos";

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

/** Pastilha pequena com o setor (cor + nome). */
function SetorPill({
  setor,
}: {
  setor: { name: string; color: string } | null;
}) {
  if (!setor) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `${setor.color}1a`, color: setor.color }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: setor.color }}
      />
      {setor.name}
    </span>
  );
}

type Tag = { id: string; name: string; color: string };

export function Inbox({
  conversations,
  templates,
  team,
  setores,
  allTags,
  currentUserId,
  currentUserName,
}: {
  conversations: InboxConversation[];
  templates: { id: string; title: string; body: string; category: string }[];
  team: { id: string; name: string; color: string }[];
  setores: { id: string; name: string; color: string }[];
  allTags: Tag[];
  currentUserId: string;
  currentUserName: string;
}) {
  const router = useRouter();
  const [convs, setConvs] = useState(conversations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fila");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>(allTags);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [draft, setDraft] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [mention, setMention] = useState<{ query: string; at: number } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [slash, setSlash] = useState<{ query: string; at: number } | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileKindRef = useRef<"IMAGE" | "DOCUMENT">("IMAGE");

  const selected = convs.find((c) => c.id === selectedId) ?? null;

  // fila = sem responsável e não encerrada; chats = em atendimento (com
  // responsável, não encerrada); contatos = histórico (encerradas).
  const bucketOf = (c: InboxConversation): Tab =>
    c.status === "CLOSED" ? "contatos" : c.assignee ? "chats" : "fila";

  const counts = useMemo(() => {
    const acc = { chats: 0, fila: 0, contatos: 0 };
    for (const c of convs) acc[bucketOf(c)]++;
    return acc;
  }, [convs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = convs.filter((c) => {
      if (bucketOf(c) !== tab) return false;
      if (tagFilter && !c.customer.tags.some((t) => t.id === tagFilter)) return false;
      if (
        q &&
        !c.customer.name.toLowerCase().includes(q) &&
        !c.customer.phone.includes(q.replace(/\D/g, ""))
      )
        return false;
      return true;
    });
    // Fila: mais antigo primeiro (quem espera há mais tempo no topo).
    // Chats/Contatos: atividade mais recente primeiro.
    return list.sort((a, b) => {
      if (tab === "fila") {
        const at = new Date(a.lastInboundAt ?? a.createdAt).getTime();
        const bt = new Date(b.lastInboundAt ?? b.createdAt).getTime();
        return at - bt;
      }
      return (
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
    });
  }, [convs, tab, search, tagFilter]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, [selectedId, selected?.messages.length]);

  // abre direto a conversa vinda do sino de notificações (?conv=...)
  const searchParams = useSearchParams();
  useEffect(() => {
    const cid = searchParams.get("conv");
    if (cid && convs.some((c) => c.id === cid)) {
      setSelectedId(cid);
      const c = convs.find((x) => x.id === cid);
      if (c) setTab(c.status === "CLOSED" ? "contatos" : c.assignee ? "chats" : "fila");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function selectConv(id: string) {
    setSelectedId(id);
    setShowTransfer(false);
    setShowTagPicker(false);
    setMention(null);
    setSlash(null);
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

  function patchLocal(id: string, patch: Partial<InboxConversation>) {
    setConvs((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  async function sendPayload(payload: Record<string, unknown>) {
    if (!selected || sending) return false;
    setSending(true);
    // enviar mensagem em conversa da fila = assumir o atendimento
    if (!selected.assignee) {
      patchLocal(selected.id, {
        assignee: { id: currentUserId, name: currentUserName, color: "#c4622d" },
      });
      await updateConv(selected.id, { assigneeId: currentUserId }, true);
    }
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
      setMention(null);
      setSlash(null);
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

  /**
   * Atualiza a conversa no servidor + estado local. `silent` evita refazer o
   * estado local quando o chamador já o ajustou (ex.: assumir ao enviar).
   */
  async function updateConv(
    id: string,
    patch: {
      status?: string;
      assigneeId?: string | null;
      setorId?: string | null;
      priority?: string;
    },
    silent = false
  ) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      router.refresh();
      return;
    }
    if (silent) return;
    const local: Partial<InboxConversation> = {};
    if (patch.status) local.status = patch.status as InboxConversation["status"];
    if (patch.priority)
      local.priority = patch.priority as InboxConversation["priority"];
    if (patch.assigneeId !== undefined)
      local.assignee = patch.assigneeId
        ? team.find((t) => t.id === patch.assigneeId) ?? null
        : null;
    if (patch.setorId !== undefined)
      local.setor = patch.setorId
        ? setores.find((s) => s.id === patch.setorId) ?? null
        : null;
    patchLocal(id, local);
  }

  // Ações da Central de Atendimento (modelo Digisac)
  const assumir = (id: string) => {
    patchLocal(id, {
      assignee: { id: currentUserId, name: currentUserName, color: "#c4622d" },
      status: "OPEN",
    });
    updateConv(id, { assigneeId: currentUserId, status: "OPEN" }, true);
    setTab("chats");
  };
  const encerrar = (id: string) => {
    if (!window.confirm("Encerrar este atendimento? Ele vai para o histórico e, se o cliente escrever de novo, volta para a fila.")) return;
    patchLocal(id, { status: "CLOSED" });
    updateConv(id, { status: "CLOSED" }, true);
  };
  const reabrir = (id: string) => {
    patchLocal(id, { status: "OPEN", assignee: null });
    updateConv(id, { status: "OPEN", assigneeId: null }, true);
    setTab("fila");
  };

  // ---- Etiquetas (tags) do contato ----
  async function toggleTag(tag: Tag) {
    if (!selected) return;
    const has = selected.customer.tags.some((t) => t.id === tag.id);
    const nextTags = has
      ? selected.customer.tags.filter((t) => t.id !== tag.id)
      : [...selected.customer.tags, tag];
    // aplica em TODAS as conversas do mesmo cliente (a etiqueta é do contato)
    setConvs((prev) =>
      prev.map((c) =>
        c.customer.id === selected.customer.id
          ? { ...c, customer: { ...c.customer, tags: nextTags } }
          : c
      )
    );
    await fetch(`/api/customers/${selected.customer.id}/tags`, {
      method: has ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: tag.id }),
    });
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name || !selected) return;
    const palette = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444"];
    const color = palette[tags.length % palette.length];
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (res.ok) {
      const tag: Tag = await res.json();
      setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
      setNewTagName("");
      if (!selected.customer.tags.some((t) => t.id === tag.id)) toggleTag(tag);
    }
  }

  // ---- Menção @vendedor (notas) e resposta rápida "/" (mensagens) ----
  function onDraftChange(value: string, caret: number) {
    setDraft(value);
    const before = value.slice(0, caret);
    // menção só no modo nota
    if (noteMode) {
      const m = before.match(/@([\p{L} ]{0,20})$/u);
      setMention(m ? { query: m[1].toLowerCase(), at: caret - m[0].length } : null);
    } else {
      setMention(null);
    }
    // resposta rápida: "/" no começo da linha (mensagem normal)
    if (!noteMode) {
      const s = before.match(/(?:^|\s)\/([\p{L}\d ]{0,24})$/u);
      setSlash(
        s ? { query: s[1].toLowerCase().trim(), at: caret - s[1].length - 1 } : null
      );
    } else {
      setSlash(null);
    }
  }

  function insertMention(name: string) {
    const caret = taRef.current?.selectionStart ?? draft.length;
    const start = mention?.at ?? caret;
    const next = draft.slice(0, start) + `@${name} ` + draft.slice(caret);
    setDraft(next);
    setMention(null);
    taRef.current?.focus();
  }

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    return team
      .filter((t) => t.id !== currentUserId && t.name.toLowerCase().includes(mention.query))
      .slice(0, 5);
  }, [mention, team, currentUserId]);

  const resolveTemplate = (body: string) =>
    body
      .replaceAll("{{nome}}", selected?.customer.name.split(" ")[0] ?? "")
      .replaceAll("{{vendedora}}", currentUserName.split(" ")[0]);

  const slashMatches = useMemo(() => {
    if (!slash) return [];
    const q = slash.query;
    return templates
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q))
      .slice(0, 6);
  }, [slash, templates]);

  function applyQuickReply(body: string) {
    const caret = taRef.current?.selectionStart ?? draft.length;
    const start = slash?.at ?? caret;
    const next = draft.slice(0, start) + resolveTemplate(body) + draft.slice(caret);
    setDraft(next);
    setSlash(null);
    taRef.current?.focus();
  }

  // ---- Link rastreável do catálogo do cliente ----
  // Insere na mensagem o link personalizado que rastreia o comportamento
  // DESTE cliente no catálogo (leva o ref do vendedor logado).
  function inserirLinkCatalogo() {
    if (!selected) return;
    const nome = selected.customer.name.split(" ")[0];
    const link = selected.customer.catalogLink;
    const msg = draft.trim()
      ? `${draft.trim()}\n${link}`
      : `Oi ${nome}! 💜 Montei um catálogo pra você dar uma olhada com calma:\n${link}`;
    setDraft(msg);
    setSlash(null);
    taRef.current?.focus();
  }

  // ---- Envio de mídia real (imagem/documento) ----
  function pickFile(kind: "IMAGE" | "DOCUMENT") {
    setShowAttach(false);
    fileKindRef.current = kind;
    if (fileRef.current) {
      fileRef.current.accept = kind === "IMAGE" ? "image/*" : "*/*";
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("Arquivo muito grande (máximo 4 MB).");
      return;
    }
    const kind = fileKindRef.current;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await sendPayload({
      kind: "TEXT",
      mediaType: kind,
      mediaUrl: dataUrl,
      fileName: file.name,
      body: kind === "IMAGE" ? "📷 Imagem" : `📎 ${file.name}`,
    });
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

  const TABS: { key: Tab; label: string; icon: typeof InboxIcon; count: number }[] = [
    { key: "chats", label: "Chats", icon: MessageCircle, count: counts.chats },
    { key: "fila", label: "Fila", icon: InboxIcon, count: counts.fila },
    { key: "contatos", label: "Contatos", icon: Users, count: counts.contatos },
  ];

  const isMine = selected?.assignee?.id === currentUserId;

  return (
    <div className="max-w-7xl mx-auto h-[calc(100dvh-160px)] md:h-[calc(100dvh-120px)] flex rounded-2xl overflow-hidden border border-gray-100 bg-white shadow-card">
      {/* Lista de conversas */}
      <div
        className={`w-full md:w-[340px] md:border-r border-gray-100 flex-col shrink-0 ${
          selected ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-4 pb-2 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h1 className="font-semibold text-lg flex items-center gap-2">
              <MessageCircle className="size-5 text-emerald-500" />
              Atendimento
            </h1>
            <div className="relative shrink-0">
              <button
                onClick={() => setShowBackup((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg border text-[11px] font-semibold px-2 py-1.5 transition ${
                  showBackup
                    ? "border-brand-300 text-brand-600 bg-brand-50"
                    : "border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-300"
                }`}
                title="Baixar cópia de segurança no seu computador"
              >
                <Download className="size-3.5" />
                Backup
              </button>
              {showBackup && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl border border-gray-100 shadow-pop z-20 p-1">
                  <a
                    href="/api/export/conversas"
                    onClick={() => setShowBackup(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-brand-50 transition"
                  >
                    <MessageCircle className="size-3.5 text-emerald-500 shrink-0" />
                    <span>Conversas <span className="text-gray-400">(planilha)</span></span>
                  </a>
                  <a
                    href="/api/export/clientes"
                    onClick={() => setShowBackup(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-brand-50 transition"
                  >
                    <Users className="size-3.5 text-brand-500 shrink-0" />
                    <span>Contatos <span className="text-gray-400">(planilha)</span></span>
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className="relative mb-2.5">
            <Search className="size-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full rounded-xl bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white pl-9 pr-3 py-2 text-sm outline-none transition"
            />
          </div>
          {/* Abas Chats / Fila / Contatos */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-white text-brand-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                  {t.count > 0 && (
                    <span
                      className={`min-w-4 px-1 rounded-full text-[10px] font-bold ${
                        t.key === "fila" && t.count > 0
                          ? "bg-amber-500 text-white"
                          : active
                            ? "bg-brand-100 text-brand-700"
                            : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* filtro por etiqueta (tag) */}
          {tags.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto thin-scroll mt-2 pb-0.5">
              {tagFilter && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold px-2 py-1 hover:bg-gray-200"
                >
                  <X className="size-3" /> limpar
                </button>
              )}
              {tags.map((t) => {
                const on = tagFilter === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTagFilter(on ? null : t.id)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition"
                    style={{
                      backgroundColor: on ? t.color : `${t.color}1a`,
                      color: on ? "#fff" : t.color,
                    }}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: on ? "#fff" : t.color }}
                    />
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll">
          {filtered.length === 0 && (
            <EmptyState
              title={
                tab === "fila"
                  ? "Fila vazia 🎉"
                  : tab === "chats"
                    ? "Nenhum atendimento em curso"
                    : "Nenhum contato no histórico"
              }
              hint={
                tab === "fila"
                  ? "Quando um cliente chamar, o chamado aparece aqui para alguém assumir."
                  : tab === "chats"
                    ? "Assuma um chamado na aba Fila para começar a atender."
                    : "Atendimentos encerrados ficam guardados aqui."
              }
            />
          )}
          {filtered.map((c) => {
            const last = c.messages[c.messages.length - 1];
            const waiting =
              tab === "fila" && (c.lastInboundAt ?? c.createdAt);
            return (
              <button
                key={c.id}
                onClick={() => selectConv(c.id)}
                className={`w-full text-left px-4 py-3 flex gap-3 items-start border-b border-gray-50 transition hover:bg-gray-50 ${
                  selectedId === c.id ? "bg-brand-50/60" : ""
                }`}
              >
                <Avatar name={c.customer.name} color="#c4622d" />
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
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <SetorPill setor={c.setor} />
                    {waiting ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5">
                        <Clock className="size-2.5" />
                        aguarda {ago(waiting as string)}
                      </span>
                    ) : c.assignee ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: c.assignee.color }}
                        />
                        {c.assignee.name.split(" ")[0]}
                      </span>
                    ) : null}
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
              <Avatar name={selected.customer.name} color="#c4622d" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/clientes/${selected.customer.id}`}
                  className="text-sm font-semibold hover:text-brand-600 truncate block"
                >
                  {selected.customer.name}
                </Link>
                <p className="text-[11px] text-gray-400 truncate">
                  {formatPhone(selected.customer.phone)}
                  {selected.lastInboundAt &&
                  (!selected.lastOutboundAt ||
                    selected.lastInboundAt > selected.lastOutboundAt)
                    ? ` · cliente aguarda há ${ago(selected.lastInboundAt)}`
                    : selected.lastOutboundAt
                      ? ` · aguardando cliente há ${ago(selected.lastOutboundAt)}`
                      : ` · aberta ${relativeDays(selected.createdAt)}`}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <SetorPill setor={selected.setor} />
                  {selected.assignee ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: selected.assignee.color }}
                      />
                      {isMine ? "Você" : selected.assignee.name.split(" ")[0]}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5">
                      <InboxIcon className="size-2.5" />
                      na fila
                    </span>
                  )}
                </div>
              </div>

              {/* ação principal: assumir / encerrar / reabrir */}
              <div className="flex items-center gap-1.5 shrink-0">
                {selected.status === "CLOSED" ? (
                  <button
                    onClick={() => reabrir(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-2 transition"
                  >
                    <RotateCcw className="size-3.5" />
                    Reabrir
                  </button>
                ) : !selected.assignee ? (
                  <button
                    onClick={() => assumir(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 transition"
                  >
                    <Hand className="size-3.5" />
                    Assumir
                  </button>
                ) : (
                  <button
                    onClick={() => encerrar(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-emerald-300 hover:text-emerald-700 text-gray-600 text-xs font-semibold px-3 py-2 transition"
                  >
                    <CheckCircle2 className="size-3.5" />
                    Encerrar
                  </button>
                )}
                <button
                  onClick={() => setShowTransfer((v) => !v)}
                  className={`p-2 rounded-xl border transition ${
                    showTransfer
                      ? "border-brand-300 text-brand-600 bg-brand-50"
                      : "border-gray-200 text-gray-500 hover:text-brand-600"
                  }`}
                  title="Transferir / mudar status"
                >
                  <ArrowRightLeft className="size-4" />
                </button>
                <button
                  onClick={() => setShowContact((v) => !v)}
                  className={`p-2 rounded-xl border transition ${
                    showContact
                      ? "border-brand-300 text-brand-600 bg-brand-50"
                      : "border-gray-200 text-gray-500 hover:text-brand-600"
                  }`}
                  title="Ficha do contato"
                >
                  <Info className="size-4" />
                </button>
              </div>
            </div>

            {/* painel de transferência (setor, atendente, status, prioridade) */}
            {showTransfer && (
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70 grid grid-cols-2 gap-2 shrink-0">
                <label className="text-[11px] font-semibold text-gray-500 flex flex-col gap-1">
                  Setor
                  <select
                    value={selected.setor?.id ?? ""}
                    onChange={(e) =>
                      updateConv(selected.id, { setorId: e.target.value || null })
                    }
                    className="text-xs rounded-lg border border-gray-200 px-2 py-2 bg-white outline-none font-normal"
                  >
                    <option value="">Sem setor</option>
                    {setores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-gray-500 flex flex-col gap-1">
                  Atendente
                  <select
                    value={selected.assignee?.id ?? ""}
                    onChange={(e) =>
                      updateConv(selected.id, {
                        assigneeId: e.target.value || null,
                      })
                    }
                    className="text-xs rounded-lg border border-gray-200 px-2 py-2 bg-white outline-none font-normal"
                  >
                    <option value="">Ninguém (fila)</option>
                    {team.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-gray-500 flex flex-col gap-1">
                  Status
                  <select
                    value={selected.status}
                    onChange={(e) =>
                      updateConv(selected.id, { status: e.target.value })
                    }
                    className="text-xs rounded-lg border border-gray-200 px-2 py-2 bg-white outline-none font-normal"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {conversationStatusLabel[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-gray-500 flex flex-col gap-1">
                  Prioridade
                  <select
                    value={selected.priority}
                    onChange={(e) =>
                      updateConv(selected.id, { priority: e.target.value })
                    }
                    className={`text-xs rounded-lg border px-2 py-2 bg-white outline-none font-normal ${
                      selected.priority === "ALTA"
                        ? "border-rose-300 text-rose-600"
                        : "border-gray-200"
                    }`}
                  >
                    <option value="BAIXA">Baixa</option>
                    <option value="NORMAL">Normal</option>
                    <option value="ALTA">🔥 Alta</option>
                  </select>
                </label>
              </div>
            )}

            {/* etiquetas (tags) do contato — clicáveis para remover, + para adicionar */}
            <div className="relative flex items-center gap-1.5 px-4 py-2 border-b border-gray-50 overflow-x-auto thin-scroll shrink-0">
              <TagIcon className="size-3.5 text-gray-300 shrink-0" />
              {selected.customer.tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleTag(t)}
                  className="group shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                  title="Remover etiqueta"
                >
                  {t.name}
                  <X className="size-2.5 opacity-50 group-hover:opacity-100" />
                </button>
              ))}
              <button
                onClick={() => setShowTagPicker((v) => !v)}
                className={`shrink-0 inline-flex items-center gap-0.5 rounded-full border border-dashed px-2 py-0.5 text-[11px] font-semibold transition ${
                  showTagPicker
                    ? "border-brand-400 text-brand-600 bg-brand-50"
                    : "border-gray-300 text-gray-400 hover:text-brand-600 hover:border-brand-300"
                }`}
              >
                <Plus className="size-3" /> etiqueta
              </button>

              {showTagPicker && (
                <div className="absolute top-full left-4 mt-1 w-60 bg-white rounded-xl border border-gray-100 shadow-pop z-20 p-2">
                  <div className="max-h-44 overflow-y-auto thin-scroll space-y-0.5">
                    {tags.length === 0 && (
                      <p className="text-[11px] text-gray-400 px-1 py-1.5">
                        Nenhuma etiqueta ainda. Crie a primeira abaixo. 👇
                      </p>
                    )}
                    {tags.map((t) => {
                      const on = selected.customer.tags.some((x) => x.id === t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleTag(t)}
                          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-gray-50"
                        >
                          <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                          <span className="flex-1 truncate">{t.name}</span>
                          {on && <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 border-t border-gray-100 mt-1.5 pt-1.5">
                    <input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          createTag();
                        }
                      }}
                      placeholder="Nova etiqueta..."
                      className="flex-1 min-w-0 rounded-lg bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white px-2 py-1.5 text-xs outline-none"
                    />
                    <button
                      onClick={createTag}
                      disabled={!newTagName.trim()}
                      className="shrink-0 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-2.5 py-1.5 disabled:opacity-40"
                    >
                      Criar
                    </button>
                  </div>
                </div>
              )}
            </div>

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

            {/* aviso: conversa na fila */}
            {!selected.assignee && selected.status !== "CLOSED" && (
              <div className="px-4 py-1.5 bg-amber-50 border-t border-amber-100 flex items-center gap-2 text-[11px] text-amber-800 shrink-0">
                <InboxIcon className="size-3.5 shrink-0" />
                Este chamado está na fila. Ao responder, você assume o
                atendimento automaticamente.
              </div>
            )}

            {/* composer */}
            <div className="p-3 border-t border-gray-100 shrink-0 relative">
              {showTemplates && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop max-h-72 overflow-y-auto thin-scroll z-10">
                  <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-2 bg-white border-b border-gray-100">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                      <Zap className="size-3" /> Respostas rápidas
                    </p>
                    <Link
                      href="/configuracoes"
                      className="text-[11px] font-semibold text-brand-600 hover:underline flex items-center gap-1"
                    >
                      <Plus className="size-3" /> criar / gerenciar
                    </Link>
                  </div>
                  {templates.length === 0 && (
                    <p className="px-4 py-4 text-xs text-gray-400">
                      Nenhuma resposta rápida ainda. Crie em Configurações → Modelos de mensagem.
                    </p>
                  )}
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
                    onClick={() => pickFile("IMAGE")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <ImageIcon className="size-5 text-brand-600" />
                    <span className="text-[10px] font-medium">Imagem</span>
                  </button>
                  <button
                    onClick={() => pickFile("DOCUMENT")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <File className="size-5 text-sky-600" />
                    <span className="text-[10px] font-medium">Documento</span>
                  </button>
                  <button
                    onClick={() => sendAttachment("AUDIO")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                    title="Áudio (demonstração)"
                  >
                    <Mic className="size-5 text-emerald-600" />
                    <span className="text-[10px] font-medium">Áudio</span>
                  </button>
                </div>
              )}

              {/* respostas rápidas: "/" para inserir um modelo de mensagem */}
              {!noteMode && slash && slashMatches.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop z-20 max-h-72 overflow-y-auto thin-scroll">
                  <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-2 bg-white border-b border-gray-100">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                      <Zap className="size-3" /> Respostas rápidas
                    </p>
                    <Link
                      href="/configuracoes"
                      className="text-[11px] font-semibold text-brand-600 hover:underline flex items-center gap-1"
                    >
                      <Plus className="size-3" /> criar / gerenciar
                    </Link>
                  </div>
                  {slashMatches.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyQuickReply(t.body)}
                      className="w-full text-left px-4 py-2.5 hover:bg-brand-50 transition border-b border-gray-50 last:border-0"
                    >
                      <p className="text-xs font-semibold text-brand-700">{t.title}</p>
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {resolveTemplate(t.body)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {/* menção @ nas notas internas */}
              {noteMode && mention && mentionMatches.length > 0 && (
                <div className="absolute bottom-full left-3 mb-1 w-56 bg-white rounded-xl border border-gray-100 shadow-pop z-20 p-1">
                  <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                    <AtSign className="size-3" /> Marcar alguém
                  </p>
                  {mentionMatches.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => insertMention(u.name.split(" ")[0])}
                      className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-amber-50 transition"
                    >
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: u.color }} />
                      <span className="truncate">{u.name}</span>
                    </button>
                  ))}
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
                  className={`p-2 transition shrink-0 ${
                    showTemplates ? "text-brand-600" : "text-gray-400 hover:text-brand-600"
                  }`}
                  title="Respostas rápidas"
                >
                  <Zap className="size-4.5" />
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
                  onClick={inserirLinkCatalogo}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Enviar link do catálogo (rastreia este cliente)"
                >
                  <Link2 className="size-4.5" />
                </button>
                <button
                  onClick={() => setShowOrder(true)}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Adicionar produto ao pedido"
                >
                  <ShoppingBag className="size-4.5" />
                </button>
                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && (mention || slash)) {
                      setMention(null);
                      setSlash(null);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      // lista de menção aberta → Enter escolhe o 1º nome
                      if (noteMode && mention && mentionMatches.length > 0) {
                        e.preventDefault();
                        insertMention(mentionMatches[0].name.split(" ")[0]);
                        return;
                      }
                      // resposta rápida aberta → Enter insere o 1º modelo
                      if (!noteMode && slash && slashMatches.length > 0) {
                        e.preventDefault();
                        applyQuickReply(slashMatches[0].body);
                        return;
                      }
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                  placeholder={
                    noteMode
                      ? "Nota interna... use @ para marcar alguém"
                      : "Escrever mensagem... (/ para respostas rápidas)"
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

      {/* Painel do contato (lateral no computador, tela cheia no celular).
          No celular fica entre o cabeçalho e o menu de baixo, para o botão
          de fechar não ficar escondido atrás da barra do topo. */}
      {selected && showContact && (
        <div className="fixed inset-x-0 top-14 bottom-16 z-30 bg-white flex flex-col md:static md:inset-auto md:top-auto md:bottom-auto md:z-auto md:w-80 md:shrink-0 md:border-l md:border-gray-100">
          <ContactPanel
            customerId={selected.customer.id}
            onClose={() => setShowContact(false)}
            onRenamed={(name) => {
              const cid = selected.customer.id;
              setConvs((prev) =>
                prev.map((c) =>
                  c.customer.id === cid
                    ? { ...c, customer: { ...c.customer, name } }
                    : c
                )
              );
            }}
          />
        </div>
      )}

      {/* seletor de arquivo (envio de mídia real) */}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={onFileChosen}
      />
    </div>
  );
}
