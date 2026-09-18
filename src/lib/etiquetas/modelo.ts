/**
 * O MODELO DA ETIQUETA — regra pura, sem banco (RN-059).
 *
 * Uma etiqueta é uma lista de ELEMENTOS posicionados em milímetros dentro de
 * uma área (largura × altura). Três desenhadores leem a MESMA lista: o ZPL
 * (Zebra), o PDF (qualquer impressora pelo driver) e o SVG (prévia na tela).
 * Assim o que a lojista vê na prévia é o que sai na impressora, e o editor
 * de modelos (etapa 4) só precisa mexer nesta lista.
 *
 * Nesta etapa a loja não desenha: escolhe tamanho e quais campos mostrar
 * (`OpcoesEmbalagem`), e `layoutEmbalagem` monta a lista por regra. Mora
 * fora de qualquer arquivo com banco porque a tela de Configurações importa
 * (ADR-012).
 */

export type Campo =
  | "produto"
  | "cor"
  | "tamanho"
  | "cor_tamanho"
  | "sku"
  | "codigo"
  | "loja"
  | "categoria"
  | "preco_atacado"
  | "preco_varejo"
  | "texto";

export type ElementoTexto = {
  tipo: "texto";
  campo: Campo;
  /** só para `campo: "texto"` (texto fixo, ex.: "Feito no Brasil") */
  texto?: string;
  x: number;
  y: number;
  w: number;
  /** altura da linha em mm (o texto é UMA linha; o que não cabe encolhe e depois corta) */
  h: number;
  /** tamanho da fonte em pontos */
  pt: number;
  negrito?: boolean;
  alinhar?: "esq" | "centro" | "dir";
};

export type ElementoBarras = {
  tipo: "barras";
  x: number;
  y: number;
  w: number;
  /** altura das BARRAS (o número, quando mostrado, vem abaixo e ocupa ~2,5 mm) */
  h: number;
  numero: boolean;
};

export type Elemento = ElementoTexto | ElementoBarras;

export type Modelo = {
  /** medidas FÍSICAS de UMA etiqueta no rolo */
  larguraMm: number;
  alturaMm: number;
  /** etiquetas lado a lado no rolo (o rolo da Toque Leve tem 4 de 23 mm) */
  colunas: number;
  /** espaço entre uma coluna e outra, em mm */
  espacoMm: number;
  /**
   * ETIQUETA GIRADA (rolo estreito e alto): o desenho é feito "deitado"
   * (largura = altura física) e impresso girado 90° no sentido horário — o
   * topo do desenho fica na borda direita da etiqueta. É o que faz nome e
   * código caberem numa etiqueta de 23 × 48 mm; sem girar, o EAN teria que
   * sair com barra de 0,125 mm, que muito leitor não lê.
   */
  girada: boolean;
  /** elementos em coordenadas do DESENHO (ver `areaDeDesenho`) */
  elementos: Elemento[];
};

/** A área onde os elementos são posicionados: a etiqueta em pé, ou deitada quando girada. */
export function areaDeDesenho(m: Pick<Modelo, "larguraMm" | "alturaMm" | "girada">): { w: number; h: number } {
  return m.girada ? { w: m.alturaMm, h: m.larguraMm } : { w: m.larguraMm, h: m.alturaMm };
}

/** Largura total de uma LINHA do rolo (todas as colunas e os espaços). */
export function larguraDaLinha(m: Pick<Modelo, "larguraMm" | "colunas" | "espacoMm">): number {
  return m.colunas * m.larguraMm + (m.colunas - 1) * m.espacoMm;
}

/** Onde começa a coluna `c` (0 = primeira), em mm a partir da borda esquerda do rolo. */
export function xDaColuna(m: Pick<Modelo, "larguraMm" | "espacoMm">, c: number): number {
  return c * (m.larguraMm + m.espacoMm);
}

/**
 * Um retângulo do desenho vira retângulo na etiqueta FÍSICA (mm, origem no
 * canto superior esquerdo da etiqueta). Girada: rotação de 90° no sentido
 * horário — o eixo x do desenho desce pela etiqueta, o eixo y do desenho
 * corre da direita para a esquerda.
 */
