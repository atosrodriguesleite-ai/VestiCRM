import { ImageResponse } from "next/og";
import { db } from "@/lib/db";

/**
 * Favicon (ícone da aba) do catálogo público — personalizado por loja.
 * Usa o logo da loja quando houver; senão, a inicial do nome sobre a cor da
 * marca. Assim a aba nunca mostra o ícone do VestiCRM, e sim a identidade da
 * loja. Este arquivo (icon) sobrescreve o /icon.svg global nesta rota.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const company = await db.company.findUnique({
    where: { slug },
    select: { name: true, logoUrl: true, catalogPrimary: true },
  });

  if (company?.logoUrl) {
    return new ImageResponse(
      (
        <div style={{ display: "flex", width: "100%", height: "100%" }}>
          <img
            src={company.logoUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ),
      { ...size }
    );
  }

  const initial = (company?.name?.trim()?.[0] ?? "?").toUpperCase();
  const bg = company?.catalogPrimary ?? "#1E3A5F";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: bg,
          color: "#fff",
          fontSize: 40,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        {initial}
      </div>
    ),
    { ...size }
  );
}
