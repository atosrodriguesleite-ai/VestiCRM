/**
 * A GRADE DE PEÇAS DO PEDIDO — a regra pura por trás do montador de pedido
 * da tela Pedidos ("Novo pedido").
 *
 * Pedido do dono (20/09/2026, com print do celular): *"quando eu vou montar
 * um pedido para o cliente no celular ou no computador, queria uma forma
 * mais funcional e prática, pensando na experiência"*. O print mostrava
 * QUATRO resultados chamados "Baby Look" com o mesmo preço — só o SKU
 * mudava — e não dava para saber qual era qual.
 *
 * O montador antigo pedia UMA variação por vez: buscar → tocar no produto →
 * tocar numa cor/tamanho → entrava 1 peça, a busca FECHAVA e o termo era
 * apagado. Para vender a grade inteira de um modelo (3 cores × 3 tamanhos)
 * eram 9 idas e 9 vezes digitando "baby look". No atacado, que vende grade,
 * era o caminho mais longo possível para o pedido mais comum.
 *
 * A forma como a lojista PENSA é a grade: linhas = cor, colunas = tamanho,
 * e ela preenche as quantidades ("3 preta M, 5 café M"). É isso que este
 * arquivo modela. A conta de DINHEIRO não muda de dono: quem diz o preço
 * continua sendo quem chama (`precoSugeridoNoPedido`, RN-041), passado aqui
 * como função — a grade nunca inventa preço.
 */

import { compararTamanhos } from "./tamanhos";

export type VariacaoDaGrade = {
  id: string;
  color: string | null;
  size: string | null;
  stock: number;
};

export type LinhaDoPedido = {
  productId: string;
  variantId: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  stock: number;
};

const alfab = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

/** O rótulo que a tela mostra quando a peça não tem cor ou tamanho cadastrado. */
export const SEM_COR = "Cor única";
export const SEM_TAMANHO = "Único";

export const rotuloCor = (cor: string | null | undefined) => (cor ?? "").trim() || SEM_COR;
export const rotuloTamanho = (t: string | null | undefined) => (t ?? "").trim() || SEM_TAMANHO;

/** Chave de uma célula da grade (cor × tamanho). */
export const chaveDaCelula = (cor: string, tamanho: string) => `${cor}\u0000${tamanho}`;

export type Grade = {
  /** linhas da grade, na ordem alfabética da cor */
  cores: string[];
  /** colunas, na ordem da arara (PP < P < M < G…, RN dos tamanhos) */
  tamanhos: string[];
  /** a variação de cada cruzamento; ausente = a loja não cadastrou essa combinação */
  celulas: Map<string, VariacaoDaGrade>;
};

/**
 * Monta a grade a partir das variações da peça. Cor vira LINHA e tamanho
 * vira COLUNA porque é assim que a arara e a planilha da confecção são
 * lidas. Cruzamento que a loja não cadastrou fica VAZIO (não é zero: é
 * "não existe"), senão a tela ofereceria uma peça que não há como separar.
 */
export function montarGrade(variantes: readonly VariacaoDaGrade[]): Grade {
  const celulas = new Map<string, VariacaoDaGrade>();
  const cores: string[] = [];
  const tamanhos: string[] = [];
  for (const v of variantes) {
    const cor = rotuloCor(v.color);
    const tamanho = rotuloTamanho(v.size);
    if (!cores.includes(cor)) cores.push(cor);
    if (!tamanhos.includes(tamanho)) tamanhos.push(tamanho);
    // a PRIMEIRA variação de cada cruzamento vence: duas linhas com a mesma
    // cor e tamanho (cadastro duplicado) não viram duas células, senão a
    // segunda escondia a primeira e a peça bipada não bateria com o pedido
    const chave = chaveDaCelula(cor, tamanho);
    if (!celulas.has(chave)) celulas.set(chave, v);
  }
  return {
    cores: cores.sort(alfab),
    tamanhos: tamanhos.sort(compararTamanhos),
    celulas,
  };
}

/** O que está no pedido AGORA para cada variação daquela peça (abre a grade preenchida). */
export function quantidadesNoPedido(linhas: readonly LinhaDoPedido[], productId: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    if (l.productId !== productId) continue;
    mapa.set(l.variantId, (mapa.get(l.variantId) ?? 0) + l.quantity);
  }
  return mapa;
}

/** Quantas peças daquele produto já estão no pedido (o selo "N no pedido" do resultado da busca). */
export function pecasNoPedido(linhas: readonly LinhaDoPedido[], productId: string): number {
  return linhas.reduce((s, l) => (l.productId === productId ? s + l.quantity : s), 0);
}

export type ResumoDaGrade = { pecas: number; valor: number; variacoes: number };

