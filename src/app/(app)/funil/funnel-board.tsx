"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Clock, Plus, X } from "lucide-react";
import { brl, relativeDays, dateShort, formatPhone } from "@/lib/format";
import { Avatar, Badge } from "@/components/ui";

export type BoardCard = {
  id: string;
  title: string;
  value: number;
  customerId: string;
  customerName: string;
  phone: string;
  lastInteractionAt: string;
  ownerName: string | null;
  ownerColor: string;
  tags: { name: string; color: string }[];
  nextTask: { title: string; dueAt: string } | null;
  lostReason: string | null;
};

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
}: {
  initialStages: BoardStage[];
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const dragCard = useRef<{ cardId: string; fromStage: string } | null>(null);

  async function moveCard(cardId: string, fromStageId: string, toStageId: string) {
    if (fromStageId === toStageId) return;
    const toStage = stages.find((s) => s.id === toStageId);
    if (!toStage) return;

    let lostReason: string | undefined;
    if (toStage.isLost) {
      lostReason =
        window.prompt("Motivo da perda (preço, prazo, sumiu...):") ?? undefined;
    }

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

    const res = await fetch(`/api/opportunities/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: toStageId, lostReason }),
    });
    if (!res.ok) router.refresh();
  }

  return (
    <>
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
                    className="bg-white rounded-xl border border-gray-100 shadow-card p-3 cursor-grab active:cursor-grabbing hover:shadow-pop transition group animate-fade-in"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/clientes/${card.customerId}`}
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

                    {card.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {card.tags.slice(0, 3).map((t) => (
                          <Badge key={t.name} color={t.color}>
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    )}

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
                      <span className="flex items-center gap-1 text-[11px] text-gray-400">
                        <MessageCircle className="size-3" />
                        {formatPhone(card.phone)}
                      </span>
                      <div className="flex items-center gap-1.5">
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
    </>
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
        setError("Não foi possível cadastrar o lead.");
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
        value: parseFloat(value.replace(",", ".")) || 0,
        stageId,
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else setError("Não foi possível criar a oportunidade.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
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
    </div>
  );
}
