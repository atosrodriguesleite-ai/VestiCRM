/**
 * DFC — a parte PURA (RN-035): nomes dos blocos, o formato do relatório e a
 * regra de qual bloco cada categoria pertence.
 *
 * Mora num arquivo só dela porque a TELA do DFC precisa dos rótulos, e a tela
 * roda no navegador: importar de `visao.ts` arrastaria o banco (`lib/db.ts`)
 * para o pacote do navegador — foi o defeito que derrubou o deploy de
 * 17/08/2026 e é o que o `navegador-sem-servidor.test.ts` guarda.
 */

export type GrupoDFC = "OPERACIONAL" | "INVESTIMENTO" | "FINANCIAMENTO";

export const DFC_LABEL: Record<GrupoDFC, string> = {
  OPERACIONAL: "Operacional — o dia a dia da loja",
  INVESTIMENTO: "Investimento — o que compramos para durar",
  FINANCIAMENTO: "Financiamento — empréstimos e sócios",
};

/**
 * Em qual bloco do DFC a categoria entra, pelo CÓDIGO da árvore padrão
 * (RN-029). O código é do sistema e o nome é da loja, então renomear a
 * categoria não quebra o relatório.
 *
 *   07.xx           → investimento (máquina, reforma: compra para durar)
 *   06.03 empréstimo e 05.04 retirada dos sócios → financiamento
 *   todo o resto    → operacional (a loja funcionando)
 *
 * Categoria criada pela loja (código fora da árvore) cai em OPERACIONAL, que
 * é onde 9 em cada 10 realmente pertencem — e é o palpite que menos mente.
 */
export function grupoDFCdoCodigo(codigo: string | null | undefined): GrupoDFC {
  if (!codigo) return "OPERACIONAL";
  if (codigo.startsWith("07")) return "INVESTIMENTO";
  if (codigo.startsWith("06.03") || codigo.startsWith("05.04"))
    return "FINANCIAMENTO";
  return "OPERACIONAL";
}

export type LinhaDFC = {
  grupo: GrupoDFC;
  categoria: string;
  entrou: number;
  saiu: number;
  resultado: number;
};

export type RelatorioDFC = {
  saldoInicial: number;
  saldoFinal: number;
  grupos: {
    grupo: GrupoDFC;
    entrou: number;
    saiu: number;
    resultado: number;
    linhas: LinhaDFC[];
  }[];
  geradoNoPeriodo: number;
  /** saldo inicial de conta cadastrada DENTRO do período (não é resultado) */
  saldosDeclarados: number;
  transferencias: number;
};