/**
 * O preço que o CABEÇALHO da grade pode afirmar.
 *
 * Onde o preço depende da quantidade (`unitPriceFor` da Central vira atacado
 * a partir do mínimo do modelo), cada célula tem o SEU: uma grade de 2+2+2
 * com mínimo 6 sai a varejo nas três linhas, mesmo somando seis peças.
 * Anunciar no topo o preço do TOTAL dizia "R$ 30 · atacado" com o pedido
 * nascendo a R$ 40 — mentira sobre dinheiro (achado da revisão). Então: sem
 * nada preenchido vale o preço de UMA peça (o "a partir de"); preenchido,
 * vale o que as células de fato cobram — e quando elas divergem, a faixa,
 * nunca um número só.
 */
export function precoDoCabecalho(
  quantidades: ReadonlyMap<string, number>,
  precoUnitario: (quantidadeDaCelula: number) => number
): { min: number; max: number } {
  const precos: number[] = [];
  for (const [, qtd] of quantidades) {
    const q = Math.max(0, Math.floor(qtd));
    if (q > 0) precos.push(precoUnitario(q));
  }
  if (precos.length === 0) {
    const base = precoUnitario(1);
    return { min: base, max: base };
  }
  return { min: Math.min(...precos), max: Math.max(...precos) };
}

/**
 * Quantas peças e quanto dá o que está preenchido na grade. O preço vem de
 * QUEM CHAMA (`precoUnitario`), com a quantidade DAQUELA célula — é a mesma
 * conta que o montador antigo fazia ao adicionar uma variação com N peças,
 * então nenhum preço muda de valor por causa da grade nova.
 */
export function resumoDaGrade(
  quantidades: ReadonlyMap<string, number>,
  precoUnitario: (quantidadeDaCelula: number) => number
): ResumoDaGrade {
  let pecas = 0;
  let valor = 0;
  let variacoes = 0;
  for (const [, qtd] of quantidades) {
    const q = Math.max(0, Math.floor(qtd));
    if (q <= 0) continue;
    pecas += q;
    variacoes += 1;
    valor += q * precoUnitario(q);
  }
  return { pecas, valor, variacoes };
}

/**
 * Aplica no pedido o que a lojista preencheu na grade de UMA peça.
 *
 * Três decisões que protegem dinheiro e trabalho já feito:
 *
 * 1. **A grade SUBSTITUI o que era daquela peça**, não soma — ela abre
 *    preenchida com o que já está no pedido, então somar faria "3" virar
 *    "6" só por abrir e confirmar.
 * 2. **Preço editado à mão NÃO é reescrito** (`unitPrice` da linha que já
 *    existe): a lojista que combinou R$ 30 numa linha e depois volta na
 *    grade para acrescentar um tamanho não pode ver o desconto sumir. Só
 *    célula NOVA nasce com o preço sugerido.
 * 3. **A ordem do pedido é preservada**: as linhas que ficam seguem onde
 *    estavam e as novas entram no fim, senão a lista se reorganizava a cada
 *    ida à grade e a lojista perdia o lugar ao conferir.
 *
 * Célula zerada SAI do pedido (é como se remove pela grade).
 *
 * A decisão 2 vale para a tela em que a lojista DIGITA preço (a tela
 * Pedidos). Onde o preço não é editável e sobe/desce com a quantidade — o
 * montador da Central de WhatsApp, cujo `unitPriceFor` vira atacado a partir
 * do mínimo do modelo — preservar seria congelar o varejo numa linha que
 * cresceu: ali quem chama pede `"recalcular"`, que é exatamente o que o
 * montador antigo fazia ao somar peças numa variação já no carrinho.
 */
export type PrecoDasLinhasExistentes = "preservar" | "recalcular";

export function aplicarGradeNoPedido(
  linhas: readonly LinhaDoPedido[],
  produto: { id: string; name: string },
  variantes: readonly VariacaoDaGrade[],
  quantidades: ReadonlyMap<string, number>,
  precoSugerido: (quantidadeDaCelula: number) => number,
  precoDasExistentes: PrecoDasLinhasExistentes = "preservar"
): LinhaDoPedido[] {
  const porId = new Map(variantes.map((v) => [v.id, v]));
  const usados = new Set<string>();

  const resultado: LinhaDoPedido[] = [];
  for (const linha of linhas) {
    if (linha.productId !== produto.id) {
      resultado.push(linha);
      continue;
    }
    const q = Math.max(0, Math.floor(quantidades.get(linha.variantId) ?? 0));
    usados.add(linha.variantId);
    if (q <= 0) continue; // zerou na grade: sai do pedido
    const v = porId.get(linha.variantId);
    resultado.push({
      ...linha,
      quantity: q,
      unitPrice: precoDasExistentes === "recalcular" ? precoSugerido(q) : linha.unitPrice,
      // o estoque acompanha a leitura mais nova (a grade acabou de vir do servidor)
      stock: v ? v.stock : linha.stock,
    });
  }

  // células novas entram no fim, na ordem da grade (cor, depois tamanho).
  // Aqui é sempre peça NOVA — quem já estava no pedido saiu no laço de cima,
  // com o preço dela preservado —, então o preço vem do sugerido.
  for (const v of variantes) {
    if (usados.has(v.id)) continue;
    const q = Math.max(0, Math.floor(quantidades.get(v.id) ?? 0));
    if (q <= 0) continue;
    resultado.push({
      productId: produto.id,
      variantId: v.id,
      name: produto.name,
      color: rotuloCor(v.color),
      size: rotuloTamanho(v.size),
      quantity: q,
      unitPrice: precoSugerido(q),
      stock: v.stock,
    });
  }
  return resultado;
}

