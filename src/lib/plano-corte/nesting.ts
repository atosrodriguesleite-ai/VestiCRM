import type { Contorno, Posicionamento } from "./types";

/**
 * Motor de encaixe (nesting) — posiciona as peças no risco gastando o
 * mínimo de comprimento de tecido.
 *
 * Técnica: "bottom-left por perfil de colunas". O tecido é dividido em
 * colunas de 0,5cm; cada coluna guarda a altura já ocupada (skyline). Cada
 * peça carrega seu PERFIL inferior/superior por coluna — assim uma peça
 * "mergulha" na concavidade da anterior (curva encaixando em curva), que é
 * exatamente o que o encaixador profissional faz. Sem contorno (modelo
 * .adsx), o perfil é reto = caixa da peça (resultado conservador).
 *
 * Regra do fio: rotação limitada a 0°/180° — girar 90° mudaria o sentido
 * do fio do tecido e deformaria a roupa. 180° só ajuda quando há contorno.
 *
 * Várias ORDENS de entrada são testadas (maior área primeiro, mais alta
 * primeiro, mais larga primeiro, intercalada grande/pequena) e vence a que
 * fechar o risco mais curto.
 */

const RES = 0.5; // cm por coluna (resolução do perfil)

export type PecaEncaixe = {
  nome: string;
  tamanho: string;
  w: number;
  h: number;
  area: number;
  contorno?: Contorno;
};

export type ResultadoEncaixe = {
  comprimentoCm: number;
  pecas: Posicionamento[];
  estrategia: string;
};

/** Perfil da peça por coluna: contorno inferior e superior (em cm). */
type Perfil = { cols: number; bottom: number[]; top: number[]; w: number; h: number };

/** Interseções de uma vertical x=xc com as arestas do polígono. */
function cortesVerticais(contorno: Contorno, xc: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < contorno.length; i++) {
    const [x1, y1] = contorno[i];
    const [x2, y2] = contorno[(i + 1) % contorno.length];
    if (x1 === x2) {
      // aresta vertical exatamente na coluna: considera os extremos
      if (Math.abs(x1 - xc) < RES / 2) ys.push(y1, y2);
      continue;
    }
    const dentro = (xc >= Math.min(x1, x2)) && (xc <= Math.max(x1, x2));
    if (!dentro) continue;
    const t = (xc - x1) / (x2 - x1);
    ys.push(y1 + t * (y2 - y1));
  }
  return ys;
}

function perfilDaPeca(p: PecaEncaixe, rot: 0 | 180, folgaCm: number): Perfil {
  const wTotal = p.w + folgaCm;
  const cols = Math.max(1, Math.ceil(wTotal / RES));
  const bottom = new Array<number>(cols).fill(0);
  const top = new Array<number>(cols).fill(p.h + folgaCm);

  if (p.contorno && p.contorno.length >= 3) {
    for (let c = 0; c < cols; c++) {
      // amostra no centro da coluna, limitada à largura real da peça
      const xc = Math.min(p.w - 0.01, Math.max(0.01, (c + 0.5) * RES));
      const ys = cortesVerticais(p.contorno, xc);
      if (ys.length >= 2) {
        let lo = Math.max(0, Math.min(...ys));
        let hi = Math.min(p.h, Math.max(...ys));
        if (rot === 180) {
          const nlo = p.h - hi;
          const nhi = p.h - lo;
          lo = nlo;
          hi = nhi;
        }
        bottom[c] = lo;
        top[c] = hi + folgaCm;
      } else {
        // coluna sem interseção (borda/ruído): usa a caixa
        bottom[c] = 0;
        top[c] = p.h + folgaCm;
      }
    }
    if (rot === 180) {
      bottom.reverse();
      top.reverse();
    }
  }
  return { cols, bottom, top, w: p.w, h: p.h };
}

