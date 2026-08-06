/**
 * ORGANIZADOR DE CATÁLOGO — sugere a categoria pela leitura do NOME da peça.
 *
 * Nasceu de um caso real (06/08/2026): loja nova com CENTENAS de produtos
 * cadastrados à mão, tudo sem categoria — organizar um a um levaria dias.
 * O nome da peça quase sempre diz o que ela é ("Vestido Longo Amanda",
 * "Conjunto short e cropped alfaiataria"): o motor lê o nome, sugere a
 * categoria e a loja só revisa e confirma. NADA é aplicado sem revisão.
 *
 * Regras:
 *  • ganha a palavra-chave que aparece PRIMEIRO no nome ("Conjunto short..."
 *    é um Conjunto, não um Short); empate na posição → a mais comprida;
 *  • se a loja JÁ tem uma categoria equivalente ("Vestido" no singular,
 *    "VESTIDOS" em caixa alta), a grafia DA LOJA vence — nunca criamos uma
 *    categoria gêmea por diferença de plural/acento;
 *  • nome sem palavra conhecida → sem sugestão (fica para a loja decidir).
 */

/** minúsculas, sem acento — régua única de comparação */
function chave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** singular/plural simples: compara também sem o "s" final */
function mesmaCategoria(a: string, b: string): boolean {
  const ca = chave(a);
  const cb = chave(b);
  if (ca === cb) return true;
  const semS = (x: string) => (x.endsWith("s") ? x.slice(0, -1) : x);
  return semS(ca) === semS(cb);
}

/**
 * Dicionário da moda (palavra no nome → categoria canônica).
 * Compostas primeiro na conferência: "saida de praia" tem que ganhar de
 * "praia" nunca existir sozinha. Chaves SEM acento (a busca normaliza).
 */
const DICIONARIO: [string, string][] = [
  // compostas (conferidas como frase)
  ["saida de praia", "Saídas de Praia"],
  ["t shirt", "T-shirts"],
  ["t-shirt", "T-shirts"],
  // peças inteiras / conjuntos
  ["vestido", "Vestidos"],
  ["macacao", "Macacões"],
  ["macaquinho", "Macaquinhos"],
  ["conjunto", "Conjuntos"],
  ["jardineira", "Jardineiras"],
  // parte de cima
  ["blusa", "Blusas"],
  ["regata", "Regatas"],
  ["cropped", "Cropped"],
  ["camiseta", "Camisetas"],
  ["camisa", "Camisas"],
  ["tshirt", "T-shirts"],
  ["body", "Bodys"],
  ["top", "Tops"],
  ["bata", "Batas"],
  ["tricot", "Tricô"],
  ["trico", "Tricô"],
  // parte de baixo
  ["saia", "Saias"],
  ["short", "Shorts"],
  ["bermuda", "Bermudas"],
  ["calca", "Calças"],
  ["legging", "Leggings"],
  ["pantalona", "Pantalonas"],
  // terceira peça / frio
  ["kimono", "Kimonos"],
  ["quimono", "Kimonos"],
  ["cardigan", "Cardigãs"],
  ["cardiga", "Cardigãs"],
  ["casaco", "Casacos"],
  ["jaqueta", "Jaquetas"],
  ["blazer", "Blazers"],
  ["moletom", "Moletons"],
  ["colete", "Coletes"],
  ["capa", "Capas"],
  // praia / dormir / íntimo
  ["biquini", "Biquínis"],
  ["maio", "Maiôs"],
  ["pijama", "Pijamas"],
  ["camisola", "Camisolas"],
  ["calcinha", "Calcinhas"],
  ["sutia", "Sutiãs"],
  ["lingerie", "Lingerie"],
  // acessórios e calçados
  ["bolsa", "Bolsas"],
  ["cinto", "Cintos"],
  ["brinco", "Acessórios"],
  ["colar", "Acessórios"],
  ["pulseira", "Acessórios"],
  ["oculos", "Acessórios"],
  ["lenco", "Acessórios"],
  ["bone", "Acessórios"],
  ["chapeu", "Acessórios"],
  ["sandalia", "Calçados"],
  ["tenis", "Calçados"],
  ["sapato", "Calçados"],
  ["sapatilha", "Calçados"],
  ["bota", "Calçados"],
  ["chinelo", "Calçados"],
  ["rasteira", "Calçados"],
];

/**
 * Sugere a categoria para um NOME de peça. Devolve null quando o nome não
 * tem nenhuma palavra conhecida. `categoriasDaLoja` faz a grafia da loja
 * vencer a canônica.
 */
export function sugerirCategoria(
  nome: string,
  categoriasDaLoja: string[] = []
): string | null {
  const texto = ` ${chave(nome)} `;
  let melhor: { pos: number; tamanho: number; categoria: string } | null = null;
  for (const [palavra, categoria] of DICIONARIO) {
    // palavra INTEIRA (cercada de não-letras): "topazio" não é "top"
    const pos = texto.indexOf(` ${palavra} `) >= 0
      ? texto.indexOf(` ${palavra} `)
      : buscarComFronteira(texto, palavra);
    if (pos < 0) continue;
    if (
      !melhor ||
      pos < melhor.pos ||
      (pos === melhor.pos && palavra.length > melhor.tamanho)
    ) {
      melhor = { pos, tamanho: palavra.length, categoria };
    }
  }
  if (!melhor) return null;
  // a grafia DA LOJA vence a canônica (evita "Vestido" e "Vestidos" gêmeas)
  const daLoja = categoriasDaLoja.find((c) => mesmaCategoria(c, melhor!.categoria));
  return daLoja ?? melhor.categoria;
}

/** posição da palavra cercada por fronteira (espaço, hífen, barra, pontuação) */
function buscarComFronteira(texto: string, palavra: string): number {
  let de = 0;
  for (;;) {
    const pos = texto.indexOf(palavra, de);
    if (pos < 0) return -1;
    const antes = texto[pos - 1] ?? " ";
    const depois = texto[pos + palavra.length] ?? " ";
    if (!/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(depois)) return pos;
    de = pos + 1;
  }
}

export type SugestaoDeCategoria = {
  id: string;
  nome: string;
  atual: string;
  sugerida: string;
};

/**
 * Roda a sugestão num lote de produtos e devolve SÓ o que mudaria de
 * verdade (sugestão diferente da categoria atual). É esta lista que a tela
 * mostra para a loja revisar.
 */
export function sugerirEmLote(
  produtos: { id: string; name: string; category: string }[],
  categoriasDaLoja: string[]
): SugestaoDeCategoria[] {
  const mudancas: SugestaoDeCategoria[] = [];
  for (const p of produtos) {
    const sugerida = sugerirCategoria(p.name, categoriasDaLoja);
    if (!sugerida) continue;
    if (mesmaCategoria(sugerida, p.category)) continue;
    mudancas.push({ id: p.id, nome: p.name, atual: p.category, sugerida });
  }
  return mudancas;
}
