"use client";

import Link from "next/link";
import { ShoppingCart, Flame, UserCheck, RotateCcw } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";

type Item = {
  kind: string;
  title: string;
  detail: string;
  customerId?: string;
  value?: number;
};

const STYLE: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  "carrinho-abandonado": { color: "#e11d48", icon: <ShoppingCart className="size-4" />, label: "Carrinho abandonado" },
  "quase-comprando": { color: "#d97706", icon: <Flame className="size-4" />, label: "Quase comprando" },
  "cliente-voltou": { color: "#059669", icon: <UserCheck className="size-4" />, label: "Cliente voltou" },
  "cliente-recorrente": { color: "#7c3aed", icon: <RotateCcw className="size-4" />, label: "Recorrente" },
};

export function RecoveryList({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nenhuma oportunidade de recuperação agora 🎉"
          hint="Carrinhos abandonados e clientes quase comprando aparecem aqui automaticamente."
        />
      </Card>
    );
  }
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {items.map((item, i) => {
        const s = STYLE[item.kind] ?? STYLE["quase-comprando"];
        const body = (
          <Card className="p-4 h-full hover:shadow-pop transition">
            <div className="flex items-start gap-3">
              <span
                className="size-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${s.color}1a`, color: s.color }}
              >
                {s.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: s.color }}>
                    {s.label}
                  </span>
                  {item.value ? (
                    <span className="text-[11px] font-semibold text-gray-500">{brl(item.value)}</span>
                  ) : null}
                </div>
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.detail}</p>
                {item.customerId && (
                  <span className="text-[11px] font-medium text-brand-600 mt-1.5 inline-block">
                    Abrir cliente →
                  </span>
                )}
              </div>
            </div>
          </Card>
        );
        return item.customerId ? (
          <Link key={i} href={`/clientes/${item.customerId}`}>{body}</Link>
        ) : (
          <div key={i}>{body}</div>
        );
      })}
    </div>
  );
}
