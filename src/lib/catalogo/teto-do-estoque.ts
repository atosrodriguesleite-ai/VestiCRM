/**
 * TETO DE ESTOQUE NA VITRINE PÚBLICA (RN-067, 25/09/2026).
 *
 * Relato do dono com o print da Entre Linhas: a "Regata Cropped Poliamida"
 * tinha UMA peça no P e a cliente colocou OITO na sacola e mandou o pedido.
 * O servidor fazia a parte dele (RN-003: reservou a única que havia e anotou
 * a falta no pedido; RN-010: o pedido não pode ser recusado), mas a vitrine
 * só sabia "tem / não tem" — o `+` do tamanho aceitava qualquer número
 * enquanto houvesse uma peça. A cliente mandava 8 no WhatsApp achando que
 * vinham 8, e a loja descobria a diferença na hora de cobrar.
 *
 * Agora a vitrine recebe QUANTAS peças há de cada cor × tamanho e a
 * quantidade PARA nesse teto, dizendo "só N disponíveis" — a mesma régua
 * da grade de montar pedido (RN-062, "máx N"). O servidor continua sendo a
 * segunda tranca (estoque que cai entre montar e enviar segue anotado no
 * pedido): o teto aqui é o que evita a cliente pedir o que a vitrine já
 * sabia que não existe.
 *
 * Regra PURA, sem React: a mesma conta vale para o `+`, para a sacola que
 * volta do aparelho (localStorage) e para a sacola abandonada que volta pelo
 * link — três caminhos, uma régua.
 */

/** sacola da vitrine: chave do card (produto|cor) → tamanho → quantidade */
export type SacolaDaVitrine = Record<string, Record<string, number>>;

/**
 * Teto do que a vitrine oferece de UMA variação. O `stock` da peça já é o
 * DISPONÍVEL (a reserva dos pedidos abertos desconta dele, RN-003/RN-050);
 * nunca negativo (baixa condicionada, mas cadastro antigo pode ter lixo) e
 * limitado ao que a rota do pedido aceita numa linha.
 */
export const TETO_POR_LINHA = 9999;
export function disponivelNaVitrine(stock: number | null | undefined): number {
  if (typeof stock !== "number" || !Number.isFinite(stock)) return 0;
  return Math.max(0, Math.min(TETO_POR_LINHA, Math.floor(stock)));
}

/** A quantidade que cabe: nunca acima do disponível, nunca negativa. */
export function limitarQuantidade(qty: number, disponivel: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.min(Math.floor(qty), Math.max(0, disponivel));
}

/**
 * A frase ao lado do tamanho. Aparece quando a quantidade escolhida ENCOSTA
 * no teto (é aí que o `+` para de responder e a cliente precisa saber por
 * quê) e, para peça quase acabando, desde o começo — "só 1 disponível" antes
 * do primeiro toque evita montar a sacola em cima de peça que não há.
 * Esgotado (0) não é assunto daqui: o rótulo "esgotado" já existe.
 */
export const POUCAS_PECAS = 3;
export function avisoDoTeto(qty: number, disponivel: number): string | null {
  if (disponivel <= 0) return null;
  if (qty < disponivel && disponivel > POUCAS_PECAS) return null;
  if (disponivel === 1) return "só 1 disponível";
  return `só ${disponivel} disponíveis`;
}

/**
 * Sacola que VOLTA (do aparelho ou do link de sacola abandonada) passa pelo
 * estoque de HOJE: tamanho que não existe mais ou zerou sai, quantidade acima
 * do disponível desce até ele. Devolve se mexeu em algo, para a tela poder
 * dizer. `disponivelDe` responde undefined quando o card/tamanho não está
 * mais na vitrine.
 */
export function limitarSacola(
  sacola: SacolaDaVitrine,
  disponivelDe: (chave: string, tamanho: string) => number | undefined
): { sacola: SacolaDaVitrine; ajustou: boolean } {
  const limpa: SacolaDaVitrine = {};
  let ajustou = false;
  for (const [chave, tamanhos] of Object.entries(sacola)) {
    const porTamanho: Record<string, number> = {};
    for (const [tamanho, qty] of Object.entries(tamanhos)) {
      const disponivel = disponivelDe(chave, tamanho);
      if (disponivel === undefined) {
        ajustou = true;
        continue;
      }
      const cabe = limitarQuantidade(qty, disponivel);
      if (cabe !== qty) ajustou = true;
      if (cabe > 0) porTamanho[tamanho] = cabe;
    }
    if (Object.keys(porTamanho).length) limpa[chave] = porTamanho;
  }
  return { sacola: limpa, ajustou };
}

/**
 * LINK DE ATACADO (RN-018) × TETO DE ESTOQUE: o mínimo por modelo é exigido
 * pelo servidor, e quando o estoque do modelo inteiro não alcança o mínimo o
 * `+` para antes dele — a sacola pedia para "completar" o que a vitrine
 * recusa. A frase diz o porquê e o caminho (a loja, no WhatsApp). Não afrouxa
 * o mínimo: o preço de atacado é da loja, e a rota continua recusando abaixo
 * dele (mudar isso é regra de dinheiro, não desta entrega).
 */
export function avisoDoMinimoSemEstoque(minimo: number, disponivelDoModelo: number): string | null {
  if (minimo <= 1 || disponivelDoModelo >= minimo) return null;
  const n = Math.max(0, disponivelDoModelo);
  return `só há ${n} ${n === 1 ? "peça disponível" : "peças disponíveis"} deste modelo — chame a loja no WhatsApp para combinar`;
}
