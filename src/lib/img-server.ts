import sharp from "sharp";

/**
 * Compressão de foto de produto no servidor (sharp).
 * Fotos originais de câmera/site (5–8 MB) estouram o limite de resposta do
 * serverless (~4,5 MB) e quebram no catálogo. Para vitrine, 1400px de lado
 * maior com JPEG q78 é mais que suficiente — fica nítida e leve (~150–400 KB).
 */

/** Acima disso a foto é considerada "pesada" e deve ser comprimida. */
export const HEAVY_BYTES = 900 * 1024;

export async function shrinkImage(
  input: Buffer
): Promise<{ buf: Buffer; mime: string }> {
  const buf = await sharp(input)
    .rotate() // respeita a orientação EXIF (foto de celular)
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return { buf, mime: "image/jpeg" };
}

/** Decodifica uma data-URL para binário (null se não for data-URL válida). */
export function dataUrlToBuffer(
  url: string
): { buf: Buffer; mime: string } | null {
  const m = url.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!m) return null;
  const [, mime, isB64, data] = m;
  const buf = isB64
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data), "utf-8");
  return { buf, mime: mime || "image/jpeg" };
}

export function bufferToDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Verifica se o binário é uma imagem de verdade (decodificável).
 * Importações antigas podem ter gravado erro/HTML do site de origem com
 * cabeçalho de imagem — passa na validação de formato mas quebra no
 * navegador. O sharp lê só o cabeçalho: rápido e definitivo.
 */
export async function isRealImage(buf: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buf).metadata();
    return Boolean(meta.format && (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0);
  } catch {
    return false;
  }
}
