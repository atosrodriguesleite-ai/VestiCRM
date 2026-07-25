import { encaixarMelhor, type PecaEncaixe } from "./nesting";
import type {
  ModeloCorte,
  ParametrosPlano,
  PlanoPano,
  ResultadoPlano,
  Risco,
  TipoPano,
} from "./types";

/**
 * Planejador de enfesto — o segundo nível da inteligência (e onde mora o
 * dinheiro): decide QUAIS riscos montar e QUANTAS folhas enfestar de cada
 * um pra fechar a grade pedida sem sobrar peça.
 *
 * Exemplo: 30P/50M/50G/30GG. Um risco só com a grade toda obrigaria 50
 * folhas e sobrariam 20P+20GG. O planejador testa VÁRIAS composições:
 *   A) grade única proporcional (com folhas = MDC das quantidades)
 *   B) grupos de tamanhos com a MESMA quantidade (M+G ×50, P+GG ×30)
 *   C) um risco por tamanho
 *   D) cascata: risco com todos os tamanhos restantes × menor quantidade
 *   E) duplas maior+menor (peça pequena preenche o vão da grande)
 * Cada risco de cada estratégia passa pelo motor de encaixe; vence a
 * estratégia que gastar MENOS TECIDO TOTAL respeitando a mesa.
 */

const mdc = (a: number, b: number): number => (b === 0 ? a : mdc(b, a % b));

type Combo = Record<string, number>; // tamanho → proporção no risco
type PropostaRisco = { combo: Combo; folhas: number };
type Estrategia = { nome: string; riscos: PropostaRisco[] };

