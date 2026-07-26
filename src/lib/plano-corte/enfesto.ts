import { empacotarOrdem, encaixarMelhor, type PecaEncaixe } from "./nesting";
import type {
  MedidaTamanho,
  ModeloCorte,
  ParametrosPlano,
  PecaModelo,
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

/**
 * Um item do pedido de corte: um modelo com sua grade. O plano aceita
 * VÁRIOS modelos no mesmo risco (mesmo tecido/largura) — peça pequena de
 * um modelo preenche o vão da grande do outro.
 */
export type ItemPedido = {
  modelo: ModeloCorte;
  grade: Record<string, number>; // tamanho → quantidade de roupas
  pecasDesligadas?: string[]; // peças DESTE modelo fora do plano
};

/** Chave da grade composta: "M" com 1 modelo; "1|M" com vários. */
const chaveTam = (idx: number, tam: string, multi: boolean) =>
  multi ? `${idx}|${tam}` : tam;
const abreChave = (chave: string): { idx: number; tam: string } => {
  const p = chave.indexOf("|");
  return p < 0
    ? { idx: 0, tam: chave }
    : { idx: parseInt(chave.slice(0, p), 10) || 0, tam: chave.slice(p + 1) };
};

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
function giraProFio(
  med: { w: number; h: number; area: number; contorno?: [number, number][] },
  espelhar = false
) {
  // PAR ESPELHADO: no enfesto as folhas ficam todas com a face pra cima, e
  // cortar o mesmo molde 2× daria duas mangas do MESMO lado. A segunda sai
  // invertida (x → w − x) antes de girar pro fio: vira a mão contrária.
  const contorno = espelhar
    ? med.contorno?.map(([x, y]) => [med.w - x, y] as [number, number])
    : med.contorno;
  return {
    w: med.h, // atravessa a largura do tecido
    h: med.w, // corre no comprimento (fio)
    area: med.area,
    contorno: contorno?.map(([x, y]) => [y, med.w - x] as [number, number]),
  };
}

/**
 * Medida da peça naquele tamanho. Peça NÃO GRADEADA (galão, viés, gola de
 * acabamento) costuma vir com um tamanho só no Audaces — antes ela sumia do
 * risco em silêncio e o corte saía com peça faltando. Agora ela usa a
 * medida do tamanho mais próximo que existe.
 */
export function medidaDaPeca(
  peca: PecaModelo,
  tam: string,
  ordem: string[]
): MedidaTamanho | undefined {
  const direta = peca.tamanhos[tam];
  if (direta) return direta;
  const alvo = ordem.indexOf(tam);
  const existentes = Object.keys(peca.tamanhos);
  if (existentes.length === 0) return undefined;
  if (alvo < 0) return peca.tamanhos[existentes[0]];
  // o mais perto na grade (empate: o menor, que é o mais conservador)
  let melhor = existentes[0];
  let dist = Infinity;
  for (const t of existentes) {
    const i = ordem.indexOf(t);
    const d = i < 0 ? Infinity : Math.abs(i - alvo);
    if (d < dist) {
      dist = d;
      melhor = t;
    }
  }
  return peca.tamanhos[melhor];
}

/**
 * Forro no MESMO pano: as peças de forro passam a valer como tecido e entram
 * no mesmo risco — preenchem os vãos das peças grandes em vez de gastar uma
 * metragem à parte.
 *
 * IMPORTANTE: isto tem que ser aplicado no MESMO lugar em que a lista de
 * modelos é montada (`carregarItens`), não só dentro do planejador. O
 * otimizador remonta as peças de cada risco a cada rodada a partir dessa
 * lista — se a conversão ficasse só aqui dentro, o forro entrava na primeira
 * rodada e sumia na segunda. É idempotente: aplicar duas vezes não muda nada.
 */
export function aplicarForroMesmoTecido(
  itens: ItemPedido[],
  params: Pick<ParametrosPlano, "incluirForro" | "forroMesmoTecido">
): ItemPedido[] {
  if (!params.incluirForro || !params.forroMesmoTecido) return itens;
  return itens.map((item) => ({
    ...item,
    modelo: {
      ...item.modelo,
      pecas: item.modelo.pecas.map((p) =>
        p.pano === "FOR" ? { ...p, pano: "TEC" as TipoPano } : p
      ),
    },
  }));
}

/** Peças que não têm medida própria em algum tamanho pedido (pra avisar). */
export function pecasNaoGradeadas(
  itens: ItemPedido[],
  params: ParametrosPlano
): string[] {
  const fora = new Set<string>();
  for (const item of itens) {
    const tams = Object.keys(item.grade).filter((t) => item.grade[t] > 0);
    for (const peca of item.modelo.pecas) {
      if (params.pecasDesligadas.includes(peca.nome)) continue;
      if (item.pecasDesligadas?.includes(peca.nome)) continue;
      if (!params.incluirForro && peca.pano === "FOR") continue;
      for (const t of tams)
        if (!peca.tamanhos[t]) {
          fora.add(peca.nome);
          break;
        }
    }
  }
  return [...fora];
}

/** Monta a lista de peças físicas de um risco (combo × peças do pano). */
export function pecasDoRiscoMulti(
  itens: ItemPedido[],
  pano: TipoPano,
  combo: Combo,
  params: ParametrosPlano
): PecaEncaixe[] {
  const multi = itens.length > 1;
  const out: PecaEncaixe[] = [];
  for (const [chave, vezes] of Object.entries(combo)) {
    const { idx, tam } = abreChave(chave);
    const item = itens[idx];
    if (!item) continue;
    for (const peca of item.modelo.pecas) {
      if (peca.pano !== pano) continue;
      if (params.pecasDesligadas.includes(peca.nome)) continue;
      if (item.pecasDesligadas?.includes(peca.nome)) continue;
      const med = medidaDaPeca(peca, tam, item.modelo.tamanhos);
      if (!med) continue; // peça sem medida nenhuma: não dá pra encaixar
      const normal = giraProFio(med, false);
      const invertida = peca.espelhada ? giraProFio(med, true) : normal;
      for (let i = 0; i < vezes * peca.qtd; i++) {
        // peça em par: alterna normal e invertida (uma de cada mão)
        const espelhar = Boolean(peca.espelhada) && i % 2 === 1;
        const g = espelhar ? invertida : normal;
        out.push({
          // no plano misto, o rótulo carrega o modelo (vai pro risco e PLT)
          nome: multi ? `${peca.nome} · ${item.modelo.nome}` : peca.nome,
          tamanho: tam,
          w: g.w,
          h: g.h,
          area: g.area,
          espelhada: espelhar || undefined,
          modeloIdx: idx,
          contorno: g.contorno,
        });
      }
    }
  }
  return out;
}

/** Combo legível pra tela/PLT: "3× BASE P + 5× M" (com modelo, se misto). */
export function rotuloDoCombo(itens: ItemPedido[], combo: Combo): string {
  const multi = itens.length > 1;
  return Object.entries(combo)
    .map(([chave, v]) => {
      const { idx, tam } = abreChave(chave);
      const nome = multi ? `${itens[idx]?.modelo.nome ?? "?"} ${tam.trim()}` : tam.trim();
      return v > 1 ? `${v}× ${nome}` : nome;
    })
    .join(" + ");
}

/**
 * PARTICIONADOR: se o risco estourar a mesa, divide as roupas em vários
 * CORTES de forma inteligente — cada unidade (1 roupa no risco) entra no
 * primeiro corte onde o encaixe continua cabendo na mesa; não coube em
 * nenhum, abre corte novo. As maiores entram primeiro (first-fit
 * decreasing). A medida usa um encaixe rápido que é TETO do encaixe final
 * — se coube na medida, cabe no risco de verdade.
 */
function dividirSePreciso(
  proposta: PropostaRisco,
  mesaCm: number,
  montar: (c: Combo) => { comprimentoCm: number },
  montarRapido: (c: Combo) => number,
  avisos: string[]
): PropostaRisco[] {
  const { comprimentoCm } = montar(proposta.combo);
  if (comprimentoCm <= mesaCm) return [proposta];

  // explode o combo em unidades: cada unidade = 1 roupa desenhada no risco
  const unidades: string[] = [];
  for (const [t, v] of Object.entries(proposta.combo))
    for (let i = 0; i < v; i++) unidades.push(t);
  if (unidades.length <= 1) {
    avisos.push(
      `Um risco de 1 tamanho ficou com ${(comprimentoCm / 100).toFixed(2)}m — maior que a mesa. O plano segue, mas confira a mesa ou corte em partes.`
    );
    return [proposta];
  }

  // maiores primeiro: o comprimento sozinho de cada unidade guia a ordem
  const solo = new Map<string, number>();
  for (const t of new Set(unidades)) solo.set(t, montarRapido({ [t]: 1 }));
  unidades.sort((a, b) => (solo.get(b) ?? 0) - (solo.get(a) ?? 0));

  const cortes: Combo[] = [];
  for (const t of unidades) {
    let colocado = false;
    for (const corte of cortes) {
      const cand: Combo = { ...corte, [t]: (corte[t] ?? 0) + 1 };
      if (montarRapido(cand) <= mesaCm) {
        corte[t] = (corte[t] ?? 0) + 1;
        colocado = true;
        break;
      }
    }
    if (!colocado) {
      if ((solo.get(t) ?? 0) > mesaCm)
        avisos.push(
          `Uma roupa sozinha (${t.trim()}) precisa de ${((solo.get(t) ?? 0) / 100).toFixed(2)}m — maior que a mesa. Confira o comprimento informado.`
        );
      cortes.push({ [t]: 1 });
    }
  }
  return cortes.map((combo) => ({ combo, folhas: proposta.folhas }));
}

/** Monta o plano de UM pano (tecido ou forro) testando todas as estratégias. */
function planejarPano(
  itens: ItemPedido[],
  pano: TipoPano,
  params: ParametrosPlano,
  polirFinalistas = true // false: só exploração (o otimizador pole depois)
): { plano: PlanoPano | null; analises: number } {
  const largura =
    pano === "FOR"
      ? params.larguraForroCm ?? params.larguraTecidoCm
      : params.larguraTecidoCm;

  const temPeca = itens.some((item) =>
    item.modelo.pecas.some(
      (p) =>
        p.pano === pano &&
        !params.pecasDesligadas.includes(p.nome) &&
        !item.pecasDesligadas?.includes(p.nome)
    )
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
        pecasDoRiscoMulti(itens, pano, combo, params),
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

  // medida-teto do particionador: UM empacotamento skyline (rapidíssimo);
  // o encaixe final testa várias ordens, então só encurta a partir daqui
  const cacheRapido = new Map<string, number>();
  const montarRapido = (combo: Combo): number => {
    const chave = JSON.stringify(combo);
    let v = cacheRapido.get(chave);
    if (v === undefined) {
      const pecas = pecasDoRiscoMulti(itens, pano, combo, params).sort(
        (a, b) => b.area - a.area
      );
      v = empacotarOrdem(pecas, largura, params.folgaCm, !params.sentidoUnico, "skyline")
        .comprimentoCm;
      cacheRapido.set(chave, v);
    }
    return v;
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
        for (const parte of dividirSePreciso(proposta, params.mesaCm, montar, montarRapido, avisos)) {
          const enc = montar(parte.combo);
          const areaPecas = pecasDoRiscoMulti(itens, pano, parte.combo, params).reduce(
            (s, p) => s + p.area,
            0
          );
          const areaRisco = largura * enc.comprimentoCm;
          riscos.push({
            combo: parte.combo,
            rotulo: rotuloDoCombo(itens, parte.combo),
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
      const pecasBase = pecasDoRiscoMulti(itens, pano, risco.combo, params).length;
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
      risco.rotulo = rotuloDoCombo(itens, melhorCombo);
      risco.folhas = melhorFolhas;
      risco.enfestos = Math.ceil(melhorFolhas / Math.max(1, params.maxFolhas));
      risco.comprimentoCm = melhorEnc.comprimentoCm;
      risco.pecas = melhorEnc.pecas;
      risco.estrategiaEncaixe = melhorEnc.estrategia;
      const areaPecas = pecasDoRiscoMulti(itens, pano, melhorCombo, params).reduce(
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
  if (polirFinalistas) for (const av of avaliadas.slice(0, 2)) polir(av);
  avaliadas.sort(
    (a, b) => a.totalTecidoCm - b.totalTecidoCm || a.riscos.length - b.riscos.length
  );
  const venc = avaliadas[0];

  const areaPecasTotal = venc.riscos.reduce(
    (s, r) =>
      s +
      r.folhas *
        pecasDoRiscoMulti(itens, pano, r.combo, params).reduce(
          (s2, p) => s2 + p.area,
          0
        ),
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

/**
 * Ponto de entrada MULTI-MODELO: vários modelos no mesmo corte (mesmo
 * tecido/largura). A grade composta junta os tamanhos de todos e as
 * estratégias de enfesto trabalham em cima dela — misturar modelos é o
 * caminho pro aproveitamento máximo (peça pequena preenche vão da grande).
 */
export function montarPlanoMulti(
  itens: ItemPedido[],
  params: ParametrosPlano,
  polirFinalistas = true
): ResultadoPlano {
  if (itens.length === 0) throw new Error("Adicione pelo menos um modelo ao corte");
  const multi = itens.length > 1;

  // Normaliza os nomes de tamanho de cada modelo ("BASE P " com espaço ≠
  // "BASE P") — evita peça sumindo em silêncio — e monta a grade composta.
  const gradeComposta: Record<string, number> = {};
  let totalRoupas = 0;
  itens.forEach((item, idx) => {
    for (const [tam, qtd] of Object.entries(item.grade)) {
      if (!(qtd > 0)) continue;
      const oficial =
        item.modelo.tamanhos.find((t) => t === tam) ??
        item.modelo.tamanhos.find(
          (t) => t.trim().toUpperCase() === tam.trim().toUpperCase()
        );
      if (!oficial)
        throw new Error(
          `Tamanho "${tam.trim()}" não existe na grade do modelo ${item.modelo.nome}`
        );
      const chave = chaveTam(idx, oficial, multi);
      gradeComposta[chave] = (gradeComposta[chave] ?? 0) + qtd;
      totalRoupas += qtd;
    }
  });
  if (totalRoupas <= 0) throw new Error("Informe a quantidade de pelo menos um tamanho");
  params = { ...params, grade: gradeComposta };

  itens = aplicarForroMesmoTecido(itens, params);

  const planos: PlanoPano[] = [];
  let analises = 0;

  const tec = planejarPano(itens, "TEC", params, polirFinalistas);
  if (tec.plano) planos.push(tec.plano);
  analises += tec.analises;

  // com o forro no mesmo pano não existe segundo risco: já foi tudo junto
  if (params.incluirForro && !params.forroMesmoTecido) {
    const forro = planejarPano(itens, "FOR", params, polirFinalistas);
    if (forro.plano) planos.push(forro.plano);
    analises += forro.analises;
  }

  if (planos.length === 0)
    throw new Error("Nenhuma peça ligada pra montar o plano — reative as peças");

  // Forro desligado com o modelo TENDO forro: o total de peças fica menor
  // que o esperado e o lojista descobre isso na mesa. Avisa em números.
  if (!params.incluirForro) {
    let pecasForro = 0;
    const nomes = new Set<string>();
    for (const item of itens) {
      const roupas = Object.values(item.grade).reduce((s, v) => s + (v > 0 ? v : 0), 0);
      for (const peca of item.modelo.pecas) {
        if (peca.pano !== "FOR") continue;
        if (params.pecasDesligadas.includes(peca.nome)) continue;
        if (item.pecasDesligadas?.includes(peca.nome)) continue;
        pecasForro += peca.qtd * roupas;
        nomes.add(peca.nome);
      }
    }
    if (pecasForro > 0)
      planos[0].avisos.push(
        `O forro está DESLIGADO neste corte: ${pecasForro} peças (${[...nomes].join(", ")}) ficaram de fora da conta. Ligue "Cortar o forro" pra incluir — e "o forro é o mesmo tecido" se ele sai do mesmo pano.`
      );
  }

  // peça sem medida própria no tamanho pedido entra com a medida do
  // tamanho mais próximo — o lojista precisa saber disso
  const semGrade = pecasNaoGradeadas(itens, params);
  if (semGrade.length > 0)
    planos[0].avisos.push(
      `${semGrade.join(", ")} não ${semGrade.length === 1 ? "está gradeada" : "estão gradeadas"} em todos os tamanhos do Audaces — entraram no risco com a medida do tamanho mais próximo. Confira se está certo.`
    );

  return { planos, totalPecasRoupa: totalRoupas, analises };
}

/** Atalho de 1 modelo só (mantém compatibilidade com testes e chamadas antigas). */
export function montarPlano(
  modelo: ModeloCorte,
  params: ParametrosPlano
): ResultadoPlano {
  return montarPlanoMulti([{ modelo, grade: params.grade }], params);
}
