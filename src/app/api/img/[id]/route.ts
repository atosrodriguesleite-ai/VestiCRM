import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Serve a foto de um produto como imagem de verdade.
 * As fotos ficam no banco como data-URL (base64); esta rota decodifica e
 * entrega o binário com cache de 1 ano (imutável) — o navegador e a CDN
 * da Vercel guardam a foto e o catálogo carrega leve, sem HTML de 19 MB.
 * Pública por natureza: o catálogo é aberto e o id (cuid) não é adivinhável.
 *
 * Fotos importadas como LINK EXTERNO (ex.: site antigo da loja) não podem
 * depender do site de origem — ele pode bloquear hotlink ou sair do ar e a
 * foto quebra no catálogo. Por isso o servidor busca a imagem UMA vez,
 * grava como data-URL no banco (vira nossa, para sempre) e serve o binário.
 */

const MAX_EXTERNAL_BYTES = 8 * 1024 * 1024; // 8 MB por foto

function serveDataUrl(dataUrl: string): NextResponse {
  const m = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
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

  if (img.url.startsWith("data:")) {
    return serveDataUrl(img.url);
  }

  // Link externo (http/https): busca no servidor, grava como data-URL
  // (self-healing — na próxima vez já sai do banco) e entrega o binário.
  if (/^https?:\/\//i.test(img.url)) {
    try {
      const res = await fetch(img.url, {
        headers: {
          // alguns hosts bloqueiam requisições "sem navegador"
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          Accept: "image/*,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (res.ok && mime.startsWith("image/")) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > 0 && buf.byteLength <= MAX_EXTERNAL_BYTES) {
          const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
          // grava sem bloquear a resposta; se falhar, tenta de novo depois
          db.productImage
            .update({ where: { id }, data: { url: dataUrl } })
            .catch(() => {});
          return new NextResponse(buf, {
            headers: {
              "Content-Type": mime,
              "Content-Length": String(buf.byteLength),
              "Cache-Control":
                "public, max-age=31536000, s-maxage=31536000, immutable",
            },
          });
        }
      }
    } catch {
      // busca falhou — cai no redirect abaixo como última tentativa
    }
    return NextResponse.redirect(img.url, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  // Caminho interno (/products/x.svg): redireciona com base na requisição.
  return NextResponse.redirect(new URL(img.url, _req.url), {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
