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
