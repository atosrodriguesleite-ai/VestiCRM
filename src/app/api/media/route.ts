import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { dataUrlToBuffer, shrinkImage, bufferToDataUrl, HEAVY_BYTES } from "@/lib/img-server";

/**
 * Biblioteca de imagens da loja (recurso gated: mediaLibraryEnabled).
 *  • GET  → lista as imagens (id, nome, data) — SEM o base64, pra ficar leve.
 *           A foto em si é servida por /api/media/[id]/raw.
 *  • POST → sobe uma imagem nova (data-URL). Imagens pesadas são comprimidas
 *           na entrada, pra biblioteca não inchar o banco.
 */

async function guard() {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { mediaLibraryEnabled: true },
  });
  return { user, enabled: !!company?.mediaLibraryEnabled };
}

export async function GET() {
  try {
    const { user, enabled } = await guard();
    if (!enabled) {
      return NextResponse.json({ error: "Recurso não habilitado" }, { status: 403 });
    }
    const assets = await db.mediaAsset.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
      take: 500,
    });
    return NextResponse.json({ assets });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const postSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  dataUrl: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { user, enabled } = await guard();
    if (!enabled) {
      return NextResponse.json({ error: "Recurso não habilitado" }, { status: 403 });
    }
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    let url = parsed.data.dataUrl.trim();

    // aceita só imagem em data-URL; comprime se vier pesada (controla o peso)
    const decoded = dataUrlToBuffer(url);
    if (!decoded || !decoded.mime.startsWith("image/")) {
      return NextResponse.json({ error: "Envie um arquivo de imagem." }, { status: 400 });
    }
    if (decoded.buf.byteLength > HEAVY_BYTES) {
      try {
        const small = await shrinkImage(decoded.buf);
        url = bufferToDataUrl(small.buf, small.mime);
      } catch {
        // se a compressão falhar, guarda o original mesmo
      }
    }

    const asset = await db.mediaAsset.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name?.trim() || null,
        url,
      },
      select: { id: true, name: true, createdAt: true },
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
