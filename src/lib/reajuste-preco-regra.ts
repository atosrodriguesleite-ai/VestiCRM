/**
 * RN-056 · A CONTA do reajuste de preço em lote — parte PURA, sem banco.
 * A tela (`produtos/reajuste-preco.tsx`) importa DAQUI: o arquivo irmão
 * (`reajuste-preco.ts`) puxa o Prisma e não pode chegar ao navegador (guarda
 * `navegador-sem-servidor.test.ts`, incidente de 17/08/2026).
 */
import { donoDoPreco, NOME_DO_DONO, type DonoExterno } from "./estoque/dono-do-estoque";

export { donoDoPreco };

/**
 * REAJUSTE DE PREÇO EM LOTE, POR CATEGORIA (pedido do dono, 15/09/2026:
 * "alterar o preço em lote de toda categoria em específico, atacado e
 * varejo"). Antes o preço só mudava peça por peça, na ficha.
 *
 * As regras que decidem o que muda vivem AQUI, em função pura, para serem
 * conferidas por teste. A prévia da tela e o "aplicar" fazem a MESMA conta,
 * na hora, sobre o que está no banco — a tela nunca manda preço pronto.
 *
 *  • percentual (+10%, −5%) ou valor fixo (todas a R$ 89,90);
 *  • centavos: arredonda a 2 casas; nunca negativo;
 *  • preço ZERO não vira preço por percentual (10% de nada é nada, e a peça
 *    que nunca teve atacado não pode ganhar um por engano) — fica de fora e
 *    é CONTADA; valor fixo, sim, vale para ela;
 *  • peça do Jueri tem os DOIS preços lá — ficam de fora, com o motivo dito
 *    na prévia; peça da Nuvemshop tem o atacado daqui, e o VAREJO muda aqui
 *    E VAI PARA LÁ (RN-057) — a prévia diz quais vão.
 */
export type CampoDePreco = "atacado" | "varejo";
export type ModoDeReajuste = "percentual" | "fixo";

/** Percentual dentro do razoável: −90% a +500%. Fora disso é erro de digitação. */
export const PERCENTUAL_MIN = -90;
export const PERCENTUAL_MAX = 500;
/** Valor fixo: até R$ 100.000 por peça (atacado de moda não passa disso). */
export const VALOR_FIXO_MAX = 100_000;

export type ProdutoParaReajuste = {
  id: string;
  name: string;
  wholesalePrice: number;
  retailPrice: number;
  nuvemshopId: string | null;
  jueriId: string | null;
  variants: { nuvemshopId: string | null }[];
};

export type DonoDoPreco = DonoExterno | null;

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * O NÚMERO DO JEITO QUE A LOJISTA DIGITA: "1.299,90", "89,90", "-5", "−10"
 * (o sinal de menos "bonito" do teclado do celular). O `parseFloat` parava
 * no segundo ponto de "1.299.90" e gravava R$ 1,30 na categoria inteira
 * (achado da revisão, mesmo incidente do `numeroBR` do desconto). `NaN`
 * quando não dá para ler — a tela não deixa seguir.
 */
export function lerNumeroDigitado(texto: string): number {
  const limpo = texto.replace(/[\u2212\u2013]/g, "-").replace(/[^\d.,-]/g, "");
  if (!limpo) return NaN;
  const temVirgula = limpo.includes(",");
  // com vírgula, todo ponto é milhar; sem vírgula, o ponto só é milhar
  // quando vem seguido de exatamente três dígitos ("1.299" sim, "89.9" não)
  const semMilhar = temVirgula
    ? limpo.replace(/\./g, "")
    : limpo.replace(/\.(?=\d{3}(?:\D|$))/g, "");
  return Number(semMilhar.replace(",", "."));
}

/**
 * O preço novo de UM campo. `null` = não muda (percentual sobre zero).
 */
export function novoPreco(atual: number, modo: ModoDeReajuste, valor: number): number | null {
  if (modo === "fixo") return Math.max(0, centavos(valor));
  if (!(atual > 0)) return null;
  return Math.max(0, centavos(atual * (1 + valor / 100)));
}

export function validarReajuste(modo: ModoDeReajuste, valor: number): string | null {
  if (!Number.isFinite(valor)) return "Informe um número.";
  if (modo === "percentual") {
    if (valor === 0) return "Percentual zero não muda nada.";
    if (valor < PERCENTUAL_MIN || valor > PERCENTUAL_MAX)
      return `O percentual precisa ficar entre ${PERCENTUAL_MIN}% e +${PERCENTUAL_MAX}%.`;
    return null;
  }
  if (valor < 0) return "O preço não pode ser negativo.";
  if (valor > VALOR_FIXO_MAX) return "Valor alto demais para uma peça.";
  return null;
}

export type MudancaDeCampo = { de: number; para: number };
export type LinhaDoReajuste = {
  id: string;
  nome: string;
  atacado?: MudancaDeCampo;
  varejo?: MudancaDeCampo;
  /** RN-057: o varejo novo vai para a Nuvemshop também */
  espelhaVarejo?: boolean;
  /** por que algum campo ficou de fora, em português */
  avisos: string[];
};
export type ResumoDoReajuste = {
  /** produtos da categoria */
  total: number;
  /** produtos em que pelo menos um preço muda */
  alterados: number;
  /** campos que ficaram de fora por preço zero (percentual) */
  semPreco: number;
  /** campos que ficaram de fora porque o Jueri manda neles */
  presos: { jueri: number };
  /** preços de varejo que mudam aqui E vão para a Nuvemshop (RN-057) */
  espelhados: number;
};

/** Planeja o reajuste: o que muda, o que fica de fora e por quê. Puro. */
export function planejarReajuste(
  produtos: ProdutoParaReajuste[],
  campos: CampoDePreco[],
  modo: ModoDeReajuste,
  valor: number
): { linhas: LinhaDoReajuste[]; resumo: ResumoDoReajuste } {
  const resumo: ResumoDoReajuste = {
    total: produtos.length,
    alterados: 0,
    semPreco: 0,
    presos: { jueri: 0 },
    espelhados: 0,
  };
  const linhas: LinhaDoReajuste[] = [];
  for (const p of produtos) {
    const dono = donoDoPreco(p);
    const linha: LinhaDoReajuste = { id: p.id, nome: p.name, avisos: [] };
    for (const campo of campos) {
      const rotulo = campo === "atacado" ? "atacado" : "varejo";
      const quem = campo === "atacado" ? dono.atacado : dono.varejo;
      if (quem) {
        linha.avisos.push(`${rotulo}: é do ${NOME_DO_DONO[quem]}, muda lá`);
        resumo.presos.jueri++;
        continue;
      }
      const atual = campo === "atacado" ? p.wholesalePrice : p.retailPrice;
      const para = novoPreco(atual, modo, valor);
      if (para === null) {
        linha.avisos.push(`${rotulo}: sem preço cadastrado, fica de fora`);
        resumo.semPreco++;
        continue;
      }
      if (para === centavos(atual)) continue; // nada a fazer
      if (campo === "varejo" && dono.espelhaVarejo) {
        // zero iria para a loja online e a peça ficaria de graça lá
        // (achado da revisão): fica de fora, dito
        if (!(para > 0)) {
          linha.avisos.push("varejo: peça da Nuvemshop não pode ficar zerada, fica de fora");
          resumo.semPreco++;
          continue;
        }
        linha.espelhaVarejo = true;
        resumo.espelhados++;
      }
      linha[campo] = { de: atual, para };
    }
    if (linha.atacado || linha.varejo) resumo.alterados++;
    linhas.push(linha);
  }
  return { linhas, resumo };
}
