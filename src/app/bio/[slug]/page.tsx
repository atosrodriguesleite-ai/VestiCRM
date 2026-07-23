import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import {
  Montserrat,
  Inter,
  Poppins,
  Playfair_Display,
  Lora,
} from "next/font/google";
import Script from "next/script";
import {
  ShoppingBag,
  MessageCircle,
  Globe,
  Link2,
  ChevronRight,
} from "lucide-react";
import { db } from "@/lib/db";
import { mixHex, readableOn } from "@/lib/color";
import { bioColors, socialLinks } from "@/lib/bio";
import { platformUrl } from "@/lib/site";
import { InstagramIcon, TiktokIcon, YoutubeIcon, FacebookIcon } from "@/components/social-icons";

const SOCIAL_ICON = {
  instagram: InstagramIcon,
  tiktok: TiktokIcon,
  youtube: YoutubeIcon,
  facebook: FacebookIcon,
} as const;

const SHAPE_CLASS: Record<string, string> = {
  rounded: "rounded-2xl",
  pill: "rounded-full",
  square: "rounded-lg",
};

/**
 * Bio pública (Gestor de Bio — módulo Marketing). A "página de links" que a
 * loja coloca na bio do Instagram, com a mesma identidade do catálogo. O
 * rodapé "feito por atacadopro.com" leva o visitante ao nosso formulário de
 * leads (canal de aquisição da bio).
 */

