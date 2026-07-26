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
  modeloIdx?: number; // qual modelo do plano (plano com vários modelos)
  contorno?: Contorno;
  /**
   * CASAL PÉ-COM-CABEÇA: esta "peça" é um bloco de duas peças iguais, a
   * segunda de cabeça pra baixo, travadas no melhor encaixe entre elas.
   * O perfil do bloco vem pronto; ao posicionar, o empacotador grava as
   * DUAS peças de verdade (membros) — o bloco nunca sai pro risco.
   */
  membros?: { peca: PecaEncaixe; rot: 0 | 180; dxCm: number; dyCm: number }[];
  perfilPronto?: Perfil;
  perfilProntoRes?: number;
  perfilProntoFolga?: number;
};

export type ResultadoEncaixe = {
  comprimentoCm: number;
  pecas: Posicionamento[];
  estrategia: string;
};

/** Perfil da peça por coluna: contorno inferior e superior (em cm). */
type Perfil = {
  cols: number;
  bottom: number[];
  top: number[];
  w: number;
  h: number;
  fx?: { b: number; t: number }[]; // faixas em células (grade), calculadas 1×
};

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

/**
 * Cache de perfis: a MESMA peça é perfilada milhares de vezes durante a
 * otimização (uma por tentativa de encaixe). O contorno é compartilhado
 * entre as instâncias (pecasDoRiscoMulti calcula uma vez por peça/tamanho
 * e reaproveita a referência), então memoizar por contorno elimina o
 * retrabalho — foi o que destravou a busca local pra milhões de tentativas.
 * Perfis são SOMENTE-LEITURA depois de prontos.
 */
const cachePerfilCurva = new WeakMap<Contorno, Map<string, Perfil>>();
const cachePerfilCaixa = new Map<string, Perfil>();

function perfilDaPeca(p: PecaEncaixe, rot: 0 | 180, folgaCm: number, res: number): Perfil {
  // casal pré-montado: o perfil já existe (só na resolução/folga de origem;
  // fora delas cai na caixa, que é conservadora e nunca sobrepõe)
  if (p.perfilPronto && rot === 0 && res === p.perfilProntoRes && folgaCm === p.perfilProntoFolga)
    return p.perfilPronto;
  const chave = `${rot}|${folgaCm}|${res}|${p.w}|${p.h}`;
  if (p.contorno && p.contorno.length >= 3) {
    let porChave = cachePerfilCurva.get(p.contorno);
    if (!porChave) {
      porChave = new Map();
      cachePerfilCurva.set(p.contorno, porChave);
    }
    const pronto = porChave.get(chave);
    if (pronto) return pronto;
    const perfil = calculaPerfil(p, rot, folgaCm, res);
    porChave.set(chave, perfil);
    return perfil;
  }
  // peça sem curva: perfil reto, só depende das medidas (rot não muda caixa)
  const pronto = cachePerfilCaixa.get(chave);
  if (pronto) return pronto;
  const perfil = calculaPerfil(p, rot, folgaCm, res);
  if (cachePerfilCaixa.size > 4096) cachePerfilCaixa.clear(); // teto de memória
  cachePerfilCaixa.set(chave, perfil);
  return perfil;
}

