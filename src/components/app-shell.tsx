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
  Activity,
  Wallet,
  ArrowLeft,
  Eye,
  PanelLeftClose,
  PanelLeft,
  Moon,
  Sun,
  Handshake,
  Scissors,
  Target,
  Camera,
  Images,
  LayoutPanelTop,
  Gauge,
  Boxes,
  ChevronDown,
  ShoppingCart,
  Repeat,
  Bot,
} from "lucide-react";
import { Avatar } from "./ui";
import { Logo, LogoMark } from "./logo";
import { NotificationBell } from "./notification-bell";
import { fileToDataUrl } from "@/lib/upload";

// supportHidden: o perfil Suporte é operacional (gestão de pedidos +
// atendimento) — telas comerciais e de configuração ficam fora do menu dele.
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Comercial", supportHidden: true },
  { href: "/funil", label: "Funil de vendas", icon: KanbanSquare, group: "Comercial", supportHidden: true },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Comercial" },
  // módulo IA de Vendas (pago à parte): sem a chave, o menu nem aparece.
  // Fica no Comercial, colada no WhatsApp — é ali que ela trabalha.
  { href: "/ia", label: "IA de Vendas", icon: Bot, group: "Comercial", managerOnly: true, aiOnly: true },
  // "Agenda" e não "Tarefas": a tela deixou de ser lista de obrigação e
  // virou a lista de quem precisa de contato hoje. O nome antigo fazia
  // parecer trabalho burocrático — e era o que ninguém abria.
  { href: "/tarefas", label: "Minha agenda", icon: CheckSquare, group: "Comercial" },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag, group: "Catálogo" },
  { href: "/produtos", label: "Produtos", icon: Package, group: "Catálogo" },
  { href: "/biblioteca", label: "Biblioteca de imagens", icon: Images, group: "Catálogo", mediaLibraryOnly: true, supportHidden: true },
  { href: "/producao", label: "Produção", icon: Scissors, group: "Catálogo", productionOnly: true, supportHidden: true },
  { href: "/plano-corte", label: "Plano de Corte", icon: LayoutPanelTop, group: "Catálogo", cutPlanOnly: true, supportHidden: true },
  { href: "/clientes", label: "Clientes", icon: Users, group: "Relacionamento" },
  { href: "/automacoes", label: "Automações", icon: Zap, group: "Relacionamento", supportHidden: true },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone, group: "Relacionamento", supportHidden: true },
  { href: "/marketing", label: "Marketing", icon: Target, group: "Análise", managerOnly: true, marketingOnly: true },
  // Recuperação e Recompra: vendedora TAMBÉM vê — vender de novo é trabalho dela
  { href: "/recuperacao", label: "Recuperação", icon: ShoppingCart, group: "Análise", supportHidden: true },
  { href: "/recompra", label: "Recompra", icon: Repeat, group: "Relacionamento", supportHidden: true },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, group: "Análise", managerOnly: true },
  { href: "/inteligencia", label: "Inteligência", icon: Brain, group: "Análise", managerOnly: true },
  { href: "/comissoes", label: "Comissões", icon: Percent, group: "Análise", managerOnly: true },
  { href: "/financeiro", label: "Financeiro", icon: Wallet, group: "Análise", managerOnly: true },
  // Conexão do WhatsApp e log de entrega: trabalho operacional, então o
  // suporte entra junto com gerente e admin (vendedora não).
  { href: "/comunicacao", label: "Comunicação", icon: Radio, group: "Sistema", operacional: true },
  { href: "/equipe", label: "Equipe", icon: UserCog, group: "Sistema", managerOnly: true },
  // Suporte VÊ Configurações: é dele o trabalho de integração (reconectar
  // a Nuvemshop, sincronizar estoque, desfazer importação). A tela mostra
  // só a parte operacional para ele — o comercial fica escondido lá dentro.
  { href: "/configuracoes", label: "Configurações", icon: Settings, group: "Sistema" },
  { href: "/gestao", label: "Gestão", icon: Gauge, group: "Plataforma", superOnly: true },
  { href: "/lojas", label: "Lojas", icon: Store, group: "Plataforma", superOnly: true },
  { href: "/portfolio", label: "Portfólio de Produtos", icon: Boxes, group: "Plataforma", superOnly: true },
  { href: "/afiliados", label: "Afiliados", icon: Handshake, group: "Plataforma", superOnly: true },
  { href: "/saude", label: "Saúde", icon: Activity, group: "Plataforma", superOnly: true },
];

