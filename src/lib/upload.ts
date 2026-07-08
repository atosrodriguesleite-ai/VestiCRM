"use client";

/**
 * Upload de imagem sem infraestrutura externa: o arquivo é redimensionado
 * no navegador (canvas) e salvo como data-URL no banco — mesmo modelo do
 * catálogo estático que inspirou o layout. Ao plugar um storage (S3,
 * UploadThing...), basta trocar esta função por um upload real: o resto do
 * app só conhece a URL resultante.
 */
export async function fileToDataUrl(
  file: File,
  maxSize = 900,
  quality = 0.82
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const isPng = file.type === "image/png" || file.type === "image/svg+xml";
  return canvas.toDataURL(isPng ? "image/png" : "image/jpeg", quality);
}
