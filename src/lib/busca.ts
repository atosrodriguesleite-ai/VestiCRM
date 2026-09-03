/**
 * BUSCA DO JEITO QUE A LOJISTA DIGITA.
 *
 * Ninguém digita "Mônica" com acento no meio do corre, nem lembra se cadastrou
 * "MARIA" ou "Maria". E telefone cada um escreve de um jeito: com DDD, sem
 * DDD, com parênteses, com traço. Se a busca exigir a forma exata, a lupa
 * "não funciona" — foi exatamente a reclamação da loja.
 *
 * Duas armadilhas que este arquivo fecha:
 *
 *  1. MAIÚSCULA E ACENTO não podem atrapalhar: "jose" acha "José Alves".
 *  2. BUSCA POR TELEFONE só vale quando o que foi digitado TEM número. O
 *     código antigo tirava as letras do termo, sobrava vazio, e "qualquer
 *     telefone contém vazio" — resultado: procurar por nome devolvia a lista
 *     inteira, como se a lupa não fizesse nada.
 */

/** Minúsculas e sem acento — a forma em que tudo é comparado. */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Tradução de acentos DENTRO do banco (pt-BR), o par do `normalizarBusca`
 * para `translate(lower(coluna), COM_ACENTO, SEM_ACENTO)` — é o que permite
 * procurar sem puxar a tabela inteira para a memória.
 */
export const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüçñ";
export const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucn";
/**
 * Para o TEXTO DA MENSAGEM a barra também vira espaço: "azul/branco" e
 * "P/M" são o vocabulário de moda, e o separador de palavras do Postgres
 * trata "azul/branco" como UMA palavra — "branco" não acharia. É a mesma
 * tabela do índice de texto da mensagem (migração 20260903120000).
 */
export const COM_ACENTO_MENSAGEM = `${COM_ACENTO}/`;
export const SEM_ACENTO_MENSAGEM = `${SEM_ACENTO} `;

/** Só os números (para telefone/documento). Campo vazio/nulo vira "". */
export const soDigitos = (texto: string | null | undefined): string =>
  (texto ?? "").replace(/\D/g, "");

/** O campo contém o termo? (ignora maiúscula e acento) */
export function casaTexto(campo: string | null | undefined, termo: string): boolean {
  if (!termo) return true;
  return normalizarBusca(campo ?? "").includes(normalizarBusca(termo));
}

/**
 * O telefone casa com o termo digitado?
 *
 * Só entra na conta se o termo tiver PELO MENOS 3 dígitos: com menos que
 * isso ("11") metade da agenda casaria, e com zero dígitos casaria tudo.
 */
export function casaTelefone(
  telefone: string | null | undefined,
  termo: string
): boolean {
  const digitos = soDigitos(termo);
  if (digitos.length < 3) return false;
  return soDigitos(telefone ?? "").includes(digitos);
}

/**
 * Um produto casa com a busca? Nome ou SKU, do jeito que a lojista digita:
 * "alca" acha "Regata de Alça", "terracota" acha "ALCA-TERRACOTA".
 */
export function casaProduto(
  produto: { name?: string | null; sku?: string | null },
  termo: string
): boolean {
  const t = termo.trim();
  if (!t) return true;
  return casaTexto(produto.name, t) || casaTexto(produto.sku, t);
}

/**
 * Filtra e ordena produtos pelo termo digitado: quem COMEÇA com o termo vem
 * primeiro, o resto em ordem alfabética — e devolve no máximo `limite`.
 * O teto existe porque a resposta completa (fotos, grade) é pesada; quando é
 * atingido, a tela avisa "digite mais letras" em vez de esconder em silêncio
 * (foi assim que um produto novo "sumiu" da busca do pedido).
 */
export function filtrarProdutos<T extends { name?: string | null; sku?: string | null }>(
  produtos: T[],
  termo: string,
  limite = 60
): T[] {
  const t = normalizarBusca(termo);
  return produtos
    .filter((p) => casaProduto(p, termo))
    .sort((a, b) => {
      const na = normalizarBusca(a.name ?? "");
      const nb = normalizarBusca(b.name ?? "");
      const pa = na.startsWith(t) ? 0 : 1;
      const pb = nb.startsWith(t) ? 0 : 1;
      return pa - pb || na.localeCompare(nb);
    })
    .slice(0, limite);
}

/**
 * Uma cliente casa com a busca? Nome, telefone ou cidade — que é por onde a
 * loja procura na vida real ("a Ana de Goiânia", "aquele 62 9...").
 */