const MOBILE_NAV = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/funil", label: "Funil", icon: KanbanSquare },
  { href: "/whatsapp", label: "Chat", icon: MessageCircle },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/clientes", label: "Clientes", icon: Users },
];

// atalhos do celular pro dono da plataforma: o dia dele começa na Gestão
const MOBILE_NAV_SUPER = [
  { href: "/gestao", label: "Gestão", icon: Gauge },
  { href: "/lojas", label: "Lojas", icon: Store },
  { href: "/whatsapp", label: "Chat", icon: MessageCircle },
  { href: "/funil", label: "Funil", icon: KanbanSquare },
  { href: "/clientes", label: "Clientes", icon: Users },
];

// atalhos do celular pro Suporte: o dia dele começa nos pedidos
const MOBILE_NAV_SUPPORT = [
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/whatsapp", label: "Chat", icon: MessageCircle },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/tarefas", label: "Agenda", icon: CheckSquare },
  { href: "/produtos", label: "Produtos", icon: Package },
];

const GROUPS = ["Comercial", "Catálogo", "Relacionamento", "Análise", "Sistema", "Plataforma"];

/**
 * MENU DO DONO DA PLATAFORMA.
 *
 * O menu padrão foi desenhado para uma LOJA de roupas (produtos, produção,
 * plano de corte, comissões...). Para o Super Admin isso é ruído: ele vive no
 * painel de gestão e usa o CRM só para os leads do próprio AtacadoPro.
 *
 * Então o MESMO menu é reagrupado — nada é removido, nada perde acesso:
 * primeiro a Plataforma, depois o comercial dele, e o resto vai para um grupo
 * que abre com um clique. Quando ele entra COMO uma loja (impersonação), o
 * menu volta a ser o da loja, porque ali ele é a loja.
 */
const GRUPOS_SUPER = ["Plataforma", "Meu comercial", "Ferramentas da loja"];
const GRUPO_SUPER_PADRAO = "Ferramentas da loja";
const GRUPOS_FECHADOS_INICIAIS = [GRUPO_SUPER_PADRAO];
const GRUPO_SUPER: Record<string, string> = {
  "/gestao": "Plataforma",
  "/lojas": "Plataforma",
  "/saude": "Plataforma",
  "/afiliados": "Plataforma",
  "/portfolio": "Plataforma",
  "/dashboard": "Meu comercial",
  "/funil": "Meu comercial",
  "/whatsapp": "Meu comercial",
  "/clientes": "Meu comercial",
  "/tarefas": "Meu comercial",
  "/campanhas": "Meu comercial",
  "/automacoes": "Meu comercial",
  "/marketing": "Meu comercial",
};

