/**
 * Motor do módulo Produção — inteligência de rendimento têxtil.
 *
 * Três responsabilidades, todas SEM regra fixa de negócio no código:
 *  1. calcularEnfesto  — kg → metros → folhas na mesa (aritmética do corte)
 *  2. preverPecas      — projeção de produção por SIMILARIDADE com o
 *     histórico da própria confecção: cada corte fechado vira uma
 *     "experiência"; a previsão pondera as mais parecidas e recentes e
 *     devolve estimativa + margem + em quantos cortes se baseou.
 *  3. custoPorPeca     — custo industrial (tecido + extras) por peça.
 *
 * O motor melhora sozinho: quanto mais cortes fechados, mais experiências,
 * margens mais curtas. Nenhum número aqui é "chutado" — tudo vem dos dados.
 */

// ---- 1. Aritmética do enfesto ----------------------------------------------

export type Enfesto = {
  lengthM: number; // metros de tecido no peso informado
  sheets: number; // folhas completas na mesa
  leftoverM: number; // ponta que sobra depois da última folha completa
};

export function calcularEnfesto(input: {
  usedKg: number;
  yieldMPerKg: number; // rendimento do tecido (m/kg)
  tableLengthM?: number | null; // comprimento da mesa
}): Enfesto {
  const lengthM = round2(Math.max(0, input.usedKg) * Math.max(0, input.yieldMPerKg));
  const mesa = input.tableLengthM ?? 0;
  const sheets = mesa > 0 ? Math.floor(lengthM / mesa) : 0;
  const leftoverM = mesa > 0 ? round2(lengthM - sheets * mesa) : 0;
  return { lengthM, sheets, leftoverM };
}

// ---- 2. Previsão por similaridade ------------------------------------------

/** Uma "experiência": corte FECHADO com rendimento real medido. */
export type Experiencia = {
  piecesPerKg: number; // peças produzidas por kg (o resultado real)
  fabricId?: string | null;
  fabricType?: string | null;
  supplier?: string | null;
  color?: string | null;
  grammage?: number | null;
  productName?: string | null;
  gradeInfo?: string | null;
  tableName?: string | null;
  operator?: string | null;
  geometry?: string | null; // quando a matéria-prima foi uma sobra
  date?: Date | string | null;
};

export type Contexto = Omit<Experiencia, "piecesPerKg" | "date">;

export type Projecao = {
  pecas: number; // estimativa central
  min: number; // faixa provável (pessimista)
  max: number; // faixa provável (otimista)
  base: number; // em quantos cortes parecidos se baseou (0 = só o próprio)
  taxaKg: number; // peças/kg usada na conta
};

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Pontuação de semelhança entre a situação atual e uma experiência passada.
 *  Pesos relativos (não absolutos): o que mais define rendimento pesa mais. */
function similaridade(ctx: Contexto, e: Experiencia): number {
  let s = 0;
  if (ctx.fabricId && e.fabricId && ctx.fabricId === e.fabricId) s += 3;
  else if (ctx.fabricType && norm(ctx.fabricType) === norm(e.fabricType)) s += 1;
  if (ctx.productName && norm(ctx.productName) === norm(e.productName)) s += 3;
  if (ctx.gradeInfo && norm(ctx.gradeInfo) === norm(e.gradeInfo)) s += 1.5;
  if (ctx.color && norm(ctx.color) === norm(e.color)) s += 0.75;
  if (
    ctx.grammage &&
    e.grammage &&
    Math.abs(ctx.grammage - e.grammage) <= ctx.grammage * 0.1
  )
    s += 1;
  if (ctx.supplier && norm(ctx.supplier) === norm(e.supplier)) s += 0.75;
  if (ctx.tableName && norm(ctx.tableName) === norm(e.tableName)) s += 0.5;
  if (ctx.operator && norm(ctx.operator) === norm(e.operator)) s += 0.5;
  if (ctx.geometry && norm(ctx.geometry) === norm(e.geometry)) s += 1;
  return s;
}

/** Peso por recência: experiência de hoje vale 1; meia-vida de ~6 meses. */
function recencia(date: Date | string | null | undefined): number {
  if (!date) return 0.7;
  const dias = (Date.now() - new Date(date).getTime()) / 86_400_000;
  if (!Number.isFinite(dias) || dias < 0) return 1;
  return Math.pow(0.5, dias / 180);
}

/**
 * Projeta quantas peças sairão de `kg` de material.
 *
 * `taxaPropria`: peças/kg já MEDIDAS neste mesmo corte (parte já cortada).
 * É a informação mais valiosa que existe — mesmo tecido, mesmo rolo, mesmo
 * plano — então entra com peso alto ao lado do histórico.
 */
export function preverPecas(
  historico: Experiencia[],
  ctx: Contexto,
  kg: number,
  taxaPropria?: number | null
): Projecao | null {
  type Amostra = { taxa: number; peso: number };
  const amostras: Amostra[] = [];

  for (const e of historico) {
    if (!(e.piecesPerKg > 0)) continue;
    const sim = similaridade(ctx, e);
    if (sim <= 0) continue; // nada em comum: não ensina nada aqui
    amostras.push({ taxa: e.piecesPerKg, peso: sim * recencia(e.date) });
  }
  // o próprio corte: peso equivalente a ~8 pontos de similaridade
  if (taxaPropria && taxaPropria > 0) {
    amostras.push({ taxa: taxaPropria, peso: 8 });
  }
  if (amostras.length === 0 || !(kg > 0)) return null;

  const somaPesos = amostras.reduce((a, x) => a + x.peso, 0);
  const media = amostras.reduce((a, x) => a + x.taxa * x.peso, 0) / somaPesos;
  // dispersão ponderada → margem: com pouco histórico a faixa é honesta e
  // larga; conforme as experiências acumulam, ela encurta sozinha
  const variancia =
    amostras.reduce((a, x) => a + x.peso * (x.taxa - media) ** 2, 0) / somaPesos;
  const desvio = Math.sqrt(variancia);
  const margemMinima = media * (amostras.length >= 20 ? 0.05 : amostras.length >= 5 ? 0.1 : 0.18);
  const margem = Math.max(desvio, margemMinima);

  const pecas = media * kg;
  return {
    pecas: Math.round(pecas),
    min: Math.max(0, Math.floor((media - margem) * kg)),
    max: Math.ceil((media + margem) * kg),
    base: amostras.length - (taxaPropria && taxaPropria > 0 ? 1 : 0),
    taxaKg: round2(media),
  };
}

