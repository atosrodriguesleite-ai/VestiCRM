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
  | "composicao"
  | "preco_atacado"
  | "preco_varejo"
  // etiqueta de ENVIO (dados do pedido)
  | "pedido"
  | "cliente"
  | "endereco"
  | "bairro_cidade"
  | "cep"
  | "telefone"
  | "remetente"
  | "texto";

/** Os campos que o editor oferece, com o nome que a lojista lê e em que tipo de etiqueta fazem sentido. */
export const CAMPOS: { campo: Campo; rotulo: string; tipos: TipoDeEtiqueta[] }[] = [
  { campo: "produto", rotulo: "Nome da peça", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "cor_tamanho", rotulo: "Cor · tamanho", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "cor", rotulo: "Cor", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "tamanho", rotulo: "Tamanho", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "composicao", rotulo: "Composição (tecido)", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "sku", rotulo: "SKU", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "codigo", rotulo: "Número do código de barras", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "categoria", rotulo: "Categoria", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "preco_atacado", rotulo: "Preço atacado", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "preco_varejo", rotulo: "Preço varejo", tipos: ["EMBALAGEM", "COMPOSICAO"] },
  { campo: "loja", rotulo: "Nome da loja", tipos: ["EMBALAGEM", "COMPOSICAO", "ENVIO"] },
  { campo: "pedido", rotulo: "Número do pedido", tipos: ["ENVIO"] },
  { campo: "cliente", rotulo: "Nome da cliente", tipos: ["ENVIO"] },
  { campo: "endereco", rotulo: "Rua, número e complemento", tipos: ["ENVIO"] },
  { campo: "bairro_cidade", rotulo: "Bairro, cidade e UF", tipos: ["ENVIO"] },
  { campo: "cep", rotulo: "CEP", tipos: ["ENVIO"] },
  { campo: "telefone", rotulo: "Telefone da cliente", tipos: ["ENVIO"] },
  { campo: "remetente", rotulo: "Remetente (loja e WhatsApp)", tipos: ["ENVIO"] },
  { campo: "texto", rotulo: "Texto fixo", tipos: ["EMBALAGEM", "COMPOSICAO", "ENVIO"] },
];

export type TipoDeEtiqueta = "EMBALAGEM" | "COMPOSICAO" | "ENVIO";
export const TIPOS: { tipo: TipoDeEtiqueta; rotulo: string; descricao: string }[] = [
  { tipo: "EMBALAGEM", rotulo: "Embalagem", descricao: "Cola na embalagem da peça, com o código de barras que o leitor bipa na separação." },
  { tipo: "COMPOSICAO", rotulo: "Composição", descricao: "A etiqueta da peça: tecido, tamanho, cuidados e nome da loja." },
  { tipo: "ENVIO", rotulo: "Envio", descricao: "Endereço da cliente e número do pedido, para colar no pacote." },
];

export type ElementoTexto = {
  tipo: "texto";
  campo: Campo;
  /** só para `campo: "texto"` (texto fixo, ex.: "Feito no Brasil") */
  texto?: string;
  x: number;
  y: number;
  w: number;
  /** altura da caixa em mm; com `linhas` > 1 o texto quebra por palavra até esse tanto de linhas */
  h: number;
  /** tamanho da fonte em pontos */
  pt: number;
  negrito?: boolean;
  alinhar?: "esq" | "centro" | "dir";
  /** máximo de linhas (1 = uma linha: encolhe e corta) */
  linhas?: number;
};

