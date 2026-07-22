import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { mixHex, readableOn } from "@/lib/color";
import { bioColors } from "@/lib/bio";

/**
 * Imagem de compartilhamento (Open Graph) da bio: quando o link é colado no
 * WhatsApp/Instagram/Facebook, aparece este cartão bonito com o nome, a
 * frase e as cores da loja — em vez de um preview sem graça.
 */
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Bio da loja";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await db.bioPage.findFirst({
    where: { slug },
    include: {
      company: { select: { name: true, tagline: true, catalogPrimary: true, catalogSecondary: true } },
    },
  });

  const name = page?.headline || page?.company.name || "Minha loja";
  const tagline = page?.tagline || page?.company.tagline || "Confira nossos links ✨";
  const colors = bioColors(page ?? {}, {
    primary: page?.company.catalogPrimary || "#4B3621",
    secondary: page?.company.catalogSecondary || "#E7DCCC",
  });
  const top = mixHex(colors.bg, "#ffffff", 0.18);
  const bottom = mixHex(colors.bg, "#000000", 0.3);
  const onBg = readableOn(colors.bg);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          backgroundImage: `linear-gradient(150deg, ${top} 0%, ${colors.bg} 48%, ${bottom} 100%)`,
        }}
      >
        <div
          style={{
            display: "flex",
            height: 160,
            width: 160,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            background: colors.button,
            color: colors.buttonText,
            fontSize: 96,
            fontWeight: 800,
            boxShadow: "0 10px 40px rgba(0,0,0,.25)",
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 68, fontWeight: 800, color: onBg, textAlign: "center" }}>
          {name}
        </div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 34, color: onBg, opacity: 0.9, textAlign: "center", maxWidth: 900 }}>
          {tagline}
        </div>
        <div style={{ display: "flex", marginTop: 44, fontSize: 26, color: onBg, opacity: 0.7 }}>
          atacadopro.com/bio/{slug}
        </div>
      </div>
    ),
    { ...size }
  );
}
