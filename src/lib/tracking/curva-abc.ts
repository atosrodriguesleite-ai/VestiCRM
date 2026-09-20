/**
 * CURVA ABC POR PEÇA (RN-061) — regra PURA, sem banco.
 *
 * Pedido do dono (20/09/2026): "quero entender quais produtos mais vendem,
 * peça por peça — regata alça preta M — e a quantidade em UNIDADES". A tela
 * Inteligência já dizia qual COR e qual CATEGORIA mais saem; aqui a linha é
 * a variação exata (produto × cor × tamanho), que é o que se repõe, corta e
 * separa.
 *
 * A curva: as linhas ordenadas da que mais vende para a que menos vende e o
 * acumulado percorrido de cima para baixo — **A** são as que, juntas,
 * fecham 80% (do que a loja escolheu medir: unidades ou faturamento; a que
 * faz a curva cruzar os 80% ainda é A), **B** as que levam até 95% e **C**
 * o resto. A classe é UMA por peça e vale para
 * a base escolhida — por unidades (o padrão, pedido do dono) ou por
 * faturamento (a mesma peça pode ser A em unidade e B em dinheiro, e a tela
 * diz qual está olhando).
 */

import { chaveDoNome, r2 } from "./insights-puro";

export type BaseAbc = "unidades" | "faturamento";
export type ClasseAbc = "A" | "B" | "C";

export type ItemVendido = {
  variantId: string | null;
  /** o produto de que a variação faz parte (fica mesmo quando a variação é apagada — SetNull só nela) */
  productId: string | null;
  /** nome do produto, cor e tamanho DA ÉPOCA (congelados no item do pedido) */
  nome: string;
  cor: string | null;
  tamanho: string | null;
  quantidade: number;
  /** o que o item vendeu de verdade (fatia do netTotal, RN-002) */
  valorVendido: number;
  /**
   * O cadastro de HOJE, no que ainda existe: o nome do PRODUTO (quando ele
   * ainda existe) e a cor/tamanho da VARIAÇÃO (quando ela ainda existe).
   * O que existe manda no rótulo; o que sumiu cai no congelado do item.
   */
  atual?: { produto?: string; cor?: string; tamanho?: string };
};

export type LinhaAbc = {
  chave: string;
  produto: string;
  cor: string;
  tamanho: string;
  /** "Regata Alça · Preta · M" */
  rotulo: string;
  unidades: number;
  faturamento: number;
  /** parte desta linha na base escolhida, em % */
  parte: number;
  /** acumulado até esta linha, em % */
  acumulado: number;
  classe: ClasseAbc;
};

export type ResumoAbc = Record<ClasseAbc, { itens: number; unidades: number; faturamento: number; parteItens: number; parteBase: number }>;

/** Cortes clássicos da curva: A fecha 80%, B vai até 95%, C é o resto. */
export const CORTE_A = 80;
export const CORTE_B = 95;

/**
 * A classe olha o acumulado ANTES da linha: a peça que faz a curva CRUZAR os
 * 80% ainda é A (é ela que fecha o bloco) — olhando o acumulado depois, uma
 * loja em que a peça campeã sozinha faz 90% das vendas não teria nenhuma A.
 * A folga é um EPSILON de ponto flutuante, não arredondamento: arredondar a
 * duas casas levava 79,996% a 80,00 e jogava para B justamente a peça que
 * cruza a linha (achado da revisão).
 */
const FOLGA = 1e-9;
function classeDo(acumuladoAntes: number): ClasseAbc {
  if (acumuladoAntes < CORTE_A - FOLGA) return "A";
  if (acumuladoAntes < CORTE_B - FOLGA) return "B";
  return "C";
}

/**
 * Agrupa por PEÇA, soma unidades e faturamento, ordena e classifica.
 *
 * A chave da peça é PRODUTO × cor × tamanho — o produto pelo id (renomear
 * não divide a linha), cor e tamanho pelo cadastro de hoje quando a variação
 * ainda existe e pelo congelado do item quando não. Agrupar pela VARIAÇÃO
 * (id) foi a primeira versão e a revisão achou o buraco: a variação apagada e
 * recriada com a mesma cor e tamanho (a lojista refaz a grade) deixava os
 * itens antigos sem `variantId` (SetNull) e a MESMA peça virava duas linhas
 * — uma com o nome de hoje, outra com o congelado. Pelo produto, as duas são
 * uma. Sem produto (apagado do cadastro) vale o nome × cor × tamanho da
 * época, normalizados — dois "Preto " com espaço não viram duas linhas.
 */
