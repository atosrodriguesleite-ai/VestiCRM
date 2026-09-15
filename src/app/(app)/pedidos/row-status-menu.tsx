"use client";

/**
 * Selo de status clicável na LISTA de pedidos: muda o status do pedido sem
 * precisar abrir. Um toque abre um menuzinho com os status (ex.: Separação →
 * Enviado). Otimista: muda na hora e o servidor confirma; se alguma regra
 * impedir (sem vendedor, sem estoque...), volta ao anterior e mostra o motivo.
 *
 * A linha inteira é um link para o pedido — por isso o botão e o menu param a
 * propagação/navegação (preventDefault + stopPropagation).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { ORDER_STATUS_FLOW, orderStatusLabel, orderStatusColor } from "@/lib/orders";
import type { OrderStatus } from "@prisma/client";
import { MenuAncorado } from "@/components/menu-ancorado";
import { CancelOrderDialog } from "./cancel-dialog";

export function RowStatusMenu({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderStatus;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState<OrderStatus>(current);
  useEffect(() => setShown(current), [current]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // cancelamento pergunta antes: devolver as peças ao estoque ou baixar de vez?
  const [askCancel, setAskCancel] = useState(false);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    setError("");
    setOpen(true);
  }

  async function pick(
    e: React.MouseEvent | null,
    status: OrderStatus,
    restock?: boolean
  ) {
    e?.preventDefault();
    e?.stopPropagation();
    if (busy || status === shown) {
      setOpen(false);
      return;
    }
    if (status === "CANCELADO" && restock === undefined) {
      setOpen(false);
      setAskCancel(true); // a resposta do diálogo chama de novo com restock
      return;
    }
    const previous = shown;
    setShown(status); // resposta visual imediata
    setOpen(false);
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(restock !== undefined ? { restock } : {}) }),
    });
    setBusy(false);
    if (!res.ok) {
      setShown(previous);
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Não foi possível mudar o status.");
      setOpen(true); // reabre pra mostrar o motivo
      return;
    }
    router.refresh();
  }

  const color = orderStatusColor[shown];

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={busy}
        title="Mudar status"
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset transition hover:brightness-95 disabled:opacity-60"
        style={{
          backgroundColor: `${color}14`,
          color,
          ["--tw-ring-color" as string]: `${color}22`,
        }}
      >
        {orderStatusLabel[shown]}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      {/* São 8 status: no pé da lista o menu não cabia embaixo do selo e os
          últimos ficavam atrás da barra de navegação (relato do dono,
          15/09/2026). O MenuAncorado vira para cima e rola por dentro. */}
      <MenuAncorado
        ancora={btnRef}
        aberto={open}
        onFechar={() => setOpen(false)}
        largura={208}
        className="py-1"
      >
        {error && (
          <p className="mx-1 mb-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-600">
            {error}
          </p>
        )}
        {ORDER_STATUS_FLOW.map((s) => {
          const on = s === shown;
          const c = orderStatusColor[s];
          return (
            <button
              key={s}
              onClick={(e) => pick(e, s)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-gray-50 ${on ? "font-semibold" : "text-gray-700"}`}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c }} />
              <span className="min-w-0 flex-1 truncate">{orderStatusLabel[s]}</span>
              {on && <Check className="size-3.5 shrink-0 text-brand-600" />}
            </button>
          );
        })}
      </MenuAncorado>
      <CancelOrderDialog
        open={askCancel}
        onClose={() => setAskCancel(false)}
        onConfirm={(restock) => {
          setAskCancel(false);
          pick(null, "CANCELADO", restock);
        }}
      />
    </>
  );
}
