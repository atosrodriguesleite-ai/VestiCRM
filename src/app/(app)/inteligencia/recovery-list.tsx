"use client";

import Link from "next/link";
import { ShoppingCart, Flame, UserCheck, RotateCcw, MessageCircle } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";

type Item = {
  kind: string;
  title: string;
  detail: string;
  customerId?: string;
  customerPhone?: string;
  items?: string[];
  value?: number;
};

const STYLE: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  "carrinho-abandonado": { color: "#e11d48", icon: <ShoppingCart className="size-4" />, label: "Carrinho abandonado" },
  "quase-comprando": { color: "#d97706", icon: <Flame className="size-4" />, label: "Quase comprando" },
  "cliente-voltou": { color: "#059669", icon: <UserCheck className="size-4" />, label: "Cliente voltou" },
  "cliente-recorrente": { color: "#c4622d", icon: <RotateCcw className="size-4" />, label: "Recorrente" },
};

/** Mensagem pronta de recuperação (carrinho abandonado identificado). */
function recoverMessage(item: Item): string {
  const first = item.title.split(" ")[0];
  const pieces = item.items?.length
    ? ` Vi que você separou ${item.items.join(", ")}.`
    : "";
  return `Oi ${first}!${pieces} Quer que eu finalize seu pedido? Qualquer dúvida sobre tamanho ou cor, me chama! 💛`;
}

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
        const phoneDigits = (item.customerPhone ?? "").replace(/\D/g, "");
        const canWhats = phoneDigits.length >= 10;
        const waHref = canWhats
          ? `https://wa.me/${phoneDigits.length <= 11 ? "55" + phoneDigits : phoneDigits}?text=${encodeURIComponent(recoverMessage(item))}`
          : null;
        return (
          <Card key={i} className="p-4 h-full hover:shadow-pop transition">
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
                {/* peças exatas deixadas na sacola */}
                {item.items && item.items.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {item.items.slice(0, 4).map((it) => (
                      <li key={it} className="text-xs text-gray-600 flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-gray-300 shrink-0" />
                        {it}
                      </li>
                    ))}
                    {item.items.length > 4 && (
                      <li className="text-[11px] text-gray-400">
                        + {item.items.length - 4} outras peças
                      </li>
                    )}
                  </ul>
                )}
                <div className="flex items-center gap-3 mt-2">
                  {waHref && (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold px-2.5 py-1.5 transition"
                    >
                      <MessageCircle className="size-3.5" />
                      Recuperar no WhatsApp
                    </a>
                  )}
                  {item.customerId && (
                    <Link
                      href={`/clientes/${item.customerId}`}
                      className="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                    >
                      Abrir cliente →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
