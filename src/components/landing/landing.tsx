"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/logo";
import { Reveal } from "./reveal";
import { DemoModal } from "./demo-form";
import {
  IconArrow,
  IconBolt,
  IconCalendar,
  IconCatalog,
  IconChart,
  IconChat,
  IconCheck,
  IconChevron,
  IconClose,
  IconFunnel,
  IconGlobe,
  IconMenu,
  IconOrders,
  IconPalette,
  IconPhone,
  IconRocket,
  IconShield,
  IconSparkles,
  IconStore,
  IconTarget,
  IconTruck,
  IconUsers,
  IconWhatsApp,
} from "./icons";

/** Número comercial de vendas. */
const SALES_WHATSAPP = "5533998618915";
const WA_MESSAGE =
  "Olá! Gostaria de conhecer o VestiCRM e solicitar uma demonstração.";
const WA_LINK = `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(WA_MESSAGE)}`;

const NAV = [
  { href: "#modulos", label: "Módulos" },
  { href: "#catalogo", label: "Catálogo" },
  { href: "#inteligencia", label: "Inteligência" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#faq", label: "FAQ" },
];

export function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased selection:bg-brand-200/60">
      <Header onDemo={openDemo} />
      <main>
        <Hero onDemo={openDemo} />
        <Pain />
        <Turn />
        <Modules />
        <Catalog onDemo={openDemo} />
        <Intelligence />
        <Audience />
        <How />
        <Implantation />
        <Shots />
        <MidCTA onDemo={openDemo} />
        <Faq />
        <FinalCTA onDemo={openDemo} />
      </main>
      <Footer onDemo={openDemo} />

      <WhatsAppFloat />
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}

/* ============================================================ HEADER */

