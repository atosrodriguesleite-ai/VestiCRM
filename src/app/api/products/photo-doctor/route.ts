import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import {
  shrinkImage,
  dataUrlToBuffer,
  bufferToDataUrl,
  HEAVY_BYTES,
} from "@/lib/img-server";

/**
 * "Médico de fotos" do catálogo — varre as fotos dos produtos da loja e:
 *  - valida as que já estão salvas no banco (data-URL);
 *  - baixa e INTERNALIZA as que ainda apontam para site externo;
 *  - COMPRIME as pesadas (originais de câmera estouram o limite de resposta
 *    do serverless ~4,5 MB e quebram no catálogo — 1400px/JPEG resolve);
 *  - lista as irrecuperáveis (origem fora do ar) por produto, para re-upload.
 * Processa em lotes; o front chama de novo enquanto houver pendentes.
 */

export const maxDuration = 60;

const BATCH_EXTERNAS = 25;
const BATCH_PESADAS = 8;
const MAX_BYTES = 8 * 1024 * 1024;
// base64 ocupa ~4/3 do binário: limiar em caracteres da data-URL
const HEAVY_CHARS = Math.floor((HEAVY_BYTES * 4) / 3);

export async function POST() {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const images = await db.productImage.findMany({
      where: { product: { companyId: user.companyId } },
      select: {
        id: true,
        url: true,
        product: { select: { name: true } },
      },
      orderBy: { id: "asc" },
    });

    let ok = 0;
    let internas = 0;
    const invalidas: string[] = [];
    const externas: { id: string; url: string; product: string }[] = [];
    const pesadas: { id: string; url: string; product: string }[] = [];

    // validação leve, sem regex no arquivo inteiro (foto de 15 MB estoura a
    // pilha do regex): confere o cabeçalho e se há conteúdo suficiente.
    const isValidDataUrl = (u: string) => {
      const sep = u.indexOf(";base64,");
      if (sep < 0) return false;
      if (!/^data:image\/[a-z+.-]+$/i.test(u.slice(0, sep))) return false;
      return u.length - (sep + 8) > 100;
    };

    for (const img of images) {
      if (img.url.startsWith("data:")) {
        if (!isValidDataUrl(img.url)) {
          invalidas.push(img.product.name);
        } else if (img.url.length > HEAVY_CHARS) {
          pesadas.push({ id: img.id, url: img.url, product: img.product.name });
        } else {
          ok++;
        }
      } else if (/^https?:\/\//i.test(img.url)) {
        externas.push({ id: img.id, url: img.url, product: img.product.name });
      } else {
        internas++; // caminho interno (/products/x.svg) — sempre funciona
      }
    }

    const consertadas: string[] = [];
    const falharam: string[] = [];
    const otimizadas: string[] = [];

    // 1) internaliza um lote de externas
    const loteExt = externas.slice(0, BATCH_EXTERNAS);
    const CONC = 5;
    for (let i = 0; i < loteExt.length; i += CONC) {
      await Promise.all(
        loteExt.slice(i, i + CONC).map(async (img) => {
          try {
            const res = await fetch(img.url, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
                Accept: "image/*,*/*;q=0.8",
              },
              redirect: "follow",
              signal: AbortSignal.timeout(12000),
            });
            let mime = res.headers.get("content-type")?.split(";")[0] ?? "";
            if (!res.ok || !mime.startsWith("image/")) throw new Error("no-img");
            let buf: Buffer = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) throw new Error("size");
            if (buf.byteLength > HEAVY_BYTES) {
              try {
                const small = await shrinkImage(buf);
                buf = small.buf;
                mime = small.mime;
              } catch {}
            }
            await db.productImage.update({
              where: { id: img.id },
              data: { url: bufferToDataUrl(buf, mime) },
            });
            consertadas.push(img.product);
          } catch {
            falharam.push(img.product);
          }
        })
      );
    }

    // 2) comprime um lote de pesadas (uma por vez — sharp usa CPU)
    for (const img of pesadas.slice(0, BATCH_PESADAS)) {
      try {
        const decoded = dataUrlToBuffer(img.url);
        if (!decoded) continue;
        const small = await shrinkImage(decoded.buf);
        await db.productImage.update({
          where: { id: img.id },
          data: { url: bufferToDataUrl(small.buf, small.mime) },
        });
        otimizadas.push(img.product);
      } catch {
        invalidas.push(img.product);
      }
    }

    const uniq = (l: string[]) => [...new Set(l)];
    return NextResponse.json({
      total: images.length,
      salvasNoBanco: ok,
      internas,
      consertadasAgora: consertadas.length,
      consertadasProdutos: uniq(consertadas),
      otimizadasAgora: otimizadas.length,
      otimizadasProdutos: uniq(otimizadas),
      falharam: uniq(falharam),
      invalidas: uniq(invalidas),
      externasRestantes: Math.max(0, externas.length - loteExt.length),
      pesadasRestantes: Math.max(0, pesadas.length - BATCH_PESADAS),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
