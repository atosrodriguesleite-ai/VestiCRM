"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X,
  Loader2,
  Phone,
  Mail,
  MapPin,
  ShoppingBag,
  Wallet,
  User as UserIcon,
  StickyNote,
  ExternalLink,
} from "lucide-react";
import { brl, formatPhone, customerTypeLabel, originLabel, dateShort } from "@/lib/format";
import { orderNumber } from "@/lib/orders";

type Ficha = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  type: string;
  origin: string;
  notes: string | null;
  preferredSize: string | null;
  preferredColors: string | null;
  ownerName: string | null;
  lastPurchaseAt: string | null;
  createdAt: string;
  totalSpent: number;
  paidOrders: number;
  tags: { name: string; color: string }[];
  interests: string[];
  orders: {
    id: string;
    number: number;
    total: number;
    status: string;
    paid: boolean;
    createdAt: string;
  }[];
};

/** Painel lateral com a ficha do contato (dados, pedidos e observações). */
export function ContactPanel({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    setFicha(null);
    fetch(`/api/customers/${customerId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Ficha | null) => {
        if (!alive || !d) return;
        setFicha(d);
        setNotes(d.notes ?? "");
        setDirty(false);
      });
    return () => {
      alive = false;
    };
  }, [customerId]);

  async function saveNotes() {
    if (!dirty) return;
    setSavingNotes(true);
    await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setSavingNotes(false);
    setDirty(false);
  }

  const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="flex items-start gap-2 text-sm text-slate-600">
      <span className="mt-0.5 text-slate-300 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <h3 className="text-sm font-semibold text-slate-700">Ficha do contato</h3>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600" title="Fechar">
          <X className="size-4" />
        </button>
      </div>

      {!ficha ? (
        <div className="flex-1 flex items-center justify-center text-gray-300">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-5">
          {/* identidade */}
          <div>
            <Link
              href={`/clientes/${ficha.id}`}
              className="text-base font-semibold text-slate-800 hover:text-brand-600 inline-flex items-center gap-1"
            >
              {ficha.name}
              <ExternalLink className="size-3.5 text-slate-300" />
            </Link>
            <div className="mt-2 space-y-1.5">
              <Row icon={<Phone className="size-3.5" />}>{formatPhone(ficha.phone)}</Row>
              {ficha.email && <Row icon={<Mail className="size-3.5" />}>{ficha.email}</Row>}
              {(ficha.city || ficha.state) && (
                <Row icon={<MapPin className="size-3.5" />}>
                  {[ficha.city, ficha.state].filter(Boolean).join(" · ")}
                </Row>
              )}
              {ficha.ownerName && (
                <Row icon={<UserIcon className="size-3.5" />}>
                  Responsável: <b className="font-medium text-slate-700">{ficha.ownerName}</b>
                </Row>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium px-2 py-0.5">
                {customerTypeLabel[ficha.type as keyof typeof customerTypeLabel] ?? ficha.type}
              </span>
              <span className="rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium px-2 py-0.5">
                {originLabel[ficha.origin as keyof typeof originLabel] ?? ficha.origin}
              </span>
              {ficha.tags.map((t) => (
                <span
                  key={t.name}
                  className="rounded-full text-[11px] font-semibold px-2 py-0.5"
                  style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          </div>

          {/* números de compra */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <Wallet className="size-3" /> Total gasto
              </p>
              <p className="mt-1 text-lg font-bold text-slate-800 tabular-nums">
                {brl(ficha.totalSpent)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <ShoppingBag className="size-3" /> Pedidos pagos
              </p>
              <p className="mt-1 text-lg font-bold text-slate-800 tabular-nums">
                {ficha.paidOrders}
              </p>
            </div>
          </div>

          {/* preferências */}
          {(ficha.preferredSize || ficha.preferredColors || ficha.interests.length > 0) && (
            <div className="text-xs text-slate-500 space-y-1">
              {ficha.preferredSize && (
                <p>Tamanho: <b className="text-slate-700">{ficha.preferredSize}</b></p>
              )}
              {ficha.preferredColors && (
                <p>Cores: <b className="text-slate-700">{ficha.preferredColors}</b></p>
              )}
              {ficha.interests.length > 0 && (
                <p>Interesses: <b className="text-slate-700">{ficha.interests.join(", ")}</b></p>
              )}
            </div>
          )}

          {/* pedidos recentes */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Pedidos recentes
            </p>
            {ficha.orders.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum pedido ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {ficha.orders.map((o) => (
                  <Link
                    key={o.id}
                    href={`/pedidos/${o.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:border-brand-200 hover:bg-brand-50/40 transition"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-slate-700">
                        {orderNumber(o.number)}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {dateShort(o.createdAt)}
                        {o.paid ? " · pago" : ""}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-slate-800 shrink-0">
                      {brl(o.total)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* observações editáveis */}
          <div>
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
              <StickyNote className="size-3" /> Observações
            </p>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              onBlur={saveNotes}
              rows={4}
              placeholder="Anotações sobre o cliente (só a equipe vê)..."
              className="w-full resize-none rounded-xl bg-slate-50 border border-transparent focus:border-brand-300 focus:bg-white px-3 py-2 text-sm outline-none transition"
            />
            <p className="h-4 text-[11px] text-slate-400">
              {savingNotes ? "Salvando…" : dirty ? "Sai do campo para salvar" : "Salvo ✓"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
