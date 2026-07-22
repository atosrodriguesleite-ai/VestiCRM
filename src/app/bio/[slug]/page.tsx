import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  Montserrat,
  Inter,
  Poppins,
  Playfair_Display,
  Lora,
} from "next/font/google";
import {
  ShoppingBag,
  MessageCircle,
  Globe,
  Link2,
  ChevronRight,
} from "lucide-react";
import { db } from "@/lib/db";
import { mixHex, readableOn } from "@/lib/color";
import { bioColors } from "@/lib/bio";
import { platformUrl } from "@/lib/site";

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

  // conta a visita (não bloqueia a renderização)
  db.bioPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } }).catch(() => {});

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

  const avatar = page.avatarUrl || c.logoUrl;
  const headline = page.headline || c.name;
  const tagline = page.tagline || c.tagline;
  const platform = platformUrl();
  const footerHref = `${platform}/?utm_source=bio&utm_campaign=${encodeURIComponent(page.slug)}&demo=1`;

  return (
    <div
      className={`${fontClass} min-h-[100dvh] w-full`}
      style={{ background: `linear-gradient(165deg, ${top} 0%, ${bg} 45%, ${bottom} 100%)` }}
    >
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col items-center px-5 pt-14 pb-10">
        {/* topo: avatar + nome + tagline */}
        <div className="flex flex-col items-center text-center">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt={headline}
              className="size-24 rounded-full object-cover shadow-lg ring-4"
              style={{ background: "#fff", borderColor: cardBg, ["--tw-ring-color" as string]: "rgba(255,255,255,.35)" }}
            />
          ) : (
            <div
              className="grid size-24 place-items-center rounded-full text-3xl font-extrabold shadow-lg ring-4"
              style={{ background: cardBg, color: onCard, ["--tw-ring-color" as string]: "rgba(255,255,255,.35)" }}
            >
              {headline.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="mt-4 text-[22px] font-extrabold tracking-tight" style={{ color: onPrimary }}>
            {headline}
          </h1>
          <p className="mt-0.5 text-sm font-medium opacity-80" style={{ color: onPrimary }}>
            @{c.slug}
          </p>
          {tagline && (
            <p className="mt-2 max-w-xs text-sm leading-snug opacity-90" style={{ color: onPrimary }}>
              {tagline}
            </p>
          )}
        </div>

        {/* botões */}
        <div className="mt-8 flex w-full flex-col gap-3">
          {page.links.length === 0 ? (
            <p className="text-center text-sm opacity-80" style={{ color: onPrimary }}>
              Em breve, novos links por aqui. ✨
            </p>
          ) : (
            page.links.map((l) => {
              const Icon = TYPE_ICON[l.type as keyof typeof TYPE_ICON] ?? Link2;
              const isWa = l.type === "WHATSAPP";
              return (
                <a
                  key={l.id}
                  href={`/api/bio/go/${l.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group flex items-center gap-3 ${btnClass} px-3 py-3 shadow-md transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0`}
                  style={{ background: cardBg, color: onCard }}
                >
                  {/* miniatura ou ícone do tipo */}
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span
                      className="grid size-11 shrink-0 place-items-center rounded-xl"
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

        {/* rodapé: leva ao formulário de leads da plataforma */}
        <a
          href={footerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto pt-10 text-center text-xs font-medium opacity-70 transition hover:opacity-100"
          style={{ color: onPrimary }}
        >
          feito por <b>atacadopro.com</b>
        </a>
      </div>
    </div>
  );
}