/** Coloca as peças (na ordem dada) e devolve o comprimento final. */
function empacotar(
  pecas: PecaEncaixe[],
  larguraCm: number,
  folgaCm: number,
  usarRotacao: boolean
): { comprimentoCm: number; pos: Posicionamento[] } {
  const colsTecido = Math.max(1, Math.floor((larguraCm + folgaCm) / RES));
  const alturaCol = new Array<number>(colsTecido).fill(0);
  const pos: Posicionamento[] = [];
  let comprimento = 0;

  for (const p of pecas) {
    const rots: (0 | 180)[] = usarRotacao && p.contorno ? [0, 180] : [0];
    let melhor: { x: number; y: number; topo: number; rot: 0 | 180; perfil: Perfil } | null =
      null;

    for (const rot of rots) {
      const perfil = perfilDaPeca(p, rot, folgaCm);
      if (perfil.cols > colsTecido) continue; // peça mais larga que o tecido
      for (let x = 0; x <= colsTecido - perfil.cols; x++) {
        // y mínimo pra peça "assentar" sobre o skyline sem sobrepor
        let y = 0;
        for (let c = 0; c < perfil.cols; c++) {
          const livre = alturaCol[x + c] - perfil.bottom[c];
          if (livre > y) y = livre;
        }
        const topo = y + perfil.h + folgaCm;
        if (!melhor || topo < melhor.topo || (topo === melhor.topo && x < melhor.x)) {
          melhor = { x, y, topo, rot, perfil };
        }
      }
    }
    if (!melhor) continue; // não coube (avisado nas camadas de cima)

    // grava a posição e sobe o skyline com o perfil superior da peça
    for (let c = 0; c < melhor.perfil.cols; c++) {
      const novo = melhor.y + melhor.perfil.top[c];
      if (novo > alturaCol[melhor.x + c]) alturaCol[melhor.x + c] = novo;
    }
    const xCm = melhor.x * RES;
    pos.push({
      nome: p.nome,
      tamanho: p.tamanho,
      x: Math.round(xCm * 100) / 100,
      y: Math.round(melhor.y * 100) / 100,
      w: p.w,
      h: p.h,
      rot: melhor.rot,
      contorno: p.contorno,
    });
    const fim = melhor.y + p.h;
    if (fim > comprimento) comprimento = fim;
  }
  return { comprimentoCm: Math.round(comprimento * 100) / 100, pos };
}

/** Ordens de entrada testadas — cada uma "pensa" o encaixe de um jeito. */
const ORDENS: { nome: string; fn: (ps: PecaEncaixe[]) => PecaEncaixe[] }[] = [
  {
    nome: "maior área primeiro",
    fn: (ps) => [...ps].sort((a, b) => b.area - a.area),
  },
  {
    nome: "mais alta primeiro",
    fn: (ps) => [...ps].sort((a, b) => b.h - a.h || b.area - a.area),
  },
  {
    nome: "mais larga primeiro",
    fn: (ps) => [...ps].sort((a, b) => b.w - a.w || b.area - a.area),
  },
  {
    nome: "grandes e pequenas intercaladas",
    fn: (ps) => {
      const ord = [...ps].sort((a, b) => b.area - a.area);
      const out: PecaEncaixe[] = [];
      let i = 0;
      let j = ord.length - 1;
      while (i <= j) {
        out.push(ord[i++]);
        if (i <= j) out.push(ord[j--]);
      }
      return out;
    },
  },
];

/**
 * Encaixa testando todas as ordens (e rotações, quando há contorno) e
 * devolve o risco mais curto. `contaAnalises` soma quantas tentativas
 * foram feitas (pra mostrar ao lojista o tamanho da busca).
 */
export function encaixarMelhor(
  pecas: PecaEncaixe[],
  larguraCm: number,
  folgaCm: number,
  permitir180 = true
): ResultadoEncaixe & { analises: number } {
  let melhor: ResultadoEncaixe | null = null;
  let analises = 0;
  for (const ordem of ORDENS) {
    for (const rot of permitir180 ? [true, false] : [false]) {
      analises++;
      const { comprimentoCm, pos } = empacotar(ordem.fn(pecas), larguraCm, folgaCm, rot);
      if (pos.length < pecas.length) continue; // alguma peça não coube
      if (!melhor || comprimentoCm < melhor.comprimentoCm) {
        melhor = {
          comprimentoCm,
          pecas: pos,
          estrategia: ordem.nome + (rot ? " + rotação 180°" : ""),
        };
      }
    }
  }
  if (!melhor)
    throw new Error(
      "Alguma peça é mais larga que o tecido — confira a largura informada"
    );
  return { ...melhor, analises };
}
