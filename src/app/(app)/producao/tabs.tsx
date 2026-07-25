"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Scissors, Shirt, Package, Layers, BarChart3, Settings2, LayoutPanelTop } from "lucide-react";

const ABAS = [
  { href: "/producao/cortes", label: "Cortes", icon: Scissors },
  { href: "/producao/plano-corte", label: "Plano de Corte", icon: LayoutPanelTop },
  { href: "/producao/costura", label: "Costura", icon: Shirt },
  { href: "/producao/lotes", label: "Lotes", icon: Package },
  { href: "/producao/sobras", label: "Sobras", icon: Layers },
  { href: "/producao/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/producao/configuracoes", label: "Configurações", icon: Settings2 },
];

export function ProducaoTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1.5 mb-6 overflow-x-auto thin-scroll -mx-1 px-1">
      {ABAS.map((a) => {
        const active = pathname.startsWith(a.href);
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition ${
              active
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:border-brand-300"
            }`}
          >
            <Icon className="size-4" />
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
