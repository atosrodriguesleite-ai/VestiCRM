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
  /**
   * O título da seção acima do item ("*Blusa Clássica Tule*"). Em mensagem
   * de formato antigo o item vem SÓ com a cor ("• Branco — Único ×4") e o
   * nome do modelo mora aqui — sem ele, não há como saber qual peça é.
   */
  categoria: string | null;
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
 * MENSAGEM ACHATADA — incidente Entre Linhas (04/08/2026): a cliente veio de
 * ANÚNCIO e abriu o catálogo dentro do navegador do Instagram/Facebook, que
 * remove as quebras de linha do link do WhatsApp. O pedido chegou inteiro
 * numa linha só ("*Novo pedido — entre linhas* *Blusa Clássica Tule* •
 * Branco — Único ×4 (…) • Off White …"). Os marcadores sobrevivem (•, os
 * asteriscos do negrito, "Total:") — então dá para REMONTAR as linhas antes
 * de ler. Só age quando a mensagem está de fato achatada.
 */
export function desachatarMensagem(texto: string): string {
  const t = texto ?? "";
  const linhasCheias = t.split(/\r?\n/).filter((l) => l.trim()).length;
  // o "·" fica de fora: é separador de "(4 peças · R$ 86,00)", não marcador
  const bullets = (t.match(/[•▪‣]/g) ?? []).length;
  // mensagem normal (várias linhas) ou sem cara de lista: não mexe
  if (linhasCheias > 3 || bullets < 2) return t;
  return (
    t
      // cada marcador de item começa linha nova
      .replace(/\s*[•▪‣]\s*/g, "\n• ")
      // o Total ANTES da regra de categoria (senão "*Total:*" perderia os
      // números da própria linha)
      .replace(/\s*\*?\s*Total:\s*\*?\s*/gi, "\nTotal: ")
      // "*Categoria*" (negrito) vira linha própria — pega também o cabeçalho
      .replace(/\s*\*([^*\n]{2,80})\*\s*/g, "\n*$1*\n")
      // os campos extras da loja (RN-027) também são marcadores de linha —
      // sem eles aqui, o CEP colado na linha do telefone virava dígito de
      // telefone na mensagem achatada do navegador do Instagram
      .replace(
        // "Nome da loja" vem ANTES de "Loja" e "Nome" de propósito: a
        // alternativa curta casaria no meio do rótulo comprido e partiria
        // "Nome da loja: X" em duas linhas erradas
        /\s+(Nome da loja|Loja|Nome|Telefone|Fone|Whatsapp|CEP|Endere[çc]o(?:\s*\(rua e n[úu]mero\))?|Bairro|Cidade|Estado(?:\s*\(UF\))?)\s*:\s*/gi,
        "\n$1: "
      )
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/**
 * Lê a mensagem inteira. Nunca lança: texto colado de WhatsApp vem torto
 * (linha quebrada, emoji no meio, pedaço faltando) e o que der para ler
 * já adianta o trabalho da vendedora — o resto ela ajusta na tela.
 */
export function lerMensagemDePedido(texto: string): PedidoLido {
  const linhas = desachatarMensagem(texto ?? "").split(/\r?\n/);
  const itens: ItemLido[] = [];
  let loja: string | null = null;
  let totalPecas: number | null = null;
  let totalValor: number | null = null;
  const cliente = {
    nome: null as string | null,
    loja: null as string | null,
    telefone: null as string | null,
  };
  // título da seção acima dos itens ("*Blusa Clássica Tule*") — no formato
  // antigo o item vem só com a cor, e o nome do modelo mora aqui
  let categoriaAtual: string | null = null;

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

    // "Total: 31 peças · R$ 1.234,50" — ou "31 conjuntos", "31 kits": a loja
    // escolhe como chamar a unidade (RN-068), então o número é lido pela
    // POSIÇÃO (o primeiro depois de "Total:"), nunca pela palavra. Procurar
    // "peça" deixava a conferência do total vazia na loja de conjuntos.
    if (norm.startsWith("total:")) {
      const p = linha.match(/total\W*(\d+)/i);
      totalPecas = p ? parseInt(p[1], 10) : null;
      const idx = linha.search(/R\$/i);
      totalValor = idx >= 0 ? lerDinheiro(linha.slice(idx)) : null;
      continue;
    }

    // bloco do cliente — "nome da loja" antes de "loja"/"nome": o rótulo do
    // campo LOJA da RN-027 é "Nome da loja", e a alternativa curta não casa
    // (o formato antigo "Loja:" continua valendo — o servidor escreve assim)
    const dado = linha.match(/^(nome da loja|loja|nome|telefone|fone|whats?app)\s*:\s*(.+)$/i);
    if (dado) {
      const chave = normalizar(dado[1]);
      const valor = dado[2].trim();
      if (chave === "loja" || chave === "nome da loja") cliente.loja = valor;
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
        // "(2 peças · …)", "(2 conjuntos · …)": o número vem primeiro, a
        // palavra é a que a loja escolheu (RN-068) — nunca procurar "peça"
        const p = paren[1].match(/^\s*(\d+)/);
        pecas = p ? parseInt(p[1], 10) : null;
        const idx = paren[1].search(/R\$/i);
        valor = idx >= 0 ? lerDinheiro(paren[1].slice(idx)) : null;
      }
      itens.push({ descricao, categoria: categoriaAtual, tamanhos, pecas, valor });
      continue;
    }

    // linha solta curta sem preço/quantidade: título da seção (nome do
    // modelo) — no formato antigo o item vem só com a cor, e é este título
    // que diz de qual peça se trata
    if (!/R\$/i.test(linha) && linha.length <= 60 && !/[×x]\s*\d/.test(linha)) {
      categoriaAtual = linha;
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
 *
 * Devolve os produtos em DEGRAUS, do nome mais longo para o mais curto, e
 * cada degrau traz TODOS os empatados naquele tamanho de nome. Existe loja
 * que cadastra UM PRODUTO POR COR com o mesmo nome (a Toque Leve tem seis
 * "Regata Alça", uma por cor): aí o nome sozinho não decide, e quem decide
 * é a cor — `casarPeca`, abaixo. Ficar com o primeiro xará foi o defeito
 * de 03/11/2026: todas as "Regata Alça" do pedido viravam a Café. O degrau
 * mais curto é RESERVA: só é consultado quando o mais longo não tem a cor
 * ("Regata Alça Azul" sem "Céu" não esconde a "Regata Alça" cor "Azul Céu").
 */
export function degrausDeProduto<T extends { id: string; name: string }>(
  descricao: string,
  produtos: T[]
): { produto: T; cor: string }[][] {
  // comparamos PALAVRA A PALAVRA: contar letras não serve, porque tirar o
  // acento muda o tamanho do texto e a cor sairia cortada no lugar errado
  const palavras = descricao.trim().split(/\s+/);
  const alvo = palavras.map(normalizar);
  const porTamanho = new Map<number, { produto: T; cor: string }[]>();

  for (const p of produtos) {
    const nome = normalizar(p.name).split(" ").filter(Boolean);
    if (nome.length === 0 || nome.length > alvo.length) continue;
    const casa = nome.every((palavra, i) => palavra === alvo[i]);
    if (!casa) continue;
    const cor = palavras.slice(nome.length).join(" ").trim();
    const lista = porTamanho.get(nome.length) ?? [];
    lista.push({ produto: p, cor });
    porTamanho.set(nome.length, lista);
  }
  return [...porTamanho.keys()].sort((x, y) => y - x).map((k) => porTamanho.get(k)!);
}

/** Os produtos empatados no nome MAIS LONGO que casa (o primeiro degrau). */
export function candidatosDeProduto<T extends { id: string; name: string }>(
  descricao: string,
  produtos: T[]
): { produto: T; cor: string }[] {
  return degrausDeProduto(descricao, produtos)[0] ?? [];
}

export type VariacaoDoCatalogo = { id: string; color: string; size: string; stock: number };
export type PecaDoCatalogo = { id: string; name: string; variants: VariacaoDoCatalogo[] };

/** Um candidato com as variações já normalizadas (cor e tamanho para comparar). */
export type CandidatoDaLinha<T extends PecaDoCatalogo> = {
  produto: T;
  cor: string;
  variacoes: { v: T["variants"][number]; cor: string; tam: string }[];
};

/**
 * Os candidatos de UMA LINHA da mensagem, em degraus (ver `degrausDeProduto`),
 * com as variações normalizadas uma vez — a linha tem vários tamanhos e cada
 * um é casado em separado, sem refazer a conta do nome.
 *
 * Formato antigo/achatado: o item vem só com a cor ("Branco") e o nome do
 * modelo mora no título da seção — tenta primeiro como veio, depois com o
 * título na frente ("Blusa Clássica Tule Branco").
 */
export function candidatosDaLinha<T extends PecaDoCatalogo>(
  item: { descricao: string; categoria: string | null },
  produtos: T[]
): CandidatoDaLinha<T>[][] {
  let degraus = degrausDeProduto(item.descricao, produtos);
  if (degraus.length === 0 && item.categoria) {
    degraus = degrausDeProduto(`${item.categoria} ${item.descricao}`, produtos);
  }
  return degraus.map((degrau) =>
    degrau.map((c) => ({
      produto: c.produto,
      cor: c.cor,
      variacoes: c.produto.variants.map((v) => ({
        v,
        cor: normalizar(v.color),
        tam: normalizar(v.size),
      })),
    }))
  );
}

/** Por que a linha ficou sem variação — a prévia escreve a frase certa. */
export type MotivoSemVariacao =
  | "cor-nao-existe" // o texto diz a cor, e ela não existe em nenhum candidato
  | "tamanho-nao-existe" // o texto não diz cor, e não há variação daquele tamanho
  | "mais-de-uma-opcao"; // o texto não diz cor, e há mais de uma variação daquele tamanho

export type PecaCasada<T extends PecaDoCatalogo> = {
  produto: T;
  cor: string;
  variante: T["variants"][number] | null;
  /** só quando `variante` é nula */
  motivo: MotivoSemVariacao | null;
};

/**
 * ACHA A PEÇA DE UMA LINHA × TAMANHO: produto + variação, pelo catálogo da
 * loja. É a decisão inteira num lugar só, pura e testável.
 *
 * Réguas:
 *  • o nome mais longo que casa escolhe os produtos candidatos; empatados
 *    (loja que cadastra um produto por cor com o mesmo nome), A COR decide
 *    — vale o candidato que TEM a variação daquela cor e tamanho; sem a cor
 *    em nenhum deles, o degrau de nome mais curto é consultado;
 *  • a cor do texto é conferida como veio e nas formas repetidas
 *    (`candidatosDeCor`: "Baunilha Baunilha" → "Baunilha");
 *  • SEM cor no texto (loja que esconde as cores, formato antigo) e UMA
 *    variação daquele tamanho entre os candidatos: é ela; mais de uma é
 *    DÚVIDA, dita como dúvida (nunca a primeira que apareceu);
 *  • cor no texto que NÃO existe em candidato nenhum NUNCA é trocada por
 *    outra. A versão anterior caía na única cor do produto ("produto
 *    certo, tamanho certo, só uma cor possível: é ela") — era isso que
 *    punha a Café no lugar da Amarelo Manteiga. Agora a linha volta sem
 *    variação, com o motivo: a vendedora vê e escolhe; peça errada
 *    reservada em silêncio ninguém vê;
 *  • entre dois candidatos com a MESMA cor e tamanho (cadastro em dobro),
 *    vale o que tem estoque para a quantidade; depois, o de maior estoque.
 */
export function casarPecaNosCandidatos<T extends PecaDoCatalogo>(
  degraus: CandidatoDaLinha<T>[][],
  tamanho: string,
  quantidade: number
): PecaCasada<T> | null {
  if (degraus.length === 0 || degraus[0].length === 0) return null;
  const tam = normalizar(tamanho);

  type Achado = { produto: T; cor: string; variante: T["variants"][number] };
  const melhor = (lista: Achado[]): Achado | null => {
    if (lista.length === 0) return null;
    return lista.reduce((a, b) => {
      const aCobre = a.variante.stock >= quantidade;
      const bCobre = b.variante.stock >= quantidade;
      if (aCobre !== bCobre) return aCobre ? a : b;
      return b.variante.stock > a.variante.stock ? b : a;
    });
  };

  // o primeiro degrau diz o que o texto chamou de cor; os de reserva só
  // entram pela cor, e a dúvida sem cor é sempre do primeiro
  let semCor: Achado[] | null = null;
  for (const degrau of degraus) {
    // todos do degrau têm a mesma cor (o nome tem o mesmo número de palavras)
    const cor = degrau[0].cor;
    if (cor) {
      // da forma mais literal para a mais enxuta, parando na primeira que
      // existir em algum candidato (a ordem é a de `candidatosDeCor`)
      for (const forma of candidatosDeCor(cor).map(normalizar)) {
        const achados: Achado[] = [];
        for (const c of degrau) {
          for (const x of c.variacoes) {
            if (x.tam === tam && x.cor === forma) {
              achados.push({ produto: c.produto, cor, variante: x.v });
            }
          }
        }
        const escolhido = melhor(achados);
        if (escolhido) return { ...escolhido, motivo: null };
      }
      continue;
    }
    // sem cor no texto (só acontece no degrau em que o nome consumiu a
    // descrição inteira — o mais longo): se só há UMA variação daquele
    // tamanho, é ela
    if (semCor === null) {
      semCor = [];
      for (const c of degrau) {
        for (const x of c.variacoes) {
          if (x.tam === tam) semCor.push({ produto: c.produto, cor, variante: x.v });
        }
      }
      if (semCor.length === 1) return { ...semCor[0], motivo: null };
    }
  }

  const primeiro = degraus[0][0];
  const motivo: MotivoSemVariacao = primeiro.cor
    ? "cor-nao-existe"
    : semCor && semCor.length > 1
      ? "mais-de-uma-opcao"
      : "tamanho-nao-existe";
  return { produto: primeiro.produto, cor: primeiro.cor, variante: null, motivo };
}

/** `candidatosDaLinha` + `casarPecaNosCandidatos` numa chamada (um tamanho só). */
export function casarPeca<T extends PecaDoCatalogo>(
  item: { descricao: string; categoria: string | null },
  tamanho: string,
  quantidade: number,
  produtos: T[]
): PecaCasada<T> | null {
  return casarPecaNosCandidatos(candidatosDaLinha(item, produtos), tamanho, quantidade);
}

/** A frase da prévia para a linha que ficou sem variação. */
export function fraseSemVariacao(
  motivo: MotivoSemVariacao,
  cor: string,
  tamanho: string,
  cadastros: number
): string {
  if (motivo === "cor-nao-existe") return `Sem essa variação (${cor} ${tamanho})`;
  if (motivo === "tamanho-nao-existe") return `Sem essa variação (tamanho ${tamanho})`;
  return cadastros > 1
    ? `Qual cor? A mensagem não diz e há ${cadastros} cadastros com esse nome`
    : `Qual cor? A mensagem não diz e a peça tem mais de uma no tamanho ${tamanho}`;
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
