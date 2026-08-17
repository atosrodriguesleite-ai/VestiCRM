import { randomBytes } from "node:crypto";
import { db } from "../db";

/**
 * TABELAS DE PREÇO POR LINK (17/08/2026).
 *
 * A loja que atende LOJISTA e CLIENTE FINAL no mesmo catálogo gera dois
 * endereços do mesmo acervo: um com preço de atacado, outro de varejo. Manda
 * o de atacado para quem revende e o de varejo para quem compra uma peça.
 *
 * TRÊS REGRAS DE OURO:
 *  1. RECURSO GATED, DESLIGADO POR PADRÃO (`Company.priceTablesEnabled`).
 *     Loja que não ativa não muda em NADA: mesmo link, mesmo preço, mesma
 *     tela, e a exigência de quantidade mínima não existe para ela — nem se
 *     o catálogo dela já estiver no modo atacado (pedido do dono);
 *  2. o link não se ADIVINHA: o código é sorteado, não é o nome da loja com
 *     "/atacado" no fim;
 *  3. quem manda no preço é o SERVIDOR. O navegador diz por qual link entrou;
 *     o preço de cada peça é recalculado aqui (RN-009), e o pedido guarda a
 *     tabela usada (`Order.priceMode`) para a conta nunca mudar depois.
 */

export type ModoDePreco = "VAREJO" | "ATACADO";

/** Código do link (sorteado, curto o bastante para caber num WhatsApp). */
export function novoCodigoDeLink(): string {
  return randomBytes(6).toString("base64url"); // 8 caracteres
}

/** O texto vira um modo conhecido? Qualquer outra coisa é varejo. */
export function modoValido(bruto: string | null | undefined): ModoDePreco {
  return bruto === "ATACADO" ? "ATACADO" : "VAREJO";
}

export type LinkDeCatalogo = {
  id: string;
  name: string;
  code: string;
  priceMode: ModoDePreco;
};

/**
 * Acha o link ATIVO de uma loja pelo código. Devolve null quando o recurso
 * está desligado para a loja — assim um link antigo (ou de uma loja que
 * deixou de assinar) simplesmente deixa de valer, e o catálogo volta ao
 * comportamento padrão em vez de cobrar a tabela errada.
 */
export async function resolverLink(
  companyId: string,
  code: string | null | undefined,
  recursoLigado: boolean
): Promise<LinkDeCatalogo | null> {
  if (!recursoLigado || !code) return null;
  const link = await db.catalogLink.findFirst({
    where: { code, companyId, active: true },
    select: { id: true, name: true, code: true, priceMode: true },
  });
  return link ? { ...link, priceMode: modoValido(link.priceMode) } : null;
}

// ---- Quantidade mínima do atacado -------------------------------------------

export type LinhaDoPedido = { productId: string; quantity: number };
export type ProdutoComMinimo = { id: string; name: string; minQuantity: number };

export type FaltaNoMinimo = {
  productId: string;
  nome: string;
  pedido: number;
  minimo: number;
};

/**
 * Quais produtos estão ABAIXO da quantidade mínima de atacado.
 *
 * A conta é POR PRODUTO, somando todas as cores e tamanhos — é assim que a
 * vitrine promete ("Atacado: R$ 33,00 / peça a partir de 6 unidades"): 2 pretas
 * + 4 azuis do mesmo modelo fecham as 6.
 *
 * Só vale no link de ATACADO. No varejo, e em toda loja que não ativou o
 * recurso, devolve lista vazia — ninguém é barrado por uma regra que não pediu.
 */
export function faltaParaOMinimo(
  itens: LinhaDoPedido[],
  produtos: ProdutoComMinimo[],
  modo: ModoDePreco
): FaltaNoMinimo[] {
  if (modo !== "ATACADO") return [];
  const porProduto = new Map<string, number>();
  for (const i of itens) {
    porProduto.set(i.productId, (porProduto.get(i.productId) ?? 0) + i.quantity);
  }
  const faltas: FaltaNoMinimo[] = [];
  for (const p of produtos) {
    const pedido = porProduto.get(p.id) ?? 0;
    // produto que não está na sacola não entra na conta
    if (pedido === 0) continue;
    if (p.minQuantity > 1 && pedido < p.minQuantity) {
      faltas.push({ productId: p.id, nome: p.name, pedido, minimo: p.minQuantity });
    }
  }
  return faltas;
}

/** Recado pronto para a cliente (e para a lojista no histórico). */
export function textoDoMinimo(faltas: FaltaNoMinimo[]): string {
  if (faltas.length === 0) return "";
  const linhas = faltas.map(
    (f) => `• ${f.nome}: ${f.pedido} ${f.pedido === 1 ? "peça" : "peças"} (mínimo ${f.minimo})`
  );
  return (
    `Este é o catálogo de atacado, que tem quantidade mínima por modelo:\n${linhas.join("\n")}\n\n` +
    `Complete a quantidade para fechar o pedido — ou chame a loja no WhatsApp.`
  );
}
