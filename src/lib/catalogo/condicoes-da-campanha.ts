/**
 * CONDIÇÕES DO LINK DE CAMPANHA (RN-040, 01/09/2026).
 *
 * Pedido do dono: "quando eu gero o link eu posso editar as condições dele...
 * o link que gerei já não posso mudar nada nele porque já estou usando na
 * campanha". É a regra inteira em uma frase:
 *
 *   O ENDEREÇO DO LINK É CONGELADO. AS CONDIÇÕES SÃO EDITÁVEIS.
 *
 * O `?ref=` já foi mandado no grupo do WhatsApp, impresso no QR da vitrine e
 * colado no story — mudar o endereço quebraria tudo isso em silêncio. Já o
 * desconto e o pedido mínimo daquele link a loja acerta quando quiser, e a
 * mudança vale na visita seguinte.
 *
 * TRÊS REGRAS DE OURO (as mesmas da RN-018, pelo mesmo motivo):
 *  1. quem manda no preço é o SERVIDOR. O navegador só diz por qual link
 *     entrou; o preço de cada peça é recalculado (RN-009);
 *  2. DESCONTOS NÃO SE SOMAM. Tabela de preço (RN-018) e catálogo de campanha
 *     com desconto (PromoCatalog) mandam mais que a condição do link: com os
 *     dois valendo, a cliente pagaria um valor que NENHUMA tela mostrou;
 *  3. campanha pausada ou excluída não aplica nada — o link volta a ser o
 *     catálogo normal da loja, com o preço e o mínimo de sempre. Ele nunca
 *     "quebra": pior que perder a condição é a cliente ver 404 num link que
 *     a loja divulgou.
 *
 * ESTE ARQUIVO É PURO — sem banco, sem Node. O catálogo público roda no
 * NAVEGADOR e importa a regra do mínimo daqui; qualquer dependência de
 * servidor aqui DERRUBA O DEPLOY (foi o deploy quebrado de 17/08/2026).
 */

export type ModoDeMinimo = "NONE" | "PECAS" | "VALOR";

/** A campanha como ela está no banco (só o que a regra precisa). */
export type CampanhaDoLink = {
  active: boolean;
  archivedAt: Date | null;
  discount: number;
  minOrderMode: string | null;
  minOrderPieces: number;
  minOrderValue: number;
};

/** O mínimo que a loja usa quando o link não manda outro. */
export type MinimoDaLoja = {
  minOrderMode: string;
  minOrder: number;
  minOrderValue: number;
};

export type CondicoesDoLink = {
  /** % de desconto a aplicar no preço do catálogo (0 = nenhum) */
  desconto: number;
  minOrderMode: ModoDeMinimo;
  minOrderPieces: number;
  minOrderValue: number;
  /** o link mandou alguma coisa diferente da loja? (é o que a tela avisa) */
  personalizado: boolean;
};

const modoValido = (bruto: string | null | undefined): ModoDeMinimo =>
  bruto === "PECAS" || bruto === "VALOR" ? bruto : "NONE";

/**
 * O desconto que vale, arredondado e dentro do limite. Fora de 0–90 não é
 * promoção, é engano de digitação: 100% sairia de graça e negativo COBRARIA
 * A MAIS. O teto mora aqui, junto da regra, e não só na tela.
 */
export const TETO_DE_DESCONTO = 90;
export function descontoValido(bruto: unknown): number {
  const n = Math.round(Number(bruto));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, TETO_DE_DESCONTO);
}

/** Preço com o desconto do link, em centavos fechados. */
export function precoComDesconto(preco: number, desconto: number): number {
  const d = descontoValido(desconto);
  if (!d) return preco;
  return Math.round(preco * (1 - d / 100) * 100) / 100;
}

/**
 * As condições que valem NESTA visita.
 *
 * `mandaOutro` é a trava do item 2: quando a visita já entrou por uma tabela
 * de preço ou por um catálogo de campanha com desconto, a condição do link
 * NÃO entra — nem o desconto, nem o mínimo.
 */