export function paraFisico(
  m: Pick<Modelo, "larguraMm" | "girada">,
  r: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  if (!m.girada) return r;
  return { x: m.larguraMm - r.y - r.h, y: r.x, w: r.h, h: r.w };
}

/** O que a etiqueta de embalagem sabe de cada peça. */
export type DadosEtiqueta = {
  loja: string;
  produto: string;
  cor: string;
  tamanho: string;
  sku: string;
  codigo: string;
  categoria: string;
  precoAtacado: number;
  precoVarejo: number;
};

export const DADOS_DE_EXEMPLO: DadosEtiqueta = {
  loja: "Toque Leve",
  produto: "Regata Nadador Poliamida",
  cor: "Preto",
  tamanho: "G",
  sku: "RN-PRE-G",
  codigo: "2000000000015",
  categoria: "Regata",
  precoAtacado: 39.9,
  precoVarejo: 79.9,
};

export type OpcoesEmbalagem = {
  larguraMm: number;
  alturaMm: number;
  /** etiquetas lado a lado no rolo (1 a 6) */
  colunas: number;
  /** espaço entre colunas, em mm (0 a 10) */
  espacoMm: number;
  /** girar 90°: "auto" gira quando a etiqueta é mais alta que larga */
  girar: "auto" | "sim" | "nao";
  mostrarLoja: boolean;
  mostrarSku: boolean;
  /** null = sem preço; "atacado" | "varejo" */
  preco: null | "atacado" | "varejo";
};

/** Padrão: 50 × 30 mm, uma coluna, o rolo mais comum nas Zebra e Elgin de bancada. */
export const OPCOES_PADRAO: OpcoesEmbalagem = {
  larguraMm: 50,
  alturaMm: 30,
  colunas: 1,
  espacoMm: 2,
  girar: "auto",
  mostrarLoja: true,
  mostrarSku: false,
  preco: null,
};

/** Limites do que a impressora de etiqueta imprime (Zebra 220: rolo de até 104 mm de largura útil). */
export const LARGURA_MIN_MM = 15;
export const LARGURA_MAX_MM = 110;
export const ALTURA_MIN_MM = 12;
export const ALTURA_MAX_MM = 150;
export const COLUNAS_MAX = 6;
export const ESPACO_MAX_MM = 10;
/** a linha inteira (colunas + espaços) tem que caber na impressora */
export const LARGURA_LINHA_MAX_MM = 110;

/** Girar ou não, resolvido a partir da opção e do formato da etiqueta. */
export function decidirGiro(op: Pick<OpcoesEmbalagem, "larguraMm" | "alturaMm" | "girar">): boolean {
  if (op.girar === "sim") return true;
  if (op.girar === "nao") return false;
  return op.alturaMm > op.larguraMm;
}

const brl = (v: number) =>
  "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** O texto de um elemento para uma peça. */
export function valorDoCampo(el: ElementoTexto, d: DadosEtiqueta): string {
  switch (el.campo) {
    case "produto":
      return d.produto;
    case "cor":
      return d.cor;
    case "tamanho":
      return d.tamanho;
    case "cor_tamanho":
      // loja sem cores (semijoias) cadastra "Único": mostrar só o tamanho
      return d.cor && d.cor.toLowerCase() !== "único" && d.cor.toLowerCase() !== "unico"
        ? `${d.cor} · ${d.tamanho}`
        : d.tamanho;
    case "sku":
      return d.sku;
    case "codigo":
      return d.codigo;
    case "loja":
      return d.loja;
    case "categoria":
      return d.categoria;
    case "preco_atacado":
      return brl(d.precoAtacado);
    case "preco_varejo":
      return brl(d.precoVarejo);
    case "texto":
      return el.texto ?? "";
  }
}

