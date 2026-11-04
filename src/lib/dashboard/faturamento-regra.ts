import { dataDoDia, diaSP } from "@/lib/dia";

/**
 * O GRÁFICO DE FATURAMENTO DO DASHBOARD, VIVO (RN-108) — a parte PURA, sem
 * banco: o navegador importa daqui (o motor com Prisma mora em
 * `faturamento-dados.ts` e não pode chegar ao navegador).
 *
 * Pedido do dono (04/11/2026): *"nesse gráfico que compara com o mês
 * anterior, eu gostaria de conseguir mudar a data de comparação e passar o
 * mouse e ver o faturamento exato do dia; ser mais dinâmico para fazer as
 * análises"*. Três réguas sustentam tudo:
 *
 * 1. **O período comparado tem SEMPRE a mesma duração do período da tela**
 *    e os dias se alinham um a um (dia 1 com dia 1) — é o que faz as duas
 *    linhas serem comparáveis no mesmo eixo. A loja escolhe só ONDE o
 *    comparado começa: o período imediatamente anterior (o padrão de sempre),
 *    o mesmo período do ano passado (sazonalidade: o novembro de 2025 contra
 *    o de 2026), ou uma data livre ("a partir de 01/10").
 * 2. **Cada ponto é um DIA de São Paulo** (a régua `diaSP`, RN-030), somando
 *    `netTotal` (valor vendido, nunca `total` — RN-002) dos pedidos PAGOS pela
 *    data do pagamento (RN-001). Acima de 92 dias os pontos viram SEMANAS
 *    (a soma dos 7 dias a partir da data do ponto), senão o gráfico vira
 *    serrote; o balão diz de qual dia a qual dia o ponto soma.
 * 3. **O navegador não faz conta de dinheiro nova**: ele soma, acumula e
 *    agrupa o que o servidor mandou por dia — as mesmas funções deste
 *    arquivo rodam nos dois lados, e o total que o resumo mostra é a soma da
 *    mesma série que a linha desenha.
 */

export const TIPOS_DE_COMPARACAO = ["anterior", "ano-passado", "personalizado"] as const;
export type TipoDeComparacao = (typeof TIPOS_DE_COMPARACAO)[number];

export const ROTULO_DA_COMPARACAO: Record<TipoDeComparacao, string> = {
  anterior: "Período anterior",
  "ano-passado": "Mesmo período do ano passado",
  personalizado: "Outra data",
};

/**
 * Teto de ~4 anos: só para o array não explodir com uma data digitada
 * errada. Quando é atingido, a tela DIZ (o corte mudo de 400 dias escondia
 * o fim do período — auditoria 24/08/2026).
 */
export const TETO_DIAS_GRAFICO = 1465;
/** acima disto o gráfico agrupa por semana */
export const DIAS_PARA_AGRUPAR_POR_SEMANA = 92;

const DIA_MS = 86_400_000;

/** "2026-11-04" é um dia que existe? (a régua de `dataDoDia`: "2026-02-30" não) */
export function diaValido(iso: unknown): iso is string {
  return typeof iso === "string" && dataDoDia(iso) !== null;
}

/** o número do dia (dias desde 1970) de um AAAA-MM-DD válido */
function numeroDoDia(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DIA_MS);
}

function isoDoNumero(n: number): string {
  return new Date(n * DIA_MS).toISOString().slice(0, 10);
}

/** "2026-11-04" + n dias (n pode ser negativo) */
export function somarDias(iso: string, n: number): string {
  return isoDoNumero(numeroDoDia(iso) + n);
}

/** quantos dias o período cobre, contando os dois extremos (nunca menos que 1) */
export function diasEntre(de: string, ate: string): number {
  return Math.max(numeroDoDia(ate) - numeroDoDia(de) + 1, 1);
}

