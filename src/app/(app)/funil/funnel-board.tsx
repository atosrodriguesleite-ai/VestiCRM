"use client";

import { useState, useRef, useEffect } from "react";
import { Portal } from "@/components/portal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Clock,
  Plus,
  X,
  Trash2,
  ShoppingCart,
  ShoppingBag,
} from "lucide-react";
import { brl, relativeDays, dateShort, formatPhone, originLabel, originColor } from "@/lib/format";
import { numeroBR } from "@/lib/numero-br";
import { orderNumber, orderStatusLabel } from "@/lib/orders";
import { Avatar, Badge } from "@/components/ui";
import type { Origin } from "@prisma/client";

export type BoardCard = {
  id: string;
  title: string;
  value: number;
  customerId: string;
  customerName: string;
  origin: Origin;
  phone: string;
  lastInteractionAt: string;
  ownerName: string | null;
  ownerColor: string;
  tags: { name: string; color: string }[];
  nextTask: { title: string; dueAt: string } | null;
  lostReason: string | null;
  order: {
    id: string;
    number: number;
    status: string;
    total: number;
    items: { name: string; variant: string; quantity: number; unitPrice: number }[];
  } | null;
  cart: { value: number; items: string[] } | null;
  behavior: {
    visits: number;
    seconds: number;
    productsViewed: number;
    added: number;
    removed: number;
  } | null;
};