export type GrupoDoPedido = {
  productId: string;
  name: string;
  linhas: LinhaDoPedido[];
  pecas: number;
  valor: number;
  /** o preço quando TODAS as linhas da peça cobram o mesmo; null quando divergem */
  precoUnico: number | null;
};

/**
 * Agrupa o pedido por PEÇA para a conferência. No atacado a lojista pensa
 * por modelo ("a baby look saiu a 34"), não por cor × tamanho: mostrar nove
 * linhas com o mesmo preço nove vezes é o que faz ela desistir de conferir
 * no celular. Preço divergente entre as variações do mesmo modelo é dito
 * (`precoUnico` nulo) em vez de escondido atrás de um número qualquer.
 */
export function agruparPorProduto(linhas: readonly LinhaDoPedido[]): GrupoDoPedido[] {
  const grupos: GrupoDoPedido[] = [];
  const porId = new Map<string, GrupoDoPedido>();
  for (const l of linhas) {
    let g = porId.get(l.productId);
    if (!g) {
      g = { productId: l.productId, name: l.name, linhas: [], pecas: 0, valor: 0, precoUnico: null };
      porId.set(l.productId, g);
      grupos.push(g);
    }
    g.linhas.push(l);
    g.pecas += l.quantity;
    g.valor += l.quantity * l.unitPrice;
  }
  for (const g of grupos) {
    const primeiro = g.linhas[0].unitPrice;
    g.precoUnico = g.linhas.every((l) => l.unitPrice === primeiro) ? primeiro : null;
  }
  return grupos;
}

/** Troca o preço de TODAS as variações de uma peça (a edição por modelo da conferência). */
export function aplicarPrecoNoProduto(
  linhas: readonly LinhaDoPedido[],
  productId: string,
  preco: number
): LinhaDoPedido[] {
  const valor = Math.max(0, preco);
  return linhas.map((l) => (l.productId === productId ? { ...l, unitPrice: valor } : l));
}

/**
 * O QUE A PESSOA DIGITOU NUMA CÉLULA, já no limite do que existe.
 *
 * A porta de criação do pedido RECUSA o pedido inteiro quando falta estoque
 * (`POST /api/orders`: "Estoque insuficiente de X (Cor Tam): restam N",
 * 409) — a reserva da RN-003 só pode segurar o que está lá. Então a grade
 * NÃO PODE OFERECER o que o servidor vai recusar: digitar 12 com 2 na arara
 * fecharia a tela num beco, com a lojista descobrindo só no último clique.
 * O número para no estoque e a célula DIZ que parou (achado da revisão).
 */
export function quantidadeDigitada(texto: string, estoque: number): string {
  const limpo = texto.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 4);
  if (!limpo) return "";
  const n = parseInt(limpo, 10);
  const teto = Math.max(0, Math.floor(estoque));
  return n > teto ? String(teto) : limpo;
}

/**
 * "3 de cada tamanho": repete o primeiro número da linha nas células VAZIAS
 * dela. Só nas vazias — sobrescrever o que já foi digitado apagaria o
 * trabalho da lojista sem desfazer (achado da revisão), e o atalho serve
 * justamente para quem começou a preencher.
 */
export function repetirNaLinha(
  textos: Readonly<Record<string, string>>,
  celulas: readonly VariacaoDaGrade[]
): Record<string, string> {
  const modelo = celulas.find((v) => (parseInt(textos[v.id] ?? "", 10) || 0) > 0);
  if (!modelo) return { ...textos };
  const valor = textos[modelo.id];
  const novo = { ...textos };
  for (const v of celulas) {
    if ((parseInt(novo[v.id] ?? "", 10) || 0) > 0) continue;
    if (v.stock <= 0) continue;
    novo[v.id] = quantidadeDigitada(valor, v.stock);
  }
  return novo;
}

/**
 * Rede de segurança: linha pedida acima do estoque. A grade já trava no
 * teto, mas o estoque pode ter caído entre abrir a grade e fechar o pedido
 * (a loja online vendeu no meio) — aí a tela avisa ANTES do clique, com a
 * verdade: o servidor vai recusar.
 */
export function pecasAcimaDoEstoque(linhas: readonly LinhaDoPedido[]): LinhaDoPedido[] {
  return linhas.filter((l) => l.quantity > l.stock);
}