export function condicoesDoLink(
  campanha: CampanhaDoLink | null,
  loja: MinimoDaLoja,
  mandaOutro = false
): CondicoesDoLink {
  const padrao: CondicoesDoLink = {
    desconto: 0,
    minOrderMode: modoValido(loja.minOrderMode),
    minOrderPieces: loja.minOrder,
    minOrderValue: loja.minOrderValue,
    personalizado: false,
  };
  if (!campanha || !campanha.active || campanha.archivedAt || mandaOutro) return padrao;

  const desconto = descontoValido(campanha.discount);
  // mínimo próprio é OPCIONAL: sem ele, o link herda o da loja (a maioria
  // das campanhas só quer o desconto, e obrigar a redigitar o mínimo faria
  // a loja zerar sem querer o que já valia)
  const temMinimoProprio = campanha.minOrderMode !== null;
  const minOrderMode = temMinimoProprio
    ? modoValido(campanha.minOrderMode)
    : padrao.minOrderMode;
  const minOrderPieces = temMinimoProprio ? campanha.minOrderPieces : padrao.minOrderPieces;
  const minOrderValue = temMinimoProprio ? campanha.minOrderValue : padrao.minOrderValue;

  return {
    desconto,
    minOrderMode,
    minOrderPieces,
    minOrderValue,
    personalizado:
      desconto > 0 ||
      minOrderMode !== padrao.minOrderMode ||
      (minOrderMode === "PECAS" && minOrderPieces !== padrao.minOrderPieces) ||
      (minOrderMode === "VALOR" && minOrderValue !== padrao.minOrderValue),
  };
}

/**
 * Dá para APAGAR a campanha de verdade, ou ela precisa virar arquivada?
 *
 * Venda não se apaga (mesma régua da ficha de funcionário, RN-025): campanha
 * que já trouxe clique ou pedido guarda o histórico do faturamento. A que
 * nasceu de um erro de digitação, sem nenhum clique, some sem deixar saudade.
 */
export function podeApagarDeVez(uso: { clicks: number; orders: number }): boolean {
  return uso.clicks === 0 && uso.orders === 0;
}

/**
 * O PEDIDO PODE SER GRAVADO, OU A CLIENTE PRECISA DO LINK ATUALIZADO?
 *
 * A pergunta é uma só: o preço mudou desde que ela viu a vitrine? Se mudou,
 * gravar seria cobrar um valor que NENHUMA tela mostrou — para mais (ela
 * perdeu o desconto) ou para menos (a loja recebe menos do que combinou na
 * mensagem do WhatsApp). Os dois lados doem, então a conferência é simétrica.
 *
 * Campanha que só mexe no pedido MÍNIMO passa direto: 0 × 0, nada de preço a
 * proteger. Recusar ali perderia o pedido à toa — e o reenvio automático da
 * RN-010 DESCARTA o que volta recusado.
 */
export function precisaDoLinkAtualizado(
  descontoVisto: number,
  descontoAgora: number
): boolean {
  return descontoValido(descontoVisto) !== descontoValido(descontoAgora);
}

/**
 * O NOME e O DESCONTO escritos na mensagem do catálogo
 * ("_Campanha: Grupo Vip (20% OFF)_").
 *
 * ATENÇÃO: o texto é DIGITÁVEL — a cliente pode editar a mensagem do wa.me
 * antes de mandar. Por isso o número daqui é só uma PISTA para achar a
 * campanha; quem diz o desconto é o cadastro da loja (`descontoDoResgate`),
 * nunca o texto colado (achado da revisão de 01/09/2026).
 */

/**
 * O DESCONTO ESCRITO NA MENSAGEM DO CATÁLOGO — "_Campanha: Grupo Vip (20% OFF)_".
 *
 * Espelho do `tabelaNoTexto` (RN-018), pelo mesmo motivo e pelo mesmo
 * incidente: o resgate "Colar pedido do WhatsApp" (RN-012) remonta o pedido
 * pelo NOSSO cadastro, então sem ler este carimbo a lojista colava um pedido
 * que a cliente aprovou por R$ 800 e o sistema criava de R$ 1.000 — cobrando
 * a mais sem ninguém perceber (achado da revisão de 01/09/2026).
 */