/** Duração amigável: "3m 20s", "45s". */
function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Link simples para chamar o cliente no WhatsApp. */
function waHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits.length <= 11 ? "55" + digits : digits}`;
}

/** Link de recuperação no WhatsApp (mensagem pronta com as peças da sacola). */
function recoverHref(card: BoardCard): string | null {
  const digits = card.phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const num = digits.length <= 11 ? "55" + digits : digits;
  const first = card.customerName.split(" ")[0];
  const pieces = card.cart?.items.length
    ? ` Vi que você separou ${card.cart.items.join(", ")}.`
    : "";
  const msg = `Oi ${first}!${pieces} Quer que eu finalize seu pedido? Qualquer dúvida sobre tamanho ou cor, me chama! 💛`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

export type BoardStage = {
  id: string;
  name: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
  cards: BoardCard[];
};

export function FunnelBoard({
  initialStages,
  customers,
  canDelete,
}: {
  initialStages: BoardStage[];
  customers: { id: string; name: string }[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<BoardCard | null>(null);
  const [erroMover, setErroMover] = useState("");
  // arrastou para "Perdido": guarda o movimento até a lojista dizer o motivo
  const [perguntarMotivo, setPerguntarMotivo] = useState<{
    cardId: string;
    fromStageId: string;
    toStageId: string;
  } | null>(null);
  const dragCard = useRef<{ cardId: string; fromStage: string } | null>(null);

  // O QUADRO PRECISA OBEDECER O SERVIDOR.
  //
  // O estado nascia de `useState(initialStages)` e nunca mais olhava para a
  // prop. Como `router.refresh()` re-renderiza o servidor MAS preserva o
  // estado do componente, a tela ficava mentindo: cartão movido que o servidor
  // recusou continuava na coluna nova, e oportunidade recém-criada não
  // aparecia (a lojista criava de novo, gerando duplicata). Este efeito é o
  // que faz a tela voltar para a verdade.
  useEffect(() => {
    setStages(initialStages);
  }, [initialStages]);

  async function moveCard(
    cardId: string,
    fromStageId: string,
    toStageId: string,
    lostReason?: string
  ) {
    if (fromStageId === toStageId) return;
    const toStage = stages.find((s) => s.id === toStageId);
    if (!toStage) return;

    // Perdeu a venda? Pergunta o motivo numa LISTA, não numa caixinha do
    // navegador: o `window.prompt` não funciona em vários celulares (onde a
    // lojista trabalha) e o cartão era perdido sem motivo nenhum. Texto livre
    // também inutilizava o relatório — "preço", "Preço" e "achou caro" viravam
    // três barras diferentes.
    if (toStage.isLost && lostReason === undefined) {
      setPerguntarMotivo({ cardId, fromStageId, toStageId });
      return;
    }

    // guarda o estado atual para desfazer se o servidor recusar
    const anterior = stages;

    // otimista: move na UI antes da API responder
    setStages((prev) => {
      const card = prev
        .find((s) => s.id === fromStageId)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return prev;
      return prev.map((s) => {
        if (s.id === fromStageId)
          return { ...s, cards: s.cards.filter((c) => c.id !== cardId) };
        if (s.id === toStageId)
          return {
            ...s,
            cards: [
              { ...card, lastInteractionAt: new Date().toISOString(), lostReason: lostReason ?? null },
              ...s.cards,
            ],
          };
        return s;
      });
    });

    // DESFAZ quando não deu certo. Antes, falha de rede (celular no 4G) ou
    // recusa do servidor deixavam o cartão na coluna nova só na tela: a
    // negociação continuava aberta no banco e ninguém cobrava a cliente.
    try {
      const res = await fetch(`/api/opportunities/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: toStageId, lostReason }),
      });
      if (!res.ok) {
        setStages(anterior);
        // o servidor explica a recusa (ex.: "cancele o pedido primeiro") —
        // mostrar a explicação é o que ensina o caminho certo
        const d = await res.json().catch(() => null);
        setErroMover(d?.error ?? "Não foi possível mover o cartão. Tente de novo.");
        router.refresh();
      }
    } catch {
      setStages(anterior);
      setErroMover("Sem conexão. O cartão voltou para onde estava.");
    }
  }

  async function deleteCard(cardId: string, stageId: string) {
    if (
      !window.confirm(
        "Excluir esta oportunidade do funil?\n\n" +
          "Se o pedido dela nasceu junto (pelo catálogo), esse pedido também " +
          "será apagado e o estoque/faturamento voltam ao normal. Pedido que " +
          "já existia antes é mantido — só o cartão sai do funil. Isso NÃO " +
          "pode ser desfeito."
      )
    )
      return;
    // otimista: some da UI na hora
    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId
          ? { ...s, cards: s.cards.filter((c) => c.id !== cardId) }
          : s
      )
    );
    const res = await fetch(`/api/opportunities/${cardId}`, { method: "DELETE" });
    if (!res.ok) {
      // o servidor pode recusar com motivo (ex.: pedido com Pix confirmado)
      const d = await res.json().catch(() => null);
      alert(d?.error ?? "Não foi possível excluir. Tente de novo.");
      router.refresh();
    } else {
      router.refresh();
    }
  }

  return (
    <>
      {erroMover && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="flex-1 text-sm text-rose-700">{erroMover}</p>
          <button
            onClick={() => setErroMover("")}
            className="shrink-0 text-rose-400 hover:text-rose-600"
            aria-label="Fechar aviso"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {perguntarMotivo && (
        <MotivoDaPerda
          onCancelar={() => setPerguntarMotivo(null)}
          onEscolher={(motivo) => {
            const m = perguntarMotivo;
            setPerguntarMotivo(null);
            moveCard(m.cardId, m.fromStageId, m.toStageId, motivo);
          }}
        />
      )}

      <div className="flex-1 flex gap-3 overflow-x-auto pb-4 thin-scroll -mx-4 px-4 md:mx-0 md:px-0">
        {stages.map((stage) => {
          const total = stage.cards.reduce((s, c) => s + c.value, 0);
          return (
            <div
              key={stage.id}
              className={`w-[280px] shrink-0 rounded-2xl flex flex-col max-h-[calc(100dvh-220px)] transition ${
                dragOver === stage.id
                  ? "bg-brand-50 ring-2 ring-brand-300"
                  : "bg-gray-100/70"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(stage.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const info = dragCard.current;
                if (info) moveCard(info.cardId, info.fromStage, stage.id);
                dragCard.current = null;
              }}
            >
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />
                  <h3 className="text-[13px] font-semibold flex-1 truncate">
                    {stage.name}
                  </h3>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {stage.cards.length}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 ml-4.5 tabular-nums">
                  {total > 0 ? brl(total) : "—"}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto thin-scroll px-2 pb-2 space-y-2">
                {stage.cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => {
                      dragCard.current = { cardId: card.id, fromStage: stage.id };
                    }}
                    onClick={() => setDetail(card)}
                    className="bg-white rounded-xl border border-gray-100 shadow-card p-3 cursor-pointer active:cursor-grabbing hover:shadow-pop hover:border-brand-200 transition group animate-fade-in"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/clientes/${card.customerId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-semibold leading-tight hover:text-brand-600 transition"
                      >
                        {card.customerName}
                      </Link>
                      {card.value > 0 && (
                        <span className="text-xs font-semibold text-emerald-600 tabular-nums shrink-0">
                          {brl(card.value)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {card.title}
                    </p>

                    {/* Pedido enviado ou sacola do cliente — abre o detalhe */}
                    {card.order ? (
                      <button
                        type="button"
                        onClick={() => setDetail(card)}
                        className="mt-2 w-full flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] font-medium px-2 py-1.5 hover:bg-emerald-100 transition"
                      >
                        <ShoppingBag className="size-3.5 shrink-0" />
                        <span className="truncate">
                          Pedido {orderNumber(card.order.number)} · {brl(card.order.total)}
                        </span>
                      </button>
                    ) : card.cart ? (
                      <div className="mt-2 space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setDetail(card)}
                          className="w-full flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-medium px-2 py-1.5 hover:bg-amber-100 transition"
                        >
                          <ShoppingCart className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {card.cart.items.length > 0
                              ? `${card.cart.items.length} ${card.cart.items.length === 1 ? "item" : "itens"} na sacola`
                              : "Sacola"}{" "}
                            · {brl(card.cart.value)}
                          </span>
                        </button>
                        {recoverHref(card) && (
                          <a
                            href={recoverHref(card)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold px-2 py-1.5 transition"
                          >
                            <MessageCircle className="size-3.5" />
                            Recuperar no WhatsApp
                          </a>
                        )}
                      </div>
                    ) : null}

                    {/* etiqueta do canal de origem sempre visível + tags */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      <Badge color={originColor[card.origin]}>
                        {originLabel[card.origin]}
                      </Badge>
                      {card.tags.slice(0, 3).map((t) => (
                        <Badge key={t.name} color={t.color}>
                          {t.name}
                        </Badge>
                      ))}
                    </div>

                    {card.nextTask && (
                      <p className="flex items-center gap-1.5 text-[11px] text-amber-600 mt-2 truncate">
                        <Clock className="size-3 shrink-0" />
                        {card.nextTask.title} · {dateShort(card.nextTask.dueAt)}
                      </p>
                    )}
                    {stage.isLost && card.lostReason && (
                      <p className="text-[11px] text-rose-500 mt-2">
                        Motivo: {card.lostReason}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-gray-50">
                      {waHref(card.phone) ? (
                        <a
                          href={waHref(card.phone)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Abrir conversa no WhatsApp"
                          className="flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 font-medium transition"
                        >
                          <MessageCircle className="size-3" />
                          {formatPhone(card.phone)}
                        </a>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-gray-400">
                          <MessageCircle className="size-3" />
                          {formatPhone(card.phone)}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5">
                        {canDelete && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCard(card.id, stage.id);
                            }}
                            title="Excluir oportunidade"
                            aria-label="Excluir oportunidade"
                            // área de toque decente no celular: com p-0.5 o alvo
                            // tinha 18px e o dedo acertava o card em vez do botão
                            className="text-gray-300 hover:text-rose-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition p-2 -m-1 md:p-0.5 md:m-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                        <span className="text-[10px] text-gray-300">
                          {relativeDays(card.lastInteractionAt)}
                        </span>
                        {card.ownerName && (
                          <Avatar
                            name={card.ownerName}
                            color={card.ownerColor}
                            size="sm"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {stage.cards.length === 0 && (
                  <div className="text-center text-[11px] text-gray-300 py-6 border border-dashed border-gray-200 rounded-xl mx-1">
                    Arraste um card aqui
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* botão nova oportunidade */}
      <button
        onClick={() => setShowNew(true)}
        className="fixed bottom-20 md:bottom-8 right-4 md:right-8 z-30 size-12 rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-pop flex items-center justify-center transition active:scale-95"
        title="Nova oportunidade"
      >
        <Plus className="size-5" />
      </button>

      {showNew && (
        <NewOpportunityModal
          customers={customers}
          stages={stages.filter((s) => !s.isWon && !s.isLost)}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}

      {detail && (
        <CardDetailModal
          card={detail}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          currentStageId={
            stages.find((s) => s.cards.some((c) => c.id === detail.id))?.id ?? null
          }
          onMove={(toStageId) => {
            const from = stages.find((s) =>
              s.cards.some((c) => c.id === detail.id)
            );
            setDetail(null);
            if (from) moveCard(detail.id, from.id, toStageId);
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}

function CardDetailModal({
  card,
  stages,
  currentStageId,
  onMove,
  onClose,
}: {
  card: BoardCard;
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  onMove: (toStageId: string) => void;
  onClose: () => void;
}) {
  const wa = recoverHref(card);
  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <h3 className="font-semibold text-lg truncate">{card.customerName}</h3>
            <p className="text-xs text-gray-400">
              {formatPhone(card.phone)} ·{" "}
              <span style={{ color: originColor[card.origin] }} className="font-semibold">
                {originLabel[card.origin]}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 p-1 shrink-0">
            <X className="size-5" />
          </button>
        </div>

        {card.order ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                <ShoppingBag className="size-4" />
                Pedido {orderNumber(card.order.number)}
              </span>
              <Badge color="#059669">
                {orderStatusLabel[card.order.status as keyof typeof orderStatusLabel] ??
                  card.order.status}
              </Badge>
            </div>
            <ul className="divide-y divide-gray-50">
              {card.order.items.map((it, i) => (
                <li key={i} className="py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{it.name}</p>
                    {it.variant && (
                      <p className="text-xs text-gray-400">{it.variant}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">
                    {it.quantity} × {brl(it.unitPrice)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums text-brand-700">{brl(card.order.total)}</span>
            </div>
            <Link
              href={`/pedidos/${card.order.id}`}
              className="mt-4 block text-center text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Abrir pedido completo →
            </Link>
          </div>
        ) : card.cart ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                <ShoppingCart className="size-4" />
                Sacola do cliente
              </span>
              <span className="text-sm font-semibold text-gray-500 tabular-nums">
                {brl(card.cart.value)}
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Peças que o cliente colocou na sacola no catálogo e ainda não finalizou.
            </p>
            {card.cart.items.length > 0 ? (
              <ul className="space-y-1.5">
                {card.cart.items.map((it) => (
                  <li key={it} className="text-sm text-gray-700 flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />
                    {it}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">
                Sacola de {brl(card.cart.value)} (itens não detalhados nesta sessão).
              </p>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 text-sm transition"
              >
                <MessageCircle className="size-4" />
                Recuperar no WhatsApp
              </a>
            )}
          </div>
        ) : null}

        {/* Resumo do comportamento no catálogo */}
        {card.behavior && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Comportamento no catálogo
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Visitas", String(card.behavior.visits)],
                ["Tempo", fmtDuration(card.behavior.seconds)],
                ["Produtos vistos", String(card.behavior.productsViewed)],
                ["Adicionou", String(card.behavior.added)],
                ["Removeu", String(card.behavior.removed)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-gray-50 px-2 py-1.5">
                  <p className="text-sm font-semibold tabular-nums">{value}</p>
                  <p className="text-[10px] text-gray-400 leading-tight">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mover de etapa por TOQUE: no celular o arrastar não existe (o
            navegador não dispara drag no dedo) — sem isto, a lojista que
            trabalha pelo celular não conseguia avançar nem fechar negociação */}
        {currentStageId && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              Etapa da negociação
            </label>
            <select
              value={currentStageId}
              onChange={(e) => {
                if (e.target.value !== currentStageId) onMove(e.target.value);
              }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-brand-400"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Escolha a etapa para mover o card — no computador também dá para
              arrastar.
            </p>
          </div>
        )}

        {/* Ações: chamar no WhatsApp + comportamento completo */}
        <div className="mt-4 flex flex-col gap-2">
          {waHref(card.phone) && !card.cart && (
            <a
              href={waHref(card.phone)!}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 text-sm transition"
            >
              <MessageCircle className="size-4" />
              Chamar no WhatsApp
            </a>
          )}
          <Link
            href={`/clientes/${card.customerId}`}
            className="block text-center text-xs font-medium text-gray-400 hover:text-brand-600"
          >
            Ver ficha e comportamento completo
          </Link>
        </div>
      </div>
    </div></Portal>
  );
}

function NewOpportunityModal({
  customers,
  stages,
  onClose,
  onCreated,
}: {
  customers: { id: string; name: string }[];
  stages: BoardStage[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // lead que ainda não é cliente (chegou pelo WhatsApp, indicação...):
  // cadastra na hora, sem sair do funil
  const [newCustomer, setNewCustomer] = useState(customers.length === 0);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    let cid = customerId;
    if (newCustomer) {
      if (!newName.trim() || newPhone.replace(/\D/g, "").length < 10) {
        setSaving(false);
        setError("Informe nome e WhatsApp com DDD do novo lead.");
        return;
      }
      const rc = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.replace(/\D/g, ""),
          origin: "WHATSAPP",
          skipOpportunity: true, // a oportunidade é criada logo abaixo, manual
        }),
      });
      if (!rc.ok) {
        setSaving(false);
        const d = await rc.json().catch(() => null);
        setError(d?.error ?? "Não foi possível cadastrar o lead.");
        return;
      }
      cid = (await rc.json()).id;
    }
    const res = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: cid,
        title,
        // leitura brasileira: "2.500,00" é dois mil e quinhentos — o
        // parseFloat puro parava no ponto de milhar e gravava R$ 2,50
        value: numeroBR(value) ?? 0,
        stageId,
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else {
      // a recusa do servidor explica o porquê (ex.: cliente da carteira de
      // outra vendedora) — engolir a explicação deixava só um erro genérico
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Não foi possível criar a oportunidade.");
    }
  }

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">Nova oportunidade</h3>
          <button type="button" onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium mb-1.5">Cliente</label>
              <button
                type="button"
                onClick={() => setNewCustomer((v) => !v)}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {newCustomer ? "Escolher cliente existente" : "+ Lead novo (nome e WhatsApp)"}
              </button>
            </div>
            {newCustomer ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome do lead *"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="WhatsApp com DDD *"
                  inputMode="tel"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
              </div>
            ) : (
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-brand-400"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              O que o cliente quer?
            </label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Grade de vestidos da coleção nova"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Valor potencial (R$)
              </label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Etapa</label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-brand-400"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <p className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            disabled={saving || (!newCustomer && !customerId)}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            {saving ? "Criando..." : "Criar oportunidade"}
          </button>
        </div>
      </form>
    </div></Portal>
  );
}

/**
 * Motivo da perda — em LISTA, não em caixinha de texto.
 *
 * Antes era um `window.prompt`, que tem dois defeitos graves: não funciona em
 * vários navegadores de celular (onde a lojista trabalha), então o cartão ia
 * para "Perdido" sem motivo nenhum; e, sendo texto livre, "preço", "Preço" e
 * "achou caro" viravam três barras diferentes no relatório — que por isso
 * nunca serviu para decidir nada.
 *
 * Os motivos são os do atacado de moda, na linguagem da loja. "Cancelar"
 * cancela o movimento inteiro: o cartão fica onde estava.
 */
const MOTIVOS_DE_PERDA = [
  "Achou caro",
  "Não fechou o pedido mínimo",
  "Prazo de entrega",
  "Frete caro",
  "Não tinha a grade/tamanho",
  "Comprou de outro fornecedor",
  "Sumiu / não respondeu",
  "Só estava pesquisando",
];

function MotivoDaPerda({
  onEscolher,
  onCancelar,
}: {
  onEscolher: (motivo: string) => void;
  onCancelar: () => void;
}) {
  const [outro, setOutro] = useState("");
  const [mostrarOutro, setMostrarOutro] = useState(false);

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onCancelar} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-lg">Por que não fechou?</h3>
          <button onClick={onCancelar} className="text-gray-300 hover:text-gray-500" aria-label="Cancelar">
            <X className="size-5" />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Escolher o motivo é o que faz o relatório mostrar onde você está
          perdendo venda.
        </p>

        <div className="grid gap-2">
          {MOTIVOS_DE_PERDA.map((m) => (
            <button
              key={m}
              onClick={() => onEscolher(m)}
              className="text-left rounded-xl border border-gray-200 hover:border-brand-400 hover:bg-brand-50 px-4 py-3 text-sm font-medium text-gray-700 transition"
            >
              {m}
            </button>
          ))}

          {!mostrarOutro ? (
            <button
              onClick={() => setMostrarOutro(true)}
              className="text-left rounded-xl border border-dashed border-gray-200 hover:border-brand-400 px-4 py-3 text-sm text-gray-500 transition"
            >
              Outro motivo...
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                value={outro}
                onChange={(e) => setOutro(e.target.value)}
                placeholder="Escreva o motivo"
                maxLength={80}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
              <button
                onClick={() => onEscolher(outro.trim() || "Outro")}
                className="shrink-0 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 transition"
              >
                Salvar
              </button>
            </div>
          )}
        </div>

        <button
          onClick={onCancelar}
          className="mt-4 w-full rounded-xl border border-gray-200 hover:bg-gray-50 py-2.5 text-sm font-medium text-gray-500 transition"
        >
          Cancelar — deixar o cartão onde está
        </button>
      </div>
    </div></Portal>
  );
}
