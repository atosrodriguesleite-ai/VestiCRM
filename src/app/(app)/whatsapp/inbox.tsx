"use client";

/* eslint-disable @next/next/no-img-element */

import { Fragment, useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
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
  Reply,
  Smile,
  Zap,
  Link2,
  Download,
  Film,
  Trash2,
  Pencil,
  MoreVertical,
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
import { gravacaoParaWav } from "@/lib/audio-wav";

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
  // resposta a mensagem específica (prévia da citada)
  replyTo?: { id: string; body: string; direction: string } | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  editedAt: string | null;
  revoked: boolean;
  revokedBy: string | null;
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

// Separador de data das mensagens ("Hoje", "Ontem", "ter, 23/07")
const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    ...(d.getFullYear() !== hoje.getFullYear() ? { year: "numeric" } : {}),
  });
}

// Carimbo da lista de conversas — a HORA da última troca sempre à vista:
// hoje → "12:56"; ontem → "Ontem 12:56"; antes → "23/07 12:56"
function listStamp(iso: string): string {
  const d = new Date(iso);
  const hora = timeShort(iso);
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return hora;
  if (d.toDateString() === ontem.toDateString()) return `Ontem ${hora}`;
  const data = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    ...(d.getFullYear() !== hoje.getFullYear() ? { year: "2-digit" } : {}),
  });
  return `${data} ${hora}`;
}