function calculaPerfil(p: PecaEncaixe, rot: 0 | 180, folgaCm: number, res: number): Perfil {
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
): { comprimentoCm: number; pos: Posicionamento[]; colocadas: number } {
  const colsTecido = Math.max(1, Math.floor((larguraCm + folgaCm) / res));
  const alturaCol = new Array<number>(colsTecido).fill(0);
  const pos: Posicionamento[] = [];
  let colocadas = 0;
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
    if (p.membros) {
      // grava as peças de verdade do casal, já nas posições absolutas
      for (const m of p.membros)
        pos.push({
          nome: m.peca.nome,
          tamanho: m.peca.tamanho,
          x: Math.round((xCm + m.dxCm) * 100) / 100,
          y: Math.round((melhor.y + m.dyCm) * 100) / 100,
          w: m.peca.w,
          h: m.peca.h,
          rot: m.rot,
          espelhada: m.peca.espelhada,
          modeloIdx: m.peca.modeloIdx,
          contorno: m.peca.contorno,
        });
    } else
      pos.push({
        nome: p.nome,
        tamanho: p.tamanho,
        x: Math.round(xCm * 100) / 100,
        y: Math.round(melhor.y * 100) / 100,
        w: p.w,
        h: p.h,
        rot: melhor.rot,
        espelhada: p.espelhada,
        modeloIdx: p.modeloIdx,
        contorno: p.contorno,
      });
    colocadas += p.membros ? p.membros.length : 1;
    const fim = melhor.y + p.h;
    if (fim > comprimento) comprimento = fim;
    if (comprimento >= tetoCm) return { comprimentoCm: Infinity, pos: [], colocadas: 0 }; // já perdeu
  }
  return { comprimentoCm: Math.round(comprimento * 100) / 100, pos, colocadas };
}

/**
 * Empacotador de GRADE DE OCUPAÇÃO (bottom-left-fill): além do skyline,
 * este mantém o mapa real de células livres/ocupadas do tecido — então
 * ele ENXERGA os bolsões vazios que ficaram pra trás e volta pra
 * preenchê-los (galão no vão entre frentes, manga no buraco da cava...).
 * Mais lento que o perfil, porém acha encaixes que o skyline não vê.
 */
/** Faixa de células [b, t) da peça em cada coluna (memoizada no perfil —
 *  o perfil já é único por rotação/folga/resolução). */
function faixasDoPerfil(perfil: Perfil, res: number): { b: number; t: number }[] {
  return (perfil.fx ??= Array.from({ length: perfil.cols }, (_, c) => ({
    b: Math.floor(perfil.bottom[c] / res),
    t: Math.max(
      Math.floor(perfil.bottom[c] / res) + 1,
      Math.ceil(perfil.top[c] / res)
    ),
  })));
}

