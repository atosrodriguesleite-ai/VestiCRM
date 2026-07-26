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

const RES = 0.5; // cm por coluna (resolução padrão do perfil)

export type PecaEncaixe = {
  nome: string;
  tamanho: string;
  w: number;
  h: number;
  area: number;
  espelhada?: boolean; // instância invertida do par (mão contrária)
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
function cortesVerticais(contorno: Contorno, xc: number, res: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < contorno.length; i++) {
    const [x1, y1] = contorno[i];
    const [x2, y2] = contorno[(i + 1) % contorno.length];
    if (x1 === x2) {
      // aresta vertical exatamente na coluna: considera os extremos
      if (Math.abs(x1 - xc) < res / 2) ys.push(y1, y2);
      continue;
    }
    const dentro = (xc >= Math.min(x1, x2)) && (xc <= Math.max(x1, x2));
    if (!dentro) continue;
    const t = (xc - x1) / (x2 - x1);
    ys.push(y1 + t * (y2 - y1));
  }
  return ys;
}

function perfilDaPeca(p: PecaEncaixe, rot: 0 | 180, folgaCm: number, res: number): Perfil {
  const wTotal = p.w + folgaCm;
  const cols = Math.max(1, Math.ceil(wTotal / res));
  const bottom = new Array<number>(cols).fill(0);
  const top = new Array<number>(cols).fill(p.h + folgaCm);

  if (p.contorno && p.contorno.length >= 3) {
    for (let c = 0; c < cols; c++) {
      // amostra no centro da coluna, limitada à largura real da peça
      const xc = Math.min(p.w - 0.01, Math.max(0.01, (c + 0.5) * res));
      const ys = cortesVerticais(p.contorno, xc, res);
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
  usarRotacao: boolean,
  tetoCm = Infinity, // melhor risco já achado: passou dele, desiste (poda)
  res = RES // resolução do perfil (0,25 na "lupa fina" do modo caprichado)
): { comprimentoCm: number; pos: Posicionamento[] } {
  const colsTecido = Math.max(1, Math.floor((larguraCm + folgaCm) / res));
  const alturaCol = new Array<number>(colsTecido).fill(0);
  const pos: Posicionamento[] = [];
  let comprimento = 0;

  for (const p of pecas) {
    const rots: (0 | 180)[] = usarRotacao && p.contorno ? [0, 180] : [0];
    let melhor: { x: number; y: number; topo: number; rot: 0 | 180; perfil: Perfil } | null =
      null;

    for (const rot of rots) {
      const perfil = perfilDaPeca(p, rot, folgaCm, res);
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
    const xCm = melhor.x * res;
    pos.push({
      nome: p.nome,
      tamanho: p.tamanho,
      x: Math.round(xCm * 100) / 100,
      y: Math.round(melhor.y * 100) / 100,
      w: p.w,
      h: p.h,
      rot: melhor.rot,
      espelhada: p.espelhada,
      contorno: p.contorno,
    });
    const fim = melhor.y + p.h;
    if (fim > comprimento) comprimento = fim;
    if (comprimento >= tetoCm) return { comprimentoCm: Infinity, pos: [] }; // já perdeu
  }
  return { comprimentoCm: Math.round(comprimento * 100) / 100, pos };
}

/**
 * Empacotador de GRADE DE OCUPAÇÃO (bottom-left-fill): além do skyline,
 * este mantém o mapa real de células livres/ocupadas do tecido — então
 * ele ENXERGA os bolsões vazios que ficaram pra trás e volta pra
 * preenchê-los (galão no vão entre frentes, manga no buraco da cava...).
 * Mais lento que o perfil, porém acha encaixes que o skyline não vê.
 */
function empacotarGrade(
  pecas: PecaEncaixe[],
  larguraCm: number,
  folgaCm: number,
  usarRotacao: boolean,
  tetoCm = Infinity, // melhor risco já achado: passou dele, desiste (poda)
  res = RES // resolução das células (0,25 na "lupa fina")
): { comprimentoCm: number; pos: Posicionamento[] } {
  const cols = Math.max(1, Math.floor((larguraCm + folgaCm) / res));
  // altura estimada do mapa: área total ÷ largura, com folga de 2,5×
  const areaCaixas = pecas.reduce((s, p) => s + (p.w + folgaCm) * (p.h + folgaCm), 0);
  let rows = Math.max(64, Math.ceil(((areaCaixas / larguraCm) * 2.5) / res));
  // ocupação por coluna (column-major: grid[c][linha])
  let grid: Uint8Array[] = Array.from({ length: cols }, () => new Uint8Array(rows));
  const cresce = (min: number) => {
    if (min <= rows) return;
    const novo = Math.max(min, Math.ceil(rows * 1.5));
    grid = grid.map((col) => {
      const n = new Uint8Array(novo);
      n.set(col);
      return n;
    });
    rows = novo;
  };

  /** Faixa de células [b, t) ocupada pela peça em cada coluna dela. */
  const faixas = (perfil: Perfil): { b: number; t: number }[] =>
    Array.from({ length: perfil.cols }, (_, c) => ({
      b: Math.floor(perfil.bottom[c] / res),
      t: Math.max(
        Math.floor(perfil.bottom[c] / res) + 1,
        Math.ceil(perfil.top[c] / res)
      ),
    }));

  const pos: Posicionamento[] = [];
  let comprimento = 0;

  for (const p of pecas) {
    const rots: (0 | 180)[] = usarRotacao && p.contorno ? [0, 180] : [0];
    let melhor: { x: number; y: number; rot: 0 | 180; fx: { b: number; t: number }[]; alturaCel: number } | null = null;

    for (let tentativa = 0; tentativa < 2 && !melhor; tentativa++) {
    if (tentativa > 0) cresce(rows * 2); // mapa lotou: dobra e tenta de novo
    for (const rot of rots) {
      const perfil = perfilDaPeca(p, rot, folgaCm, res);
      if (perfil.cols > cols) continue;
      const fx = faixas(perfil);
      const alturaCel = Math.ceil((perfil.h + folgaCm) / res);
      cresce(alturaCel + 8);

      // varre de baixo pra cima; primeiro lugar 100% livre vence
      // (bottom-left-fill: é isso que recupera os bolsões vazios)
      const yMax = melhor ? melhor.y : rows - alturaCel;
      busca: for (let y = 0; y <= yMax; y++) {
        if (y + alturaCel > rows) break;
        prox: for (let x = 0; x <= cols - perfil.cols; x++) {
          for (let c = 0; c < perfil.cols; c++) {
            const col = grid[x + c];
            for (let l = y + fx[c].b; l < y + fx[c].t; l++)
              if (col[l]) continue prox; // colidiu: tenta o próximo x
          }
          if (!melhor || y < melhor.y || (y === melhor.y && x < melhor.x))
            melhor = { x, y, rot, fx, alturaCel };
          break busca; // achou o mais baixo desta rotação
        }
      }
    }
    }
    if (!melhor) continue; // não coube (tratado nas camadas de cima)

    cresce(melhor.y + melhor.alturaCel + 8);
    for (let c = 0; c < melhor.fx.length; c++) {
      const col = grid[melhor.x + c];
      for (let l = melhor.y + melhor.fx[c].b; l < melhor.y + melhor.fx[c].t; l++) col[l] = 1;
    }
    const yCm = melhor.y * res;
    pos.push({
      nome: p.nome,
      tamanho: p.tamanho,
      x: Math.round(melhor.x * res * 100) / 100,
      y: Math.round(yCm * 100) / 100,
      w: p.w,
      h: p.h,
      rot: melhor.rot,
      espelhada: p.espelhada,
      contorno: p.contorno,
    });
    const fim = yCm + p.h;
    if (fim > comprimento) comprimento = fim;
    if (comprimento >= tetoCm) return { comprimentoCm: Infinity, pos: [] }; // já perdeu
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
  {
    // corpo primeiro, tiras (galão, gola, viés) por último: as tiras são
    // as melhores "tapa-buracos" — entram nos vãos que sobraram
    nome: "tiras preenchendo os vãos",
    fn: (ps) =>
      [...ps].sort(
        (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.area - a.area
      ),
  },
  // embaralhamentos com semente fixa (determinísticos): às vezes uma ordem
  // "sem lógica" acha um encaixe que as ordens espertas não enxergam
  ...[1, 2, 3].map((semente) => ({
    nome: `embaralhado ${semente}`,
    fn: (ps: PecaEncaixe[]) => {
      const out = [...ps];
      let s = (semente * 2654435761) >>> 0;
      for (let i = out.length - 1; i > 0; i--) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const j = s % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  })),
];

/**
 * Empacota uma SEQUÊNCIA exata de peças (sem reordenar) — é o operário da
 * busca local do otimizador: ele testa milhares de sequências mutadas e
 * precisa medir cada uma do jeito que veio.
 *   motor "skyline"  → rápido (avaliar mutações em massa)
 *   motor "grade"    → lento e certeiro (consolidar uma melhoria/lupa fina)
 */
export function empacotarOrdem(
  pecas: PecaEncaixe[],
  larguraCm: number,
  folgaCm: number,
  permitir180: boolean,
  motor: "skyline" | "grade" = "skyline",
  tetoCm = Infinity,
  res = RES
): { comprimentoCm: number; pecas: Posicionamento[] } {
  const fn = motor === "grade" ? empacotarGrade : empacotar;
  const { comprimentoCm, pos } = fn(pecas, larguraCm, folgaCm, permitir180, tetoCm, res);
  return { comprimentoCm, pecas: pos };
}

/**
 * Encaixa testando todas as ordens (e rotações, quando há contorno) e
 * devolve o risco mais curto. `contaAnalises` soma quantas tentativas
 * foram feitas (pra mostrar ao lojista o tamanho da busca).
 */
export function encaixarMelhor(
  pecas: PecaEncaixe[],
  larguraCm: number,
  folgaCm: number,
  permitir180 = true,
  profundo = true // false = só o skyline (exploração barata de combinações)
): ResultadoEncaixe & { analises: number } {
  let melhor: ResultadoEncaixe | null = null;
  let analises = 0;

  // FUNIL DE DOIS ESTÁGIOS:
  // 1º) o skyline (rapidíssimo) testa TODAS as ordens e rotações;
  // 2º) só os 3 melhores candidatos ganham o motor de grade de ocupação
  //     (caro, mas enxerga e preenche os bolsões vazios).
  type Cand = { ordem: (typeof ORDENS)[number]; rot: boolean; comprimentoCm: number };
  const candidatos: Cand[] = [];
  for (const ordem of ORDENS) {
    for (const rot of permitir180 ? [true, false] : [false]) {
      analises++;
      const { comprimentoCm, pos } = empacotar(ordem.fn(pecas), larguraCm, folgaCm, rot);
      if (pos.length < pecas.length) continue; // alguma peça não coube
      candidatos.push({ ordem, rot, comprimentoCm });
      if (!melhor || comprimentoCm < melhor.comprimentoCm) {
        melhor = {
          comprimentoCm,
          pecas: pos,
          estrategia: ordem.nome + (rot ? " + rotação 180°" : ""),
        };
      }
    }
  }
  candidatos.sort((a, b) => a.comprimentoCm - b.comprimentoCm);
  const finalistas = !profundo || pecas.length > 90 ? [] : candidatos.slice(0, 6);
  for (const c of finalistas) {
    analises++;
    const teto = melhor ? melhor.comprimentoCm : Infinity;
    const { comprimentoCm, pos } = empacotarGrade(
      c.ordem.fn(pecas),
      larguraCm,
      folgaCm,
      c.rot,
      teto
    );
    if (pos.length < pecas.length) continue; // poda: já estava perdendo
    if (!melhor || comprimentoCm < melhor.comprimentoCm) {
      melhor = {
        comprimentoCm,
        pecas: pos,
        estrategia: c.ordem.nome + (c.rot ? " + rotação 180°" : "") + " + preenche vãos",
      };
    }
  }
  if (!melhor)
    throw new Error(
      "Alguma peça é mais larga que o tecido — confira a largura informada"
    );
  return { ...melhor, analises };
}