function Header({ onDemo }: { onDemo: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-[0_1px_0_0_rgba(15,23,42,0.04)]"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" className="shrink-0" aria-label="VestiCRM — início">
          <Logo size="md" />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-xl px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:inline-flex"
          >
            Entrar
          </Link>
          <button
            onClick={onDemo}
            className="hidden rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md sm:inline-flex"
          >
            Solicitar demonstração
          </button>
          <button
            onClick={() => setMenu((v) => !v)}
            aria-label={menu ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menu}
            className="grid size-10 place-items-center rounded-xl text-slate-700 hover:bg-slate-100 md:hidden"
          >
            {menu ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </div>

      {/* menu mobile */}
      {menu && (
        <div className="border-t border-slate-100 bg-white/95 backdrop-blur-xl md:hidden">
          <nav className="mx-auto max-w-6xl px-4 py-3">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setMenu(false)}
                className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-slate-700 hover:bg-slate-50"
              >
                {n.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-3">
              <Link
                href="/login"
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-center text-sm font-medium text-slate-700"
              >
                Entrar
              </Link>
              <button
                onClick={() => {
                  setMenu(false);
                  onDemo();
                }}
                className="rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white"
              >
                Solicitar demonstração
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

/* ============================================================ HERO */

function Hero({ onDemo }: { onDemo: () => void }) {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* fundo: gradiente petróleo + malha + brilhos */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-white" />
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-brand-200/50 via-brand-100/40 to-transparent blur-3xl" />
        <div className="absolute -right-24 top-24 h-72 w-72 rounded-full bg-brand-300/30 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(15,23,42,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.035) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent)",
          }}
        />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3.5 py-1.5 text-[13px] font-medium text-brand-700">
              <IconSparkles className="size-4" />
              A plataforma comercial para lojas de moda
            </span>
          </Reveal>
          <Reveal delay={80} as="h1">
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Transforme conversas do WhatsApp em{" "}
              <span className="bg-gradient-to-r from-brand-900 via-brand-600 to-brand-500 bg-clip-text text-transparent">
                vendas organizadas
              </span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-slate-500">
              Catálogo, pedidos, funil de vendas e inteligência comercial em um só
              lugar — pensado para o jeito que lojas de roupa realmente vendem.
              Implantação personalizada, com um time ao seu lado.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={onDemo}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-7 py-4 text-base font-semibold text-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.6)] transition hover:bg-brand-700 hover:shadow-[0_12px_32px_-8px_rgba(37,99,235,0.65)] sm:w-auto"
              >
                Solicitar demonstração
                <IconArrow className="size-5 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#como-funciona"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/70 px-7 py-4 text-base font-semibold text-slate-700 backdrop-blur transition hover:border-slate-300 hover:bg-white sm:w-auto"
              >
                Ver como funciona
              </a>
            </div>
          </Reveal>
          <Reveal delay={320}>
            <p className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <IconCheck className="size-4 text-emerald-500" /> Sem taxa de setup
                surpresa
              </span>
              <span className="inline-flex items-center gap-1.5">
                <IconCheck className="size-4 text-emerald-500" /> Migração
                acompanhada
              </span>
              <span className="inline-flex items-center gap-1.5">
                <IconCheck className="size-4 text-emerald-500" /> Suporte humano
              </span>
            </p>
          </Reveal>
        </div>

        {/* mockup principal */}
        <Reveal delay={200} className="mt-14 sm:mt-16">
          <div className="relative mx-auto max-w-5xl">
            <div className="pointer-events-none absolute -inset-x-8 -top-6 bottom-0 -z-10 rounded-[2rem] bg-gradient-to-b from-brand-200/40 to-transparent blur-2xl" />
            <BrowserFrame src="/shots/dashboard.png" alt="Painel do VestiCRM com KPIs de vendas, funil e tarefas do dia" />

            {/* cards flutuantes */}
            <div className="absolute -left-3 top-16 hidden animate-[fade-up_0.6s_ease_both] sm:block lg:-left-10">
              <FloatCard
                icon={<IconWhatsApp className="size-5" />}
                tone="emerald"
                title="Novo lead no WhatsApp"
                sub="Distribuído automaticamente"
              />
            </div>
            <div className="absolute -right-3 bottom-14 hidden animate-[fade-up_0.7s_ease_both] sm:block lg:-right-10">
              <FloatCard
                icon={<IconChart className="size-5" />}
                tone="brand"
                title="+38% de conversão"
                sub="Últimos 30 dias"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function BrowserFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/5">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <span className="size-3 rounded-full bg-rose-300" />
        <span className="size-3 rounded-full bg-amber-300" />
        <span className="size-3 rounded-full bg-emerald-300" />
        <span className="ml-3 hidden truncate rounded-md bg-white px-3 py-1 text-xs text-slate-400 ring-1 ring-slate-200 sm:inline-block">
          app.vesticrm.com.br/dashboard
        </span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="block w-full"
        width={1600}
        height={1000}
      />
    </div>
  );
}

