/**
 * LER O PEDIDO DA MENSAGEM DO WHATSAPP.
 *
 * Rede de segurança para a venda que chegou só pelo WhatsApp: a vendedora
 * cola a mensagem que a cliente mandou e o sistema monta o pedido. Serve
 * para o pedido antigo (feito antes da proteção contra perda), para a
 * cliente que mandou de outro aparelho, e para o print que aparece dias
 * depois — em vez de digitar 31 peças uma a uma.
 *
 * A mensagem tem forma conhecida (é o próprio catálogo que escreve):
 *
 *   *Novo pedido — Entre Linhas*
 *
 *   *Calças*
 *   • Calça Wide Leg Jeans Azul — P ×2, M ×1  (3 peças · R$ 509,70)
 *
 *   *Total:* 31 peças · R$ 1.234,50
 *
 *   *Cliente*
 *   Loja: LOJA DA GABI
 *   Nome: Gabriela Cabral Silva
 *   Telefone: 31997441595
 *
 * Aqui a gente só LÊ o texto. Descobrir qual produto é cada linha depende
 * do catálogo da loja e acontece no servidor — este arquivo não adivinha
 * nada sozinho.
 */

export type ItemLido = {
  /** "Calça Wide Leg Jeans Azul" — produto e cor grudados, como no texto */
  descricao: string;
  tamanhos: { tamanho: string; quantidade: number }[];
  /** o que a mensagem dizia (serve para conferir se lemos certo) */
  pecas: number | null;
  valor: number | null;
};

export type PedidoLido = {
  loja: string | null;
  cliente: { nome: string | null; loja: string | null; telefone: string | null };
  itens: ItemLido[];
  totalPecas: number | null;
  totalValor: number | null;
};