export function casaCliente(
  cliente: {
    name?: string | null;
    /** nome que a cliente usa no WhatsApp (RN-024) — a loja procura por ele */
    waName?: string | null;
    phone?: string | null;
    city?: string | null;
    cpf?: string | null;
    cnpj?: string | null;
  },
  termo: string
): boolean {
  const t = termo.trim();
  if (!t) return true;
  return (
    casaTexto(cliente.name, t) ||
    casaTexto(cliente.waName, t) ||
    casaTelefone(cliente.phone, t) ||
    casaTexto(cliente.city, t) ||
    casaTelefone(cliente.cpf, t) ||
    casaTelefone(cliente.cnpj, t)
  );
}

/**
 * ONDE O TERMO APARECE NO TEXTO — ignorando maiúscula e acento, mas
 * devolvendo a posição no texto ORIGINAL (é o que a tela precisa para
 * pintar a palavra achada sem trocar "Goiânia" por "goiania").
 *
 * Normalizar o texto inteiro e procurar nele não serve: "é" vira "e" + um
 * acento solto que é apagado, e a posição no texto normalizado deixa de
 * bater com a do original. Aqui cada caractere é normalizado sozinho e
 * lembra de onde veio.
 */
export function localizarTermo(
  texto: string,
  termo: string
): { inicio: number; fim: number } | null {
  const alvo = normalizarBusca(termo);
  if (!alvo) return null;
  let normalizado = "";
  const origem: number[] = []; // posição original de cada caractere normalizado
  let pos = 0;
  for (const ch of texto) {
    // caractere a caractere, SEM o trim do normalizador: o espaço entre
    // duas palavras tem que sobreviver, senão "blusa vermelha" nunca casa
    const n = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (let i = 0; i < n.length; i++) origem.push(pos);
    normalizado += n;
    pos += ch.length;
  }
  const idx = normalizado.indexOf(alvo);
  if (idx < 0) return null;
  // o fim é o começo do caractere seguinte ao último casado (ou o fim do texto)
  const fim = idx + alvo.length < origem.length ? origem[idx + alvo.length] : texto.length;
  return { inicio: origem[idx], fim };
}

/**
 * O PEDAÇO DO TEXTO em volta da palavra achada — como o aplicativo do
 * WhatsApp mostra na busca: "…quero a blusa VERMELHA tamanho M…". A palavra
 * vem separada (`casa`) para a tela pintar. Quebras de linha viram espaço:
 * a lista tem uma linha só.
 */
export type TrechoDaBusca = { antes: string; casa: string; depois: string };

/**
 * Uma mensagem achada pela lupa da Central: em qual conversa está, quando
 * foi, de que lado veio e o pedaço do texto em volta da palavra.
 */
export type MensagemAchada = {
  id: string;
  conversationId: string;
  createdAt: string;
  direction: "IN" | "OUT";
  trecho: TrechoDaBusca;
};

export function trechoDaBusca(texto: string, termo: string, folga = 40): TrechoDaBusca | null {
  const plano = texto.replace(/\s+/g, " ");
  const onde = localizarTermo(plano, termo);
  if (!onde) return null;
  const ini = Math.max(0, onde.inicio - folga);
  const fim = Math.min(plano.length, onde.fim + folga);
  return {
    antes: (ini > 0 ? "…" : "") + plano.slice(ini, onde.inicio),
    casa: plano.slice(onde.inicio, onde.fim),
    depois: plano.slice(onde.fim, fim) + (fim < plano.length ? "…" : ""),
  };
}

/**
 * AS PALAVRAS que a busca por mensagem vai procurar, a partir do que foi
 * digitado: só letras e números, sem acento. Letra solta cai fora ("R$ 100"
 * procura "100", não "r" — que casaria "reais" e pintaria uma letra), e sem
 * pelo menos uma palavra de 3 letras não há busca ("a b" abriria a loja
 * inteira). Vazio = nada a procurar (só emoji, só pontuação).
 */
export function palavrasDaBusca(termo: string): string[] {
  const palavras = (normalizarBusca(termo).match(/[a-z0-9]+/g) ?? []).filter(
    (p) => p.length >= 2
  );
  return palavras.some((p) => p.length >= 3) ? palavras : [];
}

/**
 * A CONSULTA DE PALAVRAS para o banco (`to_tsquery`): cada palavra vira
 * PREFIXO ("vermelh" acha "vermelha" e "vermelhas"), todas têm que aparecer,
 * em qualquer ordem. Só o que `palavrasDaBusca` deixa passar entra — é o que
 * o índice de texto conhece, e o que mantém a consulta a salvo de caractere
 * especial. Sem palavra, `null`.
 */
export function consultaDePalavras(termo: string): string | null {
  const palavras = palavrasDaBusca(termo);
  if (palavras.length === 0) return null;
  return palavras.map((p) => `${p}:*`).join(" & ");
}
