import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { dataUrlToBuffer } from "@/lib/img-server";
import { cabecalhosDaFoto } from "@/lib/imagem-segura";

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
    // A extensão sai do tipo REAL do arquivo, mesmo quando ele está fora da
    // lista: usar o "octet-stream" do cabeçalho gerava `foto.octet-stream`,
    // e aí a lojista baixa um arquivo que o computador dela não sabe abrir.
    const ext = (decoded.mime || "image/jpeg").split("/")[1]?.split("+")[0] || "bin";
    const safeName = (asset.name || `imagem-${id}`).replace(/[^\w.-]+/g, "-");
    // A régua é a mesma da foto de produto (RN-026): tipo fora da lista sai
    // como download inerte, nunca como página no endereço do app.
    const headers: Record<string, string> = {
      ...cabecalhosDaFoto(decoded.mime, {
        cache: "private, max-age=3600",
        nome: `${safeName}.${ext}`,
      }),
      "Content-Length": String(decoded.buf.byteLength),
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