/** Sem acento, sem caixa, sem espaço sobrando — para comparar texto. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tira o negrito/itálico do WhatsApp e o lixo de "copiar mensagem". */
function limpar(linha: string): string {
  return linha
    .replace(/[*_~`]/g, "")
    .replace(/‎|‏/g, "") // marcas invisíveis de direção
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A linha é um item da lista?
 *
 * Conferido no texto CRU, antes de tirar o negrito: o asterisco é ao mesmo
 * tempo o marcador de negrito do WhatsApp e o marquinho da lista. Tirando
 * os asteriscos primeiro, "* Blusa — P ×1" virava "Blusa — P ×1" e o item
 * sumia — foi o que fez a mensagem de 31 peças da Entre Linhas não ser
 * reconhecida. O espaço depois do marcador é o que separa a lista do
 * negrito ("*Total:*" não é item).
 */
const BULLET = /^[•·▪‣*\-–—]\s+/;

/** Separadores de campo dentro da linha do item (" — ", " – ", " - "). */
const SEPARADOR = /\s[—–-]\s/g;

/**
 * A lista de tamanhos é o ÚLTIMO campo da linha, e é por ela que a gente
 * corta — nunca pelo primeiro separador.
 *
 * As lojas escrevem de dois jeitos, porque o nome do produto pode já trazer
 * a cor (é o que a importação da Nuvemshop faz):
 *
 *   • Cropped Básico Comfy Preto — P ×2, M ×1
 *   • Blusa Clássica Tule — Baunilha Baunilha — Único ×1
 *
 * Cortando no primeiro separador, o segundo caso perdia metade do nome do
 * produto ("Blusa Clássica Tule") e a cor virava tamanho.
 */
export function partirItem(corpo: string): { descricao: string; tamanhos: string } | null {
  const cortes = [...corpo.matchAll(SEPARADOR)];
  if (cortes.length === 0) return null;
  const ultimo = cortes[cortes.length - 1];
  const descricao = corpo.slice(0, ultimo.index).trim();
  const tamanhos = corpo.slice(ultimo.index! + ultimo[0].length).trim();
  return descricao && tamanhos ? { descricao, tamanhos } : null;
}

/** "R$ 1.234,50" → 1234.5 (e "R$ 49,90" → 49.9) */
export function lerDinheiro(s: string): number | null {
  const m = s.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const inteiro = m[1].replace(/\./g, "");
  const centavos = m[2] ?? "0";
  const v = Number(`${inteiro}.${centavos.padEnd(2, "0")}`);
  return Number.isFinite(v) ? v : null;
}

/**
 * "P ×2, M ×1, G ×3" → [{P,2},{M,1},{G,3}]
 * Aceita ×, x, X, com ou sem espaço. Tamanho pode ser letra, número ou
 * palavra ("Único", "38", "PP").
 */
export function lerTamanhos(s: string): { tamanho: string; quantidade: number }[] {
  const saida: { tamanho: string; quantidade: number }[] = [];
  for (const pedaco of s.split(/[,;]+/)) {
    const m = pedaco.trim().match(/^(.+?)\s*[×xX]\s*(\d+)$/);
    if (!m) continue;
    const tamanho = m[1].trim();
    const quantidade = parseInt(m[2], 10);
    if (tamanho && quantidade > 0) saida.push({ tamanho, quantidade });
  }
  return saida;
}

/**
 * Lê a mensagem inteira. Nunca lança: texto colado de WhatsApp vem torto
 * (linha quebrada, emoji no meio, pedaço faltando) e o que der para ler
 * já adianta o trabalho da vendedora — o resto ela ajusta na tela.
 */
export function lerMensagemDePedido(texto: string): PedidoLido {
  const linhas = (texto ?? "").split(/\r?\n/);
  const itens: ItemLido[] = [];
  let loja: string | null = null;
  let totalPecas: number | null = null;
  let totalValor: number | null = null;
  const cliente = {
    nome: null as string | null,
    loja: null as string | null,
    telefone: null as string | null,
  };

  for (const bruta of linhas) {
    // o marcador da lista é conferido ANTES de tirar o negrito (ver BULLET)
    const cru = bruta.replace(/\s+/g, " ").trim();
    const ehItem = BULLET.test(cru);
    const linha = limpar(bruta);
    if (!linha) continue;
    const norm = normalizar(linha);

    // cabeçalho: "Novo pedido — Entre Linhas"
    if (!loja) {
      const m = linha.match(/^novo pedido\s*[—–-]\s*(.+)$/i);
      if (m) {
        loja = m[1].trim();
        continue;
      }
    }

    // "Total: 31 peças · R$ 1.234,50"
    if (norm.startsWith("total:")) {
      const p = linha.match(/(\d+)\s*pe[çc]a/i);
      totalPecas = p ? parseInt(p[1], 10) : null;
      const idx = linha.search(/R\$/i);
      totalValor = idx >= 0 ? lerDinheiro(linha.slice(idx)) : null;
      continue;
    }

    // bloco do cliente
    const dado = linha.match(/^(loja|nome|telefone|fone|whats?app)\s*:\s*(.+)$/i);
    if (dado) {
      const chave = normalizar(dado[1]);
      const valor = dado[2].trim();
      if (chave === "loja") cliente.loja = valor;
      else if (chave === "nome") cliente.nome = valor;
      else cliente.telefone = valor.replace(/\D/g, "") || null;
      continue;
    }

    // item: "• Calça Wide Leg Jeans Azul — P ×2, M ×1  (3 peças · R$ 509,70)"
    if (ehItem) {
      const corpo = linha.replace(BULLET, "").trim();

      // o parêntese final é conferência ("3 peças · R$ 509,70"), não item
      const paren = corpo.match(/\(([^)]*)\)\s*$/);
      const semParen = paren ? corpo.slice(0, corpo.lastIndexOf("(")).trim() : corpo;

      const partido = partirItem(semParen);
      if (!partido) continue;
      const { descricao } = partido;
      const tamanhos = lerTamanhos(partido.tamanhos);
      if (!descricao || tamanhos.length === 0) continue;

      let pecas: number | null = null;
      let valor: number | null = null;
      if (paren) {
        const p = paren[1].match(/(\d+)\s*pe[çc]a/i);
        pecas = p ? parseInt(p[1], 10) : null;
        const idx = paren[1].search(/R\$/i);
        valor = idx >= 0 ? lerDinheiro(paren[1].slice(idx)) : null;
      }
      itens.push({ descricao, tamanhos, pecas, valor });
    }
  }

  return { loja, cliente, itens, totalPecas, totalValor };
}

/** Quantas peças a leitura encontrou (para comparar com o "Total" da mensagem). */
export function pecasLidas(p: PedidoLido): number {
  return p.itens.reduce(
    (a, i) => a + i.tamanhos.reduce((b, t) => b + t.quantidade, 0),
    0
  );
}

/**
 * Separa produto e cor usando o catálogo da loja: a descrição vem grudada
 * ("Calça Wide Leg Jeans Azul") e só o catálogo sabe onde termina o nome.
 * Vence o nome MAIS LONGO que casa — senão "Calça Wide" ganharia de
 * "Calça Wide Leg Jeans" e a cor sairia errada.
 */
export function separarProdutoECor<T extends { id: string; name: string }>(
  descricao: string,
  produtos: T[]
): { produto: T; cor: string } | null {
  // comparamos PALAVRA A PALAVRA: contar letras não serve, porque tirar o
  // acento muda o tamanho do texto e a cor sairia cortada no lugar errado
  const palavras = descricao.trim().split(/\s+/);
  const alvo = palavras.map(normalizar);
  let melhor: { produto: T; cor: string; peso: number } | null = null;

  for (const p of produtos) {
    const nome = normalizar(p.name).split(" ").filter(Boolean);
    if (nome.length === 0 || nome.length > alvo.length) continue;
    const casa = nome.every((palavra, i) => palavra === alvo[i]);
    if (!casa) continue;
    // vence o nome MAIS LONGO: senão "Calça Wide" ganharia de "Calça Wide
    // Leg Jeans" e a cor viraria "Leg Jeans Azul"
    if (!melhor || nome.length > melhor.peso) {
      melhor = {
        produto: p,
        cor: palavras.slice(nome.length).join(" ").trim(),
        peso: nome.length,
      };
    }
  }
  return melhor ? { produto: melhor.produto, cor: melhor.cor } : null;
}

/**
 * Jeitos possíveis de escrever a cor que sobrou da descrição.
 *
 * O texto repete a cor quando o NOME do produto já traz a cor dentro (é o
 * que a importação da Nuvemshop faz): "Blusa Clássica Tule — Baunilha" com
 * a variação "Baunilha" sai como "Blusa Clássica Tule — Baunilha Baunilha".
 * Dependendo de como a loja cadastrou, o que sobra é "Baunilha Baunilha",
 * "— Baunilha Baunilha" ou só "Baunilha" — tentamos as formas, da mais
 * literal para a mais enxuta, e paramos na primeira que existir no estoque.
 */
export function candidatosDeCor(cor: string): string[] {
  const base = (cor ?? "").replace(/^[\s—–-]+/, "").trim();
  if (!base) return [];
  const saida = [base];
  const palavras = base.split(/\s+/);
  // "Baunilha Baunilha" / "Azul Marinho Azul marinho" → a metade repetida
  if (palavras.length % 2 === 0) {
    const meio = palavras.length / 2;
    const a = palavras.slice(0, meio).join(" ");
    const b = palavras.slice(meio).join(" ");
    if (normalizar(a) === normalizar(b)) saida.push(a);
  }
  // último recurso: a última palavra ("Blusa Tule Preto" → "Preto")
  if (palavras.length > 1) saida.push(palavras[palavras.length - 1]);
  return [...new Set(saida)];
}
