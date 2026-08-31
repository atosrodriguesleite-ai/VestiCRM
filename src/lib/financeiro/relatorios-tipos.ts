/**
 * DRE e Fluxo de Caixa — a parte PURA (RN-034): os blocos, os rótulos e a
 * regra de em qual linha do DRE cada categoria entra.
 *
 * Fica separada do motor porque as telas rodam no navegador e não podem
 * arrastar o banco junto (`navegador-sem-servidor.test.ts`).
 */

export type BlocoDRE =
  | "RECEITA"
  | "CUSTO"
  | "DESPESA_VENDAS"
  | "DESPESA_ADMIN"
  | "DESPESA_FINANCEIRA";

export const DRE_LABEL: Record<BlocoDRE, string> = {
  RECEITA: "Receitas",
  CUSTO: "Custo da mercadoria vendida",
  DESPESA_VENDAS: "Despesas com vendas",
  DESPESA_ADMIN: "Despesas administrativas",
  DESPESA_FINANCEIRA: "Despesas financeiras",
};

/**
 * Em qual linha do DRE a categoria entra, pelo CÓDIGO da árvore padrão
 * (RN-027) — o código é do sistema e o nome é da loja, então renomear não
 * quebra o relatório.
 *
 *   01, 02  → receita          03 → custo da mercadoria
 *   04      → despesa de venda 05 → administrativa    06 → financeira
 *   07      → FORA: investimento não é despesa do mês. Comprar uma máquina
 *             de R$ 8.000 não é prejuízo — é dinheiro que virou máquina, e
 *             somá-lo aqui faria um mês bom parecer desastre. Ele aparece no
 *             DFC (RN-033), que é a conta do dinheiro, não a do resultado.
 *
 * Categoria criada pela loja (código fora da árvore) entra pelo TIPO: receita
 * vira receita, despesa vira administrativa — que é onde a maioria pertence.
 */
export function blocoDREdoCodigo(
  codigo: string | null | undefined,
  tipo: "RECEITA" | "DESPESA"
): BlocoDRE | null {
  // o TIPO manda antes do código: a loja pode ter criado uma categoria de
  // RECEITA que ficou com o código "07" (o servidor numera na ordem), e
  // tratá-la como investimento tiraria a venda da linha de receitas
  if (tipo === "RECEITA") return "RECEITA";
  if (codigo?.startsWith("07")) return null; // investimento fica fora
  if (codigo?.startsWith("03")) return "CUSTO";
  if (codigo?.startsWith("04")) return "DESPESA_VENDAS";
  if (codigo?.startsWith("06")) return "DESPESA_FINANCEIRA";
  return "DESPESA_ADMIN";
}

export type LinhaRelatorio = {
  chave: string;
  rotulo: string;
  /** valor de cada mês, na ordem de `meses` */
  meses: number[];
  total: number;
};

export type BlocoRelatorio = {
  bloco: BlocoDRE;
  linhas: LinhaRelatorio[];
  meses: number[];
  total: number;
};

export type RelatorioDRE = {
  /** "2026-09" na ordem em que aparecem nas colunas */
  meses: string[];
  /** o teto de leitura estourou: a tela DIZ antes de a lojista concluir */
  truncado: boolean;
  blocos: BlocoRelatorio[];
  receita: number[];
  custo: number[];
  lucroBruto: number[];
  despesas: number[];
  resultado: number[];
  /** investimento do período — fora do resultado, mas DITO na tela */
  investimento: number[];
  totais: {
    receita: number;
    custo: number;
    lucroBruto: number;
    despesas: number;
    resultado: number;
    investimento: number;
  };
};

/* ---- fluxo de caixa ----------------------------------------------------- */

export type AgrupamentoFluxo = "categoria" | "cliente" | "fornecedor" | "colecao";

export const AGRUPAMENTO_LABEL: Record<AgrupamentoFluxo, string> = {
  categoria: "Categoria",
  cliente: "Cliente",
  fornecedor: "Fornecedor",
  colecao: "Coleção",
};