/** Lê as opções gravadas (JSON) com os padrões por cima do que faltar; número fora da faixa cai no padrão. */
export function lerOpcoes(json: string | null | undefined): OpcoesEmbalagem {
  let o: Partial<OpcoesEmbalagem> = {};
  try {
    const lido = json ? JSON.parse(json) : {};
    if (lido && typeof lido === "object") o = lido as Partial<OpcoesEmbalagem>;
  } catch {
    o = {};
  }
  const num = (v: unknown, min: number, max: number, padrao: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : padrao;
  const colunas = Math.floor(num(o.colunas, 1, COLUNAS_MAX, OPCOES_PADRAO.colunas));
  return {
    larguraMm: num(o.larguraMm, LARGURA_MIN_MM, LARGURA_MAX_MM, OPCOES_PADRAO.larguraMm),
    alturaMm: num(o.alturaMm, ALTURA_MIN_MM, ALTURA_MAX_MM, OPCOES_PADRAO.alturaMm),
    colunas,
    espacoMm: num(o.espacoMm, 0, ESPACO_MAX_MM, OPCOES_PADRAO.espacoMm),
    girar: o.girar === "sim" || o.girar === "nao" ? o.girar : "auto",
    mostrarLoja: typeof o.mostrarLoja === "boolean" ? o.mostrarLoja : OPCOES_PADRAO.mostrarLoja,
    mostrarSku: typeof o.mostrarSku === "boolean" ? o.mostrarSku : OPCOES_PADRAO.mostrarSku,
    preco: o.preco === "atacado" || o.preco === "varejo" ? o.preco : null,
  };
}

/**
 * A etiqueta de embalagem, montada por regra a partir das opções.
 *
 * De cima para baixo: nome da peça (negrito), cor · tamanho, o código de
 * barras (o que o leitor lê — ganha o espaço que sobrar, nunca menos de
 * 8 mm de barra) e, no rodapé, o que a loja pediu (nome da loja, SKU,
 * preço). Margem de 1,5 mm em volta: a Zebra não imprime encostado na
 * borda e a etiqueta descolada meio milímetro ainda sai inteira.
 */
export function layoutEmbalagem(op: OpcoesEmbalagem): Modelo {
  const girada = decidirGiro(op);
  const area = areaDeDesenho({ larguraMm: op.larguraMm, alturaMm: op.alturaMm, girada });
  const W = area.w;
  const H = area.h;
  const m = 1.5;
  const larguraUtil = W - 2 * m;
  // fonte proporcional à etiqueta: 50 mm → 8 pt; nunca abaixo de 5
  const base = Math.max(5, Math.min(10, Math.round((W / 50) * 8)));
  const linha = (pt: number) => pt * 0.42; // altura de uma linha em mm (~pt × 0,3528 × 1,2)

  const elementos: Elemento[] = [];
  let y = m;
  elementos.push({ tipo: "texto", campo: "produto", x: m, y, w: larguraUtil, h: linha(base), pt: base, negrito: true });
  y += linha(base);
  elementos.push({ tipo: "texto", campo: "cor_tamanho", x: m, y, w: larguraUtil, h: linha(base), pt: base });
  y += linha(base) + 0.5;

  // rodapé: o que a loja pediu, de baixo para cima
  const rodape: ElementoTexto[] = [];
  const ptRodape = Math.max(4, base - 2);
  if (op.preco) {
    rodape.push({ tipo: "texto", campo: op.preco === "atacado" ? "preco_atacado" : "preco_varejo", x: m, y: 0, w: larguraUtil, h: linha(ptRodape), pt: ptRodape, negrito: true, alinhar: "dir" });
  }
  if (op.mostrarSku) {
    rodape.push({ tipo: "texto", campo: "sku", x: m, y: 0, w: larguraUtil, h: linha(ptRodape), pt: ptRodape });
  }
  if (op.mostrarLoja) {
    rodape.push({ tipo: "texto", campo: "loja", x: m, y: 0, w: larguraUtil, h: linha(ptRodape), pt: ptRodape, alinhar: "centro" });
  }
  // preço e SKU cabem na MESMA linha (um à esquerda, outro à direita)
  let fundo = H - m;
  const linhasRodape: ElementoTexto[][] = [];
  const precoEl = rodape.find((r) => r.campo.startsWith("preco"));
  const skuEl = rodape.find((r) => r.campo === "sku");
  const lojaEl = rodape.find((r) => r.campo === "loja");
  if (lojaEl) linhasRodape.push([lojaEl]);
  if (precoEl || skuEl) linhasRodape.push([skuEl, precoEl].filter((e): e is ElementoTexto => !!e));
  for (const grupo of linhasRodape) {
    const h = Math.max(...grupo.map((g) => g.h));
    fundo -= h;
    for (const g of grupo) {
      g.y = fundo;
      if (grupo.length === 2) {
        g.w = larguraUtil / 2;
        if (g.alinhar === "dir") g.x = m + larguraUtil / 2;
      }
      elementos.push(g);
    }
  }

  // o código de barras fica com o que sobrou entre as linhas de cima e o rodapé
  const alturaNumero = 2.5;
  const sobra = fundo - y - 0.5;
  const alturaBarras = Math.max(8, sobra - alturaNumero);
  const larguraBarras = Math.min(larguraUtil, 45);
  elementos.push({
    tipo: "barras",
    x: m + (larguraUtil - larguraBarras) / 2,
    y,
    w: larguraBarras,
    h: alturaBarras,
    numero: true,
  });

  return {
    larguraMm: op.larguraMm,
    alturaMm: op.alturaMm,
    colunas: Math.max(1, Math.min(COLUNAS_MAX, Math.floor(op.colunas))),
    espacoMm: Math.max(0, op.espacoMm),
    girada,
    elementos,
  };
}

/** Todo elemento cabe dentro da área de desenho? (o que sai é o que a impressora corta) */
export function elementosCabem(modelo: Modelo): boolean {
  const { w, h: alt } = areaDeDesenho(modelo);
  return (
    larguraDaLinha(modelo) <= LARGURA_LINHA_MAX_MM + 0.01 &&
    modelo.elementos.every((e) => {
      const h = e.tipo === "barras" ? e.h + (e.numero ? 2.5 : 0) : e.h;
      return e.x >= 0 && e.y >= 0 && e.x + e.w <= w + 0.01 && e.y + h <= alt + 0.01;
    })
  );
}

/**
 * O LOTE VIRA LINHAS DO ROLO: cada peça repetida pela quantidade, na ordem
 * pedida, e depois agrupada de `colunas` em `colunas`. A última linha pode
 * sair incompleta (a coluna vazia fica em branco — nunca repete uma peça
 * para "completar", senão sobra etiqueta que ninguém pediu).
 */
export function expandirLote(
  lote: { dados: DadosEtiqueta; quantidade: number }[],
  teto: number
): DadosEtiqueta[] {
  const saida: DadosEtiqueta[] = [];
  for (const item of lote) {
    for (let c = 0; c < item.quantidade; c++) {
      if (saida.length >= teto) return saida;
      saida.push(item.dados);
    }
  }
  return saida;
}

export function linhasDoRolo(etiquetas: DadosEtiqueta[], colunas: number): DadosEtiqueta[][] {
  const n = Math.max(1, Math.floor(colunas));
  const linhas: DadosEtiqueta[][] = [];
  for (let i = 0; i < etiquetas.length; i += n) linhas.push(etiquetas.slice(i, i + n));
  return linhas;
}

/** mm por ponto tipográfico */
export const MM_POR_PT = 25.4 / 72;

/**
 * O TEXTO CABE NA LINHA — e quando não cabe, encolhe e depois corta.
 *
 * Nome de peça tem 40 letras e a etiqueta tem 47 mm: primeiro a fonte
 * encolhe (até 60% do tamanho pedido, que ainda se lê), e só se nem assim
 * couber o fim vira "…". Quem chama diz como medir (o PDF mede com a fonte
 * de verdade; SVG e ZPL estimam) — a REGRA de encolher/cortar é uma só.
 */
export function encaixarTexto(
  texto: string,
  larguraMm: number,
  pt: number,
  medirMm: (t: string, pt: number) => number
): { texto: string; pt: number } {
  let t = texto.trim();
  if (!t) return { texto: "", pt };
  if (medirMm(t, pt) <= larguraMm) return { texto: t, pt };
  const minimo = pt * 0.6;
  let tam = pt * (larguraMm / medirMm(t, pt));
  if (tam >= minimo) return { texto: t, pt: Math.floor(tam * 10) / 10 };
  tam = minimo;
  while (t.length > 1 && medirMm(t + "…", tam) > larguraMm) t = t.slice(0, -1);
  return { texto: t + "…", pt: tam };
}

/** Estimativa de largura (Helvetica: ~0,52 em por letra). Para SVG e ZPL. */
export function estimarLarguraMm(t: string, pt: number): number {
  return t.length * pt * MM_POR_PT * 0.52;
}
