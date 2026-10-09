import type { DonoExterno } from "./dono-do-estoque";
import type { FiltroDoInventario } from "./inventario";
import { compararTamanhos } from "../tamanhos";
import { aProduzir } from "../sob-encomenda";

/**
 * FOLHA DE CONTAGEM DE ESTOQUE (pedido do dono, 28/09/2026: *"uma opção de
 * imprimir uma folha com todas as peças, tamanhos e cores para fazer
 * contagem de estoque"*).
 *
 * A folha é para a ARARA: quem conta anda categoria por categoria, então
 * ela sai agrupada por CATEGORIA e, dentro dela, por MODELO, com as CORES EM
 * ORDEM ALFABÉTICA e os tamanhos na ordem da arara (PP < P < M < G).
 *
 * AS CORES DA CATEGORIA SEMPRE EM ORDEM ALFABÉTICA (pedido do dono,
 * 05/10/2026, com o print da Toque Leve): a folha saía "Off-white, Azul
 * Marinho, Preto, Terracota, Branco" — a ordem em que os produtos foram
 * cadastrados, que na arara não quer dizer nada. E cada cor vinha debaixo de
 * um cabeçalho "Baby Look" repetido, porque a loja cadastra UM PRODUTO POR
 * COR (padrão da Nuvemshop). Então o modelo da folha é o NOME do produto:
 * produtos com o mesmo nome na mesma categoria viram um grupo só, e dentro
 * dele as cores saem de A a Z, cada cor com os tamanhos na ordem da arara.
 * Os modelos também saem em ordem alfabética — é a mesma ordem do Inventário
 * filtrado pela categoria, onde a contagem volta a ser digitada.
 *
 * O número de comparação é o NA LOJA (disponível + reservado): a peça
 * separada para um pedido ainda está fisicamente na loja e entra na
 * contagem. Por isso a folha mostra também o reservado — no Inventário o
 * número que se digita é o DISPONÍVEL (contado − reservado).
 *
 * Regra pura; a leitura mora em `linhasDaContagem` (inventario.ts).
 */

export type LinhaDaFolha = {
  variantId: string;
  productId: string;
  produto: string;
  categoria: string;
  cor: string;
  tamanho: string;
  sku: string;
  emEstoque: number;
  reservado: number;
  dono: DonoExterno | null;
  /** o disponível e o mínimo da peça — a lista de produção precisa deles */
  disponivel: number;
  minimo: number;
  /** RN-076: vende sob encomenda — na folha, o que falta é o negativo */
  sobEncomenda?: boolean;
};

export type ModeloDaFolha = {
  /** o id do PRIMEIRO produto do grupo (chave de desenho; o grupo pode juntar vários) */
  productId: string;
  produto: string;
  linhas: LinhaDaFolha[];
  /** peças na loja do modelo inteiro (a soma das linhas) */
  total: number;
};

export type CategoriaDaFolha = {
  categoria: string;
  modelos: ModeloDaFolha[];
  total: number;
  variacoes: number;
};

const comparar = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare;

/** a chave do modelo é o NOME, sem ligar para acento, caixa e espaço sobrando */
const chaveDoModelo = (produto: string) =>
  produto.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

/**
 * Agrupa por categoria (ordem alfabética, sem ligar para acento e caixa) e
 * por MODELO (o nome do produto — produtos de mesmo nome são um grupo só).
 * Dentro do modelo as cores saem em ordem alfabética e, dentro da cor, os
 * tamanhos na ordem da arara. Categoria em branco vai para o fim, como
 * "Sem categoria".
 */
export function agruparParaContagem(linhas: LinhaDaFolha[]): CategoriaDaFolha[] {
  const porCategoria = new Map<string, Map<string, ModeloDaFolha>>();
  for (const l of linhas) {
    const cat = l.categoria.trim() || "Sem categoria";
    const modelos = porCategoria.get(cat) ?? new Map<string, ModeloDaFolha>();
    porCategoria.set(cat, modelos);
    const chave = chaveDoModelo(l.produto);
    const m = modelos.get(chave) ?? { productId: l.productId, produto: l.produto.trim(), linhas: [], total: 0 };
    modelos.set(chave, m);
    m.linhas.push(l);
    m.total += l.emEstoque;
  }
  return [...porCategoria.entries()]
    .sort(([a], [b]) => {
      if (a === "Sem categoria") return 1;
      if (b === "Sem categoria") return -1;
      return comparar(a, b);
    })
    .map(([categoria, modelos]) => {
      const lista = [...modelos.values()].sort((a, b) => comparar(a.produto, b.produto));
      for (const m of lista) {
        m.linhas.sort(
          (a, b) =>
            comparar(a.cor.trim(), b.cor.trim()) ||
            compararTamanhos(a.tamanho, b.tamanho) ||
            comparar(a.sku, b.sku)
        );
      }
      return {
        categoria,
        modelos: lista,
        total: lista.reduce((s, m) => s + m.total, 0),
        variacoes: lista.reduce((s, m) => s + m.linhas.length, 0),
      };
    });
}

/** Como cada chip do Inventário se chama na folha (a MESMA lista da tela). */
export const ROTULO_DO_FILTRO: Record<FiltroDoInventario, string> = {
  todos: "",
  baixo: "No mínimo",
  zerado: "Zeradas",
  produzir: "A produzir",
  reservado: "Com reserva",
  externo: "Controladas por integração",
};

/**
 * A FOLHA SEGUE O CHIP DO INVENTÁRIO (pedido do dono, 08/10/2026: *"eu faço
 * o filtro para saber quais peças estão baixas, porém não tem como
 * imprimir — preciso passar para a produção"*). Com "No mínimo" ou
 * "Zeradas" a folha deixa de ser de CONTAGEM e vira LISTA DE PRODUÇÃO: em
 * vez de "contado / diferença", mostra disponível, mínimo, quanto falta
 * para voltar ao mínimo e uma coluna em branco para anotar quanto produzir.
 */
export function ehListaDeProducao(filtro: FiltroDoInventario | undefined): boolean {
  return filtro === "baixo" || filtro === "zerado" || filtro === "produzir";
}

/**
 * Quantas peças faltam para a variação VOLTAR ao mínimo (nunca negativo). A
 * peça sob encomenda (RN-076) não tem mínimo: o que falta é o que ela está
 * DEVENDO — o negativo, que é a conta dos pedidos já vendidos.
 */
export function faltaParaOMinimo(l: Pick<LinhaDaFolha, "disponivel" | "minimo" | "sobEncomenda">): number {
  if (l.sobEncomenda) return aProduzir(l.disponivel);
  return Math.max(0, l.minimo - l.disponivel);
}

/** O que a folha diz no cabeçalho sobre o recorte (para ninguém achar que é a loja inteira). */
export function recorteDaFolha(opts: {
  categoria?: string;
  q?: string;
  inativos?: boolean;
  filtro?: FiltroDoInventario;
}): string {
  const partes: string[] = [];
  partes.push(opts.categoria ? `Categoria: ${opts.categoria}` : "Todas as categorias");
  if (opts.filtro && opts.filtro !== "todos") partes.push(`filtro "${ROTULO_DO_FILTRO[opts.filtro]}"`);
  if (opts.q?.trim()) partes.push(`busca "${opts.q.trim()}"`);
  partes.push(opts.inativos ? "com produtos inativos" : "só produtos ativos");
  return partes.join(" · ");
}