export function campanhaNoTexto(texto: string): string | null {
  const linha = /^.*Campanha:.*$/im.exec(texto ?? "")?.[0];
  if (!linha) return null;
  // "_Campanha: Grupo Vip (20% OFF)_" → "Grupo Vip"
  const nome = linha
    .replace(/^.*Campanha:\s*/i, "")
    .replace(/\(\s*\d{1,3}\s*%\s*OFF\s*\)/gi, "")
    // só os marcadores das PONTAS (o WhatsApp usa _itálico_ e *negrito*):
    // limpar a linha inteira estragava nome com underline no meio, tipo
    // "Black_Friday", que então nunca casava (revisão de 01/09/2026)
    .replace(/^[_*\s]+|[_*\s]+$/g, "")
    .trim();
  return nome || null;
}

export function descontoNoTexto(texto: string): number {
  // A LINHA da campanha, não o texto inteiro
  const linha = /^.*Campanha:.*$/im.exec(texto ?? "")?.[0];
  if (!linha) return 0;
  // O ÚLTIMO "(NN% OFF)" da linha, não o primeiro: o catálogo escreve o
  // desconto no FIM, e campanha batizada de "Liquida (50% OFF)" hoje em 20%
  // faria o resgate remontar o pedido com 50% (achado da revisão de
  // 01/09/2026 — e o pedido guarda esses preços do jeito que vierem).
  const todos = [...linha.matchAll(/\((\d{1,3})\s*%\s*OFF\)/gi)];
  const ultimo = todos.at(-1);
  return ultimo ? descontoValido(ultimo[1]) : 0;
}

/**
 * O DESCONTO QUE VALE NO RESGATE (RN-012 + RN-040).
 *
 * O texto colado é digitável: trocar "(20% OFF)" por "(90% OFF)" daria 90%
 * sobre o preço do cadastro. Então o número do texto NÃO é usado — ele só
 * ajuda a achar a campanha, e o desconto sai do CADASTRO DA LOJA. Campanha
 * que não existe (ou já pausada) vale zero: preço cheio, como sempre foi.
 */
export type CampanhaDaLoja = {
  slug: string;
  name: string;
  discount: number;
  active: boolean;
  archivedAt: Date | null;
};

export type ResgateDaCampanha = {
  /** a campanha achada no cadastro (null = não achamos) */
  campanha: { slug: string; name: string } | null;
  /** o desconto que VALE (0 quando não achamos, ou quando ela não desconta) */
  desconto: number;
  /**
   * A mensagem citou campanha e não deu para honrar o desconto dela. É o que
   * a prévia AVISA: remontar a preço cheio calado é o incidente "aprovou por
   * R$ 800, o pedido nasceu R$ 1.000".
   */
  naoConfere: boolean;
};

export function descontoDoResgate(
  campanhaDoTexto: string | null,
  descontoDoTexto: number,
  campanhasDaLoja: CampanhaDaLoja[]
): ResgateDaCampanha {
  const vazio = { campanha: null, desconto: 0, naoConfere: false };
  if (!campanhaDoTexto) return vazio;
  const chave = campanhaDoTexto.trim().toLowerCase();
  const iguais = campanhasDaLoja.filter(
    (c) => c.active && !c.archivedAt && c.name.trim().toLowerCase() === chave
  );
  // não achamos: preço cheio, AVISANDO
  if (iguais.length === 0) return { campanha: null, desconto: 0, naoConfere: true };
  // DUAS CAMPANHAS ATIVAS COM O MESMO NOME ("Grupo Vip" no Instagram e no
  // WhatsApp): escolher uma seria chute, e o chute carimba o pedido na
  // campanha errada — quem conta os pedidos para a exclusão é esse carimbo.
  // Avisa, nunca adivinha (régua da RN-020, achado da revisão de 01/09/2026).
  if (iguais.length > 1) return { campanha: null, desconto: 0, naoConfere: true };
  const achada = iguais[0];
  const desconto = descontoValido(achada.discount);
  // ACHAMOS, MAS NÃO BATE com o que a mensagem diz. Acontece com xará (um
  // catálogo promocional e uma campanha com o mesmo nome) e com campanha
  // cujo desconto mudou depois. Aplicar o nosso em silêncio criaria o pedido
  // com valor que a cliente não aprovou (achado da revisão de 01/09/2026).
  if (descontoValido(descontoDoTexto) !== desconto) {
    return { campanha: { slug: achada.slug, name: achada.name }, desconto: 0, naoConfere: true };
  }
  return { campanha: { slug: achada.slug, name: achada.name }, desconto, naoConfere: false };
}
