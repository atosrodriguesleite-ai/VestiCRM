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
 *  - peça da NUVEMSHOP também vende sob encomenda (pedido do dono, mesmo
 *    dia: "mesmo sendo Nuvemshop, se a chave estiver ligada, pode estar
 *    disponível para venda"): o negativo fica AQUI e lá vai ZERO (a loja
 *    online não aceita negativo e para de vender o que já está devendo); a
 *    sincronização não apaga o negativo — o que entra lá cobre primeiro o
 *    que se deve (`estoqueDaSincronizacao`);
 *  - peça do JUERI não: a sync dele grava o número de lá duas vezes por dia
 *    e não há porta de volta — o "a produzir" sumiria na rodada seguinte.
 *    A tela nem oferece, o servidor é a segunda tranca;
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
  /** vínculo do PRODUTO com o Jueri (a peça da Nuvemshop vende, a do Jueri não) */
  jueriId?: string | null;
};

/** Peça do Jueri: a chavinha não vale nela (a sync dele apagaria o negativo). */
export function pecaDoJueri(f: Pick<FonteDaEncomenda, "jueriId">): boolean {
  return !!f.jueriId;
}

/** Vende sob encomenda? (a escada peça > categoria; Jueri nunca) */
export function vendeSobEncomenda(f: FonteDaEncomenda): boolean {
  return origemDaEncomenda(f) !== null;
}

/** De onde veio o "sim" — para a ficha dizer "pela categoria". Nulo = não vende. */
export function origemDaEncomenda(f: FonteDaEncomenda): OrigemDaEncomenda | null {
  if (pecaDoJueri(f)) return null;
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
    product: { sobEncomenda: boolean | null; category: string; jueriId?: string | null };
  },
>(variants: readonly V[], categorias: ReadonlySet<string>): Set<string> {
  const livres = new Set<string>();
  for (const v of variants) {
    if (
      vendeSobEncomenda({
        peca: v.product.sobEncomenda,
        categoria: categorias.has(v.product.category),
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

/**
 * O número que vai para a NUVEMSHOP: ela não aceita negativo, e a peça que
 * está devendo não tem nada para vender lá — vai zero.
 */
export function estoqueParaANuvemshop(stock: number): number {
  return Math.max(0, stock);
}

/**
 * O que a SINCRONIZAÇÃO grava aqui, a partir do número de lá. Sem negativo
 * aqui, vale o de lá (a Nuvemshop é a dona do estoque, RN-050). COM negativo
 * aqui, lá está em zero porque nós mandamos zero — o número de lá é o que
 * ENTROU depois (a loja lançou peças prontas na Nuvemshop), e elas cobrem
 * primeiro o que se deve: −3 aqui e 10 lá viram 7. Gravar o 0 de lá por
 * cima do −3 apagaria a conta do que há para produzir, e o próximo
 * cancelamento devolveria peças que nunca existiram (o livro diz que o
 * pedido segura 5, a arara tem 2). Vale com ou sem a chavinha ligada: o
 * negativo é dívida dos pedidos já vendidos, não da chavinha. Quem chama só
 * a aplica com o vínculo de SEMPRE (peça recém-ligada nunca recebeu o nosso
 * zero) e com número de verdade lá (infinito vale o de lá).
 */
export function estoqueDaSincronizacao(aqui: number, la: number): number {
  return aqui < 0 ? aqui + la : la;
}