/** Estratégias de composição pra uma grade {tamanho: quantidade}. */
function estrategias(grade: Record<string, number>): Estrategia[] {
  const tams = Object.keys(grade).filter((t) => grade[t] > 0);
  if (tams.length === 0) return [];
  const out: Estrategia[] = [];

  // A) grade única proporcional — folhas = MDC (ex.: 30/50 → risco 3:5 ×10)
  const g = tams.map((t) => grade[t]).reduce(mdc);
  out.push({
    nome: "Grade única proporcional",
    riscos: [
      {
        combo: Object.fromEntries(tams.map((t) => [t, grade[t] / g])),
        folhas: g,
      },
    ],
  });

  // B) grupos por quantidade igual — tamanhos com a mesma demanda juntos
  const porQtd = new Map<number, string[]>();
  for (const t of tams) porQtd.set(grade[t], [...(porQtd.get(grade[t]) ?? []), t]);
  out.push({
    nome: "Grupos por quantidade igual",
    riscos: [...porQtd.entries()].map(([qtd, ts]) => ({
      combo: Object.fromEntries(ts.map((t) => [t, 1])),
      folhas: qtd,
    })),
  });

  // C) um risco por tamanho
  out.push({
    nome: "Um risco por tamanho",
    riscos: tams.map((t) => ({ combo: { [t]: 1 }, folhas: grade[t] })),
  });

  // D) cascata — todos os restantes juntos × menor quantidade, repete
  {
    const resta: Record<string, number> = { ...grade };
    const riscos: PropostaRisco[] = [];
    for (let i = 0; i < 20; i++) {
      const vivos = tams.filter((t) => resta[t] > 0);
      if (vivos.length === 0) break;
      const folhas = Math.min(...vivos.map((t) => resta[t]));
      riscos.push({
        combo: Object.fromEntries(vivos.map((t) => [t, 1])),
        folhas,
      });
      for (const t of vivos) resta[t] -= folhas;
    }
    out.push({ nome: "Cascata (sem sobras)", riscos });
  }

  // E) duplas maior+menor — tamanho grande casa com pequeno no mesmo risco
  {
    const resta: Record<string, number> = { ...grade };
    const riscos: PropostaRisco[] = [];
    for (let i = 0; i < 30; i++) {
      const vivos = tams.filter((t) => resta[t] > 0);
      if (vivos.length === 0) break;
      if (vivos.length === 1) {
        riscos.push({ combo: { [vivos[0]]: 1 }, folhas: resta[vivos[0]] });
        resta[vivos[0]] = 0;
        break;
      }
      // maior peça (fim da grade) + menor peça (começo) juntas
      const ordenados = [...vivos].sort((a, b) => grade[b] - grade[a]);
      const primeiro = vivos[0];
      const ultimo = vivos[vivos.length - 1];
      const [a, b2] = primeiro === ultimo ? [ordenados[0], ordenados[1]] : [primeiro, ultimo];
      const folhas = Math.min(resta[a], resta[b2]);
      riscos.push({ combo: { [a]: 1, [b2]: 1 }, folhas });
      resta[a] -= folhas;
      resta[b2] -= folhas;
    }
    out.push({ nome: "Duplas maior + menor", riscos });
  }

  // remove estratégias duplicadas (ex.: com 1 tamanho todas viram a mesma)
  const vistos = new Set<string>();
  return out.filter((e) => {
    const chave = JSON.stringify(
      e.riscos.map((r) => [r.combo, r.folhas]).sort((x, y) =>
        JSON.stringify(x) < JSON.stringify(y) ? -1 : 1
      )
    );
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/**
 * REGRA DO FIO: no CAD da modelista o fio corre na horizontal (eixo X do
 * desenho); no risco, o fio deve correr no COMPRIMENTO do tecido (eixo Y
 * do encaixe). Por isso toda peça entra girada 90° — rotação verdadeira,
 * sem espelhar: (x, y) → (y, w − x) — mantendo exatamente a orientação
 * que a modelista desenhou em relação ao fio.
 */
function giraProFio(med: {
  w: number;
  h: number;
  area: number;
  contorno?: [number, number][];
}) {
  return {
    w: med.h, // atravessa a largura do tecido
    h: med.w, // corre no comprimento (fio)
    area: med.area,
    contorno: med.contorno?.map(([x, y]) => [y, med.w - x] as [number, number]),
  };
}

/** Monta a lista de peças físicas de um risco (combo × peças do pano). */
function pecasDoRisco(
  modelo: ModeloCorte,
  pano: TipoPano,
  combo: Combo,
  params: ParametrosPlano
): PecaEncaixe[] {
  const out: PecaEncaixe[] = [];
  for (const peca of modelo.pecas) {
    if (peca.pano !== pano) continue;
    if (params.pecasDesligadas.includes(peca.nome)) continue;
    for (const [tam, vezes] of Object.entries(combo)) {
      const med = peca.tamanhos[tam];
      if (!med) continue; // tamanho não gradeado nesta peça
      const girada = giraProFio(med);
      for (let i = 0; i < vezes * peca.qtd; i++) {
        out.push({
          nome: peca.nome,
          tamanho: tam,
          w: girada.w,
          h: girada.h,
          area: girada.area,
          contorno: girada.contorno,
        });
      }
    }
  }
  return out;
}

/**
 * Se o risco estourar a mesa, divide o combo em dois riscos com as mesmas
 * folhas (metade dos tamanhos em cada) — recursivo até caber ou não dar
 * mais pra dividir (aí vira aviso, não erro: a loja decide o que fazer).
 */
function dividirSePreciso(
  proposta: PropostaRisco,
  mesaCm: number,
  montar: (c: Combo) => { comprimentoCm: number },
  avisos: string[]
): PropostaRisco[] {
  const { comprimentoCm } = montar(proposta.combo);
  if (comprimentoCm <= mesaCm) return [proposta];

  const entradas = Object.entries(proposta.combo);
  const totalUnidades = entradas.reduce((s, [, v]) => s + v, 0);
  if (totalUnidades <= 1) {
    avisos.push(
      `Um risco de 1 tamanho ficou com ${(comprimentoCm / 100).toFixed(2)}m — maior que a mesa. O plano segue, mas confira a mesa ou corte em partes.`
    );
    return [proposta];
  }

  // divide: proporções pares se dividem; ímpares separam por tamanho
  const a: Combo = {};
  const b: Combo = {};
  if (entradas.length === 1) {
    const [t, v] = entradas[0];
    a[t] = Math.ceil(v / 2);
    b[t] = Math.floor(v / 2);
  } else {
    const meio = Math.ceil(entradas.length / 2);
    for (const [t, v] of entradas.slice(0, meio)) a[t] = v;
    for (const [t, v] of entradas.slice(meio)) b[t] = v;
  }
  return [
    ...dividirSePreciso({ combo: a, folhas: proposta.folhas }, mesaCm, montar, avisos),
    ...dividirSePreciso({ combo: b, folhas: proposta.folhas }, mesaCm, montar, avisos),
  ];
}

/** Monta o plano de UM pano (tecido ou forro) testando todas as estratégias. */
function planejarPano(
  modelo: ModeloCorte,
  pano: TipoPano,
  params: ParametrosPlano
): { plano: PlanoPano | null; analises: number } {
  const largura =
    pano === "FOR"
      ? params.larguraForroCm ?? params.larguraTecidoCm
      : params.larguraTecidoCm;

  const temPeca = modelo.pecas.some(
    (p) => p.pano === pano && !params.pecasDesligadas.includes(p.nome)
  );
  if (!temPeca) return { plano: null, analises: 0 };

  let analises = 0;
  // EXPLORA BARATO, POLE FUNDO: as dezenas de combinações de estratégia ×
  // multiplicação são comparadas só com o skyline (modo rápido); o motor
  // caro de preencher vãos entra apenas nos riscos do plano VENCEDOR.
  const cacheRisco = new Map<string, ReturnType<typeof encaixarMelhor>>();
  const montar = (combo: Combo, profundo = false) => {
    const chave = JSON.stringify(combo) + (profundo ? "#p" : "");
    let r = cacheRisco.get(chave);
    if (!r) {
      r = encaixarMelhor(
        pecasDoRisco(modelo, pano, combo, params),
        largura,
        params.folgaCm,
        !params.sentidoUnico, // estampa direcional: peça não vira de cabeça pra baixo
        profundo
      );
      analises += r.analises;
      cacheRisco.set(chave, r);
    }
    return r;
  };

  type Avaliada = {
    nome: string;
    riscos: Risco[];
    totalTecidoCm: number;
    avisos: string[];
  };
  const avaliadas: Avaliada[] = [];

  /**
   * MULTIPLICAÇÃO DO RISCO: a ponta ruim do fim do risco se repete a cada
   * folha enfestada — risco curto × muitas folhas = desperdício repetido.
   * Se a mesa permite, vale duplicar/triplicar o risco (2×, 3×... roupas
   * dentro dele) e enfestar menos folhas: mesma produção, menos pontas.
   * Testamos cada multiplicação que divide as folhas e cabe na mesa.
   */
  const melhorMultiplicacao = (proposta: PropostaRisco): PropostaRisco => {
    let melhor = proposta;
    let melhorCusto = Infinity;
    for (let k = 1; k <= 6; k++) {
      if (proposta.folhas % k !== 0) continue;
      const comboK: Combo = Object.fromEntries(
        Object.entries(proposta.combo).map(([t, v]) => [t, v * k])
      );
      try {
        const enc = montar(comboK);
        if (k > 1 && enc.comprimentoCm > params.mesaCm) break; // não cabe na mesa
        const folhasK = proposta.folhas / k;
        const custo = folhasK * (enc.comprimentoCm + params.perdaPorFolhaCm);
        if (custo < melhorCusto) {
          melhorCusto = custo;
          melhor = { combo: comboK, folhas: folhasK };
        }
      } catch {
        break; // combinação grande demais pra largura — para de multiplicar
      }
    }
    return melhor;
  };

  for (const est of estrategias(params.grade)) {
    const avisos: string[] = [];
    const riscos: Risco[] = [];
    let total = 0;
    let ok = true;
    try {
      for (const propostaBase of est.riscos) {
        const proposta = melhorMultiplicacao(propostaBase);
        for (const parte of dividirSePreciso(proposta, params.mesaCm, montar, avisos)) {
          const enc = montar(parte.combo);
          const areaPecas = pecasDoRisco(modelo, pano, parte.combo, params).reduce(
            (s, p) => s + p.area,
            0
          );
          const areaRisco = largura * enc.comprimentoCm;
          riscos.push({
            combo: parte.combo,
            folhas: parte.folhas,
            enfestos: Math.ceil(parte.folhas / Math.max(1, params.maxFolhas)),
            comprimentoCm: enc.comprimentoCm,
            larguraCm: largura,
            aproveitamento:
              areaRisco > 0 ? Math.round((areaPecas / areaRisco) * 1000) / 10 : 0,
            pecas: enc.pecas,
            estrategiaEncaixe: enc.estrategia,
          });
          total += parte.folhas * (enc.comprimentoCm + params.perdaPorFolhaCm);
        }
      }
    } catch {
      ok = false; // peça não coube na largura — estratégia inválida
    }
    if (ok && riscos.length > 0)
      avaliadas.push({ nome: est.nome, riscos, totalTecidoCm: Math.round(total), avisos });
  }

  if (avaliadas.length === 0)
    throw new Error(
      "Nenhuma peça coube na largura de tecido informada — confira as medidas"
    );

  avaliadas.sort(
    (a, b) => a.totalTecidoCm - b.totalTecidoCm || a.riscos.length - b.riscos.length
  );

  // POLIMENTO FINAL: os 3 melhores planos passam pelo motor caro (grade de
  // ocupação, que preenche os vãos) — e SÓ DEPOIS o campeão é declarado,
  // porque o polimento pode mudar quem vence.
  const polir = (av: Avaliada) => {
    let total = 0;
    for (const risco of av.riscos) {
      // o motor caro também reavalia a MULTIPLICAÇÃO do risco (às vezes o
      // risco 2× ou 5× fica melhor no encaixe fino do que parecia no rápido)
      let melhorEnc = montar(risco.combo, true);
      let melhorCombo = risco.combo;
      let melhorFolhas = risco.folhas;
      let melhorCusto = melhorFolhas * (melhorEnc.comprimentoCm + params.perdaPorFolhaCm);
      const base = Object.values(risco.combo).reduce(mdc);
      const pecasBase = pecasDoRisco(modelo, pano, risco.combo, params).length;
      for (const k of [2, 3, 5]) {
        if (risco.folhas % k !== 0) continue;
        if (base % k === 0) continue; // já seria redutível: mesmo risco
        if (pecasBase * k > 40) continue; // risco gigante: caro demais no fino
        const comboK: Combo = Object.fromEntries(
          Object.entries(risco.combo).map(([t, v]) => [t, v * k])
        );
        try {
          const enc = montar(comboK, true);
          if (enc.comprimentoCm > params.mesaCm) break;
          const custo = (risco.folhas / k) * (enc.comprimentoCm + params.perdaPorFolhaCm);
          if (custo < melhorCusto) {
            melhorCusto = custo;
            melhorEnc = enc;
            melhorCombo = comboK;
            melhorFolhas = risco.folhas / k;
          }
        } catch {
          break;
        }
      }
      risco.combo = melhorCombo;
      risco.folhas = melhorFolhas;
      risco.enfestos = Math.ceil(melhorFolhas / Math.max(1, params.maxFolhas));
      risco.comprimentoCm = melhorEnc.comprimentoCm;
      risco.pecas = melhorEnc.pecas;
      risco.estrategiaEncaixe = melhorEnc.estrategia;
      const areaPecas = pecasDoRisco(modelo, pano, melhorCombo, params).reduce(
        (s, p) => s + p.area,
        0
      );
      const areaRisco = largura * melhorEnc.comprimentoCm;
      risco.aproveitamento =
        areaRisco > 0 ? Math.round((areaPecas / areaRisco) * 1000) / 10 : 0;
      total += melhorFolhas * (melhorEnc.comprimentoCm + params.perdaPorFolhaCm);
    }
    av.totalTecidoCm = Math.round(total);
  };
  for (const av of avaliadas.slice(0, 2)) polir(av);
  avaliadas.sort(
    (a, b) => a.totalTecidoCm - b.totalTecidoCm || a.riscos.length - b.riscos.length
  );
  const venc = avaliadas[0];

  const areaPecasTotal = venc.riscos.reduce(
    (s, r) =>
      s +
      r.folhas *
        r.pecas.reduce((s2, p) => {
          const peca = modelo.pecas.find((pp) => pp.nome === p.nome);
          return s2 + (peca?.tamanhos[p.tamanho]?.area ?? p.w * p.h);
        }, 0),
    0
  );
  const areaTecidoTotal = venc.riscos.reduce(
    (s, r) => s + r.folhas * r.comprimentoCm * r.larguraCm,
    0
  );

  return {
    plano: {
      pano,
      riscos: venc.riscos,
      totalTecidoCm: venc.totalTecidoCm,
      areaPecasCm2: Math.round(areaPecasTotal),
      aproveitamentoMedio:
        areaTecidoTotal > 0
          ? Math.round((areaPecasTotal / areaTecidoTotal) * 1000) / 10
          : 0,
      estrategiaEnfesto: venc.nome,
      comparativo: avaliadas.map((a) => ({
        estrategia: a.nome,
        totalTecidoCm: a.totalTecidoCm,
      })),
      avisos: venc.avisos,
    },
    analises,
  };
}

/** Ponto de entrada: monta o plano completo (tecido + forro). */
export function montarPlano(
  modelo: ModeloCorte,
  params: ParametrosPlano
): ResultadoPlano {
  // Normaliza os nomes de tamanho da grade contra a grade do modelo
  // ("BASE P " com espaço ≠ "BASE P") — evita peça sumindo em silêncio.
  const gradeNormalizada: Record<string, number> = {};
  for (const [tam, qtd] of Object.entries(params.grade)) {
    if (!(qtd > 0)) continue;
    const oficial =
      modelo.tamanhos.find((t) => t === tam) ??
      modelo.tamanhos.find((t) => t.trim().toUpperCase() === tam.trim().toUpperCase());
    if (!oficial) throw new Error(`Tamanho "${tam.trim()}" não existe na grade do modelo`);
    gradeNormalizada[oficial] = (gradeNormalizada[oficial] ?? 0) + qtd;
  }
  params = { ...params, grade: gradeNormalizada };

  const totalRoupas = Object.values(params.grade).reduce((a, b) => a + b, 0);
  if (totalRoupas <= 0) throw new Error("Informe a quantidade de pelo menos um tamanho");

  const planos: PlanoPano[] = [];
  let analises = 0;

  const tec = planejarPano(modelo, "TEC", params);
  if (tec.plano) planos.push(tec.plano);
  analises += tec.analises;

  if (params.incluirForro) {
    const forro = planejarPano(modelo, "FOR", params);
    if (forro.plano) planos.push(forro.plano);
    analises += forro.analises;
  }

  if (planos.length === 0)
    throw new Error("Nenhuma peça ligada pra montar o plano — reative as peças");

  return { planos, totalPecasRoupa: totalRoupas, analises };
}
