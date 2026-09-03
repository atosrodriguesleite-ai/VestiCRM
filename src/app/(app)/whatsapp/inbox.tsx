"use client";

/* eslint-disable @next/next/no-img-element */

import { Fragment, useCallback, useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { moverTemplate } from "@/lib/templates-ordem";
import {
  Send,
  StickyNote,
  ChevronUp,
  ChevronDown,
  UserCheck,
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
  Loader2,
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
  Forward,
  Film,
  Trash2,
  Pencil,
  MoreVertical,
  Pin,
  Star,
  Ban,
  MailOpen,
  Copy,
  PackageOpen,
} from "lucide-react";
import { OrderComposer } from "@/components/order-composer";
import { contadorAoMarcarNaoLida } from "@/lib/comm/fila";
import { copiarTexto, legendaDaMidia, textoDaMensagem } from "@/lib/copiar";
import { ContactPanel } from "./contact-panel";
import { SeletorDeEmoji } from "./seletor-de-emoji";
import { orderNumber } from "@/lib/orders";
import {
  formatPhone,
  timeShort,
  dateShort,
  conversationStatusLabel,
  templateCategoryLabel,
  relativeDays,
} from "@/lib/format";
import { autoriaDaMensagem, prefixoDaPrevia } from "@/lib/comm/autoria";
import { abaDaConversa } from "@/lib/comm/fila";
import { casaCliente, type MensagemAchada } from "@/lib/busca";
import {
  listaEstaEscondida,
  lugarParaVoltar,
  mostraAtalhoDaLista,
  sentidoDoAtalho,
  vaiDevolverOLugar,
  vaiGuardarOLugar,
} from "@/lib/lugar-na-lista";
import { linkParaSalvar } from "@/lib/midia-arquivo";
import { EncaminharMensagem } from "./encaminhar";
import { MenuDaConversa } from "./menu-da-conversa";
import {
  CHAVE_MICROFONE,
  MS_ASSENTAR_MICROFONE,
  restricoesDeAudio,
  microfoneSumiu,
  nomeCurtoDoMicrofone,
} from "@/lib/microfone";
import { EscolherMicrofone } from "./escolher-microfone";
import { pausarOsOutros } from "@/lib/um-som-por-vez";
import { Avatar, EmptyState } from "@/components/ui";
import { gravacaoParaWav, TETO_AUDIO_BYTES } from "@/lib/audio-wav";
import { comprimirFoto, nomeJpeg, TETO_FOTOS_DE_UMA_VEZ } from "@/lib/comprimir-foto";
import { Portal } from "@/components/portal";

/**
 * Os emojis de reação — os mesmos seis do aplicativo do WhatsApp.
 *
 * Seis é o que cabe numa fileira no celular sem virar rolagem, e são os que
 * resolvem 99% dos casos do balcão: "recebi", "gostei", "que pena", "combinado".
 */
const EMOJIS_REACAO = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

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
  /** emoji com que a CLIENTE reagiu a esta mensagem */
  reaction: string | null;
  /** emoji com que a LOJA reagiu a esta mensagem */
  reactionStore: string | null;
  /** RN-028: o arquivo existe no WhatsApp e ainda está vindo para cá */
  mediaPending?: boolean;
  /** RN-028: o arquivo não vem mais — por quê (para a bolha não mentir) */
  mediaErro?: string | null;
};

export type InboxConversation = {
  id: string;
  channel: string;
  status: "OPEN" | "WAITING_CLIENT" | "WAITING_PAYMENT" | "CLOSED";
  priority: "BAIXA" | "NORMAL" | "ALTA";
  unreadCount: number;
  /** fixada no topo da lista */
  pinned: boolean;
  /** marcada como favorita */
  favorite: boolean;
  lastMessageAt: string;
  createdAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    photoUrl?: string | null;
    /** bloqueada no WhatsApp da loja (nulo = não está) */
    blockedAt?: string | null;
    waName?: string | null;
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

/**
 * UM SOM DE CADA VEZ: começou a tocar um áudio/vídeo, o que estava tocando
 * na tela para. O player do navegador não faz isso sozinho — dois áudios
 * abertos saíam juntos e não dava para entender nenhum (relato do dono,
 * 21/08/2026). A regra em si mora em lib/um-som-por-vez.ts.
 */
function umSomPorVez(e: React.SyntheticEvent<HTMLMediaElement>) {
  pausarOsOutros(
    e.currentTarget,
    document.querySelectorAll<HTMLMediaElement>("audio, video")
  );
}

function MediaContent({
  m,
  aoAbrirFoto,
}: {
  m: InboxMessage;
  /** clique na foto abre o visor em tela cheia (com zoom) */
  aoAbrirFoto?: (src: string) => void;
}) {
  // ARQUIVO A CAMINHO OU QUE NÃO CHEGOU (RN-028).
  //
  // Antes, mídia sem arquivo virava uma bolha muda: a vendedora via um texto
  // seco e não sabia se faltava algo, se tinha falhado ou se era para
  // esperar. Agora a bolha DIZ em que pé está — e o sistema segue buscando
  // sozinho enquanto disser "chegando".
  if (m.mediaType !== "TEXT" && !m.mediaUrl && (m.mediaPending || m.mediaErro)) {
    return (
      <span className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 mb-1 text-xs">
        {m.mediaPending ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span>Arquivo chegando…</span>
          </>
        ) : (
          <>
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              O arquivo não chegou — abra o WhatsApp para vê-lo
              {m.fileName ? ` (${m.fileName})` : ""}
            </span>
          </>
        )}
      </span>
    );
  }
  if (m.mediaType === "IMAGE" && m.mediaUrl) {
    return (
      <img
        src={m.mediaUrl}
        alt="Imagem"
        onClick={aoAbrirFoto ? () => aoAbrirFoto(m.mediaUrl!) : undefined}
        className={`rounded-xl max-w-full w-52 mb-1${aoAbrirFoto ? " cursor-zoom-in" : ""}`}
      />
    );
  }
  if (m.mediaType === "VIDEO" && m.mediaUrl) {
    return (
      <video
        src={m.mediaUrl}
        controls
        onPlay={umSomPorVez}
        className="rounded-xl max-w-full w-56 mb-1 bg-black/20"
      />
    );
  }
  if (m.mediaType === "AUDIO") {
    // áudio real toca no player; sem URL (histórico antigo) mostra a onda
    return m.mediaUrl ? (
      <audio
        src={m.mediaUrl}
        controls
        onPlay={umSomPorVez}
        className="my-1 w-56 max-w-full"
      />
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
      // target="_blank": no aplicativo instalado (PWA), abrir o PDF na mesma
      // tela ENGOLIA o app — o documento tomava tudo, sem botão de voltar, e
      // só fechando o aplicativo inteiro se saía (relato de 06/08/2026).
      // Em janela própria o celular mostra o "Concluído"/X do sistema.
      <a
        href={m.mediaUrl}
        target="_blank"
        rel="noopener"
        download={m.fileName ?? "arquivo"}
        className="block"
      >
        {inner}
      </a>
    ) : (
      inner
    );
  }
  return null;
}

/**
 * VISOR DE FOTO EM TELA CHEIA — como no aplicativo do WhatsApp.
 *
 * A cliente manda a foto da peça e a vendedora precisa VER: estampa, costura,
 * etiqueta. A miniatura de 208px não mostra nada disso. Toque na foto abre
 * grande; toque de novo dá zoom (e dá para arrastar/rolar na foto ampliada);
 * Esc, o X ou o fundo fecham. Tem download para guardar a referência.
 */