type ShellUser = {
  name: string;
  role: string;
  roleLabel: string;
  color: string;
  companyName: string;
  avatarUrl?: string | null;
  impersonating?: boolean;
  // módulo Produção (pago à parte): sem a chave, o menu nem aparece
  productionEnabled?: boolean;
  // módulo Plano de Corte (pago à parte): idem
  cutPlanEnabled?: boolean;
  // módulo Marketing (pago à parte): idem
  marketingEnabled?: boolean;
  // Biblioteca de imagens (gated): sem a chave, o menu nem aparece
  mediaLibraryEnabled?: boolean;
  // módulo IA de Vendas (pago à parte): idem
  aiSalesEnabled?: boolean;
  // modo escuro — preferência individual do usuário
  prefersDark?: boolean;
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

  // Navegou = gaveta fecha. Sem isto, abrir uma notificação pelo sino da
  // gaveta trocava a página POR BAIXO dela — a tela de destino carregava
  // escondida e parecia que o toque não tinha funcionado.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    setCollapsed(localStorage.getItem("vesti_sidebar") === "1");
  }, []);

  /**
   * Teclado do celular aberto → some com a barra de baixo (ela roubava a
   * área de leitura da conversa).
   *
   * Detecta por DOIS caminhos, porque o iPhone nem sempre avisa a mudança
   * de tamanho da janela: (1) o campo que ganhou o foco é de digitação;
   * (2) a janela visível encolheu. Qualquer um dos dois liga o modo.
   */
  useEffect(() => {
    const ehCampoDeTexto = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n || !n.tagName) return false;
      const t = n.tagName;
      return t === "INPUT" || t === "TEXTAREA" || n.isContentEditable;
    };
    const ligar = () => document.body.classList.add("teclado-aberto");
    const desligar = () => document.body.classList.remove("teclado-aberto");

    const aoFocar = (e: FocusEvent) => {
      if (ehCampoDeTexto(e.target)) ligar();
    };
    const aoSairDoFoco = () => {
      // espera um instante: trocar de campo não deve piscar a barra
      setTimeout(() => {
        if (!ehCampoDeTexto(document.activeElement)) desligar();
      }, 120);
    };
    const vv = window.visualViewport;
    const aoRedimensionar = () => {
      if (!vv) return;
      if (window.innerHeight - vv.height > 120) ligar();
      else if (!ehCampoDeTexto(document.activeElement)) desligar();
    };

    document.addEventListener("focusin", aoFocar);
    document.addEventListener("focusout", aoSairDoFoco);
    vv?.addEventListener("resize", aoRedimensionar);
    return () => {
      document.removeEventListener("focusin", aoFocar);
      document.removeEventListener("focusout", aoSairDoFoco);
      vv?.removeEventListener("resize", aoRedimensionar);
      desligar();
    };
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("vesti_sidebar", c ? "0" : "1");
      return !c;
    });
  }

  const items = NAV.filter((i) => {
    if (user.role === "SUPPORT" && "supportHidden" in i && i.supportHidden) return false;
    if ("superOnly" in i && i.superOnly) return user.role === "SUPERADMIN";
    if ("productionOnly" in i && i.productionOnly) return Boolean(user.productionEnabled);
    if ("cutPlanOnly" in i && i.cutPlanOnly) return Boolean(user.cutPlanEnabled);
    if ("marketingOnly" in i && i.marketingOnly && !user.marketingEnabled) return false;
    if ("mediaLibraryOnly" in i && i.mediaLibraryOnly) return Boolean(user.mediaLibraryEnabled);
    if ("aiOnly" in i && i.aiOnly && !user.aiSalesEnabled) return false;
    if ("managerOnly" in i && i.managerOnly)
      return ["ADMIN", "MANAGER", "SUPERADMIN"].includes(user.role);
    // operacional = quem cuida de integração e conexão (inclui Suporte)
    if ("operacional" in i && i.operacional)
      return ["ADMIN", "MANAGER", "SUPERADMIN", "SUPPORT"].includes(user.role);
    return true;
  });
  // modo plataforma: Super Admin na própria casa (fora da impersonação)
  const modoPlataforma = user.role === "SUPERADMIN" && !user.impersonating;
  const grupos = modoPlataforma ? GRUPOS_SUPER : GROUPS;
  const grupoDoItem = (href: string, group: string) =>
    modoPlataforma ? (GRUPO_SUPER[href] ?? GRUPO_SUPER_PADRAO) : group;

  // grupos recolhidos (só no modo plataforma) — a escolha fica salva
  const [fechados, setFechados] = useState<string[]>(GRUPOS_FECHADOS_INICIAIS);
  useEffect(() => {
    const salvo = localStorage.getItem("vesti_grupos_fechados");
    if (salvo) {
      try {
        const lista = JSON.parse(salvo);
        if (Array.isArray(lista)) setFechados(lista.filter((g) => typeof g === "string"));
      } catch {
        /* preferência ilegível: fica o padrão */
      }
    }
  }, []);
  function alternarGrupo(g: string) {
    setFechados((atual) => {
      const proximo = atual.includes(g) ? atual.filter((x) => x !== g) : [...atual, g];
      localStorage.setItem("vesti_grupos_fechados", JSON.stringify(proximo));
      return proximo;
    });
  }

  const mobileItems = modoPlataforma
    ? MOBILE_NAV_SUPER
    : user.role === "SUPPORT"
      ? MOBILE_NAV_SUPPORT
      : MOBILE_NAV;

  // tema claro/escuro: troca otimista + salva no perfil do usuário
  const [dark, setDark] = useState(Boolean(user.prefersDark));
  const [savingTheme, setSavingTheme] = useState(false);
  async function toggleTheme() {
    const next = !dark;
    setDark(next);
    setSavingTheme(true);
    await fetch("/api/me/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dark: next }),
    });
    setSavingTheme(false);
    router.refresh();
  }

  // foto do próprio usuário: cada pessoa envia/remove a sua (troca otimista)
  const [avatar, setAvatar] = useState<string | null>(user.avatarUrl ?? null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  async function saveAvatar(dataUrl: string | null) {
    setAvatar(dataUrl);
    setSavingAvatar(true);
    await fetch("/api/me/avatar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: dataUrl }),
    });
    setSavingAvatar(false);
    router.refresh();
  }
  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await saveAvatar(await fileToDataUrl(f, 256, 0.85));
  }

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
      {grupos.map((group) => {
        const groupItems = items.filter((i) => grupoDoItem(i.href, i.group) === group);
        if (groupItems.length === 0) return null;
        // com o menu recolhido (só ícones) nada fica escondido atrás de clique
        const recolhivel = modoPlataforma && showLabels;
        // o grupo da tela aberta nunca fica fechado (senão some o "você está aqui")
        const fechado =
          recolhivel &&
          fechados.includes(group) &&
          !groupItems.some((i) => pathname.startsWith(i.href));
        return (
          <div key={group}>
            {showLabels &&
              (recolhivel ? (
                <button
                  type="button"
                  onClick={() => alternarGrupo(group)}
                  aria-expanded={!fechado}
                  className="w-full flex items-center justify-between px-3 mb-1.5 text-[10px] font-mono font-semibold uppercase tracking-[0.14em] text-ocre/70 hover:text-ocre transition"
                >
                  <span>{group}</span>
                  <ChevronDown
                    className={`size-3.5 transition-transform ${fechado ? "-rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <p className="px-3 mb-1.5 text-[10px] font-mono font-semibold uppercase tracking-[0.14em] text-ocre/70">
                  {group}
                </p>
              ))}
            <div className={`space-y-0.5 ${fechado ? "hidden" : ""}`}>
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
                        ? "bg-cobre/20 text-creme"
                        : "text-creme/50 hover:bg-creme/5 hover:text-creme"
                    } ${!showLabels ? "justify-center" : ""}`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-cobre" />
                    )}
                    <Icon
                      className={`size-[18px] shrink-0 transition ${active ? "text-ocre" : "text-creme/40 group-hover:text-creme/80"}`}
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
    <div className="border-t border-creme/10 p-3">
      <div
        className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${!showLabels ? "justify-center" : ""}`}
      >
        {/* foto própria: clique para enviar/trocar (cada usuário a sua) */}
        <label
          className="group/av relative shrink-0 cursor-pointer"
          title={savingAvatar ? "Salvando foto…" : "Enviar / trocar sua foto"}
        >
          <input type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
          <Avatar name={user.name} color={user.color} src={avatar} />
          <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-cobre text-white ring-2 ring-sidebar transition group-hover/av:bg-ocre">
            <Camera className="size-2.5" />
          </span>
        </label>
        {showLabels && (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-creme truncate">
                {user.name}
              </p>
              <p className="text-xs text-creme/40 truncate">{user.roleLabel}</p>
            </div>
            <NotificationBell dark />
            <button
              onClick={toggleTheme}
              disabled={savingTheme}
              title={dark ? "Mudar para o modo claro" : "Mudar para o modo escuro"}
              className="text-creme/40 hover:text-ocre transition p-1.5 rounded-lg hover:bg-creme/5 disabled:opacity-50"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button
              onClick={logout}
              title="Sair"
              className="text-creme/40 hover:text-rose-400 transition p-1.5 rounded-lg hover:bg-creme/5"
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
            className="absolute inset-0 bg-espresso/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-sidebar flex flex-col animate-fade-in shadow-pop">
            <div className="flex items-center justify-between px-4 h-16 shrink-0">
              <Logo onDark size="md" />
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 text-creme/50 hover:text-creme transition"
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
        <header className="md:hidden sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-brand-900/10 flex items-center justify-between px-4 h-14">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 text-slate-600"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo size="sm" />
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Avatar name={user.name} color={user.color} src={avatar} size="sm" />
          </div>
        </header>

        {/* com o teclado aberto a barra de baixo some → o espaço dela também
            (regra em globals.css: body.teclado-aberto) */}
        <main className="area-principal flex-1 p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
          {children}
        </main>

        {/* Bottom nav mobile */}
        <nav className="barra-inferior md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/90 backdrop-blur-xl border-t border-brand-900/10 flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
          {mobileItems.map((item) => {
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