function empacotarGrade(
  pecas: PecaEncaixe[],
  larguraCm: number,
  folgaCm: number,
  usarRotacao: boolean,
  tetoCm = Infinity, // melhor risco já achado: passou dele, desiste (poda)
  res = RES // resolução das células (0,25 na "lupa fina")
): { comprimentoCm: number; pos: Posicionamento[]; colocadas: number } {
  const cols = Math.max(1, Math.floor((larguraCm + folgaCm) / res));

  // Ocupação por coluna guardada como INTERVALOS [s, e) ordenados e sem
  // sobreposição — em vez do mapa de células. Colisão vira busca binária
  // (O(log intervalos)) e o "pulo" sobre o obstáculo sai de graça: o fim
  // do intervalo diz exatamente onde a peça pode tentar de novo. Foi essa
  // troca que levou o motor de ~3 pra centenas de encaixes por segundo,
  // mantendo o mesmo resultado do bottom-left-fill célula a célula.
  type Runs = { s: number[]; e: number[] };
  const runs: Runs[] = Array.from({ length: cols }, () => ({ s: [], e: [] }));
  // 1ª célula livre de cada coluna: piso da busca (aponta pro buraco mais fundo)
  const minLivre = new Int32Array(cols);

  /** Se [lo, hi) colide com algum intervalo da coluna, devolve o FIM do
   *  intervalo que colidiu (pra pular direto); senão -1. */
  const colide = (r: Runs, lo: number, hi: number): number => {
    let a = 0;
    let b = r.e.length - 1;
    let i = -1;
    while (a <= b) {
      const m = (a + b) >> 1;
      if (r.e[m] > lo) {
        i = m;
        b = m - 1;
      } else a = m + 1;
    }
    return i >= 0 && r.s[i] < hi ? r.e[i] : -1;
  };

  /** Marca [lo, hi) como ocupado, fundindo com intervalos encostados. */
  const marca = (c: number, lo: number, hi: number) => {
    const r = runs[c];
    let i = 0;
    while (i < r.s.length && r.e[i] < lo) i++;
    let s = lo;
    let e = hi;
    let j = i;
    while (j < r.s.length && r.s[j] <= e) {
      if (r.s[j] < s) s = r.s[j];
      if (r.e[j] > e) e = r.e[j];
      j++;
    }
    r.s.splice(i, j - i, s);
    r.e.splice(i, j - i, e);
    minLivre[c] = r.s.length > 0 && r.s[0] === 0 ? r.e[0] : 0;
  };

  const tetoCel = Number.isFinite(tetoCm) ? Math.ceil(tetoCm / res) + 4 : Infinity;
  const pos: Posicionamento[] = [];
  let colocadas = 0;
  let comprimento = 0;

  for (const p of pecas) {
    const rots: (0 | 180)[] = usarRotacao && p.contorno ? [0, 180] : [0];
    let melhor: {
      x: number;
      y: number;
      rot: 0 | 180;
      fx: { b: number; t: number }[];
      alturaCel: number;
    } | null = null;

    for (const rot of rots) {
      const perfil = perfilDaPeca(p, rot, folgaCm, res);
      if (perfil.cols > cols) continue;
      const fx = faixasDoPerfil(perfil, res);
      const alturaCel = Math.ceil((perfil.h + folgaCm) / res);

      for (let x = 0; x <= cols - perfil.cols; x++) {
        // piso: a peça não assenta abaixo da 1ª célula livre de cada coluna
        let y = 0;
        for (let c = 0; c < perfil.cols; c++) {
          const lb = minLivre[x + c] - fx[c].b;
          if (lb > y) y = lb;
        }
        const yTeto = melhor ? melhor.y : tetoCel;
        salta: while (y <= yTeto) {
          for (let c = 0; c < perfil.cols; c++) {
            const fim = colide(runs[x + c], y + fx[c].b, y + fx[c].t);
            if (fim >= 0) {
              y = fim - fx[c].b; // assenta em cima do obstáculo
              continue salta;
            }
          }
          // coube: menor y deste x (empate: x menor vence, varremos crescente)
          if (!melhor || y < melhor.y || (y === melhor.y && x < melhor.x))
            melhor = { x, y, rot, fx, alturaCel };
          break;
        }
      }
    }
    if (!melhor) continue; // não coube (tratado nas camadas de cima)

    for (let c = 0; c < melhor.fx.length; c++)
      marca(melhor.x + c, melhor.y + melhor.fx[c].b, melhor.y + melhor.fx[c].t);
    const yCm = melhor.y * res;
    const xCmG = melhor.x * res;
    if (p.membros) {
      for (const m of p.membros)
        pos.push({
          nome: m.peca.nome,
          tamanho: m.peca.tamanho,
          x: Math.round((xCmG + m.dxCm) * 100) / 100,
          y: Math.round((yCm + m.dyCm) * 100) / 100,
          w: m.peca.w,
          h: m.peca.h,
          rot: m.rot,
          espelhada: m.peca.espelhada,
          modeloIdx: m.peca.modeloIdx,
          contorno: m.peca.contorno,
        });
    } else
      pos.push({
        nome: p.nome,
        tamanho: p.tamanho,
        x: Math.round(xCmG * 100) / 100,
        y: Math.round(yCm * 100) / 100,
        w: p.w,
        h: p.h,
        rot: melhor.rot,
        espelhada: p.espelhada,
        modeloIdx: p.modeloIdx,
        contorno: p.contorno,
      });
    colocadas += p.membros ? p.membros.length : 1;
    const fim = yCm + p.h;
    if (fim > comprimento) comprimento = fim;
    if (comprimento >= tetoCm) return { comprimentoCm: Infinity, pos: [], colocadas: 0 }; // já perdeu
  }
  return { comprimentoCm: Math.round(comprimento * 100) / 100, pos, colocadas };
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
 * CASAIS PÉ-COM-CABEÇA — o truque clássico do encaixador: duas peças
 * iguais, a segunda de cabeça pra baixo, deslizadas uma na outra até o
 * melhor entrelaçamento (decote mergulha na barra, cava abraça cava).
 * O bloco resultante vira UMA peça pro empacotador; ao posicionar, as
 * duas peças reais saem separadas no risco.
 *
 * Só forma casal quando o entrelaçamento economiza de verdade (área do
 * bloco ≤ 92% das duas caixas empilhadas) — senão a peça segue solta.
 */
export function montarCasais(
  pecas: PecaEncaixe[],
  folgaCm: number,
  res = RES
): PecaEncaixe[] {
  // agrupa cópias da mesma peça/tamanho (o par espelhado entra junto:
  // mesmo molde, contorno invertido — o entrelaçamento considera os dois)
  const grupos = new Map<string, PecaEncaixe[]>();
  for (const p of pecas) {
    if (!p.contorno || p.contorno.length < 3) continue; // caixa não entrelaça
    const k = `${p.modeloIdx ?? 0}|${p.nome}|${p.tamanho}|${p.w.toFixed(2)}|${p.h.toFixed(2)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }

  const emCasal = new Set<PecaEncaixe>();
  const blocos: PecaEncaixe[] = [];

  for (const grupo of grupos.values()) {
    for (let i = 0; i + 1 < grupo.length; i += 2) {
      const A = grupo[i];
      const B = grupo[i + 1];
      const PA = perfilDaPeca(A, 0, folgaCm, res);
      const PB = perfilDaPeca(B, 180, folgaCm, res);

      // desliza B sobre A e mede a caixa do bloco em cada deslocamento
      let melhor: { d: number; off: number; areaCel: number; topoMax: number } | null = null;
      for (let d = -(PB.cols - 1); d < PA.cols; d++) {
        let off = 0;
        let sobrepoe = false;
        for (let c = Math.max(0, d); c < Math.min(PA.cols, d + PB.cols); c++) {
          sobrepoe = true;
          const precisa = PA.top[c] - PB.bottom[c - d];
          if (precisa > off) off = precisa;
        }
        if (!sobrepoe) continue; // lado a lado sem contato não ganha nada
        const ini = Math.min(0, d);
        const fim = Math.max(PA.cols, d + PB.cols);
        let topoMax = 0;
        for (let c = ini; c < fim; c++) {
          const tA = c >= 0 && c < PA.cols ? PA.top[c] : 0;
          const tB = c - d >= 0 && c - d < PB.cols ? off + PB.top[c - d] : 0;
          const t = Math.max(tA, tB);
          if (t > topoMax) topoMax = t;
        }
        const areaCel = (fim - ini) * topoMax;
        if (!melhor || areaCel < melhor.areaCel) melhor = { d, off, areaCel, topoMax };
      }
      if (!melhor) continue;

      // vale a pena? compara com as duas caixas empilhadas
      const areaDuasCaixas = 2 * PA.cols * (PA.h + folgaCm);
      if (melhor.areaCel > 0.92 * areaDuasCaixas) continue;

      // monta o perfil do bloco
      const ini = Math.min(0, melhor.d);
      const fim = Math.max(PA.cols, melhor.d + PB.cols);
      const cols = fim - ini;
      const bottom = new Array<number>(cols).fill(Infinity);
      const top = new Array<number>(cols).fill(0);
      for (let c = ini; c < fim; c++) {
        const j = c - ini;
        if (c >= 0 && c < PA.cols) {
          bottom[j] = Math.min(bottom[j], PA.bottom[c]);
          top[j] = Math.max(top[j], PA.top[c]);
        }
        if (c - melhor.d >= 0 && c - melhor.d < PB.cols) {
          bottom[j] = Math.min(bottom[j], melhor.off + PB.bottom[c - melhor.d]);
          top[j] = Math.max(top[j], melhor.off + PB.top[c - melhor.d]);
        }
        if (!Number.isFinite(bottom[j])) bottom[j] = 0; // coluna vazia no meio
        if (top[j] <= bottom[j]) top[j] = bottom[j] + res; // nunca degenera
      }

      const w = cols * res - folgaCm;
      const h = melhor.topoMax - folgaCm;
      blocos.push({
        nome: `${A.nome} ×2`,
        tamanho: A.tamanho,
        w,
        h,
        area: A.area + B.area,
        modeloIdx: A.modeloIdx,
        membros: [
          { peca: A, rot: 0, dxCm: -ini * res, dyCm: 0 },
          { peca: B, rot: 180, dxCm: (melhor.d - ini) * res, dyCm: melhor.off },
        ],
        perfilPronto: { cols, bottom, top, w, h },
        perfilProntoRes: res,
        perfilProntoFolga: folgaCm,
      });
      emCasal.add(A);
      emCasal.add(B);
    }
  }

  if (blocos.length === 0) return pecas;
  return [...blocos, ...pecas.filter((p) => !emCasal.has(p))];
}

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
  const esperadas = pecas.length; // peças de verdade que têm que sair no risco

  // duas listas concorrem: as peças soltas e a versão com CASAIS
  // pé-com-cabeça (duas iguais travadas em bloco) — vence quem fechar menor
  const listas: { pecas: PecaEncaixe[]; tag: string }[] = [{ pecas, tag: "" }];
  if (permitir180) {
    const casados = montarCasais(pecas, folgaCm);
    if (casados !== pecas)
      listas.push({ pecas: casados, tag: " + casais pé-com-cabeça" });
  }

  // FUNIL DE DOIS ESTÁGIOS:
  // 1º) o skyline (rapidíssimo) testa TODAS as ordens e rotações;
  // 2º) só os melhores candidatos ganham o motor de grade de ocupação
  //     (caro, mas enxerga e preenche os bolsões vazios).
  type Cand = {
    ordem: (typeof ORDENS)[number];
    rot: boolean;
    comprimentoCm: number;
    lista: (typeof listas)[number];
  };
  const candidatos: Cand[] = [];
  for (const lista of listas) {
    for (const ordem of ORDENS) {
      for (const rot of permitir180 ? [true, false] : [false]) {
        analises++;
        const { comprimentoCm, pos, colocadas } = empacotar(
          ordem.fn(lista.pecas),
          larguraCm,
          folgaCm,
          rot
        );
        if (colocadas < esperadas) continue; // alguma peça não coube
        candidatos.push({ ordem, rot, comprimentoCm, lista });
        if (!melhor || comprimentoCm < melhor.comprimentoCm) {
          melhor = {
            comprimentoCm,
            pecas: pos,
            estrategia: ordem.nome + (rot ? " + rotação 180°" : "") + lista.tag,
          };
        }
      }
    }
  }
  candidatos.sort((a, b) => a.comprimentoCm - b.comprimentoCm);
  const finalistas = !profundo || pecas.length > 90 ? [] : candidatos.slice(0, 6);
  for (const c of finalistas) {
    analises++;
    const teto = melhor ? melhor.comprimentoCm : Infinity;
    const { comprimentoCm, pos, colocadas } = empacotarGrade(
      c.ordem.fn(c.lista.pecas),
      larguraCm,
      folgaCm,
      c.rot,
      teto
    );
    if (colocadas < esperadas) continue; // poda: já estava perdendo
    if (!melhor || comprimentoCm < melhor.comprimentoCm) {
      melhor = {
        comprimentoCm,
        pecas: pos,
        estrategia:
          c.ordem.nome + (c.rot ? " + rotação 180°" : "") + c.lista.tag + " + preenche vãos",
      };
    }
  }
  if (!melhor)
    throw new Error(
      "Alguma peça é mais larga que o tecido — confira a largura informada"
    );
  return { ...melhor, analises };
}
