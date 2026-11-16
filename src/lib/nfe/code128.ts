/**
 * CÓDIGO DE BARRAS DA CHAVE DE ACESSO — Code 128, conjunto C (RN-111).
 *
 * A chave da NF-e tem 44 dígitos, e o conjunto C do Code 128 escreve DOIS
 * dígitos por símbolo: 22 símbolos, mais o de início, o de conferência e o de
 * parada. É o padrão que o DANFE usa e que todo leitor de transportadora lê.
 *
 * Função pura, sem PDF: devolve as LARGURAS (em módulos) de barra, espaço,
 * barra, espaço… — quem desenha só multiplica pela largura do módulo. Assim
 * dá para conferir o código sem abrir arquivo nenhum, e o teste confere contra
 * um leitor de verdade.
 */

/**
 * Os 107 padrões do Code 128 (valores 0 a 105 e a parada). Cada dígito é a
 * largura, em módulos, de barra/espaço alternados, começando por BARRA. Todo
 * símbolo soma 11 módulos; a parada soma 13.
 */
const PADROES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
] as const;

const INICIO_C = 105;
const PARADA = 106;

/**
 * Os VALORES dos símbolos, na ordem em que são impressos: início C, um valor
 * por par de dígitos, o de conferência e a parada. `null` quando o texto não
 * é uma sequência de dígitos de tamanho par (o conjunto C só escreve pares).
 */
export function simbolosCode128C(digitos: string): number[] | null {
  if (!/^\d+$/.test(digitos) || digitos.length % 2 !== 0) return null;
  const valores: number[] = [];
  for (let i = 0; i < digitos.length; i += 2) valores.push(Number(digitos.slice(i, i + 2)));
  // conferência: início + Σ (posição × valor), posição começando em 1
  let soma = INICIO_C;
  valores.forEach((v, i) => {
    soma += (i + 1) * v;
  });
  return [INICIO_C, ...valores, soma % 103, PARADA];
}

/**
 * As larguras, em módulos, alternando BARRA, espaço, barra… (a primeira e a
 * última são sempre barra). `null` para texto que o conjunto C não escreve.
 */
export function barrasCode128C(digitos: string): number[] | null {
  const simbolos = simbolosCode128C(digitos);
  if (!simbolos) return null;
  const larguras: number[] = [];
  for (const s of simbolos) for (const d of PADROES[s]) larguras.push(Number(d));
  return larguras;
}

/** Quantos módulos o código ocupa (sem a margem clara dos lados). */
export function modulosCode128C(digitos: string): number {
  return (barrasCode128C(digitos) ?? []).reduce((a, b) => a + b, 0);
}

/** A tabela, só para o teste conferir que nenhum padrão foi digitado torto. */
export const PADROES_CODE128: readonly string[] = PADROES;