// Emojis do compositor — grade completa, organizada para venda de moda.
// Nativos do aparelho (sem biblioteca externa): leves e iguais ao WhatsApp.
// O 🤎 abre a fila dos corações — é o coração da marca. 😉
const EMOJI_GROUPS: { titulo: string; emojis: string[] }[] = [
  {
    titulo: "Corações",
    emojis: ["🤎","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🩷","🩵","🩶","💖","💕","💞","💓","💗","💘","💝","💟","❣️","❤️‍🔥","❤️‍🩹","💔","💌","💋"],
  },
  {
    titulo: "Carinhas",
    emojis: ["😀","😃","😄","😁","😆","😅","😂","🤣","🥲","🥹","😊","☺️","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😜","🤪","😝","🤩","🥳","😎","🤓","🧐","🤗","🤭","🫢","🤫","🤔","🫡","😐","😑","😶","🙄","😏","😬","😮‍💨","😪","😴","🥱","😷","🤒","🤕","🥴","😵","🤯","🥺","😢","😭","😤","😠","😱","😨","😰","😥","😓","🤤","😇","🥸","🤠","😈","👻","💀","🤖","👽","😺","😻","🙈","🙉","🙊"],
  },
  {
    titulo: "Gestos e pessoas",
    emojis: ["👍","👎","👏","🙌","🙏","🤝","💪","✌️","🤞","🫶","🤟","🤘","🤙","👌","🤌","🤏","👋","🖐️","✋","🖖","👈","👉","👆","👇","☝️","✊","👊","🤛","🤜","🫵","🤲","🫰","✍️","💅","🤳","💃","🕺","🧍‍♀️","🏃‍♀️","👩","👨","👧","👦","👶","👵","👴","👩‍💼","🤦‍♀️","🤷‍♀️","💁‍♀️","🙋‍♀️","🙆‍♀️","🙅‍♀️"],
  },
  {
    titulo: "Festa e destaque",
    emojis: ["🎉","🎊","✨","⭐","🌟","💫","🔥","💥","⚡","🏆","🥇","🥈","🥉","🎁","🎈","🎂","🍾","🥂","🎶","🎵","👑","💎","🪩","🎀","🧸","🎯","🧿","🍀"],
  },
  {
    titulo: "Moda e compras",
    emojis: ["👗","👚","👖","👕","👔","👙","🩱","🩳","👘","🥻","🧥","🦺","👒","🧢","👜","👛","🎒","👠","👡","👢","🥿","👞","👟","🥾","🧦","🧤","🧣","👓","🕶️","💍","💄","⌚","💼","🛍️","🛒","🧵","🪡","✂️","🧶","📦","🚚","✈️","🏭","🏬","🏠"],
  },
  {
    titulo: "Dinheiro",
    emojis: ["💰","💵","💴","💶","💳","🪙","🤑","🏷️","💸","🧾","📈","📊","💲","🏦","🔖"],
  },
  {
    titulo: "Comidas e bebidas",
    emojis: ["☕","🍵","🥤","🧉","🍷","🍹","🍺","🍫","🍰","🧁","🍩","🍪","🍓","🍒","🍉","🍇","🥐","🍞","🍕","🍔","🌭","🍟","🥗","🍝","🍦","🍯"],
  },
  {
    titulo: "Natureza e clima",
    emojis: ["☀️","🌤️","⛅","🌧️","⛈️","🌈","❄️","🌙","🌛","🌊","💧","🌸","🌹","🌺","🌻","🌷","🌼","💐","🍃","🌿","☘️","🌴","🌵","🦋","🐝","🐞","🐱","🐶","🦄"],
  },
  {
    titulo: "Símbolos e dia a dia",
    emojis: ["✅","☑️","✔️","❌","✖️","⚠️","❗","‼️","❓","💯","🆗","🆕","🆙","🔝","🔜","📌","📍","📎","🔔","🔕","⏰","⌛","⏳","📅","🗓️","📆","📞","☎️","📱","💬","🗨️","✉️","📩","📤","📥","📝","✏️","🖊️","🔍","🔒","🔓","🔑","💡","📸","📷","🎥","📣","📢","🔗","♻️","🚫","🔞","💤","🌀","➕","➖","➡️","⬅️","⬆️","⬇️","↩️","🔄"],
  },
];

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
  if (m.mediaType === "VIDEO" && m.mediaUrl) {
    return (
      <video
        src={m.mediaUrl}
        controls
        className="rounded-xl max-w-full w-56 mb-1 bg-black/20"
      />
    );
  }
  if (m.mediaType === "AUDIO") {
    // áudio real toca no player; sem URL (histórico antigo) mostra a onda
    return m.mediaUrl ? (
      <audio src={m.mediaUrl} controls className="my-1 w-56 max-w-full" />
    ) : (
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
    const inner = (
      <span className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 mb-1">
        <File className="size-4 shrink-0" />
        <span className="text-xs font-medium truncate">
          {m.fileName ?? "documento"}
        </span>
      </span>
    );
    return m.mediaUrl ? (
      <a href={m.mediaUrl} download={m.fileName ?? "arquivo"} className="block">
        {inner}
      </a>
    ) : (
      inner
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

/** Mensagem padrão do botão "enviar link do catálogo" ({nome}/{link} trocados). */
const CATALOG_MSG_PADRAO =
  "Oi {nome}! 💜 Montei um catálogo pra você dar uma olhada com calma:\n{link}";

/** Mensagem padrão de confirmação ao montar um pedido ({nome}/{pedido}/{total}). */
const ORDER_MSG_PADRAO =
  "Prontinho {nome}! 💜 Montei seu pedido {pedido} — total {total}. Te enviei o orçamento em PDF, qualquer ajuste é só me falar!";

export function Inbox({
  conversations,
  templates: templatesProp,
  team,
  setores,
  allTags,
  currentUserId,
  currentUserName,
  catalogMsg,
  orderMsg,
  canEditCatalogMsg,
}: {
  conversations: InboxConversation[];
  templates: { id: string; title: string; body: string; category: string }[];
  team: { id: string; name: string; color: string }[];
  setores: { id: string; name: string; color: string }[];
  allTags: Tag[];
  currentUserId: string;
  currentUserName: string;
  catalogMsg: string | null;
  orderMsg: string | null;
  canEditCatalogMsg: boolean;
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
  const [showEmoji, setShowEmoji] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [slash, setSlash] = useState<{ query: string; at: number } | null>(null);
  const [sending, setSending] = useState(false);
  // respostas rápidas (qualquer um da equipe cria pela própria tela)
  const [templates, setTemplates] = useState(templatesProp);
  const [showNewTpl, setShowNewTpl] = useState(false);
  const [newTplTitle, setNewTplTitle] = useState("");
  const [newTplBody, setNewTplBody] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  // editar / apagar mensagem enviada (menu estilo WhatsApp: segurar em cima)
  const [actionMsg, setActionMsg] = useState<InboxMessage | null>(null);
  // "responder": mensagem marcada para citação (prévia acima do compositor)
  const [replyMsg, setReplyMsg] = useState<InboxMessage | null>(null);
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editMsgDraft, setEditMsgDraft] = useState("");
  // mensagens automáticas personalizáveis (link do catálogo + confirmação de pedido)
  const [catMsg, setCatMsg] = useState<string | null>(catalogMsg);
  const [ordMsg, setOrdMsg] = useState<string | null>(orderMsg);
  const [showCatMsgEdit, setShowCatMsgEdit] = useState(false);
  const [catMsgDraft, setCatMsgDraft] = useState("");
  const [ordMsgDraft, setOrdMsgDraft] = useState("");
  const [savingCatMsg, setSavingCatMsg] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileKindRef = useRef<"IMAGE" | "VIDEO" | "DOCUMENT">("IMAGE");
  // gravação de áudio (voz)
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recCancelRef = useRef(false);

  const selected = convs.find((c) => c.id === selectedId) ?? null;

  // campo de mensagem cresce conforme o texto (até ~7 linhas)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  }, [draft, noteMode, selectedId]);

  async function salvarCatMsg(catalogVal: string | null, orderVal: string | null) {
    setSavingCatMsg(true);
    const res = await fetch("/api/comm/catalog-msg", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogLinkMsg: catalogVal, orderMsg: orderVal }),
    });
    setSavingCatMsg(false);
    if (res.ok) {
      setCatMsg(catalogVal);
      setOrdMsg(orderVal);
      setShowCatMsgEdit(false);
    }
  }

  // tela ocupa 100% do espaço útil: mede onde ela começa (pode ter a faixa
  // amarela de Super Admin em cima) e estica até o rodapé da janela
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + (window.scrollY || 0);
      el.style.setProperty("--inbox-top", `${Math.max(0, Math.round(top))}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // popovers do compositor (respostas rápidas, anexar, nova resposta, msg do
  // catálogo) fecham ao clicar em qualquer área fora deles
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const aberto =
      showTemplates || showAttach || showNewTpl || showCatMsgEdit || showEmoji;
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
        setShowAttach(false);
        setShowNewTpl(false);
        setShowCatMsgEdit(false);
        setShowEmoji(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showTemplates, showAttach, showNewTpl, showCatMsgEdit, showEmoji]);

  // insere o emoji na posição do cursor (e devolve o foco ao campo)
  function insertEmoji(emoji: string) {
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? draft.length;
    setDraft(draft.slice(0, pos) + emoji + draft.slice(pos));
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        const p = pos + emoji.length;
        ta.setSelectionRange(p, p);
      }
    });
  }

  // menu de etiquetas fecha ao clicar em qualquer lugar fora dele
  const tagPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showTagPicker) return;
    function onDown(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node))
        setShowTagPicker(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showTagPicker]);

  // fila = sem responsável e não encerrada; chats = em atendimento (com
  // responsável, não encerrada); contatos = histórico (encerradas).
  const bucketOf = (c: InboxConversation): Tab =>
    c.status === "CLOSED" ? "contatos" : c.assignee ? "chats" : "fila";

  const counts = useMemo(() => {
    const acc = { chats: 0, fila: 0, contatos: 0 };
    for (const c of convs) acc[bucketOf(c)]++;
    return acc;
  }, [convs]);

  // próximo chamado da fila (quem espera há mais tempo) — atalho da tela vazia
  const proximoFila = useMemo(() => {
    return convs
      .filter((c) => bucketOf(c) === "fila")
      .sort(
        (a, b) =>
          new Date(a.lastInboundAt ?? a.createdAt).getTime() -
          new Date(b.lastInboundAt ?? b.createdAt).getTime()
      )[0];
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

  // --- Tempo real: consulta o servidor a cada 4s e traz só o que mudou ---
  // (mensagem nova do cliente, recibos ✓✓, transferências...). Aba em segundo
  // plano não consulta; ao voltar o foco, sincroniza na hora.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const lastSyncRef = useRef(new Date(Date.now() - 60_000).toISOString());
  useEffect(() => {
    let alive = true;
    let busy = false;
    async function sync() {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(
          `/api/conversations?since=${encodeURIComponent(lastSyncRef.current)}`
        );
        if (!res.ok) return;
        const d: { now?: string; conversations?: InboxConversation[] } =
          await res.json();
        if (!alive || !d.conversations) return;
        // próxima busca ancorada no relógio do servidor, com folga de 10s
        if (d.now)
          lastSyncRef.current = new Date(
            new Date(d.now).getTime() - 10_000
          ).toISOString();
        if (d.conversations.length === 0) return;
        const fresh = d.conversations;
        const selId = selectedIdRef.current;
        setConvs((prev) => {
          const freshById = new Map(fresh.map((c) => [c.id, c]));
          const merged = prev.map((p) => {
            const f = freshById.get(p.id);
            if (!f) return p;
            freshById.delete(p.id);
            // preserva mensagem recém-enviada que o servidor ainda não devolveu
            const ids = new Set(f.messages.map((m) => m.id));
            const extra = p.messages.filter((m) => {
              if (ids.has(m.id)) return false;
              // bolha otimista (ainda "temp-") já confirmada pelo servidor:
              // se o sync trouxe a mesma mensagem (sentido+texto), descarta a temp
              if (
                m.id.startsWith("temp-") &&
                f.messages.some(
                  (fm) =>
                    fm.direction === m.direction &&
                    fm.kind === m.kind &&
                    fm.body === m.body
                )
              )
                return false;
              return true;
            });
            return {
              ...f,
              messages: extra.length
                ? [...f.messages, ...extra].sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt)
                  )
                : f.messages,
              unreadCount: f.id === selId ? 0 : f.unreadCount,
            };
          });
          return [...merged, ...freshById.values()]; // novas conversas entram
        });
        // conversa aberta recebeu mensagem → já marca como lida no servidor
        const sel = fresh.find((c) => c.id === selId);
        if (sel && sel.unreadCount > 0) {
          fetch(`/api/conversations/${sel.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ markRead: true }),
          });
        }
      } catch {
        // rede oscilou — tenta de novo no próximo tick
      } finally {
        busy = false;
      }
    }
    // Em segundo plano (aba oculta / app minimizado) o polling PARA — não
    // gasta bateria do celular nem cota do servidor com ninguém olhando.
    // Ao voltar, sincroniza na hora (a conversa "chega" instantânea).
    function tick() {
      if (document.visibilityState === "hidden") return;
      void sync();
    }
    function onVisible() {
      if (document.visibilityState === "visible") void sync();
    }
    const timer = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectConv(id: string) {
    setSelectedId(id);
    setShowTransfer(false);
    setShowTagPicker(false);
    setMention(null);
    setSlash(null);
    setReplyMsg(null); // resposta marcada era da conversa anterior
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

  /**
   * Envio OTIMISTA: a bolha aparece na conversa NA HORA (com relógio ⏱️) e o
   * envio real acontece em segundo plano — quando o servidor confirma, a bolha
   * vira ✓ (ou ⚠️ se falhar). Assim a tela nunca "trava" esperando o WhatsApp.
   */
  async function sendPayload(payload: Record<string, unknown>) {
    if (!selected) return false;
    const convId = selected.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // prévia da mensagem citada (quando é uma resposta)
    const citada = payload.replyToId
      ? selected.messages.find((x) => x.id === payload.replyToId)
      : null;
    const replyPreview = citada
      ? { id: citada.id, body: citada.body.slice(0, 140), direction: citada.direction }
      : null;

    // 1) mostra a bolha imediatamente (status ENVIANDO)
    appendMessage(convId, {
      id: tempId,
      replyTo: replyPreview,
      direction: "OUT",
      kind: (payload.kind as InboxMessage["kind"]) ?? "TEXT",
      mediaType: (payload.mediaType as InboxMessage["mediaType"]) ?? "TEXT",
      mediaUrl: (payload.mediaUrl as string) ?? null,
      fileName: (payload.fileName as string) ?? null,
      status: "ENVIANDO",
      error: null,
      body: (payload.body as string) ?? "",
      authorName: currentUserName,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      editedAt: null,
      revoked: false,
      revokedBy: null,
    });

    // enviar mensagem em conversa da fila = assumir o atendimento (visual já)
    if (!selected.assignee) {
      patchLocal(convId, {
        assignee: { id: currentUserId, name: currentUserName, color: "#c4622d" },
      });
      updateConv(convId, { assigneeId: currentUserId }, true);
    }

    // troca a bolha temporária pela real (ou marca falha), sem duplicar
    const reconciliar = (real: InboxMessage | null, falhou: boolean) =>
      setConvs((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const messages = c.messages
            .map((m) =>
              m.id === tempId
                ? real ??
                  { ...m, status: "FALHOU", error: "Não foi possível enviar. Toque em Reenviar." }
                : m
            )
            // se o sync já trouxe a real, remove qualquer duplicata por id
            .filter(
              (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
            );
          return { ...c, messages, ...(falhou ? {} : {}) };
        })
      );

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const msg = await res.json();
        reconciliar(
          {
            id: msg.id,
            replyTo: replyPreview,
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
            deliveredAt: msg.deliveredAt ?? null,
            readAt: msg.readAt ?? null,
            editedAt: msg.editedAt ?? null,
            revoked: msg.revoked ?? false,
            revokedBy: msg.revokedBy ?? null,
          },
          false
        );
        return true;
      }
      reconciliar(null, true);
      return false;
    } catch {
      reconciliar(null, true);
      return false;
    }
  }

  function sendMessage() {
    const body = draft.trim();
    if (!body) return;
    const kind = noteMode ? "NOTE" : "TEXT";
    const respondendo = !noteMode ? replyMsg : null;
    // limpa o campo NA HORA — sensação de instantâneo, sem esperar o servidor
    setDraft("");
    setNoteMode(false);
    setMention(null);
    setSlash(null);
    setReplyMsg(null);
    void sendPayload({
      body,
      kind,
      ...(respondendo ? { replyToId: respondendo.id } : {}),
    });
  }

  // "pressionar e segurar" (celular) abre o menu de ações da mensagem
  function startLongPress(m: InboxMessage) {
    cancelLongPress();
    lpTimerRef.current = setTimeout(() => setActionMsg(m), 450);
  }
  function cancelLongPress() {
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }
  }

  async function apagarParaTodos(messageId: string) {
    if (!selected) return;
    if (
      !window.confirm(
        "Apagar esta mensagem para o cliente? Ela some do WhatsApp dele. Aqui no sistema ela fica registrada como apagada (você ainda vê o que era)."
      )
    )
      return;
    setActionMsg(null);
    const convId = selected.id;
    const res = await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
    if (res.ok) {
      setConvs((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, revoked: true, revokedBy: "STORE" } : m
                ),
              }
            : c
        )
      );
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Não foi possível apagar.");
    }
  }

  async function salvarEdicao(messageId: string) {
    if (!selected) return;
    const body = editMsgDraft.trim();
    if (!body) return;
    const convId = selected.id;
    const res = await fetch(`/api/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      setConvs((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? { ...m, body, editedAt: new Date().toISOString() }
                    : m
                ),
              }
            : c
        )
      );
      setEditingMsgId(null);
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Não foi possível editar.");
    }
  }

  async function resend(messageId: string) {
    if (!selected) return;
    // bolha otimista que nem chegou ao servidor (falha de rede): remove a
    // bolha falha e reenvia do zero, em vez de chamar o resend por id
    if (messageId.startsWith("temp-")) {
      const m = selected.messages.find((x) => x.id === messageId);
      if (!m) return;
      setConvs((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? { ...c, messages: c.messages.filter((x) => x.id !== messageId) }
            : c
        )
      );
      void sendPayload({
        body: m.body,
        kind: m.kind,
        ...(m.mediaType !== "TEXT"
          ? {
              mediaType: m.mediaType,
              mediaUrl: m.mediaUrl ?? undefined,
              fileName: m.fileName ?? undefined,
            }
          : {}),
      });
      return;
    }
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

  // cria uma resposta rápida direto da tela (qualquer vendedor/suporte pode)
  async function criarTemplate() {
    const title = newTplTitle.trim();
    const body = newTplBody.trim();
    if (!title || !body) return;
    setSavingTpl(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, category: "OUTRO" }),
    });
    setSavingTpl(false);
    if (res.ok) {
      const created = await res.json();
      setTemplates((prev) => [
        ...prev,
        { id: created.id, title: created.title, body: created.body, category: created.category },
      ]);
      setNewTplTitle("");
      setNewTplBody("");
      setShowNewTpl(false);
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Não foi possível criar.");
    }
  }

  // ---- Link rastreável do catálogo do cliente ----
  // Insere na mensagem o link personalizado que rastreia o comportamento
  // DESTE cliente no catálogo (leva o ref do vendedor logado).
  function inserirLinkCatalogo() {
    if (!selected) return;
    const nome = selected.customer.name.split(" ")[0];
    const link = selected.customer.catalogLink;
    // já tinha texto digitado → só anexa o link; vazio → usa a mensagem da
    // loja (personalizável no ✏️ ao lado) trocando {nome} e {link}
    let msg: string;
    if (draft.trim()) {
      msg = `${draft.trim()}\n${link}`;
    } else {
      const modelo = (catMsg?.trim() || CATALOG_MSG_PADRAO)
        .replaceAll("{nome}", nome)
        .replaceAll("{link}", link);
      msg = modelo.includes(link) ? modelo : `${modelo}\n${link}`;
    }
    setDraft(msg);
    setSlash(null);
    taRef.current?.focus();
  }

  // ---- Envio de mídia real (imagem/vídeo/documento) ----
  function pickFile(kind: "IMAGE" | "VIDEO" | "DOCUMENT") {
    setShowAttach(false);
    fileKindRef.current = kind;
    if (fileRef.current) {
      fileRef.current.accept =
        kind === "IMAGE" ? "image/*" : kind === "VIDEO" ? "video/*" : "*/*";
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  const blobToDataUrl = (b: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(b);
    });

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    const kind = fileKindRef.current;
    // vídeo pode ser bem maior; imagem/arquivo mantemos leve
    const limitMb = kind === "VIDEO" ? 16 : 5;
    if (file.size > limitMb * 1024 * 1024) {
      alert(`Arquivo muito grande (máximo ${limitMb} MB).`);
      return;
    }
    const dataUrl = await blobToDataUrl(file);
    await sendPayload({
      kind: "TEXT",
      mediaType: kind,
      mediaUrl: dataUrl,
      fileName: file.name,
      body:
        kind === "IMAGE" ? "📷 Imagem" : kind === "VIDEO" ? "🎬 Vídeo" : `📎 ${file.name}`,
    });
  }

  // ---- Gravação de áudio (voz) ----
  async function startRecording() {
    if (!selected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunksRef.current = [];
      recCancelRef.current = false;
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        setRecording(false);
        setRecSecs(0);
        if (recCancelRef.current || recChunksRef.current.length === 0) return;
        const original = new Blob(recChunksRef.current, {
          type: recChunksRef.current[0]?.type || "audio/webm",
        });
        // o navegador grava SEM a duração dentro do arquivo → o WhatsApp
        // mostrava o áudio com 0:00. O WAV carrega a duração no cabeçalho.
        // Se a conversão falhar, envia o original (áudio sem tempo é melhor
        // que áudio nenhum).
        const TETO = 8 * 1024 * 1024;
        const convertido = await gravacaoParaWav(original);
        const blob = convertido && convertido.size <= TETO ? convertido : original;
        if (blob.size > TETO) {
          alert("Áudio muito longo (máximo ~8 MB).");
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        await sendPayload({
          kind: "TEXT",
          mediaType: "AUDIO",
          mediaUrl: dataUrl,
          body: "🎤 Áudio",
        });
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      alert("Não consegui acessar o microfone. Verifique a permissão do navegador.");
    }
  }
  function stopRecording(cancel: boolean) {
    recCancelRef.current = cancel;
    recRef.current?.stop();
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
    <>
    <div
      ref={shellRef}
      className="flex overflow-hidden bg-white -mx-4 -mt-4 -mb-24 h-[calc(100dvh-120px-var(--kb,0px))] rounded-none border-0 shadow-none md:-mx-8 md:-mt-8 md:-mb-8 md:h-[calc(100dvh-var(--inbox-top,0px))]"
    >
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
                      {listStamp(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {last
                      ? (last.kind === "NOTE" ? "📝 " : "") + last.body
                      : "Sem mensagens"}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <SetorPill setor={c.setor} />
                    {c.customer.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded-full text-[10px] font-semibold px-1.5 py-0.5"
                        style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
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
          <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto thin-scroll bg-gradient-to-b from-white to-brand-50/40">
            <div className="w-full max-w-md text-center">
              <div className="mx-auto size-16 rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mb-4 shadow-sm">
                <MessageCircle className="size-8" />
              </div>
              <h2 className="text-lg font-bold text-ink">
                Olá, {currentUserName.split(" ")[0]}! 👋
              </h2>
              <p className="text-sm text-gray-500 mt-1 mb-5">
                Escolha uma conversa à esquerda para atender. Veja como está o
                atendimento agora:
              </p>

              {/* resumo do atendimento (clicável) */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <button
                  onClick={() => setTab("fila")}
                  className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-center hover:border-amber-300 transition"
                >
                  <p className="text-2xl font-extrabold text-amber-600 leading-none">
                    {counts.fila}
                  </p>
                  <p className="text-[11px] font-semibold text-amber-700/80 mt-1 flex items-center justify-center gap-1">
                    <InboxIcon className="size-3" /> Na fila
                  </p>
                </button>
                <button
                  onClick={() => setTab("chats")}
                  className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-center hover:border-emerald-300 transition"
                >
                  <p className="text-2xl font-extrabold text-emerald-600 leading-none">
                    {counts.chats}
                  </p>
                  <p className="text-[11px] font-semibold text-emerald-700/80 mt-1 flex items-center justify-center gap-1">
                    <MessageCircle className="size-3" /> Em conversa
                  </p>
                </button>
                <button
                  onClick={() => setTab("contatos")}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center hover:border-gray-300 transition"
                >
                  <p className="text-2xl font-extrabold text-gray-500 leading-none">
                    {counts.contatos}
                  </p>
                  <p className="text-[11px] font-semibold text-gray-500 mt-1 flex items-center justify-center gap-1">
                    <Users className="size-3" /> Contatos
                  </p>
                </button>
              </div>

              {proximoFila ? (
                <button
                  onClick={() => {
                    setTab("fila");
                    selectConv(proximoFila.id);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-2.5 transition shadow-sm"
                >
                  <Hand className="size-4" />
                  Atender próximo da fila
                </button>
              ) : (
                <p className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-medium px-4 py-2">
                  <CheckCircle2 className="size-4" />
                  Fila zerada — tudo em dia! 🎉
                </p>
              )}

              {/* dicas rápidas */}
              <div className="mt-6 text-left space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 px-1">
                  Dicas
                </p>
                {[
                  { icon: <Zap className="size-3.5 text-brand-500" />, t: "Digite / no campo de mensagem para usar respostas rápidas." },
                  { icon: <Link2 className="size-3.5 text-brand-500" />, t: "Envie o link do catálogo já rastreado por cliente." },
                  { icon: <StickyNote className="size-3.5 text-amber-500" />, t: "Deixe notas internas (o cliente não vê) e marque colegas com @." },
                ].map((d, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg bg-white border border-gray-100 px-3 py-2 text-xs text-gray-600"
                  >
                    <span className="mt-0.5 shrink-0">{d.icon}</span>
                    {d.t}
                  </div>
                ))}
              </div>
            </div>
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
                <div className="col-span-2 flex items-center justify-between gap-2 pt-0.5">
                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    Cada mudança já é salva na hora.
                  </p>
                  <button
                    onClick={() => setShowTransfer(false)}
                    className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-1.5 transition"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            )}

            {/* etiquetas (tags) do contato — clicáveis para remover, + para adicionar.
                O menu suspenso fica FORA da faixa com rolagem horizontal para não
                ser cortado por ela (flutua por cima da conversa). */}
            <div ref={tagPickerRef} className="relative border-b border-gray-50 shrink-0">
              <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto thin-scroll">
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
              </div>

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
              {selected.messages.map((m, mIdx, msgsArr) => {
                // separador de DATA (Hoje / Ontem / 23/07) quando o dia muda —
                // sem ele não dava para saber se a conversa foi ontem ou semana passada
                const separador =
                  mIdx === 0 ||
                  dayKey(msgsArr[mIdx - 1].createdAt) !== dayKey(m.createdAt) ? (
                    <div className="flex justify-center py-1">
                      <span className="rounded-full bg-white/90 border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-500 shadow-sm">
                        {dayLabel(m.createdAt)}
                      </span>
                    </div>
                  ) : null;
                if (m.kind === "NOTE") {
                  return (
                    <Fragment key={m.id}>
                    {separador}
                    <div className="flex justify-center">
                      <div className="max-w-[85%] rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                        <p className="flex items-center gap-1 font-semibold mb-0.5">
                          <StickyNote className="size-3" />
                          Nota interna · {m.authorName ?? "equipe"}
                        </p>
                        <span className="whitespace-pre-wrap">{m.body}</span>
                      </div>
                    </div>
                    </Fragment>
                  );
                }
                const mine = m.direction === "OUT";
                const isTemp = m.id.startsWith("temp-");
                const editando = editingMsgId === m.id;
                // recibo curto e detalhado (horário de entregue/visto)
                const reciboCurto = m.readAt
                  ? `Visto ${timeShort(m.readAt)}`
                  : m.deliveredAt
                    ? `Entregue ${timeShort(m.deliveredAt)}`
                    : "";
                const reciboTitle = [
                  `Enviada ${timeShort(m.createdAt)}`,
                  m.deliveredAt ? `Entregue ${timeShort(m.deliveredAt)}` : null,
                  m.readAt ? `Vista ${timeShort(m.readAt)}` : null,
                ]
                  .filter(Boolean)
                  .join("  ·  ");
                // pode editar/apagar: mensagem da loja, de verdade, ainda não apagada
                const podeApagar = mine && !m.revoked && !isTemp && m.status !== "FALHOU";
                const podeEditar =
                  podeApagar && (m.mediaType === "TEXT" || m.mediaType === "TEMPLATE");
                return (
                  <Fragment key={m.id}>
                  {separador}
                  <div
                    className={`group flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    {/* ⋯ no desktop (hover); no celular é "segurar" a bolha */}
                    {mine && !isTemp && !editando && (
                      <button
                        onClick={() => setActionMsg(m)}
                        className="hidden md:block self-center mr-1 p-1 rounded-full text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-500 hover:bg-gray-100 transition"
                        title="Opções da mensagem"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    )}
                    <div
                      onTouchStart={
                        !isTemp && !editando ? () => startLongPress(m) : undefined
                      }
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onContextMenu={
                        !isTemp && !editando
                          ? (e) => {
                              e.preventDefault();
                              setActionMsg(m);
                            }
                          : undefined
                      }
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        mine
                          ? "bg-brand-600 text-white rounded-br-md select-none"
                          : "bg-white text-ink rounded-bl-md"
                      } ${m.revoked ? "opacity-90" : ""}`}
                    >
                      {/* aviso de mensagem apagada (mantém o texto legível) */}
                      {m.revoked && (
                        <p
                          className={`flex items-center gap-1 text-[11px] font-semibold mb-1 ${
                            mine ? "text-white/80" : "text-rose-500"
                          }`}
                        >
                          <Trash2 className="size-3" />
                          {m.revokedBy === "CUSTOMER"
                            ? "Cliente apagou esta mensagem"
                            : "Você apagou para o cliente"}
                        </p>
                      )}

                      {editando ? (
                        <div className="flex flex-col gap-1.5 min-w-[220px]">
                          <textarea
                            autoFocus
                            value={editMsgDraft}
                            onChange={(e) => setEditMsgDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                salvarEdicao(m.id);
                              }
                              if (e.key === "Escape") setEditingMsgId(null);
                            }}
                            rows={2}
                            className="resize-none rounded-lg bg-white/15 text-white placeholder-white/60 px-2 py-1.5 text-sm outline-none border border-white/30"
                          />
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setEditingMsgId(null)}
                              className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-white/80 hover:bg-white/15"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => salvarEdicao(m.id)}
                              className="rounded-lg bg-white text-brand-700 px-3 py-1 text-[11px] font-bold hover:bg-white/90"
                            >
                              Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* caixinha da mensagem citada (resposta específica) */}
                          {m.replyTo && (
                            <div
                              className={`mb-1.5 rounded-lg border-l-[3px] px-2 py-1 text-[11px] leading-snug ${
                                mine
                                  ? "bg-white/15 border-white/60 text-white/85"
                                  : "bg-gray-100 border-brand-400 text-gray-500"
                              }`}
                            >
                              <p className="font-bold">
                                {m.replyTo.direction === "OUT"
                                  ? "Você"
                                  : selected.customer.name.split(" ")[0]}
                              </p>
                              <p className="line-clamp-2 break-words">
                                {m.replyTo.body}
                              </p>
                            </div>
                          )}
                          <MediaContent m={m} />
                          {(m.mediaType === "TEXT" || m.mediaType === "TEMPLATE") && (
                            <p
                              className={`whitespace-pre-wrap break-words ${
                                m.revoked ? "italic opacity-80" : ""
                              }`}
                            >
                              {m.body}
                            </p>
                          )}
                        </>
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
                      {/* pendente há tempo demais (envio em 2º plano sem
                          confirmação): oferece o reenvio em vez de deixar o
                          ⏱️ eterno */}
                      {m.status === "ENVIANDO" &&
                        !isTemp &&
                        Date.now() - new Date(m.createdAt).getTime() > 120_000 && (
                          <div className="flex items-center gap-2 mt-1.5 rounded-lg bg-black/15 px-2 py-1">
                            <span className="text-[10px] flex-1">
                              Envio não confirmado.
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
                      {!editando && (
                        <p
                          title={mine ? reciboTitle : undefined}
                          className={`text-[10px] mt-1 text-right flex items-center gap-1 justify-end flex-wrap ${mine ? "text-white/60" : "text-gray-300"}`}
                        >
                          {mine && m.authorName
                            ? `${m.authorName.split(" ")[0]} · `
                            : ""}
                          {timeShort(m.createdAt)}
                          {m.editedAt && !m.revoked && (
                            <span className="italic">· editada</span>
                          )}
                          <StatusTicks m={m} />
                          {mine && reciboCurto && !m.revoked && (
                            <span className="font-medium">· {reciboCurto}</span>
                          )}
                        </p>
                      )}
                    </div>
                    {/* ⋯ do lado direito para mensagens do CLIENTE (responder) */}
                    {!mine && !isTemp && !editando && (
                      <button
                        onClick={() => setActionMsg(m)}
                        className="hidden md:block self-center ml-1 p-1 rounded-full text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-500 hover:bg-gray-100 transition"
                        title="Opções da mensagem"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    )}
                  </div>
                  </Fragment>
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
            <div ref={composerRef} className="p-3 border-t border-gray-100 shrink-0 relative">
              {/* respondendo mensagem específica: prévia com X para cancelar */}
              {replyMsg && (
                <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-brand-500 bg-brand-50/70 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-brand-700">
                      Respondendo{" "}
                      {replyMsg.direction === "OUT"
                        ? "você"
                        : selected.customer.name.split(" ")[0]}
                    </p>
                    <p className="text-xs text-gray-600 truncate">
                      {replyMsg.mediaType !== "TEXT" && replyMsg.mediaType !== "TEMPLATE"
                        ? "📎 "
                        : ""}
                      {replyMsg.body}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyMsg(null)}
                    className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
                    title="Cancelar resposta"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              {showTemplates && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop max-h-72 overflow-y-auto thin-scroll z-10">
                  <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-2 bg-white border-b border-gray-100">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                      <Zap className="size-3" /> Respostas rápidas
                    </p>
                    <button
                      onClick={() => setShowNewTpl((v) => !v)}
                      className="text-[11px] font-semibold text-brand-600 hover:underline flex items-center gap-1"
                    >
                      <Plus className="size-3" /> nova resposta
                    </button>
                  </div>

                  {/* criar resposta rápida na hora (qualquer um da equipe) */}
                  {showNewTpl && (
                    <div className="px-4 py-3 border-b border-gray-100 bg-brand-50/40 space-y-2">
                      <input
                        value={newTplTitle}
                        onChange={(e) => setNewTplTitle(e.target.value)}
                        placeholder="Atalho (ex: boas-vindas)"
                        className="w-full rounded-lg bg-white border border-gray-200 focus:border-brand-300 px-2.5 py-1.5 text-xs outline-none"
                      />
                      <textarea
                        value={newTplBody}
                        onChange={(e) => setNewTplBody(e.target.value)}
                        rows={2}
                        placeholder="Mensagem... use {{nome}} p/ o nome do cliente e {{vendedora}} p/ o seu"
                        className="w-full resize-none rounded-lg bg-white border border-gray-200 focus:border-brand-300 px-2.5 py-1.5 text-xs outline-none"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setShowNewTpl(false)}
                          className="rounded-lg border border-gray-200 text-gray-500 text-[11px] font-medium px-3 py-1.5 hover:bg-gray-50"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={criarTemplate}
                          disabled={savingTpl || !newTplTitle.trim() || !newTplBody.trim()}
                          className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-semibold px-3.5 py-1.5 disabled:opacity-50"
                        >
                          {savingTpl ? "Salvando…" : "Salvar"}
                        </button>
                      </div>
                    </div>
                  )}

                  {templates.length === 0 && !showNewTpl && (
                    <p className="px-4 py-4 text-xs text-gray-400">
                      Nenhuma resposta rápida ainda. Toque em{" "}
                      <b className="text-brand-600">+ nova resposta</b> para criar a primeira. 👆
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
                    onClick={() => pickFile("VIDEO")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <Film className="size-5 text-rose-500" />
                    <span className="text-[10px] font-medium">Vídeo</span>
                  </button>
                  <button
                    onClick={() => pickFile("DOCUMENT")}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 hover:bg-brand-50 transition"
                  >
                    <File className="size-5 text-sky-600" />
                    <span className="text-[10px] font-medium">Documento</span>
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
                    <button
                      onClick={() => {
                        setSlash(null);
                        setShowTemplates(true);
                        setShowNewTpl(true);
                      }}
                      className="text-[11px] font-semibold text-brand-600 hover:underline flex items-center gap-1"
                    >
                      <Plus className="size-3" /> nova resposta
                    </button>
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
              {/* seletor de emoji 😊 */}
              {showEmoji && (
                <div className="absolute bottom-full left-3 right-3 sm:right-auto sm:w-96 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop z-20 max-h-64 overflow-y-auto thin-scroll p-2">
                  {EMOJI_GROUPS.map((g) => (
                    <div key={g.titulo} className="mb-1.5">
                      <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                        {g.titulo}
                      </p>
                      <div className="flex flex-wrap">
                        {g.emojis.map((e) => (
                          <button
                            key={e}
                            onClick={() => insertEmoji(e)}
                            className="size-9 grid place-items-center text-[22px] rounded-lg hover:bg-brand-50 transition"
                            title={e}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* editor das mensagens automáticas (catálogo + pedido) */}
              {showCatMsgEdit && (
                <div className="absolute bottom-full left-3 right-3 sm:right-auto sm:w-[26rem] mb-1 bg-white rounded-xl border border-gray-100 shadow-pop z-20 p-3 max-h-[70vh] overflow-y-auto thin-scroll">
                  <p className="text-[11px] font-bold text-gray-500 mb-2">
                    Mensagens automáticas
                  </p>

                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1 mb-1.5">
                    <Link2 className="size-3" /> Link do catálogo
                  </p>
                  <textarea
                    value={catMsgDraft}
                    onChange={(e) => setCatMsgDraft(e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="w-full resize-none rounded-lg bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white px-2.5 py-2 text-xs outline-none"
                  />
                  <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                    <b>{"{nome}"}</b> = nome do cliente · <b>{"{link}"}</b> = link
                    do catálogo (se não usar, o link entra no final sozinho).
                  </p>

                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1 mb-1.5 mt-3">
                    <ShoppingBag className="size-3" /> Confirmação de pedido
                  </p>
                  <textarea
                    value={ordMsgDraft}
                    onChange={(e) => setOrdMsgDraft(e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="w-full resize-none rounded-lg bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white px-2.5 py-2 text-xs outline-none"
                  />
                  <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                    <b>{"{nome}"}</b> = cliente · <b>{"{pedido}"}</b> = nº do
                    pedido · <b>{"{total}"}</b> = valor total. O PDF do orçamento
                    é enviado automaticamente junto.
                  </p>

                  <div className="flex items-center justify-between gap-2 mt-3">
                    <button
                      onClick={() => salvarCatMsg(null, null)}
                      disabled={savingCatMsg}
                      className="text-[11px] text-gray-400 hover:text-gray-600 underline underline-offset-2 disabled:opacity-50"
                    >
                      Restaurar padrão
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setShowCatMsgEdit(false)}
                        className="rounded-lg border border-gray-200 text-gray-500 text-xs font-medium px-3 py-1.5 hover:bg-gray-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() =>
                          salvarCatMsg(
                            catMsgDraft.trim() || null,
                            ordMsgDraft.trim() || null
                          )
                        }
                        disabled={savingCatMsg}
                        className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-1.5 transition disabled:opacity-50"
                      >
                        {savingCatMsg ? "Salvando…" : "Salvar"}
                      </button>
                    </div>
                  </div>
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
                className={`flex flex-col sm:flex-row sm:items-end gap-1.5 rounded-2xl border px-2 py-1.5 transition ${
                  noteMode
                    ? "border-amber-300 bg-amber-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                {/* no celular a barra de ícones vai para baixo do campo de texto */}
                <div className="flex items-center gap-0.5 order-2 sm:order-none shrink-0">
                <button
                  onClick={() => {
                    setShowEmoji((v) => !v);
                    setShowTemplates(false);
                    setShowAttach(false);
                  }}
                  className={`p-2 transition shrink-0 ${
                    showEmoji ? "text-brand-600" : "text-gray-400 hover:text-brand-600"
                  }`}
                  title="Emoji"
                >
                  <Smile className="size-4.5" />
                </button>
                <button
                  onClick={() => {
                    setShowTemplates((v) => !v);
                    setShowAttach(false);
                    setShowEmoji(false);
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
                  title="Anexar foto, vídeo ou arquivo"
                >
                  <Paperclip className="size-4.5" />
                </button>
                <button
                  onClick={startRecording}
                  disabled={recording}
                  className="p-2 text-gray-400 hover:text-emerald-600 transition shrink-0 disabled:opacity-40"
                  title="Gravar áudio"
                >
                  <Mic className="size-4.5" />
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
                {canEditCatalogMsg && (
                  <button
                    onClick={() => {
                      setCatMsgDraft(catMsg ?? CATALOG_MSG_PADRAO);
                      setOrdMsgDraft(ordMsg ?? ORDER_MSG_PADRAO);
                      setShowCatMsgEdit((v) => !v);
                      setShowTemplates(false);
                      setShowAttach(false);
                    }}
                    className={`p-1 -ml-1.5 transition shrink-0 ${
                      showCatMsgEdit ? "text-brand-600" : "text-gray-300 hover:text-brand-600"
                    }`}
                    title="Personalizar as mensagens automáticas (catálogo e pedido)"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
                <button
                  onClick={() => setShowOrder(true)}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0"
                  title="Adicionar produto ao pedido"
                >
                  <ShoppingBag className="size-4.5" />
                </button>
                </div>
                <div className="flex items-end gap-1.5 order-1 sm:order-none sm:flex-1 min-w-0">
                {recording ? (
                  <div className="flex-1 flex items-center gap-2 py-1.5">
                    <span className="size-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span className="text-sm font-medium text-rose-600 tabular-nums">
                      Gravando… {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}
                    </span>
                    <span className="flex-1" />
                    <button
                      onClick={() => stopRecording(true)}
                      className="p-2 rounded-xl text-gray-400 hover:text-rose-600 transition shrink-0"
                      title="Cancelar"
                    >
                      <Trash2 className="size-4.5" />
                    </button>
                    <button
                      onClick={() => stopRecording(false)}
                      className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition shrink-0"
                      title="Enviar áudio"
                    >
                      <Send className="size-4" />
                    </button>
                  </div>
                ) : (
                <>
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
                  rows={2}
                  placeholder={
                    noteMode
                      ? "Nota interna... use @ para marcar alguém"
                      : "Escrever mensagem... (/ para respostas rápidas)"
                  }
                  className="flex-1 resize-none bg-transparent text-sm outline-none py-2 max-h-48"
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
                </>
                )}
                </div>
              </div>
            </div>

            {showOrder && (
              <OrderComposer
                customerId={selected.customer.id}
                customerName={selected.customer.name}
                wholesaleCustomer={selected.customer.wholesale}
                conversationId={selected.id}
                onClose={() => setShowOrder(false)}
                onCreated={async (order) => {
                  setShowOrder(false);
                  const pedido = orderNumber(order.number);
                  const total = `R$ ${order.total.toFixed(2).replace(".", ",")}`;
                  const nome = selected.customer.name.split(" ")[0];
                  // registro interno (nota) de que o pedido foi criado
                  appendMessage(selected.id, {
                    id: `local-${order.id}`,
                    direction: "OUT",
                    kind: "NOTE",
                    mediaType: "TEXT",
                    mediaUrl: null,
                    fileName: null,
                    status: "ENVIADA",
                    error: null,
                    body: `🛍️ Pedido ${pedido} criado — total ${total}`,
                    authorName: currentUserName,
                    createdAt: new Date().toISOString(),
                    deliveredAt: null,
                    readAt: null,
                    editedAt: null,
                    revoked: false,
                    revokedBy: null,
                  });
                  // mensagem de confirmação (personalizável) já pronta no campo
                  setDraft(
                    (ordMsg?.trim() || ORDER_MSG_PADRAO)
                      .replaceAll("{nome}", nome)
                      .replaceAll("{pedido}", pedido)
                      .replaceAll("{total}", total)
                  );
                  // ENVIA o PDF do orçamento de verdade (documento no WhatsApp)
                  try {
                    const pdfRes = await fetch(`/api/orders/${order.id}/pdf`);
                    if (pdfRes.ok) {
                      const dataUrl = await blobToDataUrl(await pdfRes.blob());
                      await sendPayload({
                        kind: "TEXT",
                        mediaType: "DOCUMENT",
                        mediaUrl: dataUrl,
                        fileName: `orcamento-${pedido}.pdf`,
                        body: `📄 Orçamento ${pedido}`,
                      });
                    }
                  } catch {
                    // se falhar o PDF, a mensagem de texto ainda fica no campo
                  }
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

    {/* folha de ações da mensagem (segurar no celular / ⋯ no computador):
        sobe de baixo no celular, centralizada no computador — nunca corta */}
    {actionMsg && (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 animate-fade-in"
        onClick={() => setActionMsg(null)}
      >
        <div
          className="w-full sm:max-w-xs bg-white rounded-t-2xl sm:rounded-2xl shadow-pop p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-3 pt-2 pb-1 text-[11px] text-gray-400 line-clamp-2">
            “{actionMsg.body}”
          </p>
          {/* Responder: qualquer mensagem (sua ou do cliente) */}
          {actionMsg.kind !== "NOTE" && (
            <button
              onClick={() => {
                setReplyMsg(actionMsg);
                setActionMsg(null);
                taRef.current?.focus();
              }}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Reply className="size-4 text-brand-600" /> Responder
            </button>
          )}
          {/* editar/apagar: só mensagem SUA, de verdade e não apagada */}
          {actionMsg.direction === "OUT" &&
            !actionMsg.revoked &&
            actionMsg.status !== "FALHOU" &&
            (actionMsg.mediaType === "TEXT" || actionMsg.mediaType === "TEMPLATE") && (
              <button
                onClick={() => {
                  setEditingMsgId(actionMsg.id);
                  setEditMsgDraft(actionMsg.body);
                  setActionMsg(null);
                }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="size-4 text-gray-400" /> Editar mensagem
              </button>
            )}
          {actionMsg.direction === "OUT" &&
            !actionMsg.revoked &&
            actionMsg.status !== "FALHOU" && (
              <button
                onClick={() => apagarParaTodos(actionMsg.id)}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="size-4" /> Apagar para o cliente
              </button>
            )}
          <button
            onClick={() => setActionMsg(null)}
            className="w-full rounded-xl px-3 py-3 text-center text-sm font-semibold text-gray-500 hover:bg-gray-50 mt-1 border-t border-gray-100"
          >
            Cancelar
          </button>
        </div>
      </div>
    )}
    </>
  );
}