export type ModoFluxo = "realizado" | "previsto" | "misto";

export const MODO_FLUXO_LABEL: Record<ModoFluxo, string> = {
  realizado: "Só o que já entrou e saiu",
  previsto: "Só o que está previsto",
  misto: "Fechado até hoje, previsto daqui para frente",
};

export type RelatorioFluxo = {
  meses: string[];
  entradas: LinhaRelatorio[];
  saidas: LinhaRelatorio[];
  totalEntradas: number[];
  totalSaidas: number[];
  geracao: number[];
  /** saldo inicial de conta cadastrada DENTRO do mês (não é receita) */
  aberturas: number[];
  /** transferência que entrou/saiu no mês (RN-030): net zero na mesma janela */
  transito: number[];
  saldoInicial: number[];
  saldoFinal: number[];
  /**
   * O recorte "só previsto" NÃO tem saldo: partir do saldo real e somar só
   * previsão daria um número que não é nem saldo nem projeção.
   */
  mostraSaldo: boolean;
  /** mês em que o realizado vira previsto (no modo misto) */
  mesDeCorte: string | null;
  truncado: boolean;
  /** o teto que estourou, para a tela dizer o que fazer */
  motivoDoCorte: "periodo" | "atrasado" | null;
};

/**
 * Em qual coluna o PREVISTO de uma parcela entra — ou `null` quando aquele
 * recorte não mostra previsão para o mês dela.
 *
 * A conta ATRASADA não some: ela venceu no passado, mas o dinheiro ainda vai
 * andar, e o mês em que a loja vai correr atrás é o corrente (mesma régua do
 * saldo previsto, RN-033). Previsto em mês já fechado inventaria dinheiro que
 * se sabe que não entrou.
 */
export function mesDoPrevisto(
  mesVencimento: string,
  mesDeHoje: string,
  modo: ModoFluxo
): string | null {
  if (modo === "realizado") return null;
  if (modo === "previsto") return mesVencimento;
  return mesVencimento < mesDeHoje ? mesDeHoje : mesVencimento;
}

/**
 * O saldo mês a mês: começa no saldo REAL da loja e cada mês termina onde o
 * seguinte começa. Além do que a loja gerou, entram as duas coisas que mexem
 * no saldo sem serem receita nem despesa (RN-030): conta cadastrada com saldo
 * dentro do período e transferência em trânsito (saiu num mês, caiu no
 * outro). Sem elas, "saldo no fim" não bate com o extrato.
 */
export function acumularSaldo(
  saldoAntes: number,
  geracao: number[],
  aberturas: number[],
  transito: number[]
): { saldoInicial: number[]; saldoFinal: number[] } {
  const cent = (v: number) => Math.round(v * 100) / 100;
  const saldoInicial: number[] = [];
  const saldoFinal: number[] = [];
  let acumulado = saldoAntes;
  for (let i = 0; i < geracao.length; i++) {
    saldoInicial.push(cent(acumulado));
    acumulado = cent(
      acumulado + geracao[i] + (aberturas[i] ?? 0) + (transito[i] ?? 0)
    );
    saldoFinal.push(acumulado);
  }
  return { saldoInicial, saldoFinal };
}

/** "2026-09" → "set/2026" (a coluna do relatório precisa caber). */
export function rotuloDoMes(mes: string): string {
  const nomes = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  const [ano, m] = mes.split("-");
  return `${nomes[Number(m) - 1]}/${ano}`;
}

/** Os meses entre duas pontas, inclusive: ["2026-07", "2026-08", "2026-09"]. */
export function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = [];
  let [ano, mes] = de.split("-").map(Number);
  const [anoFim, mesFim] = ate.split("-").map(Number);
  // teto de 24 colunas: relatório de 10 anos não cabe na tela nem na memória
  while ((ano < anoFim || (ano === anoFim && mes <= mesFim)) && meses.length < 24) {
    meses.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}
