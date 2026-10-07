/**
 * RN-071 · FOTOS PARA A CLIENTE — A RÉGUA PURA (o que a tela e a galeria
 * importam; o arquivo com banco é `link.ts` e não pode chegar ao navegador)
 *
 * RN-071 · FOTOS PARA A CLIENTE (pedido do dono, 07/10/2026): *"a cliente
 * sempre fica me pedindo foto das blusas"*. A vendedora escolhe as
 * categorias (ou todas) na Central e manda um link; a cliente abre uma
 * galeria no celular e baixa as fotos que quiser, UMA A UMA.
 *
 * Decisões do dono:
 *  - SÓ A FOTO: sem preço (a revendedora vai repostar com o preço dela) e
 *    sem marca d'água (ela usa nas redes sociais dela).
 *  - SEM ZIP: muita gente não consegue abrir — cada foto tem o seu "Baixar".
 *  - LINK ABERTO, válido por 7 DIAS: quem tem o link entra (depois de baixar
 *    a foto já está no celular dela — senha não protegeria nada); venceu, a
 *    cliente pede e a vendedora gera outro.
 *
 * O link é um FILTRO sobre as fotos do catálogo — nenhuma foto é copiada,
 * nada engorda o banco: a linha do link tem o código, as categorias e dois
 * contadores (aberturas e downloads). A galeria mostra o acervo de HOJE
 * (peça inativa ou que zerou some sozinha), e carrega a vendedora para a
 * venda que vier depois cair na comissão certa (RN-005).
 */

import { catalogDomain } from "../catalog-url";

export const VALIDADE_DO_LINK_DE_FOTOS_MS = 7 * 24 * 60 * 60 * 1000;
export const TETO_DE_CATEGORIAS = 60;

/** o que vem da tela vira uma lista limpa; lista vazia = todas */
export function normalizarCategorias(entrada: unknown): string[] {
  if (!Array.isArray(entrada)) return [];
  const vistas = new Set<string>();
  for (const c of entrada) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (!t || t.length > 80) continue;
    vistas.add(t);
    if (vistas.size >= TETO_DE_CATEGORIAS) break;
  }
  return [...vistas];
}

export function linkDeFotosVivo(link: { expiresAt: Date }, agora = new Date()): boolean {
  return link.expiresAt.getTime() > agora.getTime();
}

/** URL pública do link: curta no domínio de catálogos, interna sem ele */
export function urlDoLinkDeFotos(slug: string, code: string, domain?: string | null): string {
  const dom = domain !== undefined ? domain : catalogDomain();
  return dom ? `https://${dom}/${slug}/fotos/${code}` : `/catalogo/${slug}/fotos/${code}`;
}

export type PecaDaGaleria = {
  id: string;
  nome: string;
  cores: string[];
  fotos: { id: string; cor: string | null }[];
};
export type CategoriaDaGaleria = { categoria: string; pecas: PecaDaGaleria[]; fotos: number };

type ProdutoParaGaleria = {
  id: string;
  name: string;
  category: string;
  images: { id: string; color: string | null; order: number }[];
  variants: { color: string | null; stock: number }[];
};

const comparar = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare;

const chaveDaCor = (c: string | null | undefined) => (c ?? "").trim().toLocaleLowerCase("pt-BR");

/**
 * Monta a galeria: só peças COM foto, dentro das categorias escolhidas
 * (vazio = todas), categorias e peças em ordem alfabética e as fotos na
 * ordem da ficha. `soComEstoque` deixa de fora o que não tem unidade
 * disponível — a cliente não posta o que a loja não tem para vender — e
 * isso vale POR COR, não só por peça (achado da revisão): a regata com
 * Preto em estoque e Branco zerado mostra a foto do Preto e esconde a do
 * Branco (a foto sem cor marcada é da peça inteira e fica). As cores
 * listadas são as que têm estoque; peça que ficou sem foto some.
 */
export function montarGaleria(
  produtos: readonly ProdutoParaGaleria[],
  opts: { categorias: string[]; soComEstoque: boolean }
): CategoriaDaGaleria[] {
  const escolhidas = new Set(opts.categorias.map((c) => c.trim().toLocaleLowerCase("pt-BR")));
  const porCategoria = new Map<string, PecaDaGaleria[]>();
  for (const p of produtos) {
    if (p.images.length === 0) continue;
    const cat = p.category.trim() || "Outros";
    if (escolhidas.size && !escolhidas.has(cat.toLocaleLowerCase("pt-BR"))) continue;
    const variantes = opts.soComEstoque ? p.variants.filter((v) => v.stock > 0) : p.variants;
    if (opts.soComEstoque && variantes.length === 0) continue;
    const coresVivas = new Set(variantes.map((v) => chaveDaCor(v.color)).filter(Boolean));
    const fotos = [...p.images]
      .sort((a, b) => a.order - b.order)
      // foto marcada com uma cor que a peça TEM (em qualquer variação) e que
      // zerou fica fora; cor que não está na grade é só rótulo e passa
      .filter((i) => {
        if (!opts.soComEstoque || !i.color?.trim()) return true;
        const k = chaveDaCor(i.color);
        const existeNaGrade = p.variants.some((v) => chaveDaCor(v.color) === k);
        return !existeNaGrade || coresVivas.has(k);
      })
      .map((i) => ({ id: i.id, cor: i.color }));
    if (fotos.length === 0) continue;
    const cores = [...new Set(variantes.map((v) => v.color?.trim()).filter((c): c is string => !!c))];
    const lista = porCategoria.get(cat) ?? [];
    lista.push({ id: p.id, nome: p.name, cores, fotos });
    porCategoria.set(cat, lista);
  }
  return [...porCategoria.entries()]
    .sort(([a], [b]) => comparar(a, b))
    .map(([categoria, pecas]) => {
      pecas.sort((a, b) => comparar(a.nome, b.nome));
      return { categoria, pecas, fotos: pecas.reduce((s, p) => s + p.fotos.length, 0) };
    });
}

/**
 * O caminho da galeria para o catálogo da loja, levando a vendedora do
 * link (RN-005): a cliente que gostou da foto e vai pedir cai na comissão
 * de quem mandou as fotos. `ref` é o primeiro nome, a MESMA régua do link
 * rastreado (`trackedLinkParts`); sem vendedora, o catálogo puro.
 */
export function urlDoCatalogoDoLink(base: string, sellerRef: string | null): string {
  return sellerRef ? `${base}?ref=${encodeURIComponent(sellerRef)}` : base;
}

/** o nome do arquivo que a cliente salva: "Regata Alça - Preto.jpg" */
export function nomeDoArquivoDaFoto(peca: string, cor: string | null, indice: number): string {
  const base = [peca, cor].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const sufixo = indice > 0 ? ` ${indice + 1}` : "";
  return `${(base || "foto").slice(0, 80)}${sufixo}`;
}

/** a mensagem que vai pronta para o campo da Central */
export function mensagemDoLinkDeFotos(opts: { nomeDaCliente: string; url: string; categorias: string[] }): string {
  const primeiroNome = opts.nomeDaCliente.trim().split(/\s+/)[0] || "tudo bem";
  const doQue =
    opts.categorias.length === 0
      ? "de todas as peças"
      : opts.categorias.length <= 3
        ? `de ${opts.categorias.join(", ")}`
        : `de ${opts.categorias.slice(0, 2).join(", ")} e mais ${opts.categorias.length - 2} categorias`;
  return `Oi, ${primeiroNome}! 📸 Aqui estão as fotos ${doQue} para você baixar e postar:\n${opts.url}\nO link vale por 7 dias — se precisar depois, é só me pedir outro. 💛`;
}