// ---- 3. Custo por peça -----------------------------------------------------

export type ItemCusto = { name: string; value: number };

export function custoPorPeca(input: {
  fabricCost: number; // R$ do tecido usado no corte
  pieces: number; // peças produzidas
  extras: ItemCusto[]; // custos POR PEÇA (mão de obra, linha, etiqueta...)
}): { tecidoPorPeca: number; extrasPorPeca: number; total: number } | null {
  if (!(input.pieces > 0)) return null;
  const tecidoPorPeca = input.fabricCost / input.pieces;
  const extrasPorPeca = input.extras.reduce(
    (a, e) => a + (Number.isFinite(e.value) ? Math.max(0, e.value) : 0),
    0
  );
  return {
    tecidoPorPeca: round2(tecidoPorPeca),
    extrasPorPeca: round2(extrasPorPeca),
    total: round2(tecidoPorPeca + extrasPorPeca),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- 4. Método da balança (aproveitamento por pesagem das peças) -----------

/** Um modelo produzido no corte: nome, tamanho, quantidade e peso unitário. */
export type ItemProduzido = {
  name: string;
  size?: string | null;
  pieces: number;
  pieceWeightG?: number | null;
};

/**
 * Aproveitamento por SUBTRAÇÃO — o jeito real de fábrica: ninguém pesa
 * farelo de tecido no meio do corte. Pesa-se a produção pronta por SKU;
 * o que não virou peça é desperdício.
 *   15 kg cortados, 50 blusas × 200 g = 10 kg em peças
 *   → aproveitamento 66,7% · desperdício 5 kg
 * Só calcula quando TODOS os modelos têm peso unitário informado.
 */
export function resumoPesagem(
  items: ItemProduzido[],
  usedKg: number
): { pesoPecasKg: number; utilizationPct: number; wasteKg: number } | null {
  if (!(usedKg > 0) || items.length === 0) return null;
  if (items.some((i) => !(i.pieceWeightG && i.pieceWeightG > 0))) return null;
  const pesoPecasKg = items.reduce(
    (a, i) => a + (i.pieces * (i.pieceWeightG ?? 0)) / 1000,
    0
  );
  return {
    pesoPecasKg: round2(pesoPecasKg),
    utilizationPct: round2((pesoPecasKg / usedKg) * 100),
    wasteKg: round2(Math.max(0, usedKg - pesoPecasKg)),
  };
}

/**
 * Custo do tecido por MODELO: o kg pago vira outro kg quando existe
 * desperdício. Custo efetivo por kg ÚTIL = custo total ÷ kg que viraram
 * peça; cada modelo paga proporcional ao seu peso.
 *   R$ 1.500 de tecido ÷ 10 kg úteis = R$ 150/kg útil
 *   → blusa de 200 g custa R$ 30 de tecido
 */
export function custoPorModelo(
  items: ItemProduzido[],
  fabricCost: number,
  extrasPorPeca: number
): { name: string; pieces: number; tecidoPorPeca: number; totalPorPeca: number }[] | null {
  const pesoTotal = items.reduce(
    (a, i) => a + (i.pieces * (i.pieceWeightG ?? 0)) / 1000,
    0
  );
  if (!(pesoTotal > 0)) return null;
  const custoKgUtil = fabricCost / pesoTotal;
  return items.map((i) => {
    const tecido = ((i.pieceWeightG ?? 0) / 1000) * custoKgUtil;
    return {
      name: i.name,
      pieces: i.pieces,
      tecidoPorPeca: round2(tecido),
      totalPorPeca: round2(tecido + extrasPorPeca),
    };
  });
}

// ---- Helpers de leitura (usados por páginas e APIs) ------------------------

export type CorteFechadoParaHistorico = {
  usedKg: number;
  piecesTotal: number | null;
  finalizedAt: Date | null;
  productName: string | null;
  gradeInfo: string | null;
  tableName: string | null;
  operator: string | null;
  roll: {
    color: string;
    fabric: {
      id: string;
      type: string | null;
      supplier: string | null;
      grammage: number | null;
    };
  } | null;
};

/** Converte cortes fechados do banco em experiências do motor. */
export function experienciasDe(cortes: CorteFechadoParaHistorico[]): Experiencia[] {
  return cortes
    .filter((c) => c.piecesTotal && c.piecesTotal > 0 && c.usedKg > 0)
    .map((c) => ({
      piecesPerKg: c.piecesTotal! / c.usedKg,
      fabricId: c.roll?.fabric.id ?? null,
      fabricType: c.roll?.fabric.type ?? null,
      supplier: c.roll?.fabric.supplier ?? null,
      grammage: c.roll?.fabric.grammage ?? null,
      color: c.roll?.color ?? null,
      productName: c.productName,
      gradeInfo: c.gradeInfo,
      tableName: c.tableName,
      operator: c.operator,
      date: c.finalizedAt,
    }));
}