export function montarCurvaAbc(
  itens: ItemVendido[],
  base: BaseAbc = "unidades"
): { linhas: LinhaAbc[]; resumo: ResumoAbc; totalUnidades: number; totalFaturamento: number } {
  const grupos = new Map<string, LinhaAbc>();
  for (const it of itens) {
    const q = Math.max(0, Math.floor(it.quantidade));
    if (q <= 0) continue;
    const atual = it.atual;
    const produto = chaveDoNome(atual?.produto ?? it.nome) || "Sem nome";
    const cor = chaveDoNome(atual?.cor ?? it.cor ?? "") || "Sem cor";
    const tamanho = chaveDoNome(atual?.tamanho ?? it.tamanho ?? "") || "Sem tamanho";
    const grade = `${cor}|${tamanho}`.toLowerCase();
    const chave = it.productId
      ? `p:${it.productId}|${grade}`
      : it.variantId
        ? `v:${it.variantId}`
        : `n:${produto.toLowerCase()}|${grade}`;
    const linha = grupos.get(chave) ?? {
      chave,
      produto,
      cor,
      tamanho,
      rotulo: `${produto} · ${cor} · ${tamanho}`,
      unidades: 0,
      faturamento: 0,
      parte: 0,
      acumulado: 0,
      classe: "C" as ClasseAbc,
    };
    linha.unidades += q;
    // rateio NEGATIVO (desconto acima do subtotal) não entra: faria o
    // acumulado passar de 100 escondido pelo teto (achado da revisão)
    linha.faturamento += Math.max(0, it.valorVendido);
    grupos.set(chave, linha);
  }
  const linhas = [...grupos.values()];
  const totalUnidades = linhas.reduce((s, l) => s + l.unidades, 0);
  const totalFaturamento = r2(linhas.reduce((s, l) => s + l.faturamento, 0));
  const medida = (l: LinhaAbc) => (base === "unidades" ? l.unidades : l.faturamento);
  const outra = (l: LinhaAbc) => (base === "unidades" ? l.faturamento : l.unidades);
  linhas.sort((a, b) => medida(b) - medida(a) || outra(b) - outra(a) || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const totalBase = base === "unidades" ? totalUnidades : totalFaturamento;
  const resumo: ResumoAbc = {
    A: { itens: 0, unidades: 0, faturamento: 0, parteItens: 0, parteBase: 0 },
    B: { itens: 0, unidades: 0, faturamento: 0, parteItens: 0, parteBase: 0 },
    C: { itens: 0, unidades: 0, faturamento: 0, parteItens: 0, parteBase: 0 },
  };
  let acumulado = 0;
  for (const l of linhas) {
    const parte = totalBase > 0 ? (medida(l) / totalBase) * 100 : 0;
    // sem base (todo mundo faturou zero, ou nada vendido) NÃO existe A:
    // "A" é quem carrega a loja, e aqui ninguém carregou — tudo é C
    l.classe = totalBase > 0 ? classeDo(acumulado) : "C";
    acumulado += parte;
    l.parte = r2(parte);
    // o teto em 100 só apara o fio do ponto flutuante no fim da lista
    l.acumulado = r2(Math.min(100, acumulado));
    // o resumo soma o valor CRU da linha (antes do arredondamento): somar as
    // linhas já arredondadas fazia A + B + C divergir do total por centavos
    // (achado da revisão)
    const r = resumo[l.classe];
    r.itens += 1;
    r.unidades += l.unidades;
    r.faturamento += l.faturamento;
    l.faturamento = r2(l.faturamento);
  }
  // arredonda cada classe uma vez e a ÚLTIMA classe com peça leva a sobra do
  // centavo (a régua da RN-030: 33,33 + 33,33 + 33,34) — A + B + C fecha
  // EXATAMENTE com o total, que é o número que a tela mostra ao lado
  let somaClasses = 0;
  let ultimaComPeca: ClasseAbc | null = null;
  for (const c of ["A", "B", "C"] as const) {
    const r = resumo[c];
    r.faturamento = r2(r.faturamento);
    somaClasses = r2(somaClasses + r.faturamento);
    if (r.itens > 0) ultimaComPeca = c;
    r.parteItens = linhas.length > 0 ? r2((r.itens / linhas.length) * 100) : 0;
  }
  if (ultimaComPeca) resumo[ultimaComPeca].faturamento = r2(resumo[ultimaComPeca].faturamento + (totalFaturamento - somaClasses));
  for (const c of ["A", "B", "C"] as const) {
    const r = resumo[c];
    const daBase = base === "unidades" ? r.unidades : r.faturamento;
    r.parteBase = totalBase > 0 ? r2((daBase / totalBase) * 100) : 0;
  }
  return { linhas, resumo, totalUnidades, totalFaturamento };
}

/** A base pedida na URL, com o padrão do dono (unidades). */
export function lerBaseAbc(v: string | undefined): BaseAbc {
  return v === "faturamento" ? "faturamento" : "unidades";
}
