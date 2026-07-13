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

/**
 * Remove o fundo sólido de uma logo (chroma-key): detecta a cor dos cantos
 * (fundo) e deixa transparente tudo que for parecido, com uma borda suave.
 * Ideal para logos que vêm com um fundo branco/preto e precisam "subir"
 * limpas no cabeçalho do catálogo. Retorna PNG (com transparência).
 */
export async function removeBackground(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const w = canvas.width;
  const h = canvas.height;
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;

  // cor de fundo = média dos 4 cantos
  const cornerAt = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [px[i], px[i + 1], px[i + 2]] as const;
  };
  const corners = [
    cornerAt(0, 0),
    cornerAt(w - 1, 0),
    cornerAt(0, h - 1),
    cornerAt(w - 1, h - 1),
  ];
  const key = [0, 1, 2].map((c) =>
    Math.round(corners.reduce((s, cc) => s + cc[c], 0) / corners.length)
  );

  const HARD = 70; // até aqui: 100% transparente
  const SOFT = 115; // entre HARD e SOFT: transição suave
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.sqrt(
      (px[i] - key[0]) ** 2 + (px[i + 1] - key[1]) ** 2 + (px[i + 2] - key[2]) ** 2
    );
    if (d <= HARD) px[i + 3] = 0;
    else if (d < SOFT)
      px[i + 3] = Math.round(px[i + 3] * ((d - HARD) / (SOFT - HARD)));
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
