import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { dataUrlToBuffer, lerImagem } from "@/lib/img-server";
import { versaoDaLogo } from "@/lib/catalogo/logo-da-loja";

/**
 * A LOGO DA LOJA COMO IMAGEM DE VERDADE (RN-070).
 *
 * A vitrine pública levava a logo (data-URL do banco) embutida na página, três
 * vezes — e uma logo pesada segurava a primeira pintura do catálogo por 18 s
 * num 4G fraco: a tela preta do print do dono. Esta rota entrega o binário,
 * e a vitrine só carrega um endereço curto.
 *
 * Porta PÚBLICA (o catálogo é aberto, `/api/img` já é público no porteiro) e
 * só de LEITURA. O que ela protege:
 *  - **loja suspensa ou inexistente** responde 404, a mesma régua do catálogo
 *    (loja suspensa não expõe nem o nome);
 *  - **só imagem de verdade, de tipo conhecido** sai: PNG, JPEG, WebP ou GIF,
 *    conferidos pelo CONTEÚDO (`lerImagem`), nunca pelo rótulo da data-URL. A
 *    logo é gravada por uma rota que aceita qualquer texto, e um SVG com
 *    script servido daqui rodaria no endereço do app; `nosniff` fecha o resto
 *    (a logo SVG legítima nem chega aqui: `enderecoDaLogo` a mantém embutida);
 *  - **cache forte só quando a versão confere** (`?v=` igual à impressão
 *    digital de agora): esse endereço nunca muda de conteúdo. Sem versão, ou
 *    com uma velha, o cache é curto. Na CDN o forte dura UM dia, não um ano:
 *    a loja suspensa (ou que apagou a logo) deixa de ser servida pela borda
 *    no dia seguinte — o navegador de quem já viu guarda a dele, como guarda
 *    qualquer imagem que já baixou.
 *
 * E ela EMAGRECE a logo grande: a vitrine a desenha pequena no cabeçalho, e
 * uma logo de 1000 px salva em PNG passava de 1 MB. Acima de 300 KB vai a
 * 800 px no lado maior — JPEG e WebP no formato deles, PNG e GIF como PNG
 * (a transparência do "remover fundo" do designer continua; o GIF perde a
 * animação, que numa logo de cabeçalho é enfeite). Se o resultado não sair
 * menor, vale o original.
 */

const TIPOS: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Acima disto a logo é redimensionada antes de sair. */
const LOGO_PESADA = 300 * 1024;
const LADO_MAXIMO = 800;

function recusa(status: 404 | 415) {
  return NextResponse.json(
    { error: status === 404 ? "Não encontrada" : "Imagem inválida" },
    // recusa nunca pode ficar guardada na CDN
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** A logo pesada em versão menor, no formato certo; o original se não ficar menor. */
async function emagrecer(buf: Buffer, formato: string): Promise<{ buf: Buffer; formato: string }> {
  // `.rotate()` aplica a orientação gravada pela câmera (EXIF) antes de
  // descartá-la: sem ele, a logo de JPEG de celular saía deitada
  const base = sharp(buf, { animated: false })
    .rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true });
  let menor: Buffer;
  let novoFormato = formato;
  if (formato === "jpeg") menor = await base.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  else if (formato === "webp") menor = await base.webp({ quality: 85 }).toBuffer();
  else {
    // PNG com paleta continua com paleta (sem isso o PNG de 256 cores virava
    // RGBA e podia sair MAIOR que o original)
    menor = await base.png({ compressionLevel: 9, palette: formato === "gif" || undefined }).toBuffer();
    novoFormato = "png";
  }
  return menor.byteLength < buf.byteLength ? { buf: menor, formato: novoFormato } : { buf, formato };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const loja = await db.company.findUnique({
    where: { slug },
    select: { logoUrl: true, suspended: true },
  });
  const logo = loja?.logoUrl?.trim();
  if (!loja || loja.suspended || !logo) return recusa(404);

  // logo gravada como LINK (não data-URL) já é um endereço: a vitrine o usa
  // direto (`enderecoDaLogo`), então aqui não há o que servir
  if (!logo.startsWith("data:")) return recusa(404);

  let buf: Buffer;
  let formato: string;
  try {
    // dentro do try: data-URL sem base64 passa por `decodeURIComponent`, que
    // LANÇA com um "%" torto — e o campo aceita qualquer texto (achado da
    // revisão). Lançar aqui virava 500 sem cabeçalho em toda visita.
    const decodificada = dataUrlToBuffer(logo);
    if (!decodificada || decodificada.buf.byteLength === 0) return recusa(415);
    const imagem = await lerImagem(decodificada.buf);
    if (!imagem || !TIPOS[imagem.format]) return recusa(415);
    buf = decodificada.buf;
    formato = imagem.format;
    if (buf.byteLength > LOGO_PESADA) ({ buf, formato } = await emagrecer(buf, formato));
  } catch {
    // não é imagem que o sharp processe: não sai daqui com rótulo de imagem
    return recusa(415);
  }

  const versaoPedida = req.nextUrl.searchParams.get("v");
  const versaoCerta = versaoPedida !== null && versaoPedida === versaoDaLogo(logo);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": TIPOS[formato],
      "Content-Length": String(buf.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": versaoCerta
        ? // o endereço com a versão certa nunca muda de conteúdo; a borda
          // guarda um dia, para a loja suspensa sair dela no dia seguinte
          "public, max-age=31536000, s-maxage=86400, immutable"
        : "public, max-age=60, s-maxage=60",
    },
  });
}
