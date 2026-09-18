/**
 * IMAGEM → BITMAP PRETO E BRANCO para a Zebra (RN-059). Só navegador.
 *
 * A Zebra imprime imagem como `^GF` (1 bit por ponto, 8 pontos por mm). O
 * servidor não tem canvas, então quem rasteriza é o navegador, ao salvar o
 * modelo, no tamanho em que a imagem está na etiqueta. Pixel escuro vira
 * ponto preto; transparente vira branco. As fileiras vão em hexadecimal,
 * cada uma com ceil(largura/8) bytes.
 */

import { TETO_IMAGEM_BYTES } from "./modelo";

export function empacotarBits(pretos: boolean[], w: number, h: number): string {
  const porLinha = Math.ceil(w / 8);
  let hex = "";
  for (let y = 0; y < h; y++) {
    for (let b = 0; b < porLinha; b++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit;
        if (x < w && pretos[y * w + x]) byte |= 0x80 >> bit;
      }
      hex += byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return hex;
}

/** Pixels RGBA → quais são pretos (escuro e opaco). Regra pura, testável. */
export function pretosDoRgba(rgba: Uint8ClampedArray, w: number, h: number): boolean[] {
  const saida: boolean[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    saida[i] = a >= 128 && lum < 140;
  }
  return saida;
}

/**
 * O bitmap sai JÁ NA ORIENTAÇÃO FÍSICA: a Zebra não gira imagem (`^GF` não
 * tem rotação), então na etiqueta girada o navegador desenha a imagem
 * rodada 90° no sentido horário — o mesmo giro do resto do desenho — e o
 * bitmap fica com largura = altura do elemento (achado da revisão).
 */
export async function bitmapDaImagem(
  src: string,
  wMm: number,
  hMm: number,
  girada = false
): Promise<{ w: number; h: number; hex: string }> {
  const wd = Math.max(1, Math.round(wMm * 8));
  const hd = Math.max(1, Math.round(hMm * 8));
  const img = new Image();
  await new Promise<void>((ok, erro) => {
    img.onload = () => ok();
    img.onerror = () => erro(new Error("imagem inválida"));
    img.src = src;
  });
  const w = girada ? hd : wd;
  const h = girada ? wd : hd;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  if (girada) {
    // gira 90° horário em torno do canto: o topo do desenho vira a direita
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(img, 0, 0, wd, hd);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { w, h, hex: empacotarBits(pretosDoRgba(data, w, h), w, h) };
}

/** Arquivo escolhido → PNG pequeno em data-URL (lado maior 600 px), para caber no modelo. */
export async function imagemParaModelo(file: File, teto = TETO_IMAGEM_BYTES): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, erro) => {
      img.onload = () => ok();
      img.onerror = () => erro(new Error("imagem inválida"));
      img.src = url;
    });
    // tenta PNG e depois JPEG, em lados cada vez menores, até caber no teto
    // do modelo — uma foto com degradê a 600 px passa de 400 KB em PNG e o
    // servidor a descartaria com uma mensagem que não explica (achado da revisão)
    for (const lado of [600, 450, 300, 200]) {
      const escala = Math.min(1, lado / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * escala));
      canvas.height = Math.max(1, Math.round(img.height * escala));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png");
      if (png.length <= teto) return png;
      const jpg = canvas.toDataURL("image/jpeg", 0.85);
      if (jpg.length <= teto) return jpg;
    }
    throw new Error("A imagem é pesada demais mesmo reduzida. Use um logo simples (PNG com poucas cores).");
  } finally {
    URL.revokeObjectURL(url);
  }
}