function VisorDeFoto({
  src,
  legenda,
  onClose,
}: {
  src: string;
  legenda: string;
  onClose: () => void;
}) {
  const [ampliada, setAmpliada] = useState(false);
  // A FOTO PODE NÃO CARREGAR. O link da foto de perfil que o WhatsApp serve
  // VENCE, e a foto que a cliente mandou pode ter sumido do servidor. Sem
  // isto o visor abria em preto com um ícone de imagem quebrada e ninguém
  // entendia o que tinha acontecido.
  const [quebrou, setQuebrou] = useState(false);
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[95] bg-black/95 animate-fade-in">
      {/* a foto (rolável quando ampliada) fica POR BAIXO dos botões */}
      <div
        className="absolute inset-0 overflow-auto flex"
        onClick={(e) => {
          // toque no FUNDO fecha; na foto, quem trata é a própria foto
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {quebrou ? (
          <p className="m-auto max-w-xs px-6 text-center text-sm text-white/80">
            Não consegui carregar esta foto. O link do WhatsApp costuma vencer
            depois de alguns dias — abra a conversa no aplicativo para vê-la.
          </p>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt="Foto"
            onError={() => setQuebrou(true)}
            onClick={() => setAmpliada((z) => !z)}
            className={
              ampliada
                ? "m-auto max-w-none cursor-zoom-out"
                : "m-auto max-h-full max-w-full object-contain cursor-zoom-in"
            }
            style={ampliada ? { width: "220%" } : undefined}
          />
        )}
      </div>
      {/* BOTÕES SEMPRE VISÍVEIS: flutuam por cima da foto (mesmo ampliada) e
          com folga do relógio/câmera do celular (safe-area) — presos numa
          barra, ficavam escondidos atrás da barra de status do aparelho */}
      <div
        className="absolute right-3 z-10 flex gap-2"
        style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        {/* FOTO DA CONVERSA: baixa de verdade (é do nosso endereço, e o
            `?baixar=1` manda o servidor entregar como arquivo com nome).
            FOTO DE PERFIL da cliente: vem de OUTRO endereço
            (pps.whatsapp.net), onde o navegador IGNORA o "download" e
            NAVEGA — ali abre em outra aba, senão a vendedora perdia a
            Central de vista no meio do atendimento. */}
        <a
          href={linkParaSalvar(src)}
          {...(src.startsWith("/")
            ? { download: "" }
            : { target: "_blank", rel: "noopener noreferrer" })}
          className="p-3 rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm hover:bg-black/75 transition"
          title={src.startsWith("/") ? "Salvar a foto" : "Abrir a foto em outra aba"}
        >
          <Download className="size-5" />
        </a>
        <button
          onClick={onClose}
          className="p-3 rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm hover:bg-black/75 transition"
          title="Fechar (Esc)"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
      </div>
      {legenda && (
        <p
          className="absolute inset-x-0 bottom-0 z-10 text-center text-white/95 text-sm px-4 pt-8 max-h-32 overflow-y-auto whitespace-pre-wrap bg-gradient-to-t from-black/85 to-transparent"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          {legenda}
        </p>
      )}
    </div>
  );
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
  campanhas = [],
  podeVincularCampanha = false,
  podeGerenciar = false,
  conversations,
  carregadoEm,
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
  campanhas?: { id: string; name: string }[];
  podeVincularCampanha?: boolean;
  /** gerência: bloquear cliente fecha a porta para a loja inteira */
  podeGerenciar?: boolean;
  conversations: InboxConversation[];
  /** relógio do servidor no momento da carga — âncora do primeiro sync */
  carregadoEm?: string;
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
  /**
   * CONTATO PARECIDO (incidente Toque Leve, 20/08/2026): a mesma cliente
   * cadastrada duas vezes — um dígito trocado no telefone — fazia duas
   * vendedoras atenderem metades diferentes do assunto, e o que saía pelo
   * número errado não chegava em ninguém. O sistema não junta sozinho:
   * mostra aqui, na cara de quem está conversando, e a loja decide.
   */
  const [parecidosDe, setParecidosDe] = useState<{
    customerId: string;
    lista: { id: string; name: string; phone: string; motivo?: string }[];
  } | null>(null);
  // UNIFICAR AQUI (gerência): o cadastro parecido é fundido NO cadastro da
  // conversa aberta — pedidos, conversas e histórico vêm junto (03/09/2026)
  const [unificando, setUnificando] = useState<string | null>(null);
  async function unificarAqui(p: { id: string; name: string }) {
    if (!clienteAberto) return;
    if (
      !window.confirm(
        `Unificar "${p.name}" NESTE cadastro? O pedido, as conversas e o histórico do outro cadastro passam para cá. Não dá para desfazer.`
      )
    )
      return;
    setUnificando(p.id);
    const res = await fetch(`/api/customers/${clienteAberto}/unificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicadoId: p.id }),
    });
    setUnificando(null);
    if (res.ok) {
      // a conversa mudou de forma (mensagens do outro cadastro entraram):
      // recarregar é o jeito seguro de a tela ver o resultado inteiro
      window.location.reload();
    } else {
      const d = await res.json().catch(() => ({}));
      window.alert(d.error ?? "Não foi possível unificar. Tente de novo.");
    }
  }
  // dispensado por conversa: um id só fazia o aviso da primeira voltar
  // quando a vendedora dispensava o da segunda
  const [parecidoOculto, setParecidoOculto] = useState<Set<string>>(new Set());
  // filtro "Não lidas" (igual ao do WhatsApp): num dia de disparo em massa, a
  // resposta de cliente afunda no meio das conversas enviadas — este botão
  // deixa só quem espera resposta na tela
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  // favoritas: o filtro que dá sentido a marcar uma conversa como favorita
  const [soFavoritas, setSoFavoritas] = useState(false);
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
  /**
   * CONVERSAS COM A CONVERSA CARREGADA.
   *
   * A lista chega leve — só a última mensagem de cada uma, para o texto
   * embaixo do nome. O histórico é buscado quando a conversa é ABERTA, e o
   * id entra aqui. Enquanto não estiver aqui, o sync não tenta juntar
   * mensagem nenhuma (juntar num histórico que não existe montaria uma
   * conversa pela metade — foi assim que "já respondi" virou incidente).
   */
  const threadsCarregadas = useRef<Set<string>>(new Set());
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [actionMsg, setActionMsg] = useState<InboxMessage | null>(null);
  /**
   * HISTÓRICO ANTIGO.
   *
   * A conversa abre com as últimas 100 mensagens (é o que qualquer app de
   * mensagem faz). Sem este botão, tudo o que veio antes ficava INACESSÍVEL:
   * a loja tinha a conversa gravada e não conseguia ler o começo dela.
   * `semMais` guarda as conversas que já chegaram no início de tudo.
   */
  /**
   * BUSCA NO SERVIDOR.
   *
   * A tela tem as conversas mais recentes; a cliente antiga não está nela.
   * Ao digitar, o servidor varre a loja inteira e as conversas que faltavam
   * entram na lista — senão a lupa "não acha" justamente quem a vendedora
   * não lembra de cabeça.
   */
  /**
   * QUANTAS LINHAS A TELA DESENHA.
   *
   * A lista INTEIRA fica na memória (é o que faz a contagem das abas e a
   * busca serem verdadeiras), mas desenhar 2.000 linhas de uma vez trava o
   * navegador — e chat comercial vive com milhares de conversas. Desenha um
   * bloco e vai crescendo conforme a pessoa rola.
   */
  const BLOCO = 200;
  const [visiveis, setVisiveis] = useState(BLOCO);
  const [buscando, setBuscando] = useState(false);
  /**
   * MENSAGENS EM QUE A PALAVRA BUSCADA APARECEU, por conversa (vêm do
   * servidor, da mais recente para a mais antiga). É o que a lista mostra
   * embaixo do nome no lugar da última mensagem, e para onde a tela pula ao
   * abrir a conversa — como no aplicativo do WhatsApp (pedido do dono,
   * 03/09/2026). Some quando a busca é apagada.
   */
  const [achados, setAchados] = useState<Record<string, MensagemAchada[]>>({});
  /** qual das mensagens achadas está em foco na conversa aberta (▲▼) */
  const [posAchado, setPosAchado] = useState(0);
  /** mensagem para a qual a tela está indo (carrega o passado até chegar nela) */
  const [pulo, setPulo] = useState<MensagemAchada | null>(null);
  // espelho do `pulo` para a rolagem automática consultar SEM depender dele:
  // se ele entrasse nas dependências, o fim do pulo (pulo → null) rodaria a
  // rolagem para o fim e desfaria o que o pulo acabou de fazer
  const puloRef = useRef<MensagemAchada | null>(null);
  puloRef.current = pulo;
  const paginasDoPulo = useRef(0);
  /** bolha em destaque (a mensagem achada pela lupa); apaga sozinha */
  const [destaqueMsgId, setDestaqueMsgId] = useState<string | null>(null);
  /** seletor de emoji aberto DENTRO da caixa de edição de mensagem */
  const [showEmojiEdicao, setShowEmojiEdicao] = useState(false);
  const editTaRef = useRef<HTMLTextAreaElement>(null);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [semMais, setSemMais] = useState<Set<string>>(new Set());

  /** Aviso rápido no rodapé ("Mensagem copiada"). Some sozinho. */
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 2200);
    return () => clearTimeout(t);
  }, [aviso]);
  // "responder": mensagem marcada para citação (prévia acima do compositor)
  const [replyMsg, setReplyMsg] = useState<InboxMessage | null>(null);
  // mensagem escolhida para ENCAMINHAR (abre a lista de destinos)
  const [encaminhando, setEncaminhando] = useState<InboxMessage | null>(null);
  // menu da CONVERSA (clique direito no computador, toque longo no celular)
  const [menuConv, setMenuConv] = useState<{
    conv: InboxConversation;
    em: { x: number; y: number };
  } | null>(null);
  const toqueLongo = useRef<ReturnType<typeof setTimeout> | null>(null);
  // o toque longo DISPAROU: o clique que vem logo atrás (no iPhone ele vem)
  // não pode abrir a conversa por baixo da folha — abrir marcaria como lida
  // e zeraria o contador antes de a pessoa tocar em "Marcar como não lida"
  const menuAbriuNoToque = useRef(false);
  // e o dedo treme: só cancela o toque longo depois de sair deste raio
  const inicioDoToque = useRef<{ x: number; y: number } | null>(null);
  // foto aberta no visor de tela cheia (com zoom)
  const [fotoAberta, setFotoAberta] = useState<{ src: string; legenda: string } | null>(null);
  // ARRASTAR PARA RESPONDER (celular): igual ao aplicativo do WhatsApp —
  // desliza a bolha para o lado e ela vira resposta marcada
  const swipeRef = useRef<{
    id: string;
    x: number;
    y: number;
    el: HTMLElement | null;
    disparou: boolean;
  } | null>(null);
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
  // meio segundo entre tocar no microfone e começar a gravar de fato: é o
  // tempo que o ganho automático leva para achar o volume da voz
  const [preparando, setPreparando] = useState(false);
  // fila de fotos em andamento (envio múltiplo): mostra "3 de 20".
  // Guarda a CONVERSA: sem isso a barra tomava o lugar do campo de escrever
  // em QUALQUER conversa aberta, e a vendedora não conseguia responder mais
  // ninguém enquanto as vinte fotos saíam.
  const [filaFotos, setFilaFotos] = useState<
    { feito: number; total: number; convId: string } | null
  >(null);
  const cancelarFilaRef = useRef(false);
  const [parandoFila, setParandoFila] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recCancelRef = useRef(false);
  // MICROFONE ESCOLHIDO (por aparelho). Sem isto o sistema pedia "um
  // microfone" e o Windows entregava o padrão dele — o headset plugado ficava
  // de fora e ninguém ficava sabendo (reclamação de 26/08/2026).
  const [micId, setMicId] = useState<string | null>(null);
  // nome do microfone que está REALMENTE gravando (vem da trilha aberta, não
  // do que a gente pediu — é a única fonte que não mente)
  const [micNome, setMicNome] = useState("");
  useEffect(() => {
    try {
      setMicId(window.localStorage.getItem(CHAVE_MICROFONE) || null);
    } catch {
      // navegador com armazenamento bloqueado: segue no padrão
    }
  }, []);
  function escolherMicrofone(id: string | null, rotulo: string) {
    setMicId(id);
    setMicNome(id ? nomeCurtoDoMicrofone(rotulo) : "");
    try {
      if (id) window.localStorage.setItem(CHAVE_MICROFONE, id);
      else window.localStorage.removeItem(CHAVE_MICROFONE);
    } catch {
      // não deu para guardar: vale só nesta sessão
    }
  }

  const selected = convs.find((c) => c.id === selectedId) ?? null;

  // NO CELULAR o Enter do teclado é a tecla de LINHA NOVA — igual ao próprio
  // WhatsApp; enviar é só no botão ✈️. A vendedora apertava a setinha para
  // descer de linha e a mensagem saía pela metade (pedido do dono,
  // 06/08/2026). No computador o Enter continua enviando (Shift+Enter
  // quebra linha). Detecção por tipo de tela (dedo × mouse), não por tamanho.
  //
  // O MESMO sinal serve para a SELEÇÃO DE TEXTO das bolhas (ver abaixo), por
  // isso ele mora numa variável com nome próprio em vez de escondido dentro
  // do `enterEnvia`.
  const [noComputador, setNoComputador] = useState(true);
  useEffect(() => {
    setNoComputador(!window.matchMedia("(pointer: coarse)").matches);
  }, []);
  const enterEnvia = noComputador;

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
  // A LISTA NÃO PERDE O LUGAR (RN-046): no celular a lista é escondida com
  // `display:none` enquanto o chat está aberto, e elemento escondido perde a
  // rolagem — na volta o navegador entrega scrollTop zero. Guardamos o lugar
  // a cada rolagem e devolvemos quando a lista reaparece.
  const listaRef = useRef<HTMLDivElement>(null);
  const lugarDaLista = useRef(0);
  const [atalhoDaLista, setAtalhoDaLista] = useState<"fim" | "topo" | null>(null);
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

  // campo de escrita começa com UMA linha e cresce conforme o texto (no
  // celular, duas linhas fixas roubavam espaço da conversa)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  }, [draft]);

  /**
   * Campo dentro de um painel flutuante (mensagens automáticas, nova resposta
   * rápida): no celular o teclado sobe e empurra o painel — sem isso o campo
   * que você tocou some pra fora da tela. Espera o teclado terminar de subir
   * e traz o campo pro centro da área visível.
   */
  function aoFocarCampoPainel(
    e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>
  ) {
    const campo = e.currentTarget;
    setTimeout(() => campo.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
  }

  // insere o emoji na posição do cursor (e devolve o foco ao campo) — a
  // MESMA regra para o compositor e para a caixa de edição de mensagem
  function inserirNoCursor(
    ta: HTMLTextAreaElement | null,
    texto: string,
    emoji: string,
    setTexto: (t: string) => void
  ) {
    const pos = ta?.selectionStart ?? texto.length;
    setTexto(texto.slice(0, pos) + emoji + texto.slice(pos));
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        const p = pos + emoji.length;
        ta.setSelectionRange(p, p);
      }
    });
  }
  function insertEmoji(emoji: string) {
    inserirNoCursor(taRef.current, draft, emoji, setDraft);
  }
  // emoji NA MENSAGEM SENDO EDITADA (pedido do dono, 03/09/2026: "quando
  // vou editar uma mensagem não consigo colocar emoji")
  function inserirEmojiNaEdicao(emoji: string) {
    inserirNoCursor(editTaRef.current, editMsgDraft, emoji, setEditMsgDraft);
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

  // fila = CLIENTE ESPERANDO resposta e sem responsável; chats = em
  // atendimento; contatos = histórico (encerradas). A regra mora em
  // lib/comm/fila.ts para a tela e o resto do sistema falarem a mesma língua.
  const bucketOf = (c: InboxConversation): Tab => abaDaConversa(c);

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

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setAchados({}); // apagou a busca: a lista volta a mostrar a última mensagem
      return;
    }
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/conversations?q=${encodeURIComponent(q)}`);
        if (!r.ok) {
          // busca que falhou não pode deixar na tela o resultado da PALAVRA
          // ANTERIOR pintado embaixo do termo novo
          if (vivo) setAchados({});
          return;
        }
        const d: { conversations?: InboxConversation[]; mensagens?: MensagemAchada[] } =
          await r.json();
        if (!vivo) return;
        // as mensagens achadas são DESTA busca: trocou o termo, troca a lista
        const porConversa: Record<string, MensagemAchada[]> = {};
        for (const m of d.mensagens ?? []) (porConversa[m.conversationId] ??= []).push(m);
        setAchados(porConversa);
        setPosAchado(0); // a barra ▲▼ recomeça: a lista de achados é outra
        if (!d.conversations?.length) return;
        setConvs((prev) => {
          const tem = new Set(prev.map((c) => c.id));
          // resultado da busca entra como PRÉVIA (igual ao resto da lista);
          // o histórico vem quando a vendedora abrir a conversa
          const novas = d
            .conversations!.filter((c) => !tem.has(c.id))
            .map((c) => ({ ...c, messages: c.messages.slice(-1) }));
          return novas.length ? [...prev, ...novas] : prev;
        });
      } catch {
        // rede oscilou: a lista local continua valendo — sem trecho de
        // busca antiga pintado nela
        if (vivo) setAchados({});
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 350); // espera a pessoa parar de digitar
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [search]);

  useEffect(() => {
    setVisiveis(BLOCO); // trocou de aba, buscou ou filtrou: recomeça o bloco
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, tagFilter, soNaoLidas, soFavoritas]);

  /** Guarda o lugar e acerta o atalho — na rolagem e quando a lista muda. */
  const medirALista = useCallback(() => {
    const el = listaRef.current;
    if (!el) return;
    const maxima = el.scrollHeight - el.clientHeight;
    // lista escondida (o chat está aberto) não tem lugar nem altura para
    // medir: mexer aqui apagaria justamente o lugar que guardamos
    if (listaEstaEscondida(el.clientHeight)) return;
    if (vaiGuardarOLugar(el.scrollTop, el.clientHeight))
      lugarDaLista.current = el.scrollTop;
    setAtalhoDaLista(
      mostraAtalhoDaLista(el.scrollHeight, el.clientHeight)
        ? sentidoDoAtalho(el.scrollTop, maxima)
        : null
    );
  }, []);

  // ROTAÇÃO, TECLADO E JANELA REDIMENSIONADA mudam a altura sem ninguém
  // rolar: sem observar, o atalho ficava do tamanho de antes (some quando
  // devia aparecer, e vice-versa) até ela rolar na mão
  useEffect(() => {
    const el = listaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => medirALista());
    obs.observe(el);
    return () => obs.disconnect();
  }, [medirALista]);

  // DEVOLVE O LUGAR quando a lista reaparece (no celular, o chat fechou). O
  // rAF espera o navegador refazer a conta da altura: sem ele a rolagem
  // máxima ainda é a de uma lista escondida (zero) e o pedido é ignorado.
  useEffect(() => {
    if (selectedId) return;
    let vivo = true;
    const id = requestAnimationFrame(() => {
      if (!vivo) return;
      const el = listaRef.current;
      if (!el) return;
      if (vaiDevolverOLugar(el.scrollTop, lugarDaLista.current)) {
        el.scrollTop = lugarParaVoltar(
          lugarDaLista.current,
          el.scrollHeight - el.clientHeight
        );
      }
      medirALista();
    });
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [selectedId, medirALista]);

  /** O atalho: leva ao fim (ou de volta ao topo) sem rolar na mão. */
  const irNaLista = (para: "fim" | "topo") => {
    listaRef.current?.scrollTo({
      top: para === "fim" ? listaRef.current.scrollHeight : 0,
      behavior: "smooth",
    });
  };

  // a lista com TODOS os filtros MENOS o "Não lidas": é ela que alimenta o
  // filtro e o número do botãozinho — mesma régua, o contador nunca mente
  const filtradasBase = useMemo(() => {
    const q = search.trim();
    const list = convs.filter((c) => {
      // BUSCANDO? procura em TODAS as abas.
      //
      // Antes a lupa só olhava a aba aberta: a cliente estava em Contatos
      // (atendimento encerrado) e a busca em Chats não achava nada — parecia
      // que a lupa não funcionava. Quem digita um nome quer a pessoa, não a
      // gaveta em que ela está.
      if (!q && bucketOf(c) !== tab) return false;
      if (tagFilter && !c.customer.tags.some((t) => t.id === tagFilter)) return false;
      // a conversa fica se o CONTATO casa ou se a PALAVRA apareceu nela
      if (!casaCliente(c.customer, q) && !achados[c.id]) return false;
      return true;
    });
    // Fila: mais antigo primeiro (quem espera há mais tempo no topo).
    // Chats/Contatos: atividade mais recente primeiro.
    return list.sort((a, b) => {
      // FIXADAS SEMPRE NO TOPO, em qualquer aba — é para isso que servem
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (tab === "fila") {
        const at = new Date(a.lastInboundAt ?? a.createdAt).getTime();
        const bt = new Date(b.lastInboundAt ?? b.createdAt).getTime();
        return at - bt;
      }
      return (
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs, tab, search, tagFilter, achados]);

  const naoLida = (c: InboxConversation) => c.unreadCount > 0;
  const naoLidasNaLista = useMemo(
    () => filtradasBase.filter(naoLida).length,
    [filtradasBase]
  );
  const favoritasNaLista = useMemo(
    () => filtradasBase.filter((c) => c.favorite).length,
    [filtradasBase]
  );
  const filtered = useMemo(() => {
    let l = filtradasBase;
    if (soNaoLidas) l = l.filter(naoLida);
    if (soFavoritas) l = l.filter((c) => c.favorite);
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtradasBase, soNaoLidas, soFavoritas]);

  // a lista muda de tamanho sem ninguém rolar (encerrou uma conversa, chegou
  // mensagem nova, "Mostrar mais"): sem medir de novo, o atalho ficava
  // pendurado numa lista que já cabia na tela
  useEffect(() => {
    medirALista();
  }, [filtered.length, visiveis, medirALista]);

  useEffect(() => {
    // indo até uma mensagem achada pela lupa, quem manda na rolagem é o pulo
    if (puloRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    // `parecidos` entra na conta porque o aviso de cadastro duplicado nasce
    // ACIMA das mensagens depois da resposta do servidor: sem rolar de novo,
    // ele empurra as últimas mensagens para baixo da dobra
  }, [selectedId, selected?.messages.length, parecidosDe?.lista.length]);

  /**
   * PULA ATÉ A MENSAGEM ACHADA PELA LUPA (como no aplicativo do WhatsApp).
   *
   * A conversa abre com as últimas 100; se a mensagem é mais antiga, carrega
   * o passado página a página até ela aparecer — com teto: uma conversa de
   * anos não trava a tela, e a pessoa fica sabendo. Dirigido pelo estado:
   * cada lote que chega redesenha a conversa e o efeito confere de novo.
   */
  useEffect(() => {
    if (!pulo || !selected || selected.id !== pulo.conversationId) return;
    const el = document.getElementById(`msg-${pulo.id}`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setDestaqueMsgId(pulo.id);
      setPulo(null);
      return;
    }
    // o histórico recente ainda está vindo: espera ele chegar
    if (!threadsCarregadas.current.has(selected.id) || carregandoAntigas) return;
    const maisVelha = selected.messages[0]?.createdAt;
    const aindaTemPassado = !semMais.has(selected.id);
    if (
      maisVelha &&
      maisVelha > pulo.createdAt &&
      aindaTemPassado &&
      paginasDoPulo.current < 25
    ) {
      paginasDoPulo.current += 1;
      void carregarAnteriores(selected.id);
      return;
    }
    // não dá para chegar nela por aqui (muito antiga, ou sumiu)
    setPulo(null);
    setAviso("Essa mensagem é antiga demais para abrir por aqui.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulo, selected, semMais, carregandoAntigas]);

  // o destaque da mensagem achada apaga sozinho
  useEffect(() => {
    if (!destaqueMsgId) return;
    const t = setTimeout(() => setDestaqueMsgId(null), 2500);
    return () => clearTimeout(t);
  }, [destaqueMsgId]);

  // fechou a edição da mensagem: o seletor de emoji dela fecha junto
  useEffect(() => {
    if (!editingMsgId) setShowEmojiEdicao(false);
  }, [editingMsgId]);

  /** Vai até a n-ésima mensagem achada da conversa aberta (0 = mais recente). */
  function irParaAchado(convId: string, pos: number) {
    const lista = achados[convId];
    if (!lista?.length) return;
    const i = Math.max(0, Math.min(lista.length - 1, pos));
    setPosAchado(i);
    paginasDoPulo.current = 0;
    setPulo(lista[i]);
  }

  // abre direto a conversa vinda do sino de notificações ou da Agenda
  // (?conv=...). `?texto=` chega com a mensagem sugerida JÁ NO CAMPO — a
  // vendedora só revisa e envia (pedido do dono, 04/08/2026: "conversar"
  // da agenda deve abrir DENTRO do sistema, não no aplicativo).
  const searchParams = useSearchParams();
  const prefillFeito = useRef(false);
  // Cada ?conv= é atendido UMA vez. Sem esta trava, qualquer conversa nova
  // que o sync acrescentasse à lista re-rodava o efeito (convs.length) e
  // puxava a vendedora de volta à conversa do link no meio de outro
  // atendimento.
  const convDoLink = useRef<string | null>(null);
  useEffect(() => {
    const cid = searchParams.get("conv");
    if (!cid) return;
    const texto = searchParams.get("texto");
    if (convDoLink.current !== cid) {
      const conhecida = convs.find((x) => x.id === cid);
      if (conhecida) {
        convDoLink.current = cid;
        // pelo MESMO caminho do clique na lista: carrega o histórico inteiro
        // (threadsCarregadas) e marca como lida. Abrir direto, sem carregar,
        // deixava o sync da montagem reduzir a conversa aberta à prévia de
        // 1 mensagem — a "conversa pela metade" chegando pelo link da Agenda.
        selectConv(cid);
        setTab(abaDaConversa(conhecida));
      } else {
        // conversa recém-criada pela Agenda: a lista ainda não a conhece —
        // busca inteira no servidor (mesma porta do sync parcial)
        convDoLink.current = cid;
        fetch(`/api/conversations/${cid}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d?.conversation) return;
            // o histórico completo veio junto: marca como carregada (senão o
            // sync reduzia à prévia) e SUBSTITUI se o sync tiver chegado
            // primeiro com a versão de 1 mensagem
            threadsCarregadas.current.add(cid);
            setConvs((prev) =>
              prev.some((c) => c.id === cid)
                ? prev.map((c) =>
                    c.id === cid ? { ...d.conversation, unreadCount: 0 } : c
                  )
                : [d.conversation, ...prev]
            );
            setSelectedId(cid);
            setTab(abaDaConversa(d.conversation));
          })
          .catch(() => {
            convDoLink.current = null; // rede oscilou: tenta de novo
          });
      }
    }
    if (texto && !prefillFeito.current) {
      prefillFeito.current = true; // uma vez só — não sobrescreve o que ela digitar
      setDraft(texto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, convs.length]);

  // --- Tempo real: consulta o servidor a cada 4s e traz só o que mudou ---
  // (mensagem nova do cliente, recibos ✓✓, transferências...). Aba em segundo
  // plano não consulta; ao voltar o foco, sincroniza na hora.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  // Âncora do sync: o RELÓGIO DO SERVIDOR na hora em que a lista foi montada
  // (com 60s de folga), não o relógio do aparelho ao abrir a tela. O celular
  // reabre a página com a carga VELHA (cache de navegação): ancorar em
  // "agora − 60s" deixava para trás tudo que mudou entre a carga e a
  // reabertura — a vendedora respondia, voltava, e a Fila mostrava a cliente
  // como se ninguém tivesse respondido.
  const lastSyncRef = useRef(
    new Date(
      (carregadoEm ? new Date(carregadoEm).getTime() : Date.now()) - 60_000
    ).toISOString()
  );
  useEffect(() => {
    let alive = true;
    let busy = false;
    async function sync() {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        // VÃO GRANDE (página guardada na volta da navegação, aba/celular que
        // dormiu horas): o incremental sem teto puxaria todas as mensagens do
        // período com corpo INTEIRO — o pacote de megabytes que a lista leve
        // eliminou. Mais barato e igual ao F5: recarrega a lista leve inteira
        // e busca de novo só o histórico da conversa aberta.
        const gapMs = Date.now() - new Date(lastSyncRef.current).getTime();
        if (gapMs > 10 * 60_000) {
          const res = await fetch(`/api/conversations`);
          if (!res.ok) return;
          const d: { now?: string; conversations?: InboxConversation[] } =
            await res.json();
          if (!alive || !d.conversations) return;
          if (d.now)
            lastSyncRef.current = new Date(
              new Date(d.now).getTime() - 10_000
            ).toISOString();
          threadsCarregadas.current.clear();
          setConvs(d.conversations);
          const selId = selectedIdRef.current;
          if (selId) void carregarThread(selId);
          return;
        }
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
            // CONVERSA AINDA NÃO ABERTA: a tela tem só a prévia dela. Juntar
            // as mensagens do sync aqui montaria um histórico pela metade —
            // exatamente o "já respondi e não aparece". Atualiza a linha da
            // lista e mantém como prévia a mensagem mais recente conhecida.
            if (!threadsCarregadas.current.has(p.id)) {
              // A PRÉVIA É SEMPRE A MENSAGEM MAIS NOVA — pela DATA, não pela
              // ordem de chegada do sync. O sync entrega o que MUDOU, e o que
              // muda nem sempre é a última: a cliente reage com emoji numa
              // mensagem de três dias atrás, e aquela mensagem antiga volta
              // no lote. Pegando cegamente a última do lote, a linha da lista
              // passava a mostrar um texto velho, como se fosse a novidade.
              const doSync = f.messages[f.messages.length - 1] ?? null;
              const daTela = p.messages[p.messages.length - 1] ?? null;
              const maisNova =
                doSync && daTela
                  ? doSync.createdAt >= daTela.createdAt
                    ? doSync
                    : daTela
                  : (doSync ?? daTela);
              return { ...f, messages: maisNova ? [maisNova] : [] };
            }
            // preserva mensagem recém-enviada que o servidor ainda não devolveu
            const ids = new Set(f.messages.map((m) => m.id));
            // Uma mensagem do servidor só pode "quitar" UMA bolha otimista.
            // Sem isto, uma fila de fotos (todas com o corpo "📷 Imagem")
            // tinha a bolha da foto EM VOO apagada pela foto ANTERIOR que
            // voltou no sync: se aquele envio falhasse, a bolha de erro com
            // "Reenviar" não nascia e a foto sumia calada.
            const jaCasadas = new Set<string>();
            const extra = p.messages.filter((m) => {
              if (ids.has(m.id)) {
                // esta já foi reconciliada: a versão do servidor manda. E ela
                // fica MARCADA como gasta — senão continuava disponível para
                // "quitar" a bolha da PRÓXIMA foto do lote (mesmo corpo), que
                // era o buraco que sumia com a foto em voo
                jaCasadas.add(m.id);
                return false;
              }
              // BOLHA QUE FALHOU NUNCA É APAGADA DA TELA.
              //
              // Incidente real: a vendedora manda "Bom dia", o envio falha
              // (bolha ⚠️ com "Reenviar"), e no sync seguinte o servidor
              // devolve um "Bom dia" ANTIGO da mesma conversa. O texto casava,
              // a bolha do erro sumia e ela acreditava ter enviado — a cliente
              // nunca recebeu. O aviso de falha só sai daqui pelas mãos dela.
              if (m.status === "FALHOU") return true;
              // bolha otimista (ainda "temp-") já confirmada pelo servidor:
              // se o sync trouxe a mesma mensagem (sentido+texto), descarta a
              // temp. Só casa com mensagem RECENTE (2 min): sem essa janela,
              // qualquer repetição antiga do mesmo texto engolia a bolha nova.
              if (m.id.startsWith("temp-")) {
                const par = f.messages.find(
                  (fm) =>
                    !jaCasadas.has(fm.id) &&
                    fm.direction === m.direction &&
                    fm.kind === m.kind &&
                    fm.mediaType === m.mediaType &&
                    fm.body === m.body &&
                    Date.now() - new Date(fm.createdAt).getTime() < 120_000
                );
                if (par) {
                  jaCasadas.add(par.id);
                  return false;
                }
              }
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
          // Conversa nova para a tela entra pela prévia, como as outras da
          // lista. O histórico dela vem quando for aberta — nada de buscar
          // conversa que ninguém pediu.
          return [
            ...merged,
            ...[...freshById.values()].map((c) => ({
              ...c,
              messages: c.messages.slice(-1),
            })),
          ];
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
    // PRIMEIRO SYNC NA HORA: sem isto a tela reaberta ficava até 3s (um tick
    // inteiro) mostrando o estado velho — no celular parecia "não atualiza"
    void sync();
    const timer = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    // iPhone/Safari: voltar por gesto restaura a página congelada (bfcache) e
    // nem sempre dispara visibilitychange — o pageshow cobre esse caminho
    window.addEventListener("pageshow", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarThread(id: string) {
    if (threadsCarregadas.current.has(id)) return;
    setCarregandoThread(true);
    try {
      const r = await fetch(`/api/conversations/${id}`);
      if (r.ok) {
        const { conversation } = await r.json();
        if (conversation) {
          threadsCarregadas.current.add(id);
          setConvs((prev) =>
            prev.map((c) =>
              c.id === id
                ? { ...conversation, unreadCount: 0, messages: conversation.messages }
                : c
            )
          );
        }
      }
    } catch {
      // rede oscilou: reabrir a conversa tenta de novo
    } finally {
      setCarregandoThread(false);
    }
  }

  function selectConv(id: string) {
    setSelectedId(id);
    setPosAchado(0); // a barra ▲▼ da lupa recomeça na mensagem mais recente
    setPulo(null); // pulo pendente era da conversa anterior
    void carregarThread(id);
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
  /**
   * `pularAssumir`: numa fila (vinte fotos), o `selected` do laço é sempre o
   * MESMO objeto — a tela não redesenha entre as voltas —, então "conversa
   * sem dona" continuava verdadeiro nas vinte e saíam vinte PATCH iguais,
   * cada um acordando o sync de 3s. Só a primeira da fila assume.
   */
  async function sendPayload(
    payload: Record<string, unknown>,
    { pularAssumir = false }: { pularAssumir?: boolean } = {}
  ) {
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
      reaction: null,
      reactionStore: null,
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
    if (!selected.assignee && !pularAssumir) {
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
            reaction: null,
            reactionStore: null,
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

  /** Começo do toque na bolha: guarda o ponto para medir o arrasto. */
  function swipeStart(m: InboxMessage, e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    if (!t) return;
    swipeRef.current = {
      id: m.id,
      x: t.clientX,
      y: t.clientY,
      el: e.currentTarget,
      disparou: false,
    };
  }

  /**
   * Arrasto horizontal ≥ 56px (com pouco desvio vertical) = responder.
   * A bolha acompanha o dedo até lá, como no aplicativo de verdade.
   */
  function swipeMove(m: InboxMessage, e: React.TouchEvent<HTMLDivElement>) {
    const s = swipeRef.current;
    if (!s || s.id !== m.id || s.disparou) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = Math.abs(t.clientY - s.y);
    if (dy > 40 || dx < 0) {
      if (s.el) s.el.style.transform = "";
      return;
    }
    if (dx > 8 && s.el) {
      // NOTEBOOK COM TELA SENSÍVEL AO TOQUE: ali o ponteiro principal é o
      // mouse, então o texto é selecionável (é o que o dono pediu) — mas o
      // arrasto com o DEDO continua existindo, e o navegador começava a
      // marcar texto no meio dele. Ao reconhecer o arrasto, a marcação é
      // desfeita: o gesto é de responder, não de selecionar (achado da
      // revisão).
      window.getSelection?.()?.removeAllRanges();
      s.el.style.transform = `translateX(${Math.min(dx, 64)}px)`;
    }
    if (dx > 56) {
      s.disparou = true;
      if (s.el) s.el.style.transform = "";
      if (!m.revoked && !m.id.startsWith("temp-")) {
        setReplyMsg(m);
        try {
          navigator.vibrate?.(10);
        } catch {
          /* navegador sem vibração */
        }
      }
    }
  }

  function swipeEnd() {
    const s = swipeRef.current;
    if (s?.el) s.el.style.transform = "";
    swipeRef.current = null;
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

  /**
   * REAGIR COM EMOJI — o mesmo gesto do aplicativo.
   *
   * Tocar de novo no MESMO emoji tira a reação (é assim que o WhatsApp
   * desfaz). A pastilha aparece na hora e volta atrás sozinha se o WhatsApp
   * recusar: a vendedora não fica achando que reagiu quando não reagiu.
   */
  async function reagir(m: InboxMessage, emoji: string) {
    if (!selected) return;
    const convId = selected.id;
    const anterior = m.reactionStore;
    const novo = anterior === emoji ? "" : emoji;
    setActionMsg(null);
    const pintar = (valor: string | null) =>
      setConvs((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((x) =>
                  x.id === m.id ? { ...x, reactionStore: valor } : x
                ),
              }
            : c
        )
      );
    pintar(novo || null);
    const res = await fetch(`/api/messages/${m.id}/reacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji: novo }),
    }).catch(() => null);
    if (!res || !res.ok) {
      pintar(anterior); // desfaz: não deu certo
      setAviso(
        (await res?.json().catch(() => ({})))?.error ?? "Não foi possível reagir."
      );
      return;
    }
    // REPINTA COM O QUE O SERVIDOR GRAVOU. O sync roda de 3 em 3s e pode ter
    // passado no meio do caminho, trazendo a mensagem SEM a reação (ele foi
    // buscar antes do POST terminar) e apagando a pastilha da tela. Aí o
    // segundo toque da vendedora — que ela dá achando que não pegou — viraria
    // REMOÇÃO. Confirmar no fim fecha essa fresta.
    const salvo = await res.json().catch(() => null);
    if (salvo) pintar(salvo.reactionStore ?? null);
  }

  /**
   * ENCAMINHA a mensagem escolhida para as conversas marcadas.
   *
   * Quem faz o trabalho é o servidor: a tela só conhece o LINK da mídia, e
   * mandar um vídeo de volta pelo navegador seria minutos de espera no
   * celular. A resposta diz quantas foram — e o aviso conta a verdade quando
   * alguma falha.
   */
  async function encaminharPara(ids: string[]) {
    const msg = encaminhando;
    if (!msg) return;
    const res = await fetch(`/api/messages/${msg.id}/encaminhar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationIds: ids }),
    }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    setEncaminhando(null);
    if (!res || !res.ok) {
      setAviso(d?.error ?? "Não foi possível encaminhar.");
      return;
    }
    const n = d?.enviadas ?? 0;
    setAviso(
      d?.falhas
        ? `Encaminhada para ${n} de ${n + d.falhas} — ${d.falhas} não foi.`
        : `Encaminhada para ${n} ${n === 1 ? "conversa" : "conversas"}.`
    );
  }

  /** Aplica na tela e manda para o servidor; volta atrás se recusar. */
  async function mexerNaConversa(
    convId: string,
    mudanca: Partial<Pick<InboxConversation, "pinned" | "favorite">> | { markUnread: true }
  ) {
    const antes = convs.find((c) => c.id === convId);
    const local = "markUnread" in mudanca ? { unreadCount: Math.max(1, antes?.unreadCount ?? 0) } : mudanca;
    setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, ...local } : c)));
    // marcar como não lida FECHA o chat: aberto, o sync zeraria o marcador
    if ("markUnread" in mudanca && selectedId === convId) setSelectedId(null);
    const res = await fetch(`/api/conversations/${convId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mudanca),
    }).catch(() => null);
    if (!res || !res.ok) {
      // desfaz SÓ o que foi mexido: devolver o objeto inteiro de antes
      // apagaria a mensagem que o sync trouxe durante a espera (achado da
      // revisão) — e o sync incremental não a mandaria de novo
      const desfazer =
        "markUnread" in mudanca
          ? { unreadCount: antes?.unreadCount ?? 0 }
          : "pinned" in mudanca
            ? { pinned: antes?.pinned ?? false }
            : { favorite: antes?.favorite ?? false };
      setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, ...desfazer } : c)));
      setAviso((await res?.json().catch(() => ({})))?.error ?? "Não foi possível salvar.");
    }
  }

  /**
   * BLOQUEAR / DESBLOQUEAR — o bloqueio de verdade, no WhatsApp da loja.
   * Confirma antes: fecha a porta de uma cliente para a loja inteira. E só
   * marca na tela depois que o servidor confirma (ele só grava se o WhatsApp
   * aceitar) — dizer "bloqueada" com mensagem chegando seria mentira.
   */
  async function bloquearCliente(c: InboxConversation) {
    const bloquear = !c.customer.blockedAt;
    if (
      bloquear &&
      !window.confirm(
        `Bloquear ${c.customer.name} no WhatsApp da loja? Ela deixa de conseguir mandar mensagem para vocês.`
      )
    )
      return;
    const res = await fetch(`/api/conversations/${c.id}/bloquear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bloquear }),
    }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (!res || !res.ok) {
      setAviso(d?.error ?? "Não foi possível concluir.");
      return;
    }
    setConvs((prev) =>
      prev.map((x) =>
        x.customer.id === c.customer.id
          ? { ...x, customer: { ...x.customer, blockedAt: d?.blockedAt ?? null } }
          : x
      )
    );
    setAviso(bloquear ? "Cliente bloqueada no WhatsApp." : "Cliente desbloqueada.");
  }

  /** o dedo se moveu (ou soltou): não era toque longo, era rolagem/toque */
  function cancelarToqueLongo() {
    if (toqueLongo.current) {
      clearTimeout(toqueLongo.current);
      toqueLongo.current = null;
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
  /**
   * MARCAR COMO NÃO LIDA — "volto nessa depois".
   *
   * FECHA a conversa junto, e não é enfeite: enquanto ela está aberta na
   * tela, a sincronização zera o marcador a cada 3 segundos (conversa aberta
   * é conversa lida). Sem fechar, o marcador voltaria sozinho e a vendedora
   * acharia que o botão não funciona. É o mesmo comportamento do WhatsApp.
   */
  /** Copia o texto da mensagem (o da cliente também — pedido, chave Pix, endereço). */
  async function copiarMensagem(texto: string) {
    const ok = await copiarTexto(texto);
    setActionMsg(null);
    setAviso(ok ? "Mensagem copiada" : "Não consegui copiar nesse navegador");
  }

  async function carregarAnteriores(convId: string) {
    const conv = convs.find((c) => c.id === convId);
    const maisVelha = conv?.messages[0]?.createdAt;
    if (!maisVelha || carregandoAntigas) return;
    setCarregandoAntigas(true);
    try {
      const r = await fetch(
        `/api/conversations/${convId}/mensagens?antes=${encodeURIComponent(maisVelha)}`
      );
      if (r.ok) {
        const d: { messages: InboxMessage[]; temMais: boolean } = await r.json();
        setConvs((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            // nunca repete o que já está na tela
            const jaTem = new Set(c.messages.map((m) => m.id));
            const novas = d.messages.filter((m) => !jaTem.has(m.id));
            return { ...c, messages: [...novas, ...c.messages] };
          })
        );
        if (!d.temMais) setSemMais((prev) => new Set(prev).add(convId));
      }
    } catch {
      // rede oscilou: o botão continua lá para tentar de novo
    } finally {
      setCarregandoAntigas(false);
    }
  }

  const marcarNaoLida = (id: string) => {
    const conv = convs.find((c) => c.id === id);
    patchLocal(id, { unreadCount: contadorAoMarcarNaoLida(conv?.unreadCount ?? 0) });
    fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markUnread: true }),
    }).catch(() => {});
    setSelectedId(null); // volta para a lista (no celular, sai do chat)
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

  // aceita {{nome}} E {nome}: as mensagens automáticas usam chave simples e
  // quem decora um formato usava o outro sem perceber — a variável ia crua
  const resolveTemplate = (body: string) =>
    body
      .replaceAll("{{nome}}", selected?.customer.name.split(" ")[0] ?? "")
      .replaceAll("{nome}", selected?.customer.name.split(" ")[0] ?? "")
      .replaceAll("{{vendedora}}", currentUserName.split(" ")[0])
      .replaceAll("{vendedora}", currentUserName.split(" ")[0]);

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
  /**
   * Sobe/desce uma resposta rápida DENTRO da categoria dela (é o movimento
   * que o painel mostra). Otimista: a lista muda na hora.
   *
   * A gravação vai numa FILA (uma PUT por vez, em ordem): cliques rápidos
   * disparavam PUTs paralelas e a que chegasse por último no servidor podia
   * ser a lista VELHA — a ordem "voltava um degrau" no F5. E a falha AVISA:
   * engolir erro com .catch(() => {}) já causou incidente real neste projeto.
   */
  const filaOrdem = useRef<Promise<void>>(Promise.resolve());
  function persistirOrdem(ids: string[]) {
    filaOrdem.current = filaOrdem.current.then(async () => {
      try {
        const res = await fetch("/api/templates/reorder", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error();
      } catch {
        alert(
          "Não consegui salvar a nova ordem das respostas rápidas. Confira a internet e tente de novo — por enquanto a ordem antiga continua valendo."
        );
      }
    });
  }
  function moverResposta(id: string, direcao: "subir" | "descer") {
    // calculada FORA do setState: updater precisa ser puro (no modo estrito o
    // React roda o updater duas vezes — a PUT saía em dobro)
    const nova = moverTemplate(templates, id, direcao, true);
    if (nova === templates) return;
    setTemplates(nova);
    persistirOrdem(nova.map((t) => t.id));
  }

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

  // ---- Link "Dados de envio" (RN-024) ----
  // Gera o link do formulário desta cliente e põe a mensagem no rascunho.
  // Se a ficha JÁ está completa (mesma régua da etiqueta), avisa ANTES —
  // para a cliente não ter que mandar tudo de novo.
  const [gerandoDados, setGerandoDados] = useState(false);
  async function inserirLinkDados() {
    if (!selected || gerandoDados) return;
    setGerandoDados(true);
    try {
      const r = await fetch(`/api/customers/${selected.customer.id}/dados-envio`, {
        method: "POST",
      });
      const d = (await r.json()) as { url?: string; completo?: boolean; error?: string };
      if (!r.ok || !d.url) {
        alert(d.error ?? "Não consegui gerar o link. Tente de novo.");
        return;
      }
      if (
        d.completo &&
        !confirm(
          "O cadastro desta cliente já está COMPLETO ✅ (endereço, CEP e CPF/CNPJ).\n\nEnviar o formulário mesmo assim?"
        )
      )
        return;
      const nome = selected.customer.name.split(" ")[0];
      const msg = draft.trim()
        ? `${draft.trim()}\n${d.url}`
        : `Oi ${nome}! 📦 Para eu preparar seu envio, preenche seus dados nesse link rapidinho?\n${d.url}`;
      setDraft(msg);
      taRef.current?.focus();
    } catch {
      alert("Não consegui gerar o link. Tente de novo.");
    } finally {
      setGerandoDados(false);
    }
  }

  // ---- Envio de mídia real (imagem/vídeo/documento) ----
  function pickFile(kind: "IMAGE" | "VIDEO" | "DOCUMENT") {
    setShowAttach(false);
    // uma fila por vez: escolher mais fotos no meio do envio fazia as duas
    // filas dividirem a mesma barra — a primeira a terminar escondia o
    // andamento da outra, e a tela voltava a parecer travada
    if (filaFotos) {
      alert("Espere as fotos atuais terminarem de sair para escolher outras. 📷");
      return;
    }
    // gravando voz: a barra da fila cobriria os botões de parar/cancelar e o
    // microfone ficaria aberto sem jeito de encerrar
    if (recording || preparando) {
      alert("Termine o áudio antes de enviar arquivos. 🎤");
      return;
    }
    fileKindRef.current = kind;
    if (fileRef.current) {
      fileRef.current.accept =
        kind === "IMAGE" ? "image/*" : kind === "VIDEO" ? "video/*" : "*/*";
      // VÁRIAS FOTOS DE UMA VEZ (pedido do dono, 27/08/2026): a vendedora
      // mandava a arara peça por peça, abrindo o seletor a cada foto. Só
      // para FOTO: vídeo e documento pesam 3 MB cada, e vinte deles seriam
      // minutos de espera com risco de bloqueio do número.
      fileRef.current.multiple = kind === "IMAGE";
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  /**
   * Respiro entre uma foto e a próxima na fila. O envio de mídia sai em
   * segundo plano (a resposta volta assim que a linha é gravada), então sem
   * esta pausa os vinte envios de verdade aconteceriam praticamente juntos —
   * o padrão de rajada que faz o WhatsApp desconfiar da conta (RN-017).
   *
   * 2s é maior que o tempo típico de subida de uma foto: na prática elas
   * chegam na ordem escolhida. NÃO é promessa — quem entrega é o servidor
   * Evolution, e uma foto pesada pode ultrapassar a pausa. Ordem garantida
   * exigiria segurar o pedido aberto até o envio terminar, que é justamente
   * o que matava a função no meio e fazia a cliente receber duas vezes.
   */
  const MS_ENTRE_FOTOS = 2000;

  const blobToDataUrl = (b: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(b);
    });

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    // a lista do seletor é viva: copiamos ANTES de qualquer espera, senão a
    // próxima escolha (que zera o campo) apagaria a fila no meio do envio
    const escolhidos = Array.from(e.target.files ?? []);
    const file = escolhidos[0];
    if (!file || !selected) return;
    const kind = fileKindRef.current;

    // FOTO É COMPRIMIDA NO APARELHO (como o WhatsApp faz): foto de celular
    // tem 4–12 MB e o teto de envio é ~4,5 MB — sem comprimir, NENHUMA foto
    // tirada na hora passava ("arquivo muito pesado" em todas)
    //
    // VÁRIAS FOTOS SAEM UMA ATRÁS DA OUTRA, esperando cada uma terminar.
    // Três motivos para a fila (e não todas de uma vez):
    //  1. o teto de tamanho é POR pedido — vinte fotos juntas num pedido só
    //     seriam recusadas na hora;
    //  2. disparar vinte envios ao mesmo tempo é o que faz o WhatsApp
    //     desconfiar da conta (RN-017); em fila, sai no ritmo de gente;
    //  3. na prática a ordem se mantém: a pausa entre elas é maior que a
    //     subida de uma foto (não é promessa — quem entrega é o servidor
    //     do WhatsApp).
    // Quem espera é o NAVEGADOR, nunca o servidor: cada foto é um envio
    // normal, com a própria bolha (⏱️ → ✓, ou ⚠️ com "Reenviar"). Falhou a
    // sétima? As outras dezenove seguem — a fila não para.
    if (kind === "IMAGE") {
      const fotos = escolhidos.slice(0, TETO_FOTOS_DE_UMA_VEZ);
      if (escolhidos.length > TETO_FOTOS_DE_UMA_VEZ) {
        alert(
          `Dá para mandar até ${TETO_FOTOS_DE_UMA_VEZ} fotos de uma vez. Vou enviar as ${TETO_FOTOS_DE_UMA_VEZ} primeiras — repita para o resto. 📷`
        );
      }
      const convDaFila = selected.id;
      const naoLidas: string[] = [];
      let falhas = 0;
      let enviadas = 0;
      // a foto 0 pode ser pulada (ilegível e grande): "i > 0" deixava a
      // conversa sem dona na tela até o sync de 3s trazer de volta
      let jaAssumiu = false;
      cancelarFilaRef.current = false;
      setFilaFotos({ feito: 0, total: fotos.length, convId: convDaFila });
      try {
        for (let i = 0; i < fotos.length; i++) {
          if (cancelarFilaRef.current) break;
          const foto = fotos[i];
          // UMA foto problemática não pode derrubar a fila: qualquer erro
          // aqui (arquivo corrompido, leitura que falha) é anotado e a
          // próxima segue. Sem este try, a leitura que estoura levava as
          // fotos 8 a 20 embora em silêncio, e a barra sumia da tela.
          try {
            const comprimida = await comprimirFoto(foto);
            // formato que o navegador não leu (HEIC antigo, arquivo torto):
            // segue o plano B de sempre — vai CRUA, se couber no teto do
            // envio. Não cabendo, é anotada e a fila SEGUE.
            if (!comprimida && foto.size > 3 * 1024 * 1024) {
              naoLidas.push(foto.name);
              continue;
            }
            const foi = await sendPayload(
              {
                kind: "TEXT",
                mediaType: "IMAGE",
                mediaUrl: comprimida ?? (await blobToDataUrl(foto)),
                fileName: comprimida ? nomeJpeg(foto.name) : foto.name,
                body: "📷 Imagem",
              },
              // a conversa é assumida no PRIMEIRO envio de verdade; os
              // outros dezenove não repetem o mesmo PATCH
              { pularAssumir: jaAssumiu }
            );
            jaAssumiu = true;
            if (foi) {
              enviadas++;
              falhas = 0;
            } else {
              // A BOLHA ⚠️ com "Reenviar" já está na tela por conta do
              // sendPayload — aqui só decidimos se vale seguir. Três
              // seguidas é servidor fora do ar, não azar: insistir seriam
              // dezessete esperas longas com a tela presa.
              falhas++;
              if (falhas >= 3) {
                alert(
                  "As últimas fotos não estão saindo — parei a fila aqui. Verifique a conexão do WhatsApp e reenvie pelas bolhas com ⚠️."
                );
                break;
              }
            }
          } catch {
            naoLidas.push(foto.name);
          } finally {
            setFilaFotos({ feito: i + 1, total: fotos.length, convId: convDaFila });
          }
          // RESPIRO ENTRE AS FOTOS. O envio de mídia sai em segundo plano (a
          // resposta volta assim que a linha é gravada), então sem esta
          // pausa os vinte envios de verdade aconteceriam praticamente
          // juntos — que é o padrão de rajada que faz o WhatsApp desconfiar
          // da conta (RN-017). Quem espera é o NAVEGADOR: o servidor nunca
          // fica com o pedido aberto, que foi a lição do áudio (a função
          // morria no meio e a bolha dizia "falhou" com a mídia entregue).
          if (i < fotos.length - 1 && !cancelarFilaRef.current) {
            await new Promise((r) => setTimeout(r, MS_ENTRE_FOTOS));
          }
        }
      } finally {
        setFilaFotos(null);
        cancelarFilaRef.current = false;
        setParandoFila(false);
      }
      if (naoLidas.length > 0) {
        alert(
          `Não consegui abrir ${naoLidas.length === 1 ? "esta foto" : `estas ${naoLidas.length} fotos`}: ${naoLidas.slice(0, 5).join(", ")}${naoLidas.length > 5 ? "…" : ""}. O formato não foi reconhecido e o arquivo é grande demais para ir como está — salve como JPG e tente de novo. Enviei ${enviadas === 1 ? "1 foto" : `${enviadas} fotos`}; confira as bolhas com ⚠️, se houver. 📷`
        );
      }
      return;
    }

    // teto REAL do envio: o servidor corta o pedido perto de 4,5 MB e o
    // base64 infla 1/3 — 3 MB de arquivo é o máximo que chega inteiro.
    // (O teto antigo de 16 MB era mentira: passava aqui e morria no servidor.)
    const limitMb = 3;
    if (file.size > limitMb * 1024 * 1024) {
      alert(
        kind === "VIDEO"
          ? "Vídeo muito grande (máximo 3 MB). Para vídeo longo, envie pelo aplicativo do WhatsApp."
          : `Arquivo muito grande (máximo ${limitMb} MB).`
      );
      return;
    }
    const dataUrl = await blobToDataUrl(file);
    await sendPayload({
      kind: "TEXT",
      mediaType: kind,
      mediaUrl: dataUrl,
      fileName: file.name,
      // foto já saiu pela fila lá em cima; aqui sobram vídeo e documento
      body: kind === "VIDEO" ? "🎬 Vídeo" : `📎 ${file.name}`,
    });
  }

  // ---- Gravação de áudio (voz) ----
  async function startRecording() {
    // na conversa que está com a fila, a barra é dela: sem esta trava a
    // gravação começava sem mostrar nem o tempo nem o botão de parar. Em
    // OUTRA conversa a vendedora grava normalmente enquanto as fotos saem.
    if (!selected || recording || preparando) return;
    if (filaFotos && filaFotos.convId === selected.id) return;
    let microfoneAberto: MediaStream | null = null;
    // zera o cancelamento ANTES de abrir o microfone: a espera de assentar
    // olha esta bandeira para saber se a pessoa desistiu no meio
    recCancelRef.current = false;
    try {
      // MICROFONE EM QUALIDADE DE GRAVAÇÃO, não de chamada. O cancelamento
      // de eco é feito para conversa ao vivo (com o alto-falante tocando a
      // outra ponta) e some com parte da voz; aqui é gravação, não existe eco
      // para cancelar. A supressão de ruído e o ganho automático FICAM: loja
      // de confecção é barulhenta e nem todo mundo fala perto do microfone.
      // O MICROFONE ESCOLHIDO MANDA — e, se ele sumiu (headset fora da
      // tomada, outra porta USB), volta para o padrão AVISANDO. Falhar calado
      // seria repetir o defeito: gravar por um microfone que não é o que a
      // pessoa acha que está usando.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: restricoesDeAudio(micId),
        });
      } catch (e) {
        const todos = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        // só volta ao padrão quando o aparelho REALMENTE sumiu — permissão
        // negada não pode apagar a escolha da vendedora (ver `microfoneSumiu`)
        if (
          !microfoneSumiu(
            (e as { name?: string })?.name,
            micId,
            todos.filter((d) => d.kind === "audioinput")
          )
        )
          throw e;
        escolherMicrofone(null, "");
        setAviso("O microfone escolhido sumiu — gravando pelo padrão do computador.");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: restricoesDeAudio(null),
        });
      }
      microfoneAberto = stream;
      // de onde o som está vindo DE VERDADE (a barra mostra durante a gravação)
      setMicNome(nomeCurtoDoMicrofone(stream.getAudioTracks()[0]?.label));

      // DEIXA O MICROFONE ASSENTAR ANTES DE GRAVAR (26/08/2026: "no primeiro
      // segundo tá estourado, depois fica bom").
      //
      // O ganho automático do navegador começa alto e leva um instante para
      // encontrar o volume da voz — esse instante ia inteiro para dentro da
      // gravação. Meio segundo de espera joga a subida do ganho FORA do
      // arquivo, e é por isso que o resto do áudio sempre soou bom.
      //
      // A barra aparece na hora dizendo "Preparando…": a vendedora vê que o
      // toque funcionou e sabe que ainda não é hora de falar.
      setPreparando(true);
      await new Promise((r) => setTimeout(r, MS_ASSENTAR_MICROFONE));
      setPreparando(false);
      // desistiu no meio da espera (fechou a conversa, tocou em cancelar)
      if (recCancelRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      recChunksRef.current = [];
      // Bitrate no PADRÃO do navegador de propósito: subir aqui engorda o
      // webm original, que é justamente o que vai quando o WAV não cabe no
      // envio — um áudio longo que passava começaria a ser recusado. O ganho
      // de qualidade vem da taxa do WAV, não daqui.
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        recRef.current = null; // não deixa um gravador morto para trás
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
        // teto REAL: o servidor corta o pedido em ~4,5 MB (base64 infla 1/3).
        // A conversão RECEBE o teto: é ele que decide a taxa (quanto maior a
        // taxa, menos abafada a voz — e quanto mais longo o áudio, menor a
        // taxa que cabe).
        const TETO = TETO_AUDIO_BYTES;
        const convertido = await gravacaoParaWav(original, TETO);
        const blob = convertido && convertido.size <= TETO ? convertido : original;
        if (blob.size > TETO) {
          alert("Áudio muito longo — grave em partes menores.");
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
    } catch (e) {
      // o microfone pode JÁ ter sido aberto quando a falha aconteceu: sem
      // desligar, a luzinha fica acesa até recarregar a página — e a lojista
      // acha que o sistema está ouvindo. A mensagem também tem que dizer a
      // verdade: nem toda falha aqui é permissão negada.
      microfoneAberto?.getTracks().forEach((t) => t.stop());
      setPreparando(false); // senão a barra ficava presa em "Preparando…"
      const semPermissao =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "SecurityError");
      alert(
        semPermissao
          ? "Não consegui acessar o microfone. Verifique a permissão do navegador."
          : "Não consegui começar a gravação neste aparelho. Tente de novo ou use outro navegador."
      );
    }
  }
  function stopRecording(cancel: boolean) {
    recCancelRef.current = cancel;
    // DURANTE OS 500ms DE "PREPARANDO…" o gravador ainda nem existe. Chamar
    // stop() num gravador já parado estoura InvalidStateError (o `recRef`
    // guardava o gravador da vez anterior); e sem apagar o "Preparando…" a
    // barra ficava meio segundo na tela parecendo que o toque não pegou.
    // Quem desiste aqui é atendido pela bandeira, que a espera confere.
    setPreparando(false);
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  const applyTemplate = (body: string) => {
    const name = selected?.customer.name.split(" ")[0] ?? "";
    // mesma tolerância do resolveTemplate: {{nome}} e {nome} funcionam
    setDraft(
      body
        .replaceAll("{{nome}}", name)
        .replaceAll("{nome}", name)
        .replaceAll("{{vendedora}}", currentUserName.split(" ")[0])
        .replaceAll("{vendedora}", currentUserName.split(" ")[0])
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

  // pergunta "existe outro cadastro dessa mesma pessoa?" ao abrir a conversa
  const clienteAberto = selected?.customer.id ?? null;
  useEffect(() => {
    setParecidosDe(null);
    if (!clienteAberto) return;
    let vivo = true;
    fetch(`/api/customers/${clienteAberto}/parecidos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.parecidos?.length)
          setParecidosDe({ customerId: clienteAberto, lista: d.parecidos });
      })
      .catch(() => {
        // rede oscilou: sem aviso é melhor do que aviso errado
      });
    return () => {
      vivo = false;
    };
  }, [clienteAberto]);
  // o aviso só vale para o contato que está na tela AGORA: a limpeza do
  // efeito roda depois do desenho, e sem esta conferência o aviso do contato
  // anterior aparecia por um instante embaixo do nome do novo
  const parecidos =
    parecidosDe && parecidosDe.customerId === clienteAberto
      ? parecidosDe.lista
      : [];

  return (
    <>
    <div
      ref={shellRef}
      className="inbox-raiz flex overflow-hidden bg-white -mx-4 -mt-4 -mb-24 h-[calc(100dvh-var(--chat-reserva,120px)-var(--kb,0px))] rounded-none border-0 shadow-none md:-mx-8 md:-mt-8 md:-mb-8 md:h-[calc(100dvh-var(--inbox-top,0px))]"
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
              placeholder="Buscar nome, telefone ou palavra da conversa..."
              className="w-full rounded-xl bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white pl-9 pr-9 py-2 text-sm outline-none transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                title="Limpar busca"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {/* deixa claro que a busca varre as três abas — senão o resultado
              "de outra gaveta" parece bug */}
          {search.trim() && (
            <p className="-mt-1 mb-2 px-1 text-[11px] text-gray-400">
              {filtered.length === 0
                ? buscando
                  ? "Procurando nas conversas…"
                  : "Nada encontrado: nem contato com esse nome ou telefone, nem conversa com essa palavra."
                : `${filtered.length} ${filtered.length === 1 ? "resultado" : "resultados"} em Chats, Fila e Contatos.`}
            </p>
          )}
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

          {/* filtros: "Não lidas" (igual WhatsApp) + etiquetas (tags) */}
          <div className="flex gap-1.5 overflow-x-auto thin-scroll mt-2 pb-0.5">
            <button
              onClick={() => setSoNaoLidas((v) => !v)}
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                soNaoLidas
                  ? "bg-emerald-500 text-white"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
              title="Mostrar só as conversas com mensagem esperando resposta"
            >
              <span
                className={`size-1.5 rounded-full ${soNaoLidas ? "bg-white" : "bg-emerald-500"}`}
              />
              Não lidas
              {naoLidasNaLista > 0 && (
                <span
                  className={`min-w-4 px-1 rounded-full text-[10px] font-bold ${
                    soNaoLidas ? "bg-white/25 text-white" : "bg-emerald-500 text-white"
                  }`}
                >
                  {naoLidasNaLista}
                </span>
              )}
            </button>
            {/* fica na tela enquanto o filtro estiver LIGADO, mesmo que a
                contagem caia a zero — senão a lista fica vazia e sem como
                desligar (achado da revisão) */}
            {(favoritasNaLista > 0 || soFavoritas) && (
              <button
                onClick={() => setSoFavoritas((v) => !v)}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                  soFavoritas
                    ? "bg-amber-400 text-white"
                    : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
                title="Mostrar só as conversas favoritas"
              >
                <Star
                  className={`size-3 ${soFavoritas ? "fill-white" : "fill-amber-400 text-amber-400"}`}
                />
                Favoritas
                <span
                  className={`min-w-4 px-1 rounded-full text-[10px] font-bold ${
                    soFavoritas ? "bg-white/25 text-white" : "bg-amber-400 text-white"
                  }`}
                >
                  {favoritasNaLista}
                </span>
              </button>
            )}
            {tags.length > 0 && (
              <>
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
              </>
            )}
          </div>
        </div>

        <div
          ref={listaRef}
          onScroll={medirALista}
          className="flex-1 overflow-y-auto thin-scroll relative"
        >
          {/* filtro "Não lidas" escondendo conversas que EXISTEM: dizer a
              verdade e oferecer a saída — o vazio genérico ("Fila vazia 🎉")
              faria a vendedora largar a fila achando que não há ninguém */}
          {filtered.length === 0 && soNaoLidas && filtradasBase.length > 0 && (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-semibold text-gray-700">
                Tudo lido por aqui ✅
              </p>
              <p className="text-xs text-gray-400 mt-1">
                O filtro <b>Não lidas</b> está ligado e {filtradasBase.length}{" "}
                {filtradasBase.length === 1
                  ? "conversa está escondida"
                  : "conversas estão escondidas"}
                .
              </p>
              <button
                onClick={() => setSoNaoLidas(false)}
                className="mt-3 rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
              >
                Mostrar todas
              </button>
            </div>
          )}
          {filtered.length === 0 && !(soNaoLidas && filtradasBase.length > 0) && (
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
          {filtered.slice(0, visiveis).map((c) => {
            const last = c.messages[c.messages.length - 1];
            const waiting =
              tab === "fila" && (c.lastInboundAt ?? c.createdAt);
            return (
              <button
                key={c.id}
                onClick={() => {
                  // o clique que vem depois do toque longo é descartado
                  if (menuAbriuNoToque.current) {
                    menuAbriuNoToque.current = false;
                    return;
                  }
                  selectConv(c.id);
                  // achou pela palavra? vai direto na mensagem (a mais recente)
                  if (achados[c.id]?.length) irParaAchado(c.id, 0);
                }}
                // CLIQUE DIREITO (computador) abre o menu no ponto do clique
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuConv({ conv: c, em: { x: e.clientX, y: e.clientY } });
                }}
                // TOQUE LONGO (celular): meio segundo segurando. O timer é
                // cancelado no primeiro movimento do dedo, senão rolar a
                // lista abriria o menu no meio do caminho.
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  if (!t) return;
                  const em = { x: t.clientX, y: t.clientY };
                  inicioDoToque.current = em;
                  menuAbriuNoToque.current = false;
                  toqueLongo.current = setTimeout(() => {
                    toqueLongo.current = null;
                    menuAbriuNoToque.current = true;
                    setMenuConv({ conv: c, em });
                    try {
                      navigator.vibrate?.(10);
                    } catch {
                      /* navegador sem vibração */
                    }
                  }, 500);
                }}
                onTouchMove={(e) => {
                  // TREMOR DO DEDO NÃO É ROLAGEM. Cancelar no primeiro pixel
                  // impedia o menu de abrir em quem não tem a mão firme.
                  const t = e.touches[0];
                  const i = inicioDoToque.current;
                  if (!t || !i) return;
                  if (Math.abs(t.clientX - i.x) > 10 || Math.abs(t.clientY - i.y) > 10)
                    cancelarToqueLongo();
                }}
                onTouchEnd={cancelarToqueLongo}
                onTouchCancel={cancelarToqueLongo}
                className={`w-full text-left px-4 py-3 flex gap-3 items-start border-b border-gray-50 transition hover:bg-gray-50 ${
                  selectedId === c.id ? "bg-brand-50/60" : ""
                }`}
              >
                <Avatar name={c.customer.name} color="#c4622d" src={c.customer.photoUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {c.priority === "ALTA" && (
                        <Flag className="size-3 text-rose-500 shrink-0" />
                      )}
                      {/* por que esta conversa está no topo / marcada */}
                      {c.pinned && <Pin className="size-3 shrink-0 text-gray-400" />}
                      {c.favorite && (
                        <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                      )}
                      {c.customer.blockedAt && (
                        <Ban className="size-3 shrink-0 text-rose-500" />
                      )}
                      {c.customer.name}
                    </p>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {listStamp(c.lastMessageAt)}
                    </span>
                  </div>
                  {achados[c.id]?.length ? (
                    // a PALAVRA buscada, pintada no trecho em que apareceu
                    // (como no aplicativo); mais de uma mensagem, diz quantas
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {achados[c.id].length > 1 && (
                        <span className="mr-1 rounded-full bg-brand-100 text-brand-700 px-1.5 text-[10px] font-bold">
                          {achados[c.id].length} msgs
                        </span>
                      )}
                      {achados[c.id][0].trecho.antes}
                      <mark className="rounded-sm bg-amber-200 px-0.5 text-ink">
                        {achados[c.id][0].trecho.casa}
                      </mark>
                      {achados[c.id][0].trecho.depois}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {last ? prefixoDaPrevia(last) + last.body : "Sem mensagens"}
                    </p>
                  )}
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
          {/* O ATALHO PEDIDO PELA LOJA (RN-046): a vendedora faz follow-up de
              baixo para cima e pediu "algum meio de descer sem ter que
              rolar". Cola na base da coluna e some quando a lista cabe na
              tela — em lista curta seria enfeite tampando conversa. */}
          {atalhoDaLista && (
            <button
              type="button"
              onClick={() => irNaLista(atalhoDaLista)}
              aria-label={
                atalhoDaLista === "fim"
                  ? "Ir para o fim da lista"
                  : "Voltar ao topo da lista"
              }
              title={
                atalhoDaLista === "fim"
                  ? "Ir para o fim da lista"
                  : "Voltar ao topo da lista"
              }
              className="sticky bottom-3 left-full z-10 mr-3 -mt-11 flex size-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-md transition hover:border-brand-300 hover:text-brand-600"
            >
              {atalhoDaLista === "fim" ? (
                <ChevronDown className="size-5" />
              ) : (
                <ChevronUp className="size-5" />
              )}
            </button>
          )}
          {filtered.length > visiveis && (
            <button
              onClick={() => setVisiveis((v) => v + BLOCO)}
              className="w-full py-3 text-[13px] font-semibold text-brand-600 hover:bg-brand-50/60 transition"
            >
              Mostrar mais {Math.min(BLOCO, filtered.length - visiveis)} de{" "}
              {filtered.length - visiveis} restantes
            </button>
          )}
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
                  {
                    icon: <UserCheck className="size-3.5 text-emerald-500" />,
                    t: "O nome de quem respondeu fica registrado na mensagem — só a equipe vê, a cliente nunca. Respondendo pelo celular, o WhatsApp não informa quem digitou e o sistema marca 📱 pelo celular.",
                  },
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
              {/* FOTO DA CLIENTE, CLICÁVEL — o retrato de 32px não serve para
                  reconhecer ninguém. Toque abre no mesmo visor de tela cheia
                  das fotos do chat (com zoom). Sem foto não vira botão: as
                  iniciais coloridas não têm o que ampliar. */}
              {selected.customer.photoUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    setFotoAberta({
                      src: selected.customer.photoUrl!,
                      legenda: selected.customer.name,
                    })
                  }
                  className="shrink-0 rounded-full transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  title="Ver foto da cliente"
                  aria-label={`Ver foto de ${selected.customer.name}`}
                >
                  <Avatar
                    name={selected.customer.name}
                    color="#c4622d"
                    src={selected.customer.photoUrl}
                  />
                </button>
              ) : (
                <Avatar name={selected.customer.name} color="#c4622d" src={null} />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/clientes/${selected.customer.id}`}
                  className="text-sm font-semibold hover:text-brand-600 truncate block"
                >
                  {selected.customer.name}
                </Link>
                <p className="text-[11px] text-gray-400 truncate">
                  {/* a pessoa por trás da razão social (RN-024) */}
                  {selected.customer.waName?.trim() &&
                  selected.customer.waName.trim() !== selected.customer.name.trim()
                    ? `${selected.customer.waName} · `
                    : ""}
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
                    <span className="hidden sm:inline">Reabrir</span>
                  </button>
                ) : !selected.assignee ? (
                  <button
                    onClick={() => assumir(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 transition"
                  >
                    <Hand className="size-3.5" />
                    <span className="hidden sm:inline">Assumir</span>
                  </button>
                ) : (
                  <button
                    onClick={() => encerrar(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-emerald-300 hover:text-emerald-700 text-gray-600 text-xs font-semibold px-3 py-2 transition"
                  >
                    <CheckCircle2 className="size-3.5" />
                    <span className="hidden sm:inline">Encerrar</span>
                  </button>
                )}
                <button
                  onClick={() => marcarNaoLida(selected.id)}
                  className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-300 transition"
                  title="Marcar como não lida (volto nessa depois)"
                  aria-label="Marcar como não lida"
                >
                  <MailOpen className="size-4" />
                </button>
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

            {/* MESMA PESSOA EM DOIS CADASTROS: quem está conversando precisa
                saber ANTES de responder — a outra conversa pode ter o resto
                do assunto, e um dos números pode estar errado (não entrega) */}
            {parecidos.length > 0 && !parecidoOculto.has(selected.id) && (
              <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50/80 shrink-0">
                <div className="flex items-start gap-2">
                  <Users className="size-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-amber-800">
                      Parece a mesma pessoa cadastrada {parecidos.length + 1}×
                    </p>
                    <p className="text-[11px] text-amber-700 leading-snug mt-0.5">
                      Cada cadastro tem a SUA conversa — o resto do assunto pode
                      estar na outra, e um dos números pode estar errado (aí a
                      mensagem sai e não chega). Confira qual é o certo:
                    </p>
                    <div className="flex flex-col gap-1.5 mt-1.5">
                      {parecidos.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/clientes/${p.id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2 py-1 text-[11px] font-medium text-amber-800 hover:border-amber-400 transition"
                          >
                            {p.name} · {formatPhone(p.phone)}
                          </Link>
                          {podeGerenciar && (
                            <button
                              type="button"
                              disabled={unificando === p.id}
                              onClick={() => unificarAqui(p)}
                              className="inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60"
                            >
                              {unificando === p.id ? "Unificando…" : "Unificar aqui"}
                            </button>
                          )}
                          {p.motivo && (
                            <span className="basis-full text-[11px] text-amber-700 leading-snug">
                              {p.motivo}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setParecidoOculto((v) => new Set(v).add(selected.id))
                    }
                    className="text-amber-400 hover:text-amber-600 shrink-0"
                    title="Já conferi, esconder"
                    aria-label="Esconder aviso"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            )}

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
              {/* A PALAVRA BUSCADA NESTA CONVERSA: quantas vezes apareceu e
                  ▲▼ para andar entre elas (a lista abre na mais recente) */}
              {search.trim() && achados[selected.id]?.length ? (
                <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-2 flex items-center gap-2 border-b border-amber-100 bg-amber-50/95 px-4 py-2 text-xs text-amber-800">
                  <Search className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    <b>{achados[selected.id].length}</b>{" "}
                    {achados[selected.id].length === 1 ? "mensagem" : "mensagens"} com “
                    {search.trim()}”
                    {achados[selected.id].length > 1 &&
                      ` · ${posAchado + 1} de ${achados[selected.id].length}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => irParaAchado(selected.id, posAchado + 1)}
                    disabled={posAchado >= achados[selected.id].length - 1}
                    title="Mais antiga"
                    className="rounded-lg p-1 hover:bg-amber-100 disabled:opacity-30"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => irParaAchado(selected.id, posAchado - 1)}
                    disabled={posAchado <= 0}
                    title="Mais recente"
                    className="rounded-lg p-1 hover:bg-amber-100 disabled:opacity-30"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                </div>
              ) : null}
              {/* HISTÓRICO: o começo da conversa não fica inacessível */}
              {selected.messages.length >= 100 && !semMais.has(selected.id) && (
                <div className="flex justify-center pb-2">
                  <button
                    onClick={() => carregarAnteriores(selected.id)}
                    disabled={carregandoAntigas}
                    className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-[12px] font-semibold text-gray-600 shadow-sm transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
                  >
                    {carregandoAntigas ? "Carregando…" : "Ver mensagens anteriores"}
                  </button>
                </div>
              )}
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
                    <div id={`msg-${m.id}`} className="flex justify-center">
                      <div
                        className={`max-w-[85%] rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800 ${
                          destaqueMsgId === m.id ? "ring-2 ring-amber-400" : ""
                        }`}
                      >
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
                    id={`msg-${m.id}`}
                    className={`group flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    {/* ⋯ no desktop (hover); no celular é "segurar" a bolha */}
                    {!isTemp && !editando && (
                      <button
                        onClick={() => setActionMsg(m)}
                        className={`hidden md:block self-center p-1 rounded-full text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-500 hover:bg-gray-100 transition ${
                          // na mensagem da CLIENTE o ⋯ vai para depois da bolha
                          // (é dela que se copia pedido, chave Pix e endereço)
                          mine ? "mr-1" : "ml-1 order-last"
                        }`}
                        title="Opções da mensagem"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    )}
                    <div
                      onTouchStart={
                        !isTemp && !editando
                          ? (e) => {
                              startLongPress(m);
                              swipeStart(m, e);
                            }
                          : undefined
                      }
                      onTouchEnd={() => {
                        cancelLongPress();
                        swipeEnd();
                      }}
                      onTouchMove={(e) => {
                        // mover o dedo cancela o "segurar" (é rolagem ou arrasto)
                        cancelLongPress();
                        if (!isTemp && !editando) swipeMove(m, e);
                      }}
                      onContextMenu={
                        !isTemp && !editando
                          ? (e) => {
                              e.preventDefault();
                              setActionMsg(m);
                            }
                          : undefined
                      }
                      className={`relative max-w-[80%] touch-pan-y rounded-2xl px-3.5 py-2 text-sm shadow-sm transition-transform duration-100 ${
                        mine
                          ? // SELECIONAR E COPIAR TAMBÉM O QUE A LOJA MANDOU
                            // (pedido do dono, 26/08/2026). A bolha da loja
                            // era a ÚNICA com `select-none`: veio junto do
                            // "arrastar para responder", para o dedo não
                            // começar a marcar texto no meio do arrasto. Só
                            // que o arrasto é gesto de DEDO — no computador
                            // não existe, e a trava ali só impedia a
                            // vendedora de copiar a própria mensagem (o Pix
                            // que ela mandou, o endereço, a medida da peça).
                            // No celular a trava fica, e copiar continua indo
                            // pelo "Copiar mensagem" do menu da bolha.
                            `bg-brand-600 text-white rounded-br-md selection:bg-white/30 selection:text-white ${
                              noComputador ? "select-text" : "select-none"
                            }`
                          : "bg-white text-ink rounded-bl-md"
                      } ${m.revoked ? "opacity-90" : ""} ${
                        // a pastilha da reação fica PENDURADA na beirada de
                        // baixo: sem essa folga ela cobria a bolha seguinte
                        m.reaction || m.reactionStore ? "mb-3" : ""
                      } ${
                        // a mensagem achada pela lupa chega em DESTAQUE
                        destaqueMsgId === m.id
                          ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-[#f4f1f8]"
                          : ""
                      }`}
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
                        <div className="relative flex flex-col gap-1.5 min-w-[220px]">
                          {/* emoji NA EDIÇÃO: o mesmo seletor do compositor,
                              aberto em cima da bolha (embaixo ficaria cortado
                              pela borda do chat na última mensagem) */}
                          {showEmojiEdicao && (
                            <SeletorDeEmoji
                              onEscolher={inserirEmojiNaEdicao}
                              className="absolute bottom-full right-0 mb-1 w-80 max-w-[85vw] text-ink"
                            />
                          )}
                          <textarea
                            ref={editTaRef}
                            autoFocus
                            value={editMsgDraft}
                            onChange={(e) => setEditMsgDraft(e.target.value)}
                            onKeyDown={(e) => {
                              // no celular Enter quebra linha; salvar é no ✓
                              if (e.key === "Enter" && !e.shiftKey && enterEnvia) {
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
                              type="button"
                              onClick={() => setShowEmojiEdicao((v) => !v)}
                              title="Emoji"
                              className={`mr-auto rounded-lg p-1 hover:bg-white/15 ${
                                showEmojiEdicao ? "text-white" : "text-white/80"
                              }`}
                            >
                              <Smile className="size-4" />
                            </button>
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
                          <MediaContent
                            m={m}
                            aoAbrirFoto={(src) =>
                              setFotoAberta({ src, legenda: legendaDaMidia(m) })
                            }
                          />
                          {/* LEGENDA DA MÍDIA: o texto que a cliente escreveu
                              junto da foto. Antes a tela só desenhava texto
                              quando a mensagem era texto PURO — numa foto, a
                              legenda ficava invisível, mesmo estando gravada.
                              A cliente mandava a peça e escrevia "essa no P,
                              3 unidades" embaixo, e a vendedora não via. */}
                          {(m.mediaType === "TEXT" || m.mediaType === "TEMPLATE"
                            ? m.body
                            : legendaDaMidia(m)) && (
                            <p
                              className={`whitespace-pre-wrap break-words ${
                                m.revoked ? "italic opacity-80" : ""
                              }`}
                            >
                              {m.mediaType === "TEXT" || m.mediaType === "TEMPLATE"
                                ? m.body
                                : legendaDaMidia(m)}
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
                          {/* QUEM RESPONDEU — informação só da equipe: nunca
                              vai junto no texto que a cliente recebe */}
                          {mine &&
                            (() => {
                              const a = autoriaDaMensagem(m);
                              if (!a) return null;
                              return (
                                <span
                                  title={a.detalhe}
                                  className={
                                    a.tipo === "PESSOA"
                                      ? "font-semibold"
                                      : "italic opacity-90"
                                  }
                                >
                                  {a.tipo === "CELULAR" ? "📱 " : ""}
                                  {a.rotulo} ·
                                </span>
                              );
                            })()}
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

                      {/* REAÇÕES — penduradas na beirada da bolha, como no
                          aplicativo. Uma de cada lado: 👤 a da cliente e a da
                          loja. Tocar abre o menu para trocar ou tirar. */}
                      {(m.reaction || m.reactionStore) && !editando && (
                        <button
                          type="button"
                          onClick={() => setActionMsg(m)}
                          title={
                            [
                              m.reaction ? `Cliente reagiu ${m.reaction}` : null,
                              m.reactionStore ? `Você reagiu ${m.reactionStore}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                          className={`absolute -bottom-3 flex items-center gap-0.5 rounded-full border border-gray-100 bg-white px-1.5 py-0.5 text-[13px] leading-none shadow-sm transition hover:scale-105 ${
                            mine ? "right-2" : "left-2"
                          }`}
                        >
                          {m.reaction && <span>{m.reaction}</span>}
                          {m.reactionStore && <span>{m.reactionStore}</span>}
                        </button>
                      )}
                    </div>
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
                <div className="painel-flutuante absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl border border-gray-100 shadow-pop max-h-72 overflow-y-auto thin-scroll z-10">
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
                        onFocus={aoFocarCampoPainel}
                        placeholder="Atalho (ex: boas-vindas)"
                        className="w-full rounded-lg bg-white border border-gray-200 focus:border-brand-300 px-2.5 py-1.5 text-xs outline-none"
                      />
                      <textarea
                        value={newTplBody}
                        onChange={(e) => setNewTplBody(e.target.value)}
                        onFocus={aoFocarCampoPainel}
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
                        <div
                          key={t.id}
                          className="flex items-center gap-1 pr-2 hover:bg-brand-50 transition border-b border-gray-50 last:border-0"
                        >
                          <button
                            onClick={() => applyTemplate(t.body)}
                            className="flex-1 min-w-0 text-left px-4 py-2.5"
                          >
                            <p className="text-xs font-semibold text-brand-700">
                              {t.title}
                            </p>
                            <p className="text-xs text-gray-500 line-clamp-2">
                              {t.body}
                            </p>
                          </button>
                          {/* setinhas: reordenam DENTRO da categoria */}
                          <span className="flex flex-col shrink-0">
                            <button
                              onClick={() => moverResposta(t.id, "subir")}
                              aria-label={`Subir ${t.title}`}
                              title="Subir"
                              className="p-1 rounded text-gray-300 hover:text-brand-600 hover:bg-brand-100/60"
                            >
                              <ChevronUp className="size-3.5" />
                            </button>
                            <button
                              onClick={() => moverResposta(t.id, "descer")}
                              aria-label={`Descer ${t.title}`}
                              title="Descer"
                              className="p-1 rounded text-gray-300 hover:text-brand-600 hover:bg-brand-100/60"
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                          </span>
                        </div>
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
                    <span className="text-[10px] font-medium">Fotos</span>
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
              {/* seletor de emoji 😊 — com barra de pesquisa */}
              {showEmoji && (
                <SeletorDeEmoji
                  onEscolher={insertEmoji}
                  className="absolute bottom-full left-3 right-3 sm:right-auto sm:w-96 mb-1"
                />
              )}
              {/* editor das mensagens automáticas (catálogo + pedido) */}
              {showCatMsgEdit && (
                <>
                {/* fundo escuro só no celular: fecha ao tocar fora */}
                <div
                  onClick={() => setShowCatMsgEdit(false)}
                  className="sm:hidden fixed inset-0 z-40 bg-black/40"
                />
                {/*
                  No CELULAR este editor é uma janela ANCORADA NO TOPO: como
                  balão nascendo do campo de escrita, o teclado empurrava o
                  painel e o primeiro campo saía pela borda de cima da tela.
                  No computador continua o balão de sempre (sm:).
                */}
                <div className="fixed left-3 right-3 top-14 z-50 max-h-[60vh] sm:absolute sm:top-auto sm:bottom-full sm:left-3 sm:right-auto sm:w-[26rem] sm:mb-1 sm:z-20 sm:max-h-[70vh] bg-white rounded-xl border border-gray-100 shadow-pop p-3 overflow-y-auto thin-scroll">
                  <p className="text-[11px] font-bold text-gray-500 mb-2">
                    Mensagens automáticas
                  </p>

                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1 mb-1.5">
                    <Link2 className="size-3" /> Link do catálogo
                  </p>
                  <textarea
                    value={catMsgDraft}
                    onChange={(e) => setCatMsgDraft(e.target.value)}
                    onFocus={aoFocarCampoPainel}
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
                    onFocus={aoFocarCampoPainel}
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
                </>
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
                {/* microfone: o ícone grava, a setinha ao lado escolhe de
                    qual aparelho vem o som (um controle só) */}
                <EscolherMicrofone
                  escolhidoId={micId}
                  onEscolher={escolherMicrofone}
                  onGravar={startRecording}
                  gravando={recording}
                />
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
                  onClick={inserirLinkDados}
                  disabled={gerandoDados}
                  className="p-2 text-gray-400 hover:text-brand-600 transition shrink-0 disabled:opacity-50"
                  title="Dados de envio: a cliente preenche o próprio cadastro (avisa se já está completo)"
                >
                  <PackageOpen className="size-4.5" />
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
                {/* SAÍDA COM O TECLADO ABERTO (relato do dono, 21/08/2026):
                    no celular o teclado esconde a barra de baixo E empurra o
                    cabeçalho do chat (onde mora o ← Voltar) para fora da
                    tela — a lojista ficava presa na conversa e fechava o app
                    para sair. Este botão fecha o teclado e traz a tela de
                    volta ao topo, devolvendo o caminho de saída. Só aparece
                    no celular e só enquanto o teclado está aberto
                    (regra `.so-com-teclado` em globals.css). */}
                <button
                  onClick={() => {
                    // desfoca QUALQUER campo em foco, não só o de mensagem: o
                    // botão também aparece com o teclado aberto na resposta
                    // rápida e nas mensagens automáticas
                    (document.activeElement as HTMLElement | null)?.blur?.();
                    // iOS às vezes deixa a página rolada depois do teclado:
                    // sem isto o cabeçalho podia continuar fora da tela
                    window.scrollTo({ top: 0 });
                  }}
                  className="so-com-teclado items-center gap-0.5 border-l border-gray-200 pl-1.5 pr-0.5 py-2 text-gray-500 shrink-0 min-[380px]:ml-1 min-[380px]:gap-1 min-[380px]:pl-2 min-[380px]:pr-1"
                  title="Fechar o teclado"
                  aria-label="Fechar o teclado"
                >
                  <ChevronDown className="size-4.5" />
                  {/* em tela bem estreita fica só a seta: com o rótulo, a
                      barra de ícones estourava a largura e o botão saía da
                      tela justamente quando é necessário */}
                  <span className="hidden min-[380px]:inline text-[11px] font-medium">
                    teclado
                  </span>
                </button>
                </div>
                <div className="flex items-end gap-1.5 order-1 sm:order-none sm:flex-1 min-w-0">
                {/* A ORDEM AQUI É REGRA, NÃO ESTILO (incidente 28/08/2026):
                    gravação vem ANTES da fila de fotos — microfone aberto
                    precisa dos botões de parar/enviar na tela. A tentativa
                    anterior ("recording ? null : fila ? …") apagava a área
                    INTEIRA ao tocar no microfone: as barras de "Preparando"
                    e "Gravando" ficavam inalcançáveis depois do `null`, e
                    NINGUÉM conseguia mandar áudio. */}
                {filaFotos &&
                filaFotos.convId === selected.id &&
                !recording &&
                !preparando ? (
                  /* FILA DE FOTOS: sem isto, a vendedora escolhia vinte e a
                     barra ficava muda por meio minuto — parecia travado, e
                     mandar de novo faria a cliente receber tudo em dobro */
                  <div className="flex-1 flex items-center gap-2 py-1.5">
                    <span className="size-2.5 rounded-full bg-brand-500 animate-pulse shrink-0" />
                    <span className="text-sm font-medium text-brand-600 tabular-nums">
                      {parandoFila
                        ? "Parando…"
                        : `Enviando foto ${Math.min(filaFotos.feito + 1, filaFotos.total)} de ${filaFotos.total}…`}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden min-w-[40px]">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all"
                        style={{ width: `${(filaFotos.feito / filaFotos.total) * 100}%` }}
                      />
                    </div>
                    {/* PARAR: sem isto, escolher a pasta errada (ou o WhatsApp
                        fora do ar) prendia a vendedora até a última foto */}
                    <button
                      onClick={() => {
                        cancelarFilaRef.current = true;
                        // o ref sozinho não redesenha: a barra seguia dizendo
                        // "enviando" por vários segundos e o toque parecia
                        // não ter funcionado
                        setParandoFila(true);
                      }}
                      disabled={parandoFila}
                      className="p-2 rounded-xl text-gray-400 hover:text-rose-600 transition shrink-0 disabled:opacity-40"
                      title="Parar de enviar as próximas"
                    >
                      <X className="size-4.5" />
                    </button>
                  </div>
                ) : preparando ? (
                  /* meio segundo entre o toque e a gravação de verdade: a
                     barra avisa que o sistema entendeu e que ainda não é
                     hora de falar (é a subida do ganho do microfone) */
                  <div className="flex-1 flex items-center gap-2 py-1.5">
                    <span className="size-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    <span className="text-sm font-medium text-amber-600">
                      Preparando o microfone…
                    </span>
                    <span className="flex-1" />
                    <button
                      onClick={() => stopRecording(true)}
                      className="p-2 rounded-xl text-gray-400 hover:text-rose-600 transition shrink-0"
                      title="Cancelar"
                    >
                      <Trash2 className="size-4.5" />
                    </button>
                  </div>
                ) : recording ? (
                  <div className="flex-1 flex items-center gap-2 py-1.5">
                    <span className="size-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span className="text-sm font-medium text-rose-600 tabular-nums">
                      Gravando… {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}
                    </span>
                    {/* DE ONDE O SOM ESTÁ VINDO. Sem isto, gravar pelo
                        microfone errado só era descoberto quando a cliente
                        reclamava do áudio. */}
                    {micNome && (
                      <span className="hidden min-[380px]:inline truncate text-[11px] text-gray-400">
                        · {micNome}
                      </span>
                    )}
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
                    if (e.key === "Enter" && !e.shiftKey && enterEnvia) {
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
                    reaction: null,
                    reactionStore: null,
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
            campanhas={campanhas}
            podeVincular={podeVincularCampanha}
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

    {/* visor de foto em tela cheia (toque na foto; toque de novo dá zoom).
        Sai pelo Portal: dentro do painel do chat ele ficava preso atrás do
        cabeçalho e da barra de navegação no celular. */}
    {fotoAberta && (
      <Portal>
        <VisorDeFoto
          src={fotoAberta.src}
          legenda={fotoAberta.legenda}
          onClose={() => setFotoAberta(null)}
        />
      </Portal>
    )}

    {menuConv && (
      <Portal>
        <MenuDaConversa
          em={menuConv.em}
          noComputador={noComputador}
          onFechar={() => setMenuConv(null)}
          acoes={{
            fixada: menuConv.conv.pinned,
            favorita: menuConv.conv.favorite,
            bloqueada: Boolean(menuConv.conv.customer.blockedAt),
            podeBloquear: podeGerenciar,
            onFixar: () =>
              mexerNaConversa(menuConv.conv.id, { pinned: !menuConv.conv.pinned }),
            onFavoritar: () =>
              mexerNaConversa(menuConv.conv.id, { favorite: !menuConv.conv.favorite }),
            onNaoLida: () => mexerNaConversa(menuConv.conv.id, { markUnread: true }),
            onBloquear: () => bloquearCliente(menuConv.conv),
          }}
        />
      </Portal>
    )}

    {encaminhando && (
      <Portal>
        <EncaminharMensagem
          previa={
            textoDaMensagem(encaminhando) ||
            (encaminhando.mediaType === "IMAGE"
              ? "📷 Foto"
              : encaminhando.mediaType === "VIDEO"
                ? "🎬 Vídeo"
                : encaminhando.mediaType === "AUDIO"
                  ? "🎤 Áudio"
                  : (encaminhando.fileName ?? "📎 Arquivo"))
          }
          conversas={convs}
          conversaAtualId={selectedId}
          onFechar={() => setEncaminhando(null)}
          onEncaminhar={encaminharPara}
        />
      </Portal>
    )}

    {/* folha de ações da mensagem (segurar no celular / ⋯ no computador):
        sobe de baixo no celular, centralizada no computador — nunca corta */}
    {aviso && (
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4"
      >
        <span className="rounded-full bg-ink/90 px-4 py-2 text-[13px] font-semibold text-white shadow-pop">
          {aviso}
        </span>
      </div>
    )}
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
          {/* REAGIR COM EMOJI — primeira coisa da folha, como no aplicativo:
              é o gesto mais usado e o mais rápido. O emoji já escolhido fica
              marcado; tocar nele de novo tira a reação. Nota interna não sai
              para o WhatsApp, então não tem no que reagir. */}
          {actionMsg.kind !== "NOTE" &&
            !actionMsg.revoked &&
            actionMsg.status !== "FALHOU" && (
            <div className="flex items-center justify-between gap-1 px-2 pb-2 pt-1 border-b border-gray-100">
              {EMOJIS_REACAO.map((e) => (
                <button
                  key={e}
                  onClick={() => reagir(actionMsg, e)}
                  className={`grid size-10 place-items-center rounded-full text-xl transition hover:scale-110 ${
                    actionMsg.reactionStore === e ? "bg-brand-100" : "hover:bg-gray-100"
                  }`}
                  title={actionMsg.reactionStore === e ? "Tirar a reação" : `Reagir ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
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
          {/* ENCAMINHAR: os dois lados. Chegou a foto da peça nova e ela
              manda para as clientes que perguntaram; ou repassa o endereço
              que ela mesma escreveu. Nota interna não sai do CRM. */}
          {/* `temp-` = bolha que a tela desenhou na hora e o servidor ainda
              não confirmou: encaminhar dela mandaria um id que não existe */}
          {actionMsg.kind !== "NOTE" &&
            !actionMsg.revoked &&
            actionMsg.status !== "FALHOU" &&
            !actionMsg.id.startsWith("temp-") && (
            <button
              onClick={() => {
                setEncaminhando(actionMsg);
                setActionMsg(null);
              }}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Forward className="size-4 text-brand-600" /> Encaminhar
            </button>
          )}
          {/* Copiar: vale para a mensagem da CLIENTE também — é dela que se
              copia pedido, chave Pix e endereço */}
          {textoDaMensagem(actionMsg) && (
            <button
              onClick={() => copiarMensagem(textoDaMensagem(actionMsg))}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Copy className="size-4 text-gray-400" /> Copiar mensagem
            </button>
          )}
          {/* SALVAR O ARQUIVO — foto, vídeo, áudio ou documento, tanto o que a
              cliente mandou quanto o que a loja mandou. É um LINK de verdade
              (não um botão com JavaScript): é assim que o celular oferece
              "Salvar em Fotos"/"Baixar". O `?baixar=1` faz o servidor mandar
              como arquivo, com nome e extensão — sem isso o navegador só
              ABRIA a foto e não havia como guardar (pedido do dono,
              26/08/2026). */}
          {actionMsg.mediaUrl &&
            actionMsg.mediaType !== "TEXT" &&
            !actionMsg.id.startsWith("temp-") && (
            <a
              href={linkParaSalvar(actionMsg.mediaUrl)}
              download={actionMsg.fileName ?? ""}
              onClick={() => setActionMsg(null)}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Download className="size-4 text-gray-400" />
              {actionMsg.mediaType === "IMAGE"
                ? "Salvar foto"
                : actionMsg.mediaType === "VIDEO"
                  ? "Salvar vídeo"
                  : actionMsg.mediaType === "AUDIO"
                    ? "Salvar áudio"
                    : "Salvar arquivo"}
            </a>
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
