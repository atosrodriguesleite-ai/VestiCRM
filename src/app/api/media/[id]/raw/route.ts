import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { dataUrlToBuffer } from "@/lib/img-server";

/**
 * Serve a imagem da biblioteca como binário (pra exibir na grade e pra
 * baixar). Só entrega imagens da própria loja — a biblioteca é privada,
 * diferente das fotos de produto (que são públicas no catálogo).
 * `?download=1` força o navegador a salvar o arquivo.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const asset = await db.mediaAsset.findFirst({
      where: { id, companyId: user.companyId },
      select: { url: true, name: true },
    });
    if (!asset) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    // link externo: redireciona; data-URL: decodifica e entrega o binário
    if (!asset.url.startsWith("data:")) {
      return NextResponse.redirect(asset.url);
    }
    const decoded = dataUrlToBuffer(asset.url);
    if (!decoded) {
      return NextResponse.json({ error: "Imagem inválida" }, { status: 415 });
    }

    const download = req.nextUrl.searchParams.get("download");
    const ext = decoded.mime.split("/")[1]?.split("+")[0] || "jpg";
    const safeName = (asset.name || `imagem-${id}`).replace(/[^\w.-]+/g, "-");
    const headers: Record<string, string> = {
      "Content-Type": decoded.mime || "image/jpeg",
      "Content-Length": String(decoded.buf.byteLength),
      "Cache-Control": "private, max-age=3600",
    };
    if (download) {
      headers["Content-Disposition"] = `attachment; filename="${safeName}.${ext}"`;
    }
    return new NextResponse(new Uint8Array(decoded.buf), { headers });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
