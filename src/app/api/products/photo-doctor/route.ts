import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * "Médico de fotos" do catálogo — varre as fotos dos produtos da loja e:
 *  - valida as que já estão salvas no banco (data-URL);
 *  - baixa e INTERNALIZA as que ainda apontam para site externo (grava como
 *    data-URL — nunca mais dependem do site de origem);
 *  - lista as irrecuperáveis (origem fora do ar) por produto, para re-upload.
 * Processa em lotes (limite de tempo do serverless); o front chama de novo
 * enquanto houver pendentes.
 */

const BATCH = 25; // externas por chamada
const MAX_BYTES = 8 * 1024 * 1024;

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

    for (const img of images) {
      if (img.url.startsWith("data:")) {
        if (/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s]{100,}$/i.test(img.url)) ok++;
        else invalidas.push(img.product.name);
      } else if (/^https?:\/\//i.test(img.url)) {
        externas.push({ id: img.id, url: img.url, product: img.product.name });
      } else {
        internas++; // caminho interno (/products/x.svg) — sempre funciona
      }
    }

    // conserta um lote de externas agora
    const lote = externas.slice(0, BATCH);
    const consertadas: string[] = [];
    const falharam: string[] = [];
    const CONC = 5;
    for (let i = 0; i < lote.length; i += CONC) {
      await Promise.all(
        lote.slice(i, i + CONC).map(async (img) => {
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
            const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
            if (!res.ok || !mime.startsWith("image/")) throw new Error("no-img");
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) throw new Error("size");
            await db.productImage.update({
              where: { id: img.id },
              data: { url: `data:${mime};base64,${buf.toString("base64")}` },
            });
            consertadas.push(img.product);
          } catch {
            falharam.push(img.product);
          }
        })
      );
    }

    const uniq = (l: string[]) => [...new Set(l)];
    return NextResponse.json({
      total: images.length,
      salvasNoBanco: ok,
      internas,
      consertadasAgora: consertadas.length,
      consertadasProdutos: uniq(consertadas),
      falharam: uniq(falharam),
      invalidas: uniq(invalidas),
      externasRestantes: Math.max(0, externas.length - lote.length),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
