import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Serve a foto de um produto como imagem de verdade.
 * As fotos ficam no banco como data-URL (base64); esta rota decodifica e
 * entrega o binário com cache de 1 ano (imutável) — o navegador e a CDN
 * da Vercel guardam a foto e o catálogo carrega leve, sem HTML de 19 MB.
 * Pública por natureza: o catálogo é aberto e o id (cuid) não é adivinhável.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const img = await db.productImage.findUnique({
    where: { id },
    select: { url: true },
  });
  if (!img) {
    return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
  }

  // URL externa (http...): apenas redireciona
  if (!img.url.startsWith("data:")) {
    return NextResponse.redirect(img.url);
  }

  const m = img.url.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!m) {
    return NextResponse.json({ error: "Imagem inválida" }, { status: 415 });
  }
  const [, mime, isB64, data] = m;
  const body = isB64
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data), "utf-8");

  return new NextResponse(body, {
    headers: {
      "Content-Type": mime || "image/jpeg",
      "Content-Length": String(body.byteLength),
      // foto de produto não muda (editar = nova imagem/id): cache imutável.
      // s-maxage faz a CDN da Vercel guardar a foto — o banco só é
      // consultado UMA vez por foto, não uma vez por visitante.
      "Cache-Control":
        "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
