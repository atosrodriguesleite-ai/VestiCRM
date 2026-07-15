import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { shrinkImage, dataUrlToBuffer, bufferToDataUrl } from "@/lib/img-server";

/** Identificação do ambiente (para diagnóstico): banco e versão do código. */
const DB_FP = createHash("sha256")
  .update(process.env.DATABASE_URL ?? "")
  .digest("hex")
  .slice(0, 8);
const DEPLOY = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

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
// Acima disso a resposta corre risco de estourar o limite do serverless
// (~4,5 MB) e a foto quebra no catálogo: comprime antes de entregar.
const SAFE_RESPONSE_BYTES = 3 * 1024 * 1024;

function serveBuffer(body: Buffer, mime: string): NextResponse {
  return new NextResponse(new Uint8Array(body), {
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

async function serveDataUrl(id: string, dataUrl: string): Promise<NextResponse> {
  const decoded = dataUrlToBuffer(dataUrl);
  if (!decoded) {
    return NextResponse.json(
      { error: "Imagem inválida" },
      { status: 415, headers: { "Cache-Control": "no-store" } }
    );
  }
  let buf: Buffer = decoded.buf;
  let mime = decoded.mime;

  // Foto pesada demais para a resposta do serverless: comprime agora e grava
  // a versão leve no banco (self-healing) — o catálogo nunca mais quebra.
  if (buf.byteLength > SAFE_RESPONSE_BYTES) {
    try {
      const small = await shrinkImage(buf);
      buf = small.buf;
      mime = small.mime;
      db.productImage
        .update({ where: { id }, data: { url: bufferToDataUrl(buf, mime) } })
        .catch(() => {});
    } catch {
      // compressão falhou: serve o original (pode falhar no limite, mas
      // não há alternativa melhor aqui)
    }
  }
  return serveBuffer(buf, mime);
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
    // no-store: um "não encontrada" NUNCA pode ficar guardado na CDN.
    // O corpo identifica o ambiente (id recebido, contagem no banco,
    // impressão digital do banco e versão do código) para o diagnóstico
    // expor divergência entre quem lista as fotos e quem as serve.
    const n = await db.productImage
      .count({ where: { id } })
      .catch(() => -1);
    return NextResponse.json(
      { error: "Não encontrada", id, len: id.length, n, db: DB_FP, dep: DEPLOY },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (img.url.startsWith("data:")) {
    return serveDataUrl(id, img.url);
  }

  // ATALHO INTERNO (/api/img/<outroId>): herança de importação que gravou a
  // REFERÊNCIA de outra foto em vez do arquivo. Redirecionar quebrava quando
  // o alvo tinha sido apagado (404 em cadeia). Resolve aqui: alvo vivo →
  // serve e cola a foto nesta linha (vira independente); alvo morto → 404
  // limpo (sem redirect fantasma).
  const ref = img.url.match(/^\/api\/img\/([a-z0-9]+)/i);
  if (ref) {
    const target = await db.productImage.findUnique({
      where: { id: ref[1] },
      select: { url: true },
    });
    if (target?.url.startsWith("data:")) {
      db.productImage
        .update({ where: { id }, data: { url: target.url } })
        .catch(() => {});
      return serveDataUrl(id, target.url);
    }
    return NextResponse.json(
      { error: "Não encontrada", ref: ref[1], db: DB_FP, dep: DEPLOY },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
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
      let mime = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (res.ok && mime.startsWith("image/")) {
        let buf: Buffer = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > 0 && buf.byteLength <= MAX_EXTERNAL_BYTES) {
          // originais de câmera/site vêm pesados: comprime antes de guardar
          if (buf.byteLength > SAFE_RESPONSE_BYTES) {
            try {
              const small = await shrinkImage(buf);
              buf = small.buf;
              mime = small.mime;
            } catch {}
          }
          // grava sem bloquear a resposta; se falhar, tenta de novo depois
          db.productImage
            .update({ where: { id }, data: { url: bufferToDataUrl(buf, mime) } })
            .catch(() => {});
          return serveBuffer(buf, mime);
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
