/**
 * EAN-13 — a conta e as barras, sem nada de banco (RN-059).
 *
 * O código de barras da variação nasce no banco (`ean13_interno`, gatilho da
 * migração 20260918100000) e aqui mora a MESMA conta em TypeScript, por dois
 * motivos: conferir o que o leitor bipou (dígito errado nem vai ao servidor)
 * e desenhar as barras na etiqueta (PDF e prévia). O script
 * `scripts/confere-codigo-de-barras.ts` prova que as duas contas concordam.
 *
 * Por que EAN-13 e não Code128 com o SKU: é o formato que TODO leitor de
 * loja lê de fábrica, a Zebra desenha nativo (`^BE`) e o número cabe numa
 * etiqueta de 30 mm. O prefixo 2 é a faixa de USO INTERNO do GS1 — nunca
 * colide com produto de supermercado.
 */

/** Dígito verificador dos 12 primeiros dígitos (posições ímpares pesam 1, pares pesam 3). */
export function digitoVerificadorEan13(doze: string): number {
  if (!/^\d{12}$/.test(doze)) throw new Error("EAN-13 precisa de 12 dígitos para calcular o verificador");
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    const d = doze.charCodeAt(i) - 48;
    soma += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (soma % 10)) % 10;
}

/** O mesmo código que o banco gera para o número N da sequência. */
export function ean13Interno(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99_999_999_999) throw new Error("número fora da faixa");
  const base = "2" + String(n).padStart(11, "0");
  return base + digitoVerificadorEan13(base);
}

/** É um EAN-13 válido (13 dígitos e verificador certo)? */
export function ean13Valido(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return false;
  return digitoVerificadorEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

/**
 * O que o leitor mandou vira código limpo: só dígitos, sem o Enter do
 * leitor, sem espaço. Devolve null quando não é um EAN-13 válido — a
 * separação (etapa 3) recusa sem ir ao servidor.
 */
export function lerCodigoBipado(entrada: string): string | null {
  const so = entrada.replace(/\D/g, "");
  return ean13Valido(so) ? so : null;
}

// Codificação das barras (padrão GS1): cada dígito vira 7 módulos. As três
// tabelas são as do padrão, ESCRITAS por extenso: a primeira versão derivava
// G como "L espelhado" e G é o espelho de R (achado da revisão, 18/09/2026)
// — toda etiqueta em PDF saía com barra que nenhum leitor lia. O teste
// confere as tabelas contra a relação do padrão (R = L invertido, G = R
// espelhado) e contra uma sequência conhecida.
export const TABELA_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
export const TABELA_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
export const TABELA_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const L = TABELA_L;
const G = TABELA_G;
const R = TABELA_R;
// o primeiro dígito escolhe a mistura L/G dos seis da esquerda
const PARIDADE = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Largura total em módulos, contando as zonas de silêncio (11 à esquerda, 7 à direita). */
export const MODULOS_EAN13 = 95;
export const SILENCIO_ESQ = 11;
export const SILENCIO_DIR = 7;
export const MODULOS_COM_SILENCIO = SILENCIO_ESQ + MODULOS_EAN13 + SILENCIO_DIR;

/**
 * As 95 barras do código como lista de 0/1 (1 = barra preta). As guardas
 * (início, meio, fim) são as que descem mais na etiqueta — quem desenha
 * recebe também quais posições são guarda, para alongá-las.
 */
export function modulosEan13(codigo: string): { bits: number[]; guarda: boolean[] } {
  if (!ean13Valido(codigo)) throw new Error("EAN-13 inválido");
  const bits: number[] = [];
  const guarda: boolean[] = [];
  const empurrar = (padrao: string, ehGuarda: boolean) => {
    for (const c of padrao) {
      bits.push(c === "1" ? 1 : 0);
      guarda.push(ehGuarda);
    }
  };
  const paridade = PARIDADE[Number(codigo[0])];
  empurrar("101", true);
  for (let i = 1; i <= 6; i++) {
    const d = Number(codigo[i]);
    empurrar(paridade[i - 1] === "L" ? L[d] : G[d], false);
  }
  empurrar("01010", true);
  for (let i = 7; i <= 12; i++) empurrar(R[Number(codigo[i])], false);
  empurrar("101", true);
  return { bits, guarda };
}

/**
 * Barras prontas para desenhar: retângulos em milímetros a partir do canto
 * esquerdo da ÁREA do código (já com a zona de silêncio). Junta módulos
 * vizinhos num retângulo só (menos objetos no PDF).
 */
export function barrasEan13(
  codigo: string,
  larguraMm: number,
  alturaMm: number
): { x: number; w: number; h: number }[] {
  const { bits, guarda } = modulosEan13(codigo);
  const modulo = larguraMm / MODULOS_COM_SILENCIO;
  const saida: { x: number; w: number; h: number }[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === 0) {
      i++;
      continue;
    }
    const ini = i;
    const ehGuarda = guarda[i];
    while (i < bits.length && bits[i] === 1 && guarda[i] === ehGuarda) i++;
    saida.push({
      x: (SILENCIO_ESQ + ini) * modulo,
      w: (i - ini) * modulo,
      // guarda desce ~5% a mais, como no padrão (é o que o olho reconhece)
      h: ehGuarda ? alturaMm : alturaMm * 0.92,
    });
  }
  return saida;
}
