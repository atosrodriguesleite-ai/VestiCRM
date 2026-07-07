"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  MessageCircle,
  Users,
  CheckSquare,
  Zap,
  Megaphone,
  BarChart3,
  UserCog,
  Settings,
  Sparkles,
  LogOut,
  Menu,
  X,
  Package,
  ShoppingBag,
} from "lucide-react";
import { Avatar } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/funil", label: "Funil de vendas", icon: KanbanSquare },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/produtos", label: "Produtos", icon: Package },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { href: "/automacoes", label: "Automações", icon: Zap },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/equipe", label: "Equipe", icon: UserCog, managerOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

const MOBILE_NAV = NAV.slice(0, 5);

type ShellUser = {
  name: string;
  role: string;
  roleLabel: string;
  color: string;
  companyName: string;
};

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = NAV.filter(
    (i) =>
      !i.managerOnly ||
      ["ADMIN", "MANAGER", "SUPERADMIN"].includes(user.role)
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const navLinks = (onClick?: () => void) => (
    <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto thin-scroll">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-brand-50 text-brand-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <Icon
              className={`size-[18px] ${active ? "text-brand-600" : "text-gray-400"}`}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const userBlock = (
    <div className="border-t border-gray-100 p-3">
      <div className="flex items-center gap-3 rounded-xl px-2 py-2">
        <Avatar name={user.name} color={user.color} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <p className="text-xs text-gray-400 truncate">{user.roleLabel}</p>
        </div>
        <button
          onClick={logout}
          title="Sair"
          className="text-gray-400 hover:text-rose-500 transition p-1.5 rounded-lg hover:bg-rose-50"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-white border-r border-gray-100 sticky top-0 h-dvh">
        <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
          <div className="size-8 rounded-lg bg-brand-600 text-white flex items-center justify-center">
            <Sparkles className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight text-[15px]">VestiCRM</p>
            <p className="text-[11px] text-gray-400 truncate max-w-36">
              {user.companyName}
            </p>
          </div>
        </div>
        {navLinks()}
        {userBlock}
      </aside>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/30 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white flex flex-col animate-fade-in shadow-pop">
            <div className="flex items-center justify-between px-5 h-16 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-brand-600 text-white flex items-center justify-center">
                  <Sparkles className="size-4" />
                </div>
                <p className="font-semibold tracking-tight">VestiCRM</p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-gray-400"
              >
                <X className="size-5" />
              </button>
            </div>
            {navLinks(() => setDrawerOpen(false))}
            {userBlock}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header mobile */}
        <header className="md:hidden sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 flex items-center justify-between px-4 h-14">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 text-gray-500"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-brand-600 text-white flex items-center justify-center">
              <Sparkles className="size-3.5" />
            </div>
            <span className="font-semibold tracking-tight text-sm">
              VestiCRM
            </span>
          </div>
          <Avatar name={user.name} color={user.color} size="sm" />
        </header>

        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">{children}</main>

        {/* Bottom nav mobile */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
          {MOBILE_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 px-3 text-[10px] font-medium ${
                  active ? "text-brand-600" : "text-gray-400"
                }`}
              >
                <Icon className="size-5" />
                {item.label.split(" ")[0]}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
