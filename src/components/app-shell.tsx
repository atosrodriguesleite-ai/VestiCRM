"use client";

import { useEffect, useState } from "react";
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
  Percent,
  UserCog,
  Settings,
  LogOut,
  Menu,
  X,
  Package,
  ShoppingBag,
  Radio,
  Brain,
  Store,
  ArrowLeft,
  Eye,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { Avatar } from "./ui";
import { Logo, LogoMark } from "./logo";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Comercial" },
  { href: "/funil", label: "Funil de vendas", icon: KanbanSquare, group: "Comercial" },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Comercial" },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare, group: "Comercial" },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag, group: "Catálogo" },
  { href: "/produtos", label: "Produtos", icon: Package, group: "Catálogo" },
  { href: "/clientes", label: "Clientes", icon: Users, group: "Relacionamento" },
  { href: "/automacoes", label: "Automações", icon: Zap, group: "Relacionamento" },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone, group: "Relacionamento" },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, group: "Análise", managerOnly: true },
  { href: "/inteligencia", label: "Inteligência", icon: Brain, group: "Análise", managerOnly: true },
  { href: "/comissoes", label: "Comissões", icon: Percent, group: "Análise", managerOnly: true },
  { href: "/comunicacao", label: "Comunicação", icon: Radio, group: "Sistema", managerOnly: true },
  { href: "/equipe", label: "Equipe", icon: UserCog, group: "Sistema", managerOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings, group: "Sistema" },
  { href: "/lojas", label: "Lojas", icon: Store, group: "Plataforma", superOnly: true },
];

const MOBILE_NAV = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/funil", label: "Funil", icon: KanbanSquare },
  { href: "/whatsapp", label: "Chat", icon: MessageCircle },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/clientes", label: "Clientes", icon: Users },
];

const GROUPS = ["Comercial", "Catálogo", "Relacionamento", "Análise", "Sistema", "Plataforma"];

type ShellUser = {
  name: string;
  role: string;
  roleLabel: string;
  color: string;
  companyName: string;
  impersonating?: boolean;
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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("vesti_sidebar") === "1");
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("vesti_sidebar", c ? "0" : "1");
      return !c;
    });
  }

  const items = NAV.filter((i) => {
    if ("superOnly" in i && i.superOnly) return user.role === "SUPERADMIN";
    if ("managerOnly" in i && i.managerOnly)
      return ["ADMIN", "MANAGER", "SUPERADMIN"].includes(user.role);
    return true;
  });

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const [exiting, setExiting] = useState(false);
  async function exitImpersonation() {
    setExiting(true);
    await fetch("/api/impersonate/exit", { method: "POST" });
    router.push("/lojas");
    router.refresh();
  }

  const navLinks = (onClick?: () => void, showLabels = true) => (
    <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto thin-scroll">
      {GROUPS.map((group) => {
        const groupItems = items.filter((i) => i.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            {showLabels && (
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group}
              </p>
            )}
            <div className="space-y-0.5">
              {groupItems.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClick}
                    title={!showLabels ? item.label : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ${
                      active
                        ? "bg-brand-600/15 text-white"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    } ${!showLabels ? "justify-center" : ""}`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-brand-400" />
                    )}
                    <Icon
                      className={`size-[18px] shrink-0 transition ${active ? "text-brand-300" : "text-slate-500 group-hover:text-slate-200"}`}
                    />
                    {showLabels && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const userBlock = (showLabels = true) => (
    <div className="border-t border-white/5 p-3">
      <div
        className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${!showLabels ? "justify-center" : ""}`}
      >
        <Avatar name={user.name} color={user.color} />
        {showLabels && (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {user.name}
              </p>
              <p className="text-xs text-slate-500 truncate">{user.roleLabel}</p>
            </div>
            <button
              onClick={logout}
              title="Sair"
              className="text-slate-500 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-white/5"
            >
              <LogOut className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh flex bg-canvas">
      {/* Sidebar desktop */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-sidebar sticky top-0 h-dvh transition-[width] duration-200 ${
          collapsed ? "w-[68px]" : "w-64"
        }`}
      >
        <div
          className={`flex items-center h-16 shrink-0 ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}
        >
          {collapsed ? (
            <LogoMark className="size-9" onDark />
          ) : (
            <Logo subtitle={user.companyName} onDark size="md" />
          )}
        </div>
        {navLinks(undefined, !collapsed)}
        {userBlock(!collapsed)}
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3 top-20 size-6 rounded-full bg-white border border-slate-200 shadow-card flex items-center justify-center text-slate-400 hover:text-brand-600 transition"
          title={collapsed ? "Expandir" : "Recolher"}
        >
          {collapsed ? (
            <PanelLeft className="size-3.5" />
          ) : (
            <PanelLeftClose className="size-3.5" />
          )}
        </button>
      </aside>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-sidebar flex flex-col animate-fade-in shadow-pop">
            <div className="flex items-center justify-between px-4 h-16 shrink-0">
              <Logo onDark size="md" />
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-slate-400 hover:text-white transition"
              >
                <X className="size-5" />
              </button>
            </div>
            {navLinks(() => setDrawerOpen(false))}
            {userBlock()}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Faixa de acesso à loja (impersonação pelo Super Admin) */}
        {user.impersonating && (
          <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-400 px-4 py-2.5 text-amber-950 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="size-4 shrink-0" />
              <p className="text-[13px] font-medium truncate">
                Você está acessando a loja{" "}
                <b className="font-semibold">{user.companyName}</b> como Super Admin.
              </p>
            </div>
            <button
              onClick={exitImpersonation}
              disabled={exiting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1.5 text-[12.5px] font-semibold text-amber-50 transition hover:bg-amber-900 disabled:opacity-60"
            >
              <ArrowLeft className="size-3.5" />
              {exiting ? "Voltando…" : "Voltar ao Super Admin"}
            </button>
          </div>
        )}

        {/* Header mobile */}
        <header className="md:hidden sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200/70 flex items-center justify-between px-4 h-14">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 text-slate-600"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo size="sm" />
          <Avatar name={user.name} color={user.color} size="sm" />
        </header>

        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
          {children}
        </main>

        {/* Bottom nav mobile */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur-xl border-t border-slate-200/70 flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
          {MOBILE_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 px-3 text-[10px] font-medium transition ${
                  active ? "text-brand-600" : "text-slate-400"
                }`}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-brand-600" />
                )}
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