/** o mesmo dia um ano antes (29/02 vira 01/03 — o JavaScript escorrega, e é o dia útil mais perto) */
function umAnoAntes(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export type Periodo = { de: string; ate: string };

/**
 * O período comparado: mesma duração do período da tela, começando onde o
 * tipo manda. `personalizado` sem uma data válida não tem comparação (null —
 * quem chama decide o que dizer).
 */
export function periodoDeComparacao(
  tipo: TipoDeComparacao,
  periodo: Periodo,
  cmpDe?: string | null
): Periodo | null {
  const n = diasEntre(periodo.de, periodo.ate);
  let de: string;
  if (tipo === "anterior") de = somarDias(periodo.de, -n);
  else if (tipo === "ano-passado") de = umAnoAntes(periodo.de);
  else {
    if (!diaValido(cmpDe)) return null;
    de = cmpDe;
  }
  return { de, ate: somarDias(de, n - 1) };
}

/**
 * O período que o gráfico de fato MOSTRA: preso ao teto. Quem consulta o
 * banco consulta só isto — ler quatro anos a mais para descartar depois era
 * trabalho jogado fora numa porta barata de disparar (achado da revisão).
 */
export function janelaDoGrafico(periodo: Periodo): { periodo: Periodo; dias: number; cortado: boolean } {
  const total = diasEntre(periodo.de, periodo.ate);
  const dias = Math.min(total, TETO_DIAS_GRAFICO);
  return {
    periodo: { de: periodo.de, ate: somarDias(periodo.de, dias - 1) },
    dias,
    cortado: total > TETO_DIAS_GRAFICO,
  };
}

export type VendaPaga = { paidAt: Date | string | null; netTotal: number };
export type SerieDiaria = { valores: number[]; pedidos: number[] };

/**
 * A série diária: um valor e uma contagem por dia de São Paulo, a partir de
 * `de`, com `dias` posições. Pedido fora da janela (ou sem data) não entra.
 */
export function serieDiaria(vendas: VendaPaga[], de: string, dias: number): SerieDiaria {
  const valores = new Array<number>(dias).fill(0);
  const pedidos = new Array<number>(dias).fill(0);
  const primeiro = numeroDoDia(de);
  for (const v of vendas) {
    if (!v.paidAt) continue;
    const quando = typeof v.paidAt === "string" ? new Date(v.paidAt) : v.paidAt;
    if (Number.isNaN(quando.getTime())) continue;
    const i = numeroDoDia(diaSP(quando)) - primeiro;
    if (i < 0 || i >= dias) continue;
    valores[i] += v.netTotal;
    pedidos[i] += 1;
  }
  return { valores, pedidos };
}

export type DadosDoFaturamento = {
  periodo: Periodo & { dias: number };
  comparacao: { tipo: TipoDeComparacao; periodo: Periodo | null };
  atual: SerieDiaria;
  /** vazia (arrays de zero posições) quando não há período comparado */
  comparado: SerieDiaria;
  /** o período pedia mais dias do que o teto: a série mostra os primeiros */
  cortado: boolean;
};

/**
 * Monta o pacote que a tela recebe (e que a porta devolve): puro — quem tem
 * banco chama `serieDiaria` sobre o que leu.
 */
export function montarFaturamento(args: {
  periodo: Periodo;
  tipo: TipoDeComparacao;
  comparacao: Periodo | null;
  vendas: VendaPaga[];
  vendasComparadas: VendaPaga[];
}): DadosDoFaturamento {
  const { dias, cortado } = janelaDoGrafico(args.periodo);
  return {
    periodo: { ...args.periodo, dias },
    comparacao: { tipo: args.tipo, periodo: args.comparacao },
    atual: serieDiaria(args.vendas, args.periodo.de, dias),
    comparado: args.comparacao
      ? serieDiaria(args.vendasComparadas, args.comparacao.de, dias)
      : { valores: [], pedidos: [] },
    cortado,
  };
}

/** "dd/mm" */
export function rotuloDoDia(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "dd/mm/aaaa" */
export function rotuloDoDiaComAno(iso: string): string {
  return `${rotuloDoDia(iso)}/${iso.slice(0, 4)}`;
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function diaDaSemana(iso: string): string {
  return DIAS_DA_SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

/** agrupa de 7 em 7 (a última semana pode ser mais curta) */
export function agruparPorSemana(arr: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.length; i += 7) out.push(arr.slice(i, i + 7).reduce((a, b) => a + b, 0));
  return out;
}

/** soma corrida: o ponto i é a soma de 0..i */
export function acumular(arr: number[]): number[] {
  let soma = 0;
  return arr.map((v) => (soma += v));
}

/** variação em % do comparado para o atual; sem base (comparado zero), nulo — nunca zero disfarçado */
export function variacao(atual: number, comparado: number): number | null {
  if (comparado <= 0) return null;
  return ((atual - comparado) / comparado) * 100;
}

export type ModoDoGrafico = "dia" | "acumulado";

export type PontoDoGrafico = {
  /** o primeiro e o último dia que este ponto soma (iguais quando é um dia só) */
  de: string;
  ate: string;
  /** os mesmos dias no período comparado (nulos sem comparação) */
  cmpDe: string | null;
  cmpAte: string | null;
  atual: number;
  comparado: number | null;
  pedidos: number;
  pedidosComparados: number | null;
};

export type Grafico = {
  porSemana: boolean;
  pontos: PontoDoGrafico[];
  /** rótulo curto do eixo de cada ponto */
  rotulos: string[];
};

/**
 * A série que a linha desenha: por dia ou acumulada, agrupada por semana
 * quando o período é longo. Cada ponto sabe que dias soma (é o que o balão
 * diz) — nos dois períodos.
 */
export function montarGrafico(dados: DadosDoFaturamento, modo: ModoDoGrafico): Grafico {
  const porSemana = dados.periodo.dias > DIAS_PARA_AGRUPAR_POR_SEMANA;
  const temComparacao = dados.comparacao.periodo != null && dados.comparado.valores.length > 0;
  const agrupar = (arr: number[]) => (porSemana ? agruparPorSemana(arr) : arr);
  const serie = (arr: number[]) => (modo === "acumulado" ? acumular(agrupar(arr)) : agrupar(arr));
  const atual = serie(dados.atual.valores);
  const pedidos = serie(dados.atual.pedidos);
  const comparado = temComparacao ? serie(dados.comparado.valores) : null;
  const pedidosComparados = temComparacao ? serie(dados.comparado.pedidos) : null;
  const passo = porSemana ? 7 : 1;
  const ultimoDia = dados.periodo.dias - 1;
  const pontos: PontoDoGrafico[] = atual.map((v, i) => {
    const inicio = i * passo;
    const fim = Math.min(inicio + passo - 1, ultimoDia);
    const cmp = dados.comparacao.periodo;
    return {
      de: somarDias(dados.periodo.de, inicio),
      ate: somarDias(dados.periodo.de, fim),
      cmpDe: cmp && temComparacao ? somarDias(cmp.de, inicio) : null,
      cmpAte: cmp && temComparacao ? somarDias(cmp.de, fim) : null,
      atual: v,
      comparado: comparado ? (comparado[i] ?? 0) : null,
      pedidos: pedidos[i] ?? 0,
      pedidosComparados: pedidosComparados ? (pedidosComparados[i] ?? 0) : null,
    };
  });
  return { porSemana, pontos, rotulos: pontos.map((p) => rotuloDoDia(p.de)) };
}

export type Resumo = {
  total: number;
  pedidos: number;
  totalComparado: number | null;
  pedidosComparados: number | null;
  /** % do comparado para o atual; nulo sem base */
  variacao: number | null;
  /** atual − comparado em reais; nulo sem comparação */
  diferenca: number | null;
  /** a média dos dias FECHADOS do período atual (sem hoje, quando o período chega até hoje) */
  mediaPorDia: number;
  /** quantos dias entraram na média do atual */
  diasDaMedia: number;
  /** a média deixou o dia de hoje de fora (o período termina hoje e tem mais de um dia) */
  mediaSemHoje: boolean;
  mediaPorDiaComparada: number | null;
  ticket: number | null;
  ticketComparado: number | null;
  /** o dia que mais vendeu (nulo quando nada foi vendido) */
  melhorDia: { dia: string; valor: number } | null;
};

/**
 * O resumo dos dois períodos — somado da MESMA série diária que a linha
 * desenha. `hoje` (AAAA-MM-DD em SP) decide a média por dia: um período que
 * chega até hoje tem o dia de hoje pela metade, e dividir por ele fazia a
 * média atual sair menor que a do comparado (que é fechado) só porque o dia
 * não acabou (achado da revisão) — então a média do atual é dos dias
 * FECHADOS, e o resumo diz que foi assim.
 */
export function resumoDoFaturamento(dados: DadosDoFaturamento, hoje?: string): Resumo {
  const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const total = soma(dados.atual.valores);
  const pedidos = soma(dados.atual.pedidos);
  const temComparacao = dados.comparacao.periodo != null && dados.comparado.valores.length > 0;
  const totalComparado = temComparacao ? soma(dados.comparado.valores) : null;
  const pedidosComparados = temComparacao ? soma(dados.comparado.pedidos) : null;
  let melhorDia: Resumo["melhorDia"] = null;
  dados.atual.valores.forEach((v, i) => {
    if (v > 0 && (!melhorDia || v > melhorDia.valor)) melhorDia = { dia: somarDias(dados.periodo.de, i), valor: v };
  });
  const dias = Math.max(dados.periodo.dias, 1);
  // os dias fechados: tudo antes de hoje, quando hoje está dentro da série
  let diasDaMedia = dias;
  let mediaSemHoje = false;
  if (hoje && dias > 1 && hoje >= dados.periodo.de) {
    const indiceDeHoje = diasEntre(dados.periodo.de, hoje) - 1;
    if (indiceDeHoje < dias) {
      diasDaMedia = Math.max(indiceDeHoje, 1);
      mediaSemHoje = indiceDeHoje >= 1;
    }
  }
  const mediaPorDia = mediaSemHoje ? soma(dados.atual.valores.slice(0, diasDaMedia)) / diasDaMedia : total / diasDaMedia;
  return {
    total,
    pedidos,
    totalComparado,
    pedidosComparados,
    variacao: totalComparado == null ? null : variacao(total, totalComparado),
    diferenca: totalComparado == null ? null : total - totalComparado,
    mediaPorDia,
    diasDaMedia,
    mediaSemHoje,
    mediaPorDiaComparada: totalComparado == null ? null : totalComparado / dias,
    ticket: pedidos > 0 ? total / pedidos : null,
    ticketComparado: pedidosComparados ? (totalComparado ?? 0) / pedidosComparados : null,
    melhorDia,
  };
}

/** a frase que diz com o que o gráfico está comparando */
export function fraseDaComparacao(c: DadosDoFaturamento["comparacao"]): string {
  if (!c.periodo) return "sem período para comparar";
  const de = rotuloDoDiaComAno(c.periodo.de);
  const ate = rotuloDoDiaComAno(c.periodo.ate);
  const datas = c.periodo.de === c.periodo.ate ? de : `${de} a ${ate}`;
  if (c.tipo === "anterior") return `período anterior · ${datas}`;
  if (c.tipo === "ano-passado") return `mesmo período do ano passado · ${datas}`;
  return `de ${datas}`;
}

/** "+12,5%" / "−8%" / "" — a variação como a tela escreve (vírgula, sinal sempre) */
export function textoDaVariacao(pct: number | null): string {
  if (pct == null) return "";
  const arredondado = Math.round(pct * 10) / 10;
  const abs = Math.abs(arredondado).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (arredondado > 0) return `+${abs}%`;
  if (arredondado < 0) return `−${abs}%`;
  return "0%";
}

/** o que a tela diz quando a busca do comparado falha (a régua da faixa "hoje", RN-088) */
export function avisoDaFalha(status: number | null): string {
  if (status === 401) return "sua sessão venceu — entre de novo em outra aba e tente de novo";
  if (status === 403 || status === 404) return "esta comparação não está disponível para você";
  if (status === 400) return "a data escolhida não serve — confira e tente de novo";
  return "sem conexão — mostrando a última comparação que deu certo";
}

export type ParametrosDoFaturamento = {
  periodo: Periodo;
  tipo: TipoDeComparacao;
  cmpDe: string | null;
};

/**
 * Lê os parâmetros da porta (e os que a tela monta): dias que existem, tipo
 * da lista, começo antes do fim, teto de dias. Torto → `null`, e a porta
 * responde 400 (nunca uma série da loja inteira disfarçada de resposta).
 */
export function lerParametros(q: {
  de?: string | null;
  ate?: string | null;
  tipo?: string | null;
  cmpDe?: string | null;
}): ParametrosDoFaturamento | null {
  if (!diaValido(q.de) || !diaValido(q.ate)) return null;
  if (numeroDoDia(q.ate) < numeroDoDia(q.de)) return null;
  const tipo = (q.tipo ?? "anterior") as TipoDeComparacao;
  if (!TIPOS_DE_COMPARACAO.includes(tipo)) return null;
  if (tipo === "personalizado" && !diaValido(q.cmpDe)) return null;
  return { periodo: { de: q.de, ate: q.ate }, tipo, cmpDe: tipo === "personalizado" ? q.cmpDe! : null };
}

/** o endereço da porta para estes parâmetros (a tela monta, o teste prende) */
export function enderecoDaPorta(p: ParametrosDoFaturamento): string {
  const params = new URLSearchParams({ de: p.periodo.de, ate: p.periodo.ate, tipo: p.tipo });
  if (p.cmpDe) params.set("cmpDe", p.cmpDe);
  return `/api/dashboard/faturamento?${params.toString()}`;
}
