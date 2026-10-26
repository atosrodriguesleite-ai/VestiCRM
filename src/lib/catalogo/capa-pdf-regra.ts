/**
 * A CAPA DO CATÁLOGO EM PDF É DA LOJA (RN-094, item 6) — a parte PURA.
 *
 * Pedido do dono (26/10/2026): *"quero a opção de editar a capa, o layout
 * dela completo, ou então fazer ela tipo em Canva e subir no sistema"*.
 * Decidido com ele: a capa feita FORA (Canva) e subida aqui, mais ajustes
 * pequenos na capa automática — um editor de layout dentro do sistema seria
 * uma obra grande que nunca chegaria perto do Canva, que a lojista já usa.
 *
 * Este arquivo não sabe de banco nem de sharp: é a régua que o navegador
 * (recorte antes de enviar), o servidor (conferência e recompressão) e o
 * PDF (o desenho) leem — uma só, senão o navegador aceitaria o que o
 * servidor recusa.
 */

/** o A4 em pé: 210 × 297 mm */
export const PROPORCAO_A4 = 297 / 210;

/**
 * A imagem guardada: o A4 a 150 dpi. É o que o PDF embute na página inteira
 * — a 300 dpi (2480 × 3508) a capa sozinha pesaria mais que o catálogo, e a
 * cliente vê isto numa tela de celular.
 */
export const CAPA_LARGURA_PX = 1240;
export const CAPA_ALTURA_PX = 1754;

/** imagem menor que isto sai borrada na folha — recusada com frase */
export const CAPA_LARGURA_MINIMA_PX = 800;

/**
 * Quanto a proporção pode fugir do A4 antes de recusarmos. Dentro disto o
 * recorte apara uma borda fina (uma imagem 1240 × 1700 perde 3% da altura);
 * fora disto a imagem é de OUTRO formato (quadrada, story 9:16) e cortar
 * levaria o título embora — melhor dizer para refazer no tamanho certo.
 */
export const TOLERANCIA_DE_PROPORCAO = 0.08;

/** acima disto o navegador nem tenta ler (foto crua de câmera de 12 MB passa) */
export const TETO_BYTES_DO_ARQUIVO = 20 * 1024 * 1024;

/** o data-URL que o servidor aceita no corpo (a Vercel corta em 4,5 MB) */
export const TETO_DATAURL_ENVIADA = 4 * 1024 * 1024;

export const TETO_FOTOS_DA_CAPA = 3;
export const TETO_TITULO = 60;
export const TETO_SUBTITULO = 90;

/** o que a tela DIZ à lojista — uma frase só, para a tela e o teste lerem */
export const FORMATO_RECOMENDADO = {
  nome: "A4 em pé (21 × 29,7 cm)",
  pixels: `${CAPA_LARGURA_PX} × ${CAPA_ALTURA_PX} px ou mais (2480 × 3508 px a 300 dpi)`,
  formatos: "JPG ou PNG",
  tamanho: "até 20 MB",
  canva: 'No Canva: crie um "Documento A4" e baixe como JPG (qualidade alta).',
};

/** o formato é de A4 em pé? (dentro da tolerância) */
export function proporcaoCabeNoA4(largura: number, altura: number): boolean {
  if (!(largura > 0 && altura > 0)) return false;
  const proporcao = altura / largura;
  return Math.abs(proporcao - PROPORCAO_A4) / PROPORCAO_A4 <= TOLERANCIA_DE_PROPORCAO;
}

/**
 * Por que a imagem não serve — ou `null` quando serve. A MESMA frase no
 * navegador (antes de enviar) e no servidor (segunda tranca).
 */
export function motivoDaRecusa(largura: number, altura: number): string | null {
  if (!(largura > 0 && altura > 0)) return "Não deu para ler a imagem. Envie um JPG ou PNG.";
  if (largura < CAPA_LARGURA_MINIMA_PX) {
    return `Imagem pequena demais (${largura} px de largura): sairia borrada. Use pelo menos ${CAPA_LARGURA_MINIMA_PX} px — o ideal é ${CAPA_LARGURA_PX} × ${CAPA_ALTURA_PX} px.`;
  }
  if (altura <= largura) {
    return `A capa precisa estar em pé, no formato ${FORMATO_RECOMENDADO.nome}. Esta imagem está deitada ou quadrada (${largura} × ${altura} px).`;
  }
  if (!proporcaoCabeNoA4(largura, altura)) {
    return `A imagem não está no formato A4 (${largura} × ${altura} px). Refaça no tamanho ${FORMATO_RECOMENDADO.nome}, ${CAPA_LARGURA_PX} × ${CAPA_ALTURA_PX} px.`;
  }
  return null;
}

/**
 * O recorte que leva a imagem ao A4 exato, pelo centro — a borda fina que
 * sobra sai; nada é esticado. Devolve a janela na imagem ORIGINAL e quanto
 * foi aparado (em %), para a tela avisar quando passar de nada.
 */
export function recorteParaA4(largura: number, altura: number): {
  x: number;
  y: number;
  w: number;
  h: number;
  aparouPct: number;
  /** de qual lado a sobra saiu — quem avisa a lojista lê daqui, não refaz a conta */
  eixo: "altura" | "largura";
} {
  const proporcao = altura / largura;
  if (proporcao > PROPORCAO_A4) {
    // alta demais: apara em cima e embaixo
    const h = Math.round(largura * PROPORCAO_A4);
    return { x: 0, y: Math.round((altura - h) / 2), w: largura, h, aparouPct: pct(1 - h / altura), eixo: "altura" };
  }
  // larga demais: apara nas laterais
  const w = Math.round(altura / PROPORCAO_A4);
  return { x: Math.round((largura - w) / 2), y: 0, w, h: altura, aparouPct: pct(1 - w / largura), eixo: "largura" };
}

function pct(fracao: number): number {
  return Math.round(Math.max(0, fracao) * 1000) / 10;
}

/** o título da capa automática: o da loja, ou o de sempre */
export function tituloDaCapa(personalizado: string | null | undefined, mesAno: string): string {
  const t = personalizado?.trim();
  return t ? t : `CATÁLOGO · ${mesAno.toUpperCase()}`;
}

/**
 * Lê a lista de peças da capa gravada como JSON. Texto torto, item que não
 * é texto e repetição caem fora — e nunca mais que o teto.
 */
export function lerFotosDaCapa(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    return normalizarFotosDaCapa(JSON.parse(json));
  } catch {
    return [];
  }
}

/** a régua da lista (texto, não vazio, sem repetição, no teto) — para o JSON gravado e para a porta */
export function normalizarFotosDaCapa(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>();
  const ids: string[] = [];
  for (const item of valor) {
    if (typeof item !== "string" || !item.trim() || vistos.has(item)) continue;
    vistos.add(item);
    ids.push(item);
    if (ids.length >= TETO_FOTOS_DA_CAPA) break;
  }
  return ids;
}

/** texto livre da capa: aparado, sem quebra de linha, no teto */
export function textoDaCapa(valor: string | null | undefined, teto: number): string | null {
  const t = (valor ?? "").replace(/\s+/g, " ").trim().slice(0, teto);
  return t || null;
}