export const dynamic = "force-dynamic";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const lora = Lora({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const FONT_CLASS: Record<string, string> = {
  montserrat: montserrat.className,
  inter: inter.className,
  poppins: poppins.className,
  playfair: playfair.className,
  lora: lora.className,
};

const TYPE_ICON = {
  CATALOGO: ShoppingBag,
  WHATSAPP: MessageCircle,
  SITE: Globe,
  EXTERNO: Link2,
} as const;

async function load(slug: string) {
  return db.bioPage.findFirst({
    where: { slug, published: true },
    include: {
      company: {
        select: {
          name: true,
          slug: true,
          tagline: true,
          logoUrl: true,
          catalogPrimary: true,
          catalogSecondary: true,
          catalogBg: true,
          catalogFont: true,
        },
      },
      links: {
        where: { active: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) return { title: "Bio" };
  const name = page.headline || page.company.name;
  return {
    title: `${name} — Links`,
    description: page.tagline || page.company.tagline || `Links de ${name}`,
    openGraph: { title: name, description: page.tagline || page.company.tagline || undefined },
  };
}

export default async function BioPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();

  // conta a visita — mas SÓ de gente de verdade. Robôs e as prévias de link
  // (WhatsApp, Instagram, Facebook, Google) buscam a página e inflariam as
  // visitas, bagunçando a taxa de clique. Filtra pelo user-agent. E aguarda a
  // gravação (fire-and-forget se perde no serverless depois da resposta).
  const ua = (await headers()).get("user-agent") ?? "";
  const ehRobo =
    !ua ||
    /bot|crawler|spider|crawl|slurp|facebookexternalhit|whatsapp|telegram|discord|embedly|preview|monitor|lighthouse|headless|bingpreview|pinterest|linkedinbot|skypeuripreview|vkshare|redditbot|applebot/i.test(
      ua
    );
  if (!ehRobo) {
    await Promise.all([
      // total acumulado (all-time)
      db.bioPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } }),
      // evento com data (pra filtrar por período no relatório)
      db.bioView.create({ data: { bioPageId: page.id, companyId: page.companyId } }),
    ]).catch(() => {});
  }

  const c = page.company;
  // usa a fonte/cores próprias da bio; se não tiver, herda do catálogo da loja
  const fontClass = FONT_CLASS[page.font ?? c.catalogFont] ?? FONT_CLASS.montserrat;
  const colors = bioColors(page, {
    primary: c.catalogPrimary || "#4B3621",
    secondary: c.catalogSecondary || "#E7DCCC",
  });

  // fundo rico derivado da cor de fundo (clareia no topo, escurece embaixo)
  const bg = colors.bg;
  const top = mixHex(bg, "#ffffff", 0.18);
  const bottom = mixHex(bg, "#000000", 0.28);
  const onPrimary = readableOn(bg);
  const cardBg = colors.button;
  const onCard = colors.buttonText;
  const iconChip = mixHex(colors.button, colors.buttonText, 0.12);
  const btnClass = SHAPE_CLASS[page.buttonShape] ?? "rounded-2xl";

  const showCover = !!page.coverUrl && !page.hideCover;
  const avatar = page.avatarUrl || c.logoUrl;
  const headline = page.headline || c.name;
  const tagline = page.tagline || c.tagline;
  const socials = socialLinks(page);
  const platform = platformUrl();
  const footerHref = `${platform}/?utm_source=bio&utm_campaign=${encodeURIComponent(page.slug)}&demo=1`;

  return (
    <div
      className={`${fontClass} min-h-[100dvh] w-full`}
      style={{ background: `linear-gradient(165deg, ${top} 0%, ${bg} 45%, ${bottom} 100%)` }}
    >
      {/* foto de capa (banner no topo) — pode ser escondida pra bio compacta */}
      {showCover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={page.coverUrl!} alt="" className="mx-auto h-32 w-full max-w-[560px] object-cover sm:h-40" />
      )}
      <div className={`mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col items-center px-5 pb-6 ${showCover ? "-mt-11 pt-0" : "pt-6"}`}>
        {/* topo: avatar + nome + tagline */}
        <div className="flex flex-col items-center text-center">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt={headline}
              className="size-16 rounded-full object-cover shadow-lg ring-2"
              style={{ background: "#fff", borderColor: cardBg, ["--tw-ring-color" as string]: "rgba(255,255,255,.35)" }}
            />
          ) : (
            <div
              className="grid size-16 place-items-center rounded-full text-2xl font-extrabold shadow-lg ring-2"
              style={{ background: cardBg, color: onCard, ["--tw-ring-color" as string]: "rgba(255,255,255,.35)" }}
            >
              {headline.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="mt-2.5 text-[20px] font-extrabold tracking-tight" style={{ color: onPrimary }}>
            {headline}
          </h1>
          {socials.length > 0 && (
            <div className="mt-2 flex items-center gap-2.5">
              {socials.map((s) => {
                const SIcon = SOCIAL_ICON[s.key];
                return (
                  <a
                    key={s.key}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid size-8 place-items-center rounded-full transition hover:scale-110"
                    style={{ background: cardBg, color: onCard }}
                    aria-label={s.key}
                  >
                    <SIcon className="size-4" />
                  </a>
                );
              })}
            </div>
          )}
          {tagline && (
            <p className="mt-1.5 max-w-xs text-sm leading-snug opacity-90" style={{ color: onPrimary }}>
              {tagline}
            </p>
          )}
        </div>

        {/* botões */}
        <div className="mt-4 flex w-full flex-col gap-2.5">
          {page.links.length === 0 ? (
            <p className="text-center text-sm opacity-80" style={{ color: onPrimary }}>
              Em breve, novos links por aqui. ✨
            </p>
          ) : (
            page.links.map((l) => {
              const Icon = TYPE_ICON[l.type as keyof typeof TYPE_ICON] ?? Link2;
              const isWa = l.type === "WHATSAPP";
              // botão em BANNER: imagem larga clicável, título sobreposto (se houver)
              if (l.layout === "banner" && l.imageUrl) {
                return (
                  <a
                    key={l.id}
                    href={`/api/bio/go/${l.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group relative block overflow-hidden rounded-2xl shadow-md transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${l.featured ? "ring-2 ring-offset-2" : ""}`}
                    style={l.featured ? { ["--tw-ring-color" as string]: "#ffffff", ["--tw-ring-offset-color" as string]: bg } : undefined}
                  >
                    {l.featured && (
                      <span className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-800 shadow">
                        ✨ Destaque
                      </span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.imageUrl} alt={l.title} className="w-full object-cover" />
                  </a>
                );
              }
              return (
                <a
                  key={l.id}
                  href={`/api/bio/go/${l.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group relative flex items-center gap-3 ${btnClass} px-3 py-2.5 shadow-md transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${l.featured ? "ring-2 ring-offset-2" : ""}`}
                  style={{ background: cardBg, color: onCard, ...(l.featured ? { ["--tw-ring-color" as string]: "#ffffff", ["--tw-ring-offset-color" as string]: bg } : {}) }}
                >
                  {l.featured && (
                    <span className="absolute -right-1 -top-1 text-sm">✨</span>
                  )}
                  {/* miniatura ou ícone do tipo */}
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl"
                      style={{ background: isWa ? "#25D366" : iconChip, color: isWa ? "#ffffff" : onCard }}
                    >
                      <Icon className="size-5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-tight">{l.title}</span>
                    {l.subtitle && (
                      <span className="block truncate text-xs opacity-60">{l.subtitle}</span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 opacity-30 transition group-hover:translate-x-0.5 group-hover:opacity-60" />
                </a>
              );
            })
          )}
        </div>

        {/* rodapé: mesmo formato do catálogo (⚡ feito com…) — leva ao
            formulário de leads da plataforma (canal de aquisição) */}
        <a
          href={footerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 flex flex-col items-center gap-0.5 text-center transition"
          style={{ color: onPrimary }}
        >
          <span className="text-sm font-semibold underline underline-offset-2 opacity-85 transition hover:opacity-100">
            ⚡ feito com atacadopro.com
          </span>
          <span className="text-[10px] opacity-60">conheça o AtacadoPro →</span>
        </a>
      </div>

      {/* Pixel de remarketing da loja (Meta / Google) — só se configurado */}
      {page.metaPixelId && (
        <Script id="bio-meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${page.metaPixelId}');fbq('track','PageView');`}
        </Script>
      )}
      {page.gaId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${page.gaId}`} strategy="afterInteractive" />
          <Script id="bio-ga" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${page.gaId}');`}
          </Script>
        </>
      )}
    </div>
  );
}
