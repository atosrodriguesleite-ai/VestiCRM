import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { conversationScope } from "@/lib/scope";
import { shrinkImage, dataUrlToBuffer } from "@/lib/img-server";

/**
 * Serve a MÍDIA de uma mensagem (foto, áudio, documento) como arquivo de
 * verdade, com cache no navegador. Antes, a mídia viajava inteira (base64)
 * dentro do JSON da inbox — a tela baixava TODAS as mídias de TODAS as
 * conversas a cada carga, o que deixava o celular lento. Agora o JSON leva
 * só o link; o navegador busca cada mídia UMA vez, quando aparece na tela.
 *
 * Privada: exige login e respeita o escopo de conversas do usuário
 * (multi-tenant + carteira). Por isso o cache é `private` (só o navegador
 * guarda; a CDN não) — a mídia nunca muda, então é imutável por 1 ano.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const msg = await db.message.findFirst({
      where: { id, conversation: conversationScope(user) },
      select: { mediaUrl: true },
    });
    if (!msg?.mediaUrl) {
      return NextResponse.json(
        { error: "Mídia não encontrada" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    // link externo (raro): repassa
    if (!msg.mediaUrl.startsWith("data:")) {
      return NextResponse.redirect(msg.mediaUrl, {
        headers: { "Cache-Control": "private, max-age=3600" },
      });
    }
    const decoded = dataUrlToBuffer(msg.mediaUrl);
    if (!decoded) {
      return NextResponse.json(
        { error: "Mídia inválida" },
        { status: 415, headers: { "Cache-Control": "no-store" } }
      );
    }
    let buf: Buffer = decoded.buf;
    let mime = decoded.mime;
    // imagem pesada demais para a resposta do serverless: comprime na entrega
    if (buf.byteLength > 3 * 1024 * 1024 && mime.startsWith("image/")) {
      try {
        const small = await shrinkImage(buf);
        buf = small.buf;
        mime = small.mime;
      } catch {
        /* comprime falhou: tenta servir o original */
      }
    }
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime || "application/octet-stream",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
