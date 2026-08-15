"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, AtSign, ArrowRightLeft, Check, Sun } from "lucide-react";
import { Portal } from "./portal";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string;
  convId: string | null;
  orderId?: string | null;
  read: boolean;
  createdAt: string;
};

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / (60 * 24))}d`;
}

/** Sino de notificações internas (menções e transferências de atendimento). */
export function NotificationBell({ dark = false }: { dark?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  // posição do painel na TELA (não no sino): no celular o sino fica no rodapé
  // do menu, perto do meio — o painel "colado" nele estourava a borda direita
  // e o texto saía cortado. Calculada ao abrir e presa às bordas.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  function abrir() {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const margem = 8;
      const width = Math.min(320, window.innerWidth - margem * 2);
      // GEOMETRIA, não tema: abre para o lado onde há mais espaço (o sino do
      // rodapé abre para cima, o do topo para baixo — e qualquer sino futuro
      // se resolve sozinho) e ancora no lado do sino mais próximo da borda.
      const abreParaCima = r.top > window.innerHeight - r.bottom;
      const alinhaPelaDireita = r.left > window.innerWidth / 2;
      // preso às bordas: nunca sai da tela, nem pela esquerda nem pela direita
      const left = Math.min(
        Math.max(margem, alinhaPelaDireita ? r.right - width : r.left),
        window.innerWidth - width - margem
      );
      setPos(
        abreParaCima
          ? { bottom: window.innerHeight - r.top + margem, left, width }
          : { top: r.bottom + margem, left, width }
      );
    }
    setOpen(true);
    load();
  }

  // Girou o celular / mudou o tamanho da janela com o painel aberto: a
  // posição fixa calculada na abertura pode ficar fora da tela nova. Fechar
  // é o comportamento honesto — reabrir recalcula certo.
  useEffect(() => {
    if (!open) return;
    const fechar = () => setOpen(false);
    window.addEventListener("resize", fechar);
    window.addEventListener("orientationchange", fechar);
    return () => {
      window.removeEventListener("resize", fechar);
      window.removeEventListener("orientationchange", fechar);
    };
  }, [open]);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (res.ok) {
      const d = await res.json();
      setItems(d.items);
      setUnread(d.unread);
    }
  }, []);

  useEffect(() => {
    load();
    // aba em segundo plano não consulta (economia de bateria/servidor);
    // ao voltar, atualiza na hora
    const tick = () => {
      if (document.visibilityState !== "hidden") load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const t = setInterval(tick, 45000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // O fechar-ao-clicar-fora é o VÉU atrás do painel (Portal), não um ouvinte
  // de documento: o painel vive no <body>, fora deste embrulho — o ouvinte
  // antigo fechava o painel em qualquer toque DENTRO dele.

  async function markAll() {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  async function openNotif(n: Notif) {
    setOpen(false);
    if (!n.read) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      });
    }
    // pedido tem prioridade: o aviso é sobre a venda, e é a tela do pedido
    // que resolve (definir vendedora, cobrar, conferir estoque)
    if (n.orderId) router.push(`/pedidos/${n.orderId}`);
    else if (n.convId) router.push(`/whatsapp?conv=${n.convId}`);
  }

  const iconCls = dark
    ? "text-creme/40 hover:text-ocre hover:bg-creme/5"
    : "text-slate-500 hover:text-brand-600 hover:bg-slate-100";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (open ? setOpen(false) : abrir())}
        title="Notificações"
        className={`relative p-1.5 rounded-lg transition ${iconCls}`}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && pos && (
        <Portal>
          {/* véu invisível: toque fora fecha (o painel vive no <body>, fora do
              alcance do clique-fora por contains) */}
          <div className="fixed inset-0 z-[69]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[70] bg-white rounded-xl border border-slate-200 shadow-pop overflow-hidden"
            style={{
              left: pos.left,
              width: pos.width,
              ...(pos.top !== undefined ? { top: pos.top } : {}),
              ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
            }}
          >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Notificações</p>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="text-[11px] font-medium text-brand-600 hover:underline flex items-center gap-1"
              >
                <Check className="size-3" />
                Marcar todas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto thin-scroll">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Nenhuma notificação por aqui. 🔔
              </p>
            ) : (
              items.map((n) => {
                // AGENDA = a lista de "quem chamar hoje" das automações
                const Icon =
                  n.type === "MENTION"
                    ? AtSign
                    : n.type === "AGENDA"
                      ? Sun
                      : ArrowRightLeft;
                return (
                  <button
                    key={n.id}
                    onClick={() => openNotif(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 border-b border-slate-50 last:border-0 transition hover:bg-slate-50 ${
                      n.read ? "" : "bg-brand-50/50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
                        n.type === "MENTION"
                          ? "bg-violet-100 text-violet-600"
                          : "bg-sky-100 text-sky-600"
                      }`}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">
                          {n.title}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {ago(n.createdAt)}
                        </span>
                      </span>
                      {n.body && (
                        <span className="block text-xs text-slate-500 line-clamp-2 mt-0.5">
                          {n.body}
                        </span>
                      )}
                    </span>
                    {!n.read && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                    )}
                  </button>
                );
              })
            )}
          </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