export type ElementoImagem = {
  tipo: "imagem";
  x: number;
  y: number;
  w: number;
  h: number;
  /** a imagem como data-URL (PNG ou JPEG), para o PDF e a prévia */
  src: string;
  /**
   * A MESMA imagem em preto e branco, 8 pontos por mm, para a Zebra (`^GF`):
   * o navegador rasteriza ao salvar o modelo, porque no servidor não há
   * canvas. `linhas` são as fileiras de bits em hexadecimal (1 = preto).
   */
  bitmap?: { w: number; h: number; hex: string };
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

export type Elemento = ElementoTexto | ElementoBarras | ElementoImagem;

/** Teto do tamanho de uma imagem dentro do modelo (data-URL) e do modelo inteiro. */
export const TETO_IMAGEM_BYTES = 400_000;
export const TETO_MODELO_BYTES = 1_500_000;
export const TETO_ELEMENTOS = 60;

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

/** O que a etiqueta sabe de cada peça (e, na de envio, do pedido). */
export type DadosEtiqueta = {
  loja: string;
  produto: string;
  cor: string;
  tamanho: string;
  sku: string;
  codigo: string;
  categoria: string;
  composicao: string;
  precoAtacado: number;
  precoVarejo: number;
  pedido: string;
  cliente: string;
  endereco: string;
  bairroCidade: string;
  cep: string;
  telefone: string;
  remetente: string;
};

export const DADOS_VAZIOS: DadosEtiqueta = {
  loja: "",
  produto: "",
  cor: "",
  tamanho: "",
  sku: "",
  codigo: "",
  categoria: "",
  composicao: "",
  precoAtacado: 0,
  precoVarejo: 0,
  pedido: "",
  cliente: "",
  endereco: "",
  bairroCidade: "",
  cep: "",
  telefone: "",
  remetente: "",
};

export const DADOS_DE_EXEMPLO: DadosEtiqueta = {
  ...DADOS_VAZIOS,
  loja: "Toque Leve",
  produto: "Regata Nadador Poliamida",
  cor: "Preto",
  tamanho: "G",
  sku: "RN-PRE-G",
  codigo: "2000000000015",
  categoria: "Regata",
  composicao: "8% elastano, 92% poliamida",
  precoAtacado: 39.9,
  precoVarejo: 79.9,
  pedido: "#110",
  cliente: "Maria da Silva",
  endereco: "Rua das Flores, 123, apto 4",
  bairroCidade: "Centro, Fortaleza – CE",
  cep: "60000-000",
  telefone: "(85) 99999-0000",
  remetente: "Toque Leve · (85) 98888-0000",
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
    case "composicao":
      return d.composicao;
    case "pedido":
      return d.pedido;
    case "cliente":
      return d.cliente;
    case "endereco":
      return d.endereco;
    case "bairro_cidade":
      return d.bairroCidade;
    case "cep":
      return d.cep;
    case "telefone":
      return d.telefone;
    case "remetente":
      return d.remetente;
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
  const linha = alturaDaLinhaMm;

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

/** Altura de uma linha de texto em mm para um tamanho em pontos (~pt × 0,3528 × 1,2). */
export function alturaDaLinhaMm(pt: number): number {
  return pt * 0.42;
}

/**
 * TEXTO EM VÁRIAS LINHAS: quebra por palavra até `maxLinhas`; a última que
 * não coube ganha "…". Palavra maior que a linha é cortada no meio (nome de
 * tecido comprido não pode derrubar a etiqueta).
 */
export function quebrarTexto(
  texto: string,
  larguraMm: number,
  pt: number,
  maxLinhas: number,
  medirMm: (t: string, pt: number) => number
): string[] {
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (medirMm(tentativa, pt) <= larguraMm) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    // palavra que sozinha não cabe: corta no meio
    let resto = p;
    while (medirMm(resto, pt) > larguraMm && resto.length > 1) {
      let corte = resto.length - 1;
      while (corte > 1 && medirMm(resto.slice(0, corte), pt) > larguraMm) corte--;
      linhas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    atual = resto;
  }
  if (atual) linhas.push(atual);
  if (linhas.length <= maxLinhas) return linhas;
  const cabem = linhas.slice(0, maxLinhas);
  let ultima = cabem[maxLinhas - 1];
  while (ultima.length > 1 && medirMm(ultima + "…", pt) > larguraMm) ultima = ultima.slice(0, -1);
  cabem[maxLinhas - 1] = ultima + "…";
  return cabem;
}

/**
 * As linhas de um elemento de texto, prontas para desenhar: uma linha
 * (encolhe e corta) ou várias (quebra por palavra). Regra única para as
 * três saídas; cada uma passa o seu jeito de medir.
 */
export function linhasDoElemento(
  el: ElementoTexto,
  dados: DadosEtiqueta,
  medirMm: (t: string, pt: number) => number
): { linhas: string[]; pt: number } {
  const bruto = valorDoCampo(el, dados);
  if (!bruto) return { linhas: [], pt: el.pt };
  const max = Math.max(1, Math.floor(el.linhas ?? 1));
  if (max === 1) {
    const r = encaixarTexto(bruto, el.w, el.pt, medirMm);
    return { linhas: r.texto ? [r.texto] : [], pt: r.pt };
  }
  // quantas linhas cabem na caixa, respeitando o máximo pedido
  const cabem = Math.max(1, Math.min(max, Math.floor(el.h / alturaDaLinhaMm(el.pt))));
  return { linhas: quebrarTexto(bruto, el.w, el.pt, cabem, medirMm), pt: el.pt };
}

/**
 * ETIQUETA DE COMPOSIÇÃO por regra (o padrão que a loja edita depois): o
 * tecido em cima (até 3 linhas), o tamanho GRANDE no meio, a linha de
 * cuidados e o nome da loja embaixo — o desenho da etiqueta que a Toque Leve
 * já imprime no OpenLabel, girado quando o rolo é estreito e alto.
 */
export function layoutComposicao(op: OpcoesEmbalagem): Modelo {
  const girada = decidirGiro(op);
  const area = areaDeDesenho({ larguraMm: op.larguraMm, alturaMm: op.alturaMm, girada });
  const W = area.w;
  const H = area.h;
  const m = 1.5;
  const larguraUtil = W - 2 * m;
  const base = Math.max(4, Math.min(8, Math.round((W / 48) * 6)));
  const elementos: Elemento[] = [];
  let y = m;
  const alturaComposicao = alturaDaLinhaMm(base) * 3;
  elementos.push({ tipo: "texto", campo: "composicao", x: m, y, w: larguraUtil, h: alturaComposicao, pt: base, alinhar: "centro", linhas: 3 });
  y += alturaComposicao + 0.5;
  const ptTamanho = Math.max(10, Math.min(26, Math.round(H * 0.9)));
  const alturaTamanho = alturaDaLinhaMm(ptTamanho);
  elementos.push({ tipo: "texto", campo: "tamanho", x: m, y, w: larguraUtil, h: alturaTamanho, pt: ptTamanho, negrito: true, alinhar: "centro" });
  y += alturaTamanho;
  const ptRodape = Math.max(4, base - 1);
  let fundo = H - m;
  if (op.mostrarLoja) {
    fundo -= alturaDaLinhaMm(ptRodape);
    elementos.push({ tipo: "texto", campo: "loja", x: m, y: fundo, w: larguraUtil, h: alturaDaLinhaMm(ptRodape), pt: ptRodape, negrito: true, alinhar: "centro" });
  }
  // instrução de cuidado (lavar, alvejante, ferro) NÃO é inventada pelo
  // sistema: é informação da etiqueta legal da peça e quem responde é a
  // loja — ela acrescenta como texto fixo no editor (achado da revisão,
  // mesma régua do NCM: o sistema não inventa dado que a loja assina)
  void y;
  return { larguraMm: op.larguraMm, alturaMm: op.alturaMm, colunas: Math.max(1, Math.min(COLUNAS_MAX, Math.floor(op.colunas))), espacoMm: Math.max(0, op.espacoMm), girada, elementos };
}

/**
 * ETIQUETA DE ENVIO por regra: número do pedido e cliente em destaque, o
 * endereço em duas linhas, CEP e telefone, e o remetente no rodapé.
 */
export function layoutEnvio(op: OpcoesEmbalagem): Modelo {
  const girada = decidirGiro(op);
  const area = areaDeDesenho({ larguraMm: op.larguraMm, alturaMm: op.alturaMm, girada });
  const W = area.w;
  const H = area.h;
  const m = 2;
  const larguraUtil = W - 2 * m;
  const base = Math.max(6, Math.min(11, Math.round((W / 100) * 10)));
  const elementos: Elemento[] = [];
  let y = m;
  const l = (pt: number) => alturaDaLinhaMm(pt);
  elementos.push({ tipo: "texto", campo: "pedido", x: m, y, w: larguraUtil / 3, h: l(base + 2), pt: base + 2, negrito: true });
  elementos.push({ tipo: "texto", campo: "loja", x: m + larguraUtil / 3, y, w: (larguraUtil * 2) / 3, h: l(base), pt: base, alinhar: "dir" });
  y += l(base + 2) + 1;
  elementos.push({ tipo: "texto", campo: "cliente", x: m, y, w: larguraUtil, h: l(base + 1), pt: base + 1, negrito: true });
  y += l(base + 1);
  elementos.push({ tipo: "texto", campo: "endereco", x: m, y, w: larguraUtil, h: l(base) * 2, pt: base, linhas: 2 });
  y += l(base) * 2;
  elementos.push({ tipo: "texto", campo: "bairro_cidade", x: m, y, w: larguraUtil, h: l(base), pt: base });
  y += l(base);
  elementos.push({ tipo: "texto", campo: "cep", x: m, y, w: larguraUtil / 2, h: l(base), pt: base, negrito: true });
  elementos.push({ tipo: "texto", campo: "telefone", x: m + larguraUtil / 2, y, w: larguraUtil / 2, h: l(base), pt: base, alinhar: "dir" });
  const ptRodape = Math.max(5, base - 2);
  elementos.push({ tipo: "texto", campo: "remetente", x: m, y: H - m - l(ptRodape), w: larguraUtil, h: l(ptRodape), pt: ptRodape });
  return { larguraMm: op.larguraMm, alturaMm: op.alturaMm, colunas: Math.max(1, Math.min(COLUNAS_MAX, Math.floor(op.colunas))), espacoMm: Math.max(0, op.espacoMm), girada, elementos };
}

/** O desenho por regra do tipo pedido (o que um modelo novo recebe ao nascer). */
export function layoutPorTipo(tipo: TipoDeEtiqueta, op: OpcoesEmbalagem): Modelo {
  if (tipo === "COMPOSICAO") return layoutComposicao(op);
  if (tipo === "ENVIO") return layoutEnvio(op);
  return layoutEmbalagem(op);
}

/** Tamanhos de partida por tipo (a loja muda no editor). */
export function opcoesIniciais(tipo: TipoDeEtiqueta): OpcoesEmbalagem {
  if (tipo === "COMPOSICAO") return { ...OPCOES_PADRAO, larguraMm: 23, alturaMm: 48, colunas: 4, espacoMm: 2, mostrarLoja: true };
  if (tipo === "ENVIO") return { ...OPCOES_PADRAO, larguraMm: 100, alturaMm: 60, mostrarLoja: true };
  return OPCOES_PADRAO;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * LÊ A LISTA DE ELEMENTOS GRAVADA (JSON do editor) — devolve só o que é
 * válido, campo a campo; elemento torto cai fora em vez de derrubar a
 * impressão. `null` quando o JSON não é uma lista.
 */
export function lerElementos(json: string | null | undefined): Elemento[] | null {
  if (!json) return null;
  let lido: unknown;
  try {
    lido = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(lido)) return null;
  const saida: Elemento[] = [];
  const campos = new Set(CAMPOS.map((c) => c.campo));
  for (const e of lido.slice(0, TETO_ELEMENTOS)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h);
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0 || x < 0 || y < 0) continue;
    if (o.tipo === "texto") {
      const campo = typeof o.campo === "string" && campos.has(o.campo as Campo) ? (o.campo as Campo) : null;
      const pt = num(o.pt);
      if (!campo || pt === null || pt < 3 || pt > 72) continue;
      saida.push({
        tipo: "texto",
        campo,
        ...(campo === "texto" ? { texto: typeof o.texto === "string" ? o.texto.slice(0, 300) : "" } : {}),
        x, y, w, h, pt,
        ...(o.negrito === true ? { negrito: true } : {}),
        ...(o.alinhar === "centro" || o.alinhar === "dir" ? { alinhar: o.alinhar } : {}),
        ...(num(o.linhas) && (o.linhas as number) > 1 ? { linhas: Math.min(10, Math.floor(o.linhas as number)) } : {}),
      });
    } else if (o.tipo === "barras") {
      saida.push({ tipo: "barras", x, y, w, h, numero: o.numero !== false });
    } else if (o.tipo === "imagem") {
      const src = typeof o.src === "string" && /^data:image\/(png|jpeg);base64,/.test(o.src) && o.src.length <= TETO_IMAGEM_BYTES ? o.src : null;
      if (!src) continue;
      const b = o.bitmap && typeof o.bitmap === "object" ? (o.bitmap as Record<string, unknown>) : null;
      const bw = b ? num(b.w) : null;
      const bh = b ? num(b.h) : null;
      const bitmap =
        b && bw && bh && typeof b.hex === "string" && /^[0-9A-Fa-f]*$/.test(b.hex) && b.hex.length === Math.ceil(bw / 8) * 2 * bh
          ? { w: Math.floor(bw), h: Math.floor(bh), hex: b.hex.toUpperCase() }
          : undefined;
      saida.push({ tipo: "imagem", x, y, w, h, src, ...(bitmap ? { bitmap } : {}) });
    }
  }
  return saida;
}

/** O modelo pronto para desenhar, a partir da linha gravada: o desenho do editor quando existe, senão o desenho por regra do tipo. */
export function modeloDaLinhaGravada(linha: {
  tipo: string;
  larguraMm: number;
  alturaMm: number;
  colunas: number;
  espacoMm: number;
  girada: boolean;
  opcoes: string | null;
  elementos: string | null;
}): Modelo {
  const elementos = lerElementos(linha.elementos);
  if (elementos) {
    return {
      larguraMm: linha.larguraMm,
      alturaMm: linha.alturaMm,
      colunas: Math.max(1, Math.min(COLUNAS_MAX, linha.colunas)),
      espacoMm: Math.max(0, linha.espacoMm),
      girada: linha.girada,
      elementos,
    };
  }
  const tipo: TipoDeEtiqueta = linha.tipo === "COMPOSICAO" || linha.tipo === "ENVIO" ? linha.tipo : "EMBALAGEM";
  // tamanho, colunas e giro são os da LINHA (o editor grava lá); `opcoes` só
  // diz quais campos o desenho por regra mostra
  const op: OpcoesEmbalagem = {
    ...lerOpcoes(linha.opcoes),
    larguraMm: linha.larguraMm,
    alturaMm: linha.alturaMm,
    colunas: Math.max(1, Math.min(COLUNAS_MAX, linha.colunas)),
    espacoMm: Math.max(0, linha.espacoMm),
    girar: linha.girada ? "sim" : "nao",
  };
  return layoutPorTipo(tipo, op);
}