function FloatCard({
  icon,
  title,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  tone: "emerald" | "brand";
}) {
  const t =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
      : "bg-brand-50 text-brand-600 ring-brand-100";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/90 px-4 py-3 shadow-pop backdrop-blur">
      <span className={`grid size-9 place-items-center rounded-xl ring-1 ${t}`}>
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-[13px] font-semibold text-slate-900">{title}</p>
        <p className="text-[11px] text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

/* ============================================================ SECTION SHELL */

function SectionHead({
  eyebrow,
  title,
  desc,
  center = true,
}: {
  eyebrow: string;
  title: React.ReactNode;
  desc?: string;
  center?: boolean;
}) {
  return (
    <div className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      <Reveal>
        <span className="text-[13px] font-semibold uppercase tracking-wider text-brand-600">
          {eyebrow}
        </span>
      </Reveal>
      <Reveal delay={60} as="h2">
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          {title}
        </h2>
      </Reveal>
      {desc && (
        <Reveal delay={120}>
          <p className="mt-4 text-lg leading-relaxed text-slate-500">{desc}</p>
        </Reveal>
      )}
    </div>
  );
}

/* ============================================================ PAIN */

function Pain() {
  const items = [
    "Pedidos anotados no caderno, no bloco de notas e em três conversas diferentes",
    "Cliente que sumiu e ninguém lembrou de chamar de volta",
    "Vendedora que esquece a numeração, a cor ou a última compra da cliente",
    "Fim do mês sem saber quanto vendeu, quem vendeu e o que ficou parado",
  ];
  return (
    <section className="relative bg-slate-950 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-0 opacity-60">
        <div className="absolute left-0 top-0 h-64 w-64 rounded-full bg-brand-800/40 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-brand-900/50 blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <Reveal>
            <span className="text-[13px] font-semibold uppercase tracking-wider text-brand-300">
              A dor de vender moda hoje
            </span>
          </Reveal>
          <Reveal delay={60} as="h2">
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Vender é o que você faz melhor. O caos por trás disso,{" "}
              <span className="text-brand-300">não deveria ser seu problema.</span>
            </h2>
          </Reveal>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {items.map((t, i) => (
            <Reveal key={t} delay={i * 90}>
              <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20">
                  <IconClose className="size-4" />
                </span>
                <p className="text-[15px] leading-relaxed text-slate-300">{t}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ TURN (fluxo) */

function Turn() {
  const steps = [
    {
      icon: <IconWhatsApp className="size-6" />,
      title: "Chegou uma cliente",
      desc: "WhatsApp, Instagram, catálogo ou loja física — tudo entra num lugar só.",
    },
    {
      icon: <IconUsers className="size-6" />,
      title: "Vai pra pessoa certa",
      desc: "Distribuição automática entre vendedoras, com tarefa e prazo de resposta.",
    },
    {
      icon: <IconFunnel className="size-6" />,
      title: "Anda no funil",
      desc: "Cada oportunidade avança de etapa, sem cliente esquecido pelo caminho.",
    },
    {
      icon: <IconChart className="size-6" />,
      title: "Vira número",
      desc: "Venda registrada, pedido montado e resultado que você enxerga em tempo real.",
    },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow="A virada"
          title="Do primeiro “oi” à venda registrada"
          desc="O VestiCRM organiza o caminho inteiro da sua venda — sem planilha, sem caderno, sem perder ninguém no meio."
        />
        <div className="relative mt-14">
          {/* linha conectora desktop */}
          <div className="pointer-events-none absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-brand-200 to-transparent lg:block" />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 100}>
                <div className="relative flex h-full flex-col rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card transition hover:-translate-y-1 hover:shadow-pop">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]">
                      {s.icon}
                    </span>
                    <span className="text-4xl font-bold text-slate-100">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {s.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                    {s.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ MODULES */

function Modules() {
  const mods = [
    {
      icon: <IconChat />,
      title: "Atendimento omnichannel",
      desc: "WhatsApp, Instagram e site numa única caixa de entrada, com histórico completo de cada cliente.",
    },
    {
      icon: <IconFunnel />,
      title: "Funil de vendas visual",
      desc: "Arraste oportunidades entre etapas e saiba exatamente onde cada venda parou.",
    },
    {
      icon: <IconCatalog />,
      title: "Catálogo digital",
      desc: "Vitrine com a sua cara: grade de tamanhos, cores, fotos e link pronto para enviar.",
    },
    {
      icon: <IconOrders />,
      title: "Pedidos e vendas",
      desc: "Monte o pedido, calcule o total, registre o pagamento e acompanhe a entrega.",
    },
    {
      icon: <IconChart />,
      title: "Inteligência comercial",
      desc: "Rankings, metas, produtos parados e a saúde da operação num painel só.",
    },
    {
      icon: <IconUsers />,
      title: "Equipe e metas",
      desc: "Cada vendedora com sua carteira, suas metas e seu desempenho medido de verdade.",
    },
  ];
  return (
    <section id="modulos" className="scroll-mt-20 bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow="Módulos principais"
          title="Tudo que a sua loja precisa, integrado"
          desc="Módulos que conversam entre si. O que entra no atendimento vira funil, vira pedido e vira número — sem retrabalho."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {mods.map((m, i) => (
            <Reveal key={m.title} delay={(i % 3) * 90}>
              <div className="group h-full rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card transition duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-pop">
                <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition group-hover:bg-brand-600 group-hover:text-white [&>svg]:size-6">
                  {m.icon}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-slate-900">
                  {m.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {m.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ CATALOG */

function Catalog({ onDemo }: { onDemo: () => void }) {
  const feats = [
    "Sua logo, suas cores e sua tipografia — a vitrine com a identidade da loja",
    "Grade completa: tamanhos, cores e variações com estoque em tempo real",
    "Produto esgotado aparece como indisponível, sem frustrar a cliente",
    "Link único para enviar no WhatsApp, no story ou na bio do Instagram",
  ];
  return (
    <section id="catalogo" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <Reveal>
            <span className="text-[13px] font-semibold uppercase tracking-wider text-brand-600">
              Catálogo personalizado
            </span>
          </Reveal>
          <Reveal delay={60} as="h2">
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Uma vitrine digital com a cara da sua loja
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-4 text-lg leading-relaxed text-slate-500">
              Cada lojista personaliza o próprio catálogo — logo, paleta de cores,
              tipografia e organização. Sua cliente vê a sua marca, não a nossa.
            </p>
          </Reveal>
          <ul className="mt-8 space-y-3.5">
            {feats.map((f, i) => (
              <Reveal key={f} delay={i * 80}>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                    <IconCheck className="size-3.5" />
                  </span>
                  <span className="text-[15px] leading-relaxed text-slate-600">
                    {f}
                  </span>
                </li>
              </Reveal>
            ))}
          </ul>
          <Reveal delay={200}>
            <button
              onClick={onDemo}
              className="mt-9 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Ver o catálogo na prática
              <IconArrow className="size-4" />
            </button>
          </Reveal>
        </div>

        <Reveal delay={120}>
          <div className="relative">
            <div className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-100 to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-pop ring-1 ring-slate-900/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/shots/catalogo.png"
                alt="Catálogo digital personalizável do VestiCRM com produtos, grade de tamanhos e cores"
                loading="lazy"
                className="block w-full"
                width={1200}
                height={1500}
              />
            </div>
            <div className="absolute -bottom-5 -left-4 hidden rounded-2xl border border-slate-100 bg-white/90 px-4 py-3 shadow-pop backdrop-blur sm:flex sm:items-center sm:gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <IconPalette className="size-5" />
              </span>
              <div className="leading-tight">
                <p className="text-[13px] font-semibold text-slate-900">
                  100% personalizável
                </p>
                <p className="text-[11px] text-slate-400">Logo · cores · fontes</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ INTELLIGENCE */

function Intelligence() {
  const cards = [
    {
      icon: <IconTarget className="size-5" />,
      title: "Metas e ranking",
      desc: "Acompanhe metas por vendedora e o ranking do time em tempo real.",
    },
    {
      icon: <IconBolt className="size-5" />,
      title: "Recuperação de clientes",
      desc: "Descubra quem parou de comprar e reative com a abordagem certa.",
    },
    {
      icon: <IconChart className="size-5" />,
      title: "Curva de produtos",
      desc: "Veja o que gira, o que empaca e o que precisa de um empurrão.",
    },
    {
      icon: <IconGlobe className="size-5" />,
      title: "Origem dos leads",
      desc: "Saiba de onde vêm suas melhores vendas e onde investir.",
    },
  ];
  return (
    <section
      id="inteligencia"
      className="relative scroll-mt-20 overflow-hidden bg-brand-900 py-20 text-white sm:py-28"
    >
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute -left-32 top-10 h-80 w-80 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-brand-400/20 blur-3xl" />
      </div>
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <div>
          <Reveal>
            <span className="text-[13px] font-semibold uppercase tracking-wider text-brand-300">
              Inteligência comercial
            </span>
          </Reveal>
          <Reveal delay={60} as="h2">
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Pare de vender no escuro
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-4 text-lg leading-relaxed text-brand-100/80">
              O VestiCRM transforma cada atendimento em dado e cada dado em decisão.
              Você enxerga a operação inteira e sabe exatamente o próximo passo.
            </p>
          </Reveal>
          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {cards.map((c, i) => (
              <Reveal key={c.title} delay={i * 90}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur transition hover:bg-white/[0.1]">
                  <span className="grid size-10 place-items-center rounded-xl bg-white/10 text-brand-200 ring-1 ring-white/10">
                    {c.icon}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-white">
                    {c.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-brand-100/70">
                    {c.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal delay={140}>
          <div className="relative">
            <div className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-brand-400/20 blur-2xl" />
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-pop ring-1 ring-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/shots/inteligencia.png"
                alt="Painel de Inteligência Comercial do VestiCRM com metas, rankings e curva de produtos"
                loading="lazy"
                className="block w-full"
                width={1600}
                height={1000}
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ AUDIENCE */

function Audience() {
  const who = [
    {
      icon: <IconStore />,
      title: "Lojas de roupa",
      desc: "Moda feminina, masculina, infantil, plus size, praia, fitness — a operação inteira num lugar.",
    },
    {
      icon: <IconWhatsApp className="size-6" />,
      title: "Quem vende no WhatsApp",
      desc: "Se a maior parte da sua venda acontece no chat, o VestiCRM foi feito para você.",
    },
    {
      icon: <IconTruck />,
      title: "Atacado e multimarcas",
      desc: "Grades grandes, pedidos por peça e clientes que compram para revender.",
    },
    {
      icon: <IconUsers />,
      title: "Equipes de vendedoras",
      desc: "Distribua leads, acompanhe metas e mantenha o time no mesmo padrão.",
    },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow="Para quem é"
          title="Feito para o varejo de moda que vende no relacionamento"
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {who.map((w, i) => (
            <Reveal key={w.title} delay={i * 90}>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/50 p-6 text-center shadow-card">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 [&>svg]:size-7">
                  {w.icon}
                </span>
                <h3 className="mt-5 text-[17px] font-semibold text-slate-900">
                  {w.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {w.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ HOW */

function How() {
  const steps = [
    {
      icon: <IconPhone className="size-6" />,
      title: "Você solicita a demonstração",
      desc: "Preenche um formulário rápido. Sem cartão de crédito, sem compromisso.",
    },
    {
      icon: <IconCalendar className="size-6" />,
      title: "Conversamos sobre a sua loja",
      desc: "Um especialista entende a sua operação e mostra o VestiCRM na prática, ao vivo.",
    },
    {
      icon: <IconRocket className="size-6" />,
      title: "Implantamos com você",
      desc: "Configuramos catálogo, funil e equipe junto do seu time — do jeito da sua loja.",
    },
    {
      icon: <IconChart className="size-6" />,
      title: "Você acompanha os resultados",
      desc: "Com o time rodando na plataforma e o suporte por perto sempre que precisar.",
    },
  ];
  return (
    <section
      id="como-funciona"
      className="scroll-mt-20 bg-slate-50/70 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow="Como funciona"
          title="Do primeiro contato à loja rodando"
          desc="Nada de contratar sozinho e se virar. Nosso modelo é atendimento humano e implantação personalizada, do começo ao fim."
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 100}>
              <div className="relative h-full rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-brand-600 text-white">
                    {s.icon}
                  </span>
                  <span className="text-[13px] font-semibold uppercase tracking-wider text-brand-400">
                    Passo {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  {s.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ IMPLANTATION */

function Implantation() {
  const items = [
    {
      icon: <IconRocket className="size-5" />,
      title: "Configuração feita para você",
      desc: "Catálogo, etapas do funil, origens de lead, metas e usuários prontos antes de você começar.",
    },
    {
      icon: <IconUsers className="size-5" />,
      title: "Treinamento do time",
      desc: "Sua equipe aprende na prática, com acompanhamento até todo mundo estar seguro.",
    },
    {
      icon: <IconTruck className="size-5" />,
      title: "Migração dos seus dados",
      desc: "Trazemos clientes, produtos e histórico do sistema (ou planilha) que você usa hoje.",
    },
    {
      icon: <IconShield className="size-5" />,
      title: "Suporte humano contínuo",
      desc: "Um time por perto de verdade — não é um robô respondendo ticket.",
    },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white to-brand-50/40 p-8 shadow-card sm:p-12">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-100/60 blur-3xl" />
          <div className="relative grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <span className="text-[13px] font-semibold uppercase tracking-wider text-brand-600">
                  Implantação personalizada
                </span>
              </Reveal>
              <Reveal delay={60} as="h2">
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                  Você não entra sozinho. Entra com um time do seu lado.
                </h2>
              </Reveal>
              <Reveal delay={120}>
                <p className="mt-4 text-lg leading-relaxed text-slate-500">
                  O VestiCRM não é um autoatendimento. Cada loja é implantada de forma
                  personalizada, com acompanhamento humano em cada etapa — para a
                  ferramenta se encaixar no jeito que você já vende.
                </p>
              </Reveal>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((it, i) => (
                <Reveal key={it.title} delay={i * 90}>
                  <div className="h-full rounded-2xl border border-slate-200/60 bg-white/80 p-5 backdrop-blur">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                      {it.icon}
                    </span>
                    <h3 className="mt-3.5 text-[15px] font-semibold text-slate-900">
                      {it.title}
                    </h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                      {it.desc}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ SHOTS */

function Shots() {
  const shots = [
    { src: "/shots/funil.png", label: "Funil de vendas", alt: "Funil de vendas do VestiCRM com etapas e oportunidades" },
    { src: "/shots/chat.png", label: "Atendimento", alt: "Central de atendimento omnichannel do VestiCRM" },
    { src: "/shots/pedidos.png", label: "Pedidos", alt: "Tela de pedidos e vendas do VestiCRM" },
    { src: "/shots/produtos.png", label: "Produtos", alt: "Cadastro de produtos e catálogo do VestiCRM" },
  ];
  return (
    <section className="bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          eyebrow="Por dentro da plataforma"
          title="Telas reais, não ilustrações"
          desc="É assim que a sua operação vai parecer todos os dias. Bonito de usar e simples de aprender."
        />
        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {shots.map((s, i) => (
            <Reveal key={s.src} delay={(i % 2) * 100}>
              <figure className="group overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-card transition hover:-translate-y-1 hover:shadow-pop">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">
                    {s.label}
                  </span>
                  <span className="flex gap-1.5">
                    <span className="size-2.5 rounded-full bg-slate-200" />
                    <span className="size-2.5 rounded-full bg-slate-200" />
                    <span className="size-2.5 rounded-full bg-brand-300" />
                  </span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.src}
                  alt={s.alt}
                  loading="lazy"
                  className="block w-full transition duration-500 group-hover:scale-[1.015]"
                  width={1600}
                  height={1000}
                />
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ MID CTA */

function MidCTA({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 px-6 py-12 text-center shadow-[0_24px_60px_-20px_rgba(37,99,235,0.6)] sm:px-12 sm:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-40">
              <div className="absolute -left-10 top-0 h-40 w-40 rounded-full bg-white/20 blur-3xl" />
              <div className="absolute -right-10 bottom-0 h-48 w-48 rounded-full bg-brand-900/40 blur-3xl" />
            </div>
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Quer ver o VestiCRM funcionando com a realidade da sua loja?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-brand-50/90">
                Agende uma demonstração gratuita. A gente mostra tudo ao vivo e tira
                todas as suas dúvidas.
              </p>
              <button
                onClick={onDemo}
                className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 text-base font-semibold text-brand-700 shadow-lg transition hover:bg-brand-50"
              >
                Solicitar demonstração
                <IconArrow className="size-5" />
              </button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ FAQ */

function Faq() {
  const faqs = [
    {
      q: "Preciso pagar para testar?",
      a: "Não. O primeiro passo é sempre uma demonstração gratuita e sem compromisso. Um especialista mostra a plataforma ao vivo e entende a sua operação antes de qualquer decisão.",
    },
    {
      q: "Como funciona a contratação?",
      a: "Não há compra automática nem cadastro self-service. Depois da demonstração, montamos uma proposta e uma implantação personalizada para a sua loja, com acompanhamento humano do começo ao fim.",
    },
    {
      q: "Vocês ajudam a migrar meus dados?",
      a: "Sim. Trazemos seus clientes, produtos e histórico do sistema ou planilha que você usa hoje. A migração é acompanhada pelo nosso time durante a implantação.",
    },
    {
      q: "O catálogo fica com a cara da minha loja?",
      a: "Totalmente. Você personaliza logo, cores, tipografia e organização. A sua cliente vê a identidade da sua marca — não a do VestiCRM.",
    },
    {
      q: "Funciona no celular?",
      a: "Sim. O VestiCRM foi desenhado para funcionar como um aplicativo no celular e no computador, para você e sua equipe venderem de onde estiverem.",
    },
    {
      q: "Serve para a minha loja?",
      a: "Se você vende moda e boa parte das suas vendas passa pelo WhatsApp, Instagram, catálogo ou loja física, o VestiCRM foi feito para você — de loja individual a operações com várias vendedoras.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHead eyebrow="Perguntas frequentes" title="Ainda com dúvidas?" />
        <div className="mt-12 divide-y divide-slate-100 rounded-2xl border border-slate-200/70 bg-white shadow-card">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left sm:px-6"
                >
                  <span className="text-[15px] font-semibold text-slate-900">
                    {f.q}
                  </span>
                  <IconChevron
                    className={`size-5 shrink-0 text-brand-500 transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid overflow-hidden px-5 transition-all duration-300 ease-out sm:px-6 ${
                    isOpen
                      ? "grid-rows-[1fr] pb-5 opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <p className="min-h-0 text-[14.5px] leading-relaxed text-slate-500">
                    {f.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ FINAL CTA */

function FinalCTA({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="relative overflow-hidden bg-slate-950 py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-96 w-[900px] -translate-x-1/2 rounded-full bg-brand-600/25 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.25]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse 60% 60% at 50% 40%, black, transparent)",
          }}
        />
      </div>
      <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
        <Reveal>
          <LogoMark className="mx-auto size-14" rounded="rounded-2xl" />
        </Reveal>
        <Reveal delay={80} as="h2">
          <h2 className="mt-7 text-balance text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            Organize suas vendas. Cresça com clareza.
          </h2>
        </Reveal>
        <Reveal delay={140}>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-300">
            Dê à sua loja de moda a plataforma comercial que ela merece. Comece com
            uma demonstração — o resto, a gente constrói junto com você.
          </p>
        </Reveal>
        <Reveal delay={220}>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={onDemo}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-8 py-4 text-base font-semibold text-white shadow-[0_10px_30px_-8px_rgba(37,99,235,0.7)] transition hover:bg-brand-500 sm:w-auto"
            >
              Solicitar demonstração
              <IconArrow className="size-5 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-base font-semibold text-white backdrop-blur transition hover:bg-white/10 sm:w-auto"
            >
              <IconWhatsApp className="size-5" />
              Falar no WhatsApp
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ FOOTER */

function Footer({ onDemo }: { onDemo: () => void }) {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 text-slate-400">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo size="md" onDark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              A plataforma comercial para lojas de moda. Do primeiro contato no
              WhatsApp à venda registrada — organizado, com a sua marca.
            </p>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
            >
              <IconWhatsApp className="size-4" />
              Falar com vendas
            </a>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
              Plataforma
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li><a href="#modulos" className="transition hover:text-white">Módulos</a></li>
              <li><a href="#catalogo" className="transition hover:text-white">Catálogo</a></li>
              <li><a href="#inteligencia" className="transition hover:text-white">Inteligência comercial</a></li>
              <li><a href="#como-funciona" className="transition hover:text-white">Como funciona</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
              Comece
            </p>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <button onClick={onDemo} className="transition hover:text-white">
                  Solicitar demonstração
                </button>
              </li>
              <li><a href="#faq" className="transition hover:text-white">Perguntas frequentes</a></li>
              <li><Link href="/login" className="transition hover:text-white">Entrar na plataforma</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-800 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} VestiCRM. Todos os direitos reservados.</p>
          <p>Feito para o varejo de moda brasileiro.</p>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================ WHATSAPP FLOAT */

function WhatsAppFloat() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 480);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <a
      href={WA_LINK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar no WhatsApp com o time VestiCRM"
      className={`fixed bottom-5 right-5 z-[60] flex items-center gap-3 rounded-full bg-[#25D366] py-3.5 pl-3.5 pr-4 text-white shadow-[0_10px_30px_-6px_rgba(37,211,102,0.6)] transition-all duration-300 hover:brightness-105 sm:bottom-6 sm:right-6 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <span className="absolute inset-0 -z-10 rounded-full bg-[#25D366] opacity-60 motion-safe:animate-ping" />
      <IconWhatsApp className="size-7" />
      <span className="hidden text-sm font-semibold sm:inline">Fale conosco</span>
    </a>
  );
}
