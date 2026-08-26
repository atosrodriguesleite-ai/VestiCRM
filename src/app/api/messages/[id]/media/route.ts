import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { conversationScope } from "@/lib/scope";
import { shrinkImage, dataUrlToBuffer } from "@/lib/img-server";
import { nomeDoArquivo } from "@/lib/midia-arquivo";

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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    // `?baixar=1` = SALVAR NO APARELHO. A mesma porta serve a mídia para
    // aparecer na bolha (padrão) e para guardar no computador/celular. Sem
    // esta chave, o navegador só ABRIA a foto numa aba nova — e no celular
    // nem isso — e não havia como salvar vídeo, áudio ou foto (relato do
    // dono, 26/08/2026). O atributo `download` do link sozinho não resolve:
    // ele é ignorado quando o arquivo vem de outro endereço, e alguns
    // navegadores o ignoram junto com `target="_blank"`.
    const baixar = req.nextUrl.searchParams.get("baixar") === "1";
    const msg = await db.message.findFirst({
      where: { id, conversation: conversationScope(user) },
      select: { mediaUrl: true, fileName: true, mediaType: true },
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
    const tipo = mime || "application/octet-stream";
    // ARQUIVO DA CLIENTE NÃO RODA DENTRO DO SISTEMA.
    //
    // O tipo vem do WhatsApp, e a cliente escolhe o que manda: um .html (ou
    // um .svg, que carrega script) servido para MOSTRAR abre no endereço do
    // app, com o login da vendedora do lado. Só os tipos que a bolha
    // realmente desenha são exibidos; o resto sai como arquivo para baixar,
    // que é inofensivo. O `nosniff` fecha a outra metade: sem ele o
    // navegador adivinha o tipo pelo conteúdo e ignora o que a gente disse.
    const podeMostrar =
      /^(image\/(jpeg|png|gif|webp|bmp)|video\/|audio\/|application\/pdf)/.test(tipo);
    const comoArquivo = baixar || !podeMostrar;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ...(comoArquivo
          ? {
              // `filename*` (UTF-8) para nome com acento não virar lixo
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
                nomeDoArquivo(msg.fileName, msg.mediaType, tipo)
              )}`,
            }
          : {}),
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
