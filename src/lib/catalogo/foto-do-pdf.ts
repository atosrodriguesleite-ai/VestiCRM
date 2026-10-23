/**
 * AS FOTOS DO CATÁLOGO EM PDF (RN-094).
 *
 * A foto de produto mora no banco de três jeitos (dívida técnica nº 1):
 * data-URL (o normal), LINK EXTERNO http (Nuvemshop, Jueri, importação de
 * site antigo) e, por herança de importação, uma REFERÊNCIA interna a outra
 * foto (`/api/img/<outroId>`). A rota `/api/img/[id]` já resolve os três — e
 * cura o link externo gravando-o como data-URL na primeira visita.
 *
 * Aqui é o mesmo caminho, com três diferenças que são do PDF:
 *  • é EM LOTE (uma consulta para o catálogo inteiro, não uma por foto);
 *  • **não grava nada**: gerar um PDF é leitura — a cura do link externo
 *    continua acontecendo pelo tráfego normal da vitrine;
 *  • tem ORÇAMENTO DE TEMPO. A função da Vercel morre em 60s, e uma loja com
 *    centenas de links externos levaria mais que isso só buscando foto. O que
 *    não chegou dentro do orçamento sai do PDF como moldura vazia — catálogo
 *    com uma foto faltando é melhor que catálogo nenhum.
 */

import sharp from "sharp";
import { db } from "@/lib/db";
import { dataUrlToBuffer } from "@/lib/img-server";

/**
 * Largura da foto dentro do PDF, em pixels.
 *
 * Medido: a 420px com qualidade 72 uma foto de peça fica em 5–6 KB e, no
 * tamanho em que é impressa (≈159 × 184 pt), não dá para distinguir de uma
 * maior. A 300px o arquivo cai pela metade mas aparece borrão ao dar zoom no
 * celular — e é dando zoom que a lojista olha trama e acabamento.
 */
export const LARGURA_DA_FOTO = 420;
export const QUALIDADE_DA_FOTO = 72;

/** teto de bytes de uma foto externa — acima disso não vale o tempo */
const MAX_EXTERNO = 8 * 1024 * 1024;
/** cada link externo tem a própria paciência, curta */
const MS_POR_FOTO_EXTERNA = 6000;
/** quantas fotos processamos ao mesmo tempo */
const EM_PARALELO = 8;

export type FotoDoPdf = { jpeg: Buffer };

/**
 * Lê e encolhe as fotos pedidas, em lote. Devolve só as que deram certo —
 * quem desenha trata a ausência como moldura vazia.
 *
 * `restante()` diz quantos milissegundos ainda há; quando acaba, a leitura
 * PARA (o que já foi lido continua valendo).
 */
export async function lerFotosParaPdf(
  ids: string[],
  restante: () => number,
  /**
   * a proporção da moldura do card (altura ÷ largura). A foto sai RECORTADA
   * nessa proporção, ancorada no TOPO — é o `object-cover object-top` do
   * site. Recortar aqui (e não ao desenhar) é o que impede a foto de vazar
   * por cima do card vizinho: o pdf-lib não sabe recortar.
   */
  proporcao = 184 / 159
): Promise<Map<string, FotoDoPdf>> {
  const saida = new Map<string, FotoDoPdf>();
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return saida;

  /*
   * EM BLOCOS, INCLUSIVE A CONSULTA.
   *
   * Uma consulta só para as 600 fotos seria a mais fácil de escrever e a
   * pior possível: cada data-URL tem megabytes de base64, e elas ficariam
   * todas na memória a rodada inteira — a função morre sem resposta, que é
   * exatamente o que o orçamento de tempo existe para evitar (achado da
   * revisão). Cada bloco lê, encolhe e deixa o cru ser recolhido; o que
   * sobra na memória é só o JPEG de ~6 KB.
   */
  for (let i = 0; i < unicos.length; i += EM_PARALELO) {
    if (restante() <= 0) break;
    const bloco = unicos.slice(i, i + EM_PARALELO);
    const porId = await lerUrls(bloco);
    const lidas = await Promise.all(
      bloco.map(async (id) => {
        const url = porId.get(id);
        if (!url) return null;
        const bruto = await lerBruto(url, restante);
        if (!bruto) return null;
        try {
          const jpeg = await sharp(bruto)
            .rotate() // orientação EXIF (foto de celular deitada)
            .resize({
              width: LARGURA_DA_FOTO,
              height: Math.round(LARGURA_DA_FOTO * proporcao),
              fit: "cover",
              position: "top",
              withoutEnlargement: false,
            })
            // fundo branco: PNG com transparência viraria preto no JPEG
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: QUALIDADE_DA_FOTO, mozjpeg: true })
            .toBuffer();
          return { id, jpeg };
        } catch {
          // foto corrompida (importação antiga gravou HTML com cabeçalho de
          // imagem): sai do PDF, não derruba o catálogo inteiro
          return null;
        }
      })
    );
    for (const l of lidas) if (l) saida.set(l.id, { jpeg: l.jpeg });
  }

  return saida;
}

/**
 * As URLs de um bloco de fotos, já resolvendo a REFERÊNCIA interna
 * (`/api/img/<outroId>`, herança de importação que gravou o ponteiro para
 * outra foto em vez do arquivo). Um nível só: cadeia de referência não
 * existe em loja viva, e seguir para sempre seria laço.
 */
async function lerUrls(ids: string[]): Promise<Map<string, string>> {
  const linhas = await db.productImage.findMany({
    where: { id: { in: ids } },
    select: { id: true, url: true },
  });
  const porId = new Map(linhas.map((l) => [l.id, l.url]));

  const refDe = (url: string) => url.match(/^\/api\/img\/([a-z0-9]+)/i)?.[1];
  const alvos = [...new Set([...porId.values()].map(refDe).filter((x): x is string => !!x))];
  if (!alvos.length) return porId;

  const extras = await db.productImage.findMany({
    where: { id: { in: alvos } },
    select: { id: true, url: true },
  });
  const mapa = new Map(extras.map((l) => [l.id, l.url]));
  for (const [id, url] of porId) {
    const ref = refDe(url);
    const destino = ref ? mapa.get(ref) : undefined;
    // só adota o destino quando ele é conteúdo de verdade: referência que
    // aponta para outra referência (ou para foto apagada) fica sem foto
    if (destino && !refDe(destino)) porId.set(id, destino);
  }
  return porId;
}

/** O binário de uma foto, venha ela do banco ou da internet. */
async function lerBruto(url: string, restante: () => number): Promise<Buffer | null> {
  if (url.startsWith("data:")) return dataUrlToBuffer(url)?.buf ?? null;
  if (!/^https?:\/\//i.test(url)) return null;
  // link externo: paciência curta e nunca maior que o tempo que sobra
  const paciencia = Math.min(MS_POR_FOTO_EXTERNA, restante());
  if (paciencia <= 0) return null;
  try {
    const res = await fetch(url, {
      headers: {
        // alguns hosts recusam requisição "sem navegador"
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(paciencia),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type")?.split(";")[0] ?? "").startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= MAX_EXTERNO ? buf : null;
  } catch {
    return null;
  }
}
