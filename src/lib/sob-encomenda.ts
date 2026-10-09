/**
 * VENDE SOB ENCOMENDA (RN-076, 09/10/2026) — a parte PURA, lida pela tela e
 * pelo servidor (ADR-012: tela não arrasta código de banco).
 *
 * Pedido do dono: *"tenho clientes de confecção — às vezes não tem pronto,
 * mas pode produzir. Em cada produto ou categoria eu posso ligar uma
 * chavinha para esse produto vender infinitamente, mesmo que o estoque
 * fique negativo. Nasce desligada para todos."* Decidido com ele:
 *
 *  - a chavinha mora na CATEGORIA e na PEÇA, e a peça manda mais
 *    (`Product.sobEncomenda`: nulo segue a categoria; true/false decide) —
 *    a mesma escada do mínimo (RN-051) e do NCM (RN-055): liga em
 *    "Conjuntos" e desliga só no kit que não se produz;
 *  - com ela ligada o estoque pode ficar NEGATIVO: "−3" = 3 a produzir. A
 *    baixa deixa de ser condicionada (RN-003 continua valendo para todas as
 *    outras peças); cancelar devolve e a produção lançada cobre o negativo
 *    primeiro, sem conta especial — é só soma;
 *  - vale em TODA porta de venda (catálogo público, Central, Colar pedido,
 *    Novo pedido, Editar itens, restaurar cancelado): a peça passa livre,
 *    sem a janela "estou ciente" da peça extra (RN-075) — a chavinha JÁ é a
 *    ciência, dada uma vez pela gerência;
 *  - a vitrine não muda NADA para a cliente (sem selo, sem prazo): a peça só
 *    não some ao zerar e a quantidade não para no estoque (RN-067);
 *  - peça vinculada à Nuvemshop ou ao Jueri NUNCA vende sob encomenda: o
 *    estoque é de lá (RN-050), e negativo aqui viraria zero lá por cima do
 *    nosso número. A tela nem oferece, o servidor é a segunda tranca;
 *  - fora do alerta de mínimo (RN-051): negativo é esperado, alerta todo dia
 *    vira barulho — a peça tem o próprio recorte, "A produzir", no Estoque.
 */

export type OrigemDaEncomenda = "PECA" | "CATEGORIA";

/** O que decide se UMA variação vende sob encomenda. */
export type FonteDaEncomenda = {
  /** `Product.sobEncomenda`: nulo = segue a categoria */
  peca: boolean | null | undefined;
  /** a categoria da peça está na lista `SobEncomendaCategoria`? */
  categoria: boolean;
  /** vínculo da VARIAÇÃO com a Nuvemshop */
  nuvemshopId?: string | null;
  /** vínculo do PRODUTO com o Jueri */
  jueriId?: string | null;
};

/** Esta peça é de dono externo? Então a chavinha não vale nela. */
export function pecaVinculada(f: Pick<FonteDaEncomenda, "nuvemshopId" | "jueriId">): boolean {
  return !!f.nuvemshopId || !!f.jueriId;
}

/** Vende sob encomenda? (a escada peça > categoria; vinculada nunca) */
export function vendeSobEncomenda(f: FonteDaEncomenda): boolean {
  return origemDaEncomenda(f) !== null;
}

/** De onde veio o "sim" — para a ficha dizer "pela categoria". Nulo = não vende. */
export function origemDaEncomenda(f: FonteDaEncomenda): OrigemDaEncomenda | null {
  if (pecaVinculada(f)) return null;
  if (f.peca === true) return "PECA";
  if (f.peca === false) return null;
  return f.categoria ? "CATEGORIA" : null;
}

/**
 * O conjunto das variações LIVRES (vendem sob encomenda) entre as que uma
 * porta carregou — é o que a reserva recebe para baixar sem condição.
 */
export function variacoesSobEncomenda<
  V extends {
    id: string;
    nuvemshopId?: string | null;
    product: { sobEncomenda: boolean | null; category: string; jueriId?: string | null };
  },
>(variants: readonly V[], categorias: ReadonlySet<string>): Set<string> {
  const livres = new Set<string>();
  for (const v of variants) {
    if (
      vendeSobEncomenda({
        peca: v.product.sobEncomenda,
        categoria: categorias.has(v.product.category),
        nuvemshopId: v.nuvemshopId,
        jueriId: v.product.jueriId,
      })
    )
      livres.add(v.id);
  }
  return livres;
}

/** "−3 · a produzir": quantas peças o estoque negativo está devendo. */
export function aProduzir(stock: number): number {
  return stock < 0 ? -stock : 0;
}
