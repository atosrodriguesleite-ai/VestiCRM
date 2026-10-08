/**
 * TROCA DE PEÇAS — A REGRA PURA (RN-073).
 *
 * A cliente devolve peças de um pedido já pago e leva outras (do mesmo
 * modelo ou de outro). Pedido do dono (08/10/2026): *"estou tendo muita
 * troca nos produtos — como realizar essas trocas de forma mais simples no
 * sistema, levando em conta que temos a integração com a Nuvemshop"*.
 *
 * Decidido com ele: a troca é um REGISTRO PRÓPRIO, pendurado no pedido.
 * O pedido original NÃO muda (valor vendido, status, data da venda,
 * comissão e nota fiscal são história — reescrevê-los mexeria no mês já
 * fechado e lançado); o que muda é o ESTOQUE (livro de movimentos) e, se
 * houver, a DIFERENÇA de dinheiro, que fica aqui com a resolução escolhida.
 * O frete da troca é COMBINADO fora da conta (texto livre).
 *
 * Este arquivo não toca banco nem tela: é o que o navegador (prévia) e o
 * servidor (segunda tranca) conferem do MESMO jeito.
 */

import { PAID_ORDER_STATUSES, round2 } from "@/lib/orders";
import { STATUS_NA_FILA } from "@/lib/etiquetas/separacao-regra";

export type TrocaDestino = "ESTOQUE" | "DEFEITO";
export type TrocaResolucao = "SEM_DIFERENCA" | "COBRAR" | "CREDITO" | "DEVOLUCAO";

/**
 * Uma PEÇA do pedido como a troca precisa dela — agrupada por CHAVE, não por
 * linha. A chave é a VARIAÇÃO (ou o retrato nome|cor|tamanho quando a
 * variação foi apagada do cadastro). Por que não o id da linha: editar os
 * itens do pedido recria todas as linhas com ids novos (a porta de edição
 * apaga e recria), e um teto preso ao id da linha zerava a cada edição — a
 * mesma peça podia "voltar" duas vezes (achado da revisão).
 */
export type LinhaParaTroca = {
  /** `v:<variantId>` ou `s:<nome>|<cor>|<tamanho>` */
  chave: string;
  /** a primeira linha do pedido deste grupo (informativo, para o retrato) */
  orderItemId: string;
  variantId: string | null;
  productId: string | null;
  name: string;
  color: string | null;
  size: string | null;
  /** soma das linhas do grupo */
  quantity: number;
  /** o preço PAGO nesta linha (faz parte da chave) */
  unitPrice: number;
  /** o que JÁ voltou desta peça em trocas anteriores */
  jaDevolvidas: number;
};

export type ItemDoPedidoParaTroca = {
  id: string;
  variantId: string | null;
  productId: string | null;
  name: string;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
};

/**
 * A chave leva o PREÇO PAGO: duas linhas da mesma peça com preços
 * diferentes (uma promocional) são dois grupos — devolver a de R$ 20 vale
 * R$ 20 e a de R$ 32 vale R$ 32, em vez de valer o menor para todas
 * (achado da revisão). Como a edição de itens é bloqueada depois da
 * primeira troca, o preço da linha não muda por baixo da chave.
 */
export function chaveDaPeca(p: { variantId: string | null; name: string; color: string | null; size: string | null; unitPrice: number }): string {
  const preco = round2(p.unitPrice).toFixed(2);
  return p.variantId
    ? `v:${p.variantId}|${preco}`
    : `s:${p.name.trim().toLowerCase()}|${(p.color ?? "").trim().toLowerCase()}|${(p.size ?? "").trim().toLowerCase()}|${preco}`;
}

/**
 * Agrupa as linhas do pedido por chave e já anota o que voltou em trocas
 * anteriores (pela MESMA chave — a troca guarda variação e retrato).
 */
export function linhasParaTroca(
  itens: ItemDoPedidoParaTroca[],
  trocas: { itens: { sentido: string; variantId: string | null; name: string; color: string | null; size: string | null; unitPrice: number; quantity: number }[] }[]
): LinhaParaTroca[] {
  const devolvidas = devolvidasPorChave(trocas);
  const grupos = new Map<string, LinhaParaTroca>();
  for (const i of itens) {
    const chave = chaveDaPeca(i);
    const g = grupos.get(chave);
    if (g) {
      g.quantity += i.quantity;
    } else {
      grupos.set(chave, {
        chave,
        orderItemId: i.id,
        variantId: i.variantId,
        productId: i.productId,
        name: i.name,
        color: i.color,
        size: i.size,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        jaDevolvidas: devolvidas.get(chave) ?? 0,
      });
    }
  }
  return [...grupos.values()];
}

export type PecaQueVolta = { chave: string; quantity: number; destino: TrocaDestino };
export type PecaQueSai = { variantId: string; quantity: number; unitPrice: number };

/**
 * Em quais status se registra troca: a peça tem que ter SAÍDO da loja —
 * venda paga já enviada/entregue (RN-001) e a venda a prazo entregue
 * (RN-069). Pedido que ainda consta na loja (pago, em produção, separação)
 * NÃO troca: a Separação lê os itens do pedido e o Inventário conta o livro
 * como "reservado na loja" — uma troca ali deixava os dois contando a peça
 * de jeitos opostos (achado da revisão). Se a peça já foi com a cliente, o
 * caminho é marcar o pedido como entregue e aí registrar; se não foi, é
 * edição de itens. Derivado das listas, não escrito à mão.
 */
export const STATUS_QUE_ACEITAM_TROCA: readonly string[] = [
  ...PAID_ORDER_STATUSES.filter((s) => !(STATUS_NA_FILA as readonly string[]).includes(s)),
  "ENTREGUE_A_RECEBER",
];

export const RECUSA_TROCA_POR_STATUS =
  "Troca só se registra em pedido ENVIADO ou ENTREGUE (a peça já saiu com a cliente). Se ela já está com a peça, marque o pedido como entregue e registre; se ainda não saiu, edite os itens.";

export function aceitaTroca(status: string): boolean {
  return STATUS_QUE_ACEITAM_TROCA.includes(status);
}


const inteiroPositivo = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1;

/**
 * Quanto de cada linha ainda pode voltar: comprado − já devolvido. A troca
 * anterior conta — sem isso a mesma peça "voltava" duas vezes e o estoque
 * ganhava uma peça que não existe.
 */
export function restanteDaLinha(linha: Pick<LinhaParaTroca, "quantity" | "jaDevolvidas">): number {
  return Math.max(0, linha.quantity - linha.jaDevolvidas);
}

/** O que já voltou, por CHAVE da peça, somando as trocas anteriores. */
export function devolvidasPorChave(
  trocas: { itens: { sentido: string; variantId: string | null; name: string; color: string | null; size: string | null; unitPrice: number; quantity: number }[] }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trocas)
    for (const i of t.itens)
      if (i.sentido === "VOLTA") {
        const chave = chaveDaPeca(i);
        m.set(chave, (m.get(chave) ?? 0) + i.quantity);
      }
  return m;
}

/** Junta repetições da mesma linha/variação (a tela pode mandar duas vezes). */
export function juntarVoltas(volta: PecaQueVolta[]): PecaQueVolta[] {
  const m = new Map<string, PecaQueVolta>();
  for (const v of volta) {
    const chave = `${v.chave}|${v.destino}`;
    const atual = m.get(chave);
    if (atual) atual.quantity += v.quantity;
    else m.set(chave, { ...v });
  }
  return [...m.values()];
}

export function juntarSaidas(sai: PecaQueSai[]): PecaQueSai[] {
  const m = new Map<string, PecaQueSai>();
  for (const s of sai) {
    const atual = m.get(s.variantId);
    // preço diferente para a mesma variação não faz sentido numa troca: vale o
    // primeiro, e a quantidade soma
    if (atual) atual.quantity += s.quantity;
    else m.set(s.variantId, { ...s });
  }
  return [...m.values()];
}

/**
 * A conferência da troca — frase em português ou `null` quando está tudo
 * certo. Vale no navegador (antes de mandar) e no servidor (com os dados
 * relidos dentro da transação).
 */
export function validarTroca(
  linhas: LinhaParaTroca[],
  volta: PecaQueVolta[],
  sai: PecaQueSai[]
): string | null {
  if (volta.length === 0) return "Marque pelo menos uma peça que a cliente devolveu.";
  if (sai.length === 0)
    return "Escolha a peça que a cliente leva. Devolução sem peça nova não é troca — cancele o pedido ou ajuste os itens.";

  const porChave = new Map(linhas.map((l) => [l.chave, l]));
  const pedidoPorLinha = new Map<string, number>();
  for (const v of volta) {
    if (!inteiroPositivo(v.quantity)) return "Quantidade devolvida inválida.";
    if (v.destino !== "ESTOQUE" && v.destino !== "DEFEITO") return "Destino da peça devolvida inválido.";
    const linha = porChave.get(v.chave);
    if (!linha) return "Uma das peças devolvidas não é deste pedido.";
    pedidoPorLinha.set(v.chave, (pedidoPorLinha.get(v.chave) ?? 0) + v.quantity);
  }
  for (const [chave, q] of pedidoPorLinha) {
    const linha = porChave.get(chave)!;
    const restante = restanteDaLinha(linha);
    if (q > restante) {
      const nome = rotuloDaPeca(linha);
      return restante === 0
        ? `${nome}: todas as peças desta linha já voltaram em troca anterior.`
        : `${nome}: o pedido tem ${restante} ${restante === 1 ? "peça" : "peças"} que ainda ${restante === 1 ? "pode" : "podem"} voltar (você marcou ${q}).`;
    }
  }

  for (const s of sai) {
    if (!s.variantId) return "Peça que sai sem variação.";
    if (!inteiroPositivo(s.quantity)) return "Quantidade da peça que sai inválida.";
    if (typeof s.unitPrice !== "number" || !Number.isFinite(s.unitPrice) || s.unitPrice < 0)
      return "Preço da peça que sai inválido.";
  }
  return null;
}

/**
 * As somas: o que volta vale o preço que a cliente PAGOU no pedido (não o
 * preço de hoje — ela não paga mais caro pela peça que já era dela); o que
 * sai vale o combinado. Diferença positiva = a cliente deve; negativa = a
 * loja deve.
 */
export function somarTroca(
  linhas: LinhaParaTroca[],
  volta: PecaQueVolta[],
  sai: PecaQueSai[]
): { valorVolta: number; valorSai: number; diferenca: number } {
  const porChave = new Map(linhas.map((l) => [l.chave, l]));
  const valorVolta = round2(
    volta.reduce((s, v) => s + (porChave.get(v.chave)?.unitPrice ?? 0) * v.quantity, 0)
  );
  const valorSai = round2(sai.reduce((s, p) => s + p.unitPrice * p.quantity, 0));
  return { valorVolta, valorSai, diferenca: round2(valorSai - valorVolta) };
}

/**
 * O que se pode fazer com a diferença depende do SINAL dela: zero não tem o
 * que resolver; a cliente devendo só pode ser cobrada; a loja devendo
 * escolhe entre crédito na ficha e devolução (decisão do dono: "os dois").
 */
export function resolucoesPermitidas(diferenca: number): TrocaResolucao[] {
  if (Math.abs(diferenca) < 0.005) return ["SEM_DIFERENCA"];
  return diferenca > 0 ? ["COBRAR"] : ["CREDITO", "DEVOLUCAO"];
}

export function resolucaoValida(diferenca: number, resolucao: TrocaResolucao): boolean {
  return resolucoesPermitidas(diferenca).includes(resolucao);
}

/**
 * Sem diferença e crédito nascem ACERTADOS (não há dinheiro andando fora do
 * sistema); cobrança e devolução esperam alguém dizer que o dinheiro andou.
 */
export function nasceAcertada(resolucao: TrocaResolucao): boolean {
  return resolucao === "SEM_DIFERENCA" || resolucao === "CREDITO";
}

export const ROTULO_RESOLUCAO: Record<TrocaResolucao, string> = {
  SEM_DIFERENCA: "Sem diferença",
  COBRAR: "Cobrar da cliente",
  CREDITO: "Crédito na ficha da cliente",
  DEVOLUCAO: "Devolver o dinheiro",
};

export const ROTULO_DESTINO: Record<TrocaDestino, string> = {
  ESTOQUE: "voltou ao estoque",
  DEFEITO: "com defeito (não volta ao estoque)",
};

export function rotuloDaPeca(p: { name: string; color?: string | null; size?: string | null }): string {
  const det = [p.color, p.size].filter(Boolean).join(" ");
  return det ? `${p.name} (${det})` : p.name;
}

/**
 * OS MOVIMENTOS DO LIVRO que a troca gera (RN-003: o estoque anda pelo livro,
 * nunca por número digitado):
 *  - peça que volta BOA → ENTRADA (o estoque sobe);
 *  - peça que volta com DEFEITO → ENTRADA + SAÍDA sem pedido ("baixa por
 *    defeito"): o estoque não muda, mas o livro conta que ela voltou e foi
 *    baixada — e o pedido deixa de "segurá-la" (ela não está mais com a
 *    cliente), então cancelar o pedido depois não a devolve de novo;
 *  - peça que SAI → SAÍDA (o estoque desce; a reserva é condicional, RN-003).
 *
 * `comPedido` diz se o movimento leva o `orderId`: SIM quando o estoque
 * deste pedido é DAQUI (o livro do pedido fica coerente — cancelar depois da
 * troca devolve o que a cliente tem AGORA); NÃO quando a venda é da loja
 * online (a Nuvemshop baixou lá e o livro daqui nunca teve a SAÍDA dela —
 * uma ENTRADA presa ao pedido deixaria o "reservado" torto).
 */
export type MovimentoDaTroca = {
  variantId: string;
  type: "ENTRADA" | "SAIDA";
  quantity: number;
  comPedido: boolean;
  reason: string;
  /** quanto o estoque muda de fato (+ sobe, − desce, 0 defeito) */
  deltaEstoque: number;
};

export function movimentosDaTroca(
  linhas: LinhaParaTroca[],
  volta: PecaQueVolta[],
  sai: PecaQueSai[],
  ctx: { numeroDaTroca: number; pedido: string; estoqueDoPedidoEDaqui: boolean }
): MovimentoDaTroca[] {
  const porChave = new Map(linhas.map((l) => [l.chave, l]));
  const rotulo = `Troca ${ctx.numeroDaTroca} — pedido ${ctx.pedido}`;
  const out: MovimentoDaTroca[] = [];
  for (const v of volta) {
    const linha = porChave.get(v.chave);
    // linha sem vínculo (variação apagada do cadastro): não há onde devolver;
    // a troca registra que voltou, o estoque não muda
    if (!linha?.variantId) continue;
    if (v.destino === "ESTOQUE") {
      out.push({
        variantId: linha.variantId,
        type: "ENTRADA",
        quantity: v.quantity,
        comPedido: ctx.estoqueDoPedidoEDaqui,
        reason: `${rotulo}: devolvida pela cliente`,
        deltaEstoque: v.quantity,
      });
    } else {
      out.push({
        variantId: linha.variantId,
        type: "ENTRADA",
        quantity: v.quantity,
        comPedido: ctx.estoqueDoPedidoEDaqui,
        reason: `${rotulo}: devolvida com defeito`,
        deltaEstoque: 0,
      });
      out.push({
        variantId: linha.variantId,
        type: "SAIDA",
        quantity: v.quantity,
        comPedido: false,
        reason: `${rotulo}: baixa por defeito`,
        deltaEstoque: 0,
      });
    }
  }
  for (const s of sai) {
    out.push({
      variantId: s.variantId,
      type: "SAIDA",
      quantity: s.quantity,
      comPedido: ctx.estoqueDoPedidoEDaqui,
      reason: `${rotulo}: peça levada pela cliente`,
      deltaEstoque: -s.quantity,
    });
  }
  return out;
}

/**
 * O PACOTE EFETIVO do pedido é itens ± trocas: a peça que voltou sai da
 * conta, a que foi levada entra. É o que a edição de itens precisa saber
 * para não "devolver" ao estoque a peça que a cliente levou na troca nem
 * baixar de novo a que ela devolveu (achado da revisão): o livro do pedido
 * já conta a troca, os itens não.
 */
export function ajusteDasTrocasPorVariacao(
  trocas: { itens: { sentido: string; variantId: string | null; quantity: number; destino?: string | null }[] }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trocas)
    for (const i of t.itens) {
      if (!i.variantId) continue;
      // a peça com DEFEITO também saiu do pacote da cliente (voltou e foi baixada)
      const delta = i.sentido === "SAI" ? i.quantity : -i.quantity;
      m.set(i.variantId, (m.get(i.variantId) ?? 0) + delta);
    }
  return m;
}

/**
 * O PACOTE EFETIVO como lista de peças (variação, quantidade, rótulo): é o
 * que o pedido cancelado volta a RESERVAR ao ser restaurado — reservar os
 * itens originais traria de volta peças que, pelas trocas, já voltaram
 * todas, e deixaria fora as que a cliente de fato tem (achado da revisão).
 * Peça que só existe nas trocas usa o retrato guardado nelas.
 */
export function pacoteEfetivo(
  itens: { variantId: string | null; quantity: number; name: string; color: string | null; size: string | null }[],
  trocas: { itens: { sentido: string; variantId: string | null; quantity: number; name: string; color: string | null; size: string | null }[] }[]
): { variantId: string; quantity: number; name: string; color: string | null; size: string | null }[] {
  const porVariacao = new Map<string, { variantId: string; quantity: number; name: string; color: string | null; size: string | null }>();
  for (const i of itens) {
    if (!i.variantId) continue;
    const g = porVariacao.get(i.variantId);
    if (g) g.quantity += i.quantity;
    else porVariacao.set(i.variantId, { variantId: i.variantId, quantity: i.quantity, name: i.name, color: i.color, size: i.size });
  }
  for (const t of trocas)
    for (const i of t.itens) {
      if (!i.variantId) continue;
      const delta = i.sentido === "SAI" ? i.quantity : -i.quantity;
      const g = porVariacao.get(i.variantId);
      if (g) g.quantity += delta;
      else porVariacao.set(i.variantId, { variantId: i.variantId, quantity: delta, name: i.name, color: i.color, size: i.size });
    }
  return [...porVariacao.values()].filter((p) => p.quantity > 0);
}

/** Quanto cada variação muda de estoque, somado (para o espelho da Nuvemshop/Jueri). */
export function deltasPorVariacao(movs: MovimentoDaTroca[]): { variantId: string; delta: number }[] {
  const m = new Map<string, number>();
  for (const mv of movs) m.set(mv.variantId, (m.get(mv.variantId) ?? 0) + mv.deltaEstoque);
  return [...m].filter(([, d]) => d !== 0).map(([variantId, delta]) => ({ variantId, delta }));
}

// espaço comum no lugar do "espaço duro" do toLocaleString: a frase vai para
// a história do pedido e para a busca, e o caractere invisível atrapalha as duas
const brlSimples = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

/**
 * A frase da história do pedido — é o "registro de trocas como histórico"
 * que o dono pediu, legível sem abrir a troca.
 */
export function textoDaTroca(entrada: {
  numero: number;
  autor: string;
  volta: { nome: string; quantity: number; destino: TrocaDestino }[];
  sai: { nome: string; quantity: number }[];
  diferenca: number;
  resolucao: TrocaResolucao;
  freteCombinado?: string | null;
  motivo?: string | null;
}): string {
  const voltou = entrada.volta
    .map((v) => `${v.quantity}× ${v.nome}${v.destino === "DEFEITO" ? " (defeito)" : ""}`)
    .join(", ");
  const levou = entrada.sai.map((s) => `${s.quantity}× ${s.nome}`).join(", ");
  let dinheiro: string;
  if (entrada.resolucao === "SEM_DIFERENCA") dinheiro = "sem diferença de valor";
  else if (entrada.resolucao === "COBRAR")
    dinheiro = `diferença de ${brlSimples(entrada.diferenca)} a cobrar da cliente`;
  else if (entrada.resolucao === "CREDITO")
    dinheiro = `diferença de ${brlSimples(-entrada.diferenca)} virou crédito na ficha da cliente`;
  else dinheiro = `diferença de ${brlSimples(-entrada.diferenca)} a devolver para a cliente`;
  const partes = [
    `Troca ${entrada.numero} registrada por ${entrada.autor}: voltou ${voltou}; levou ${levou}; ${dinheiro}.`,
  ];
  if (entrada.motivo?.trim()) partes.push(`Motivo: ${entrada.motivo.trim()}.`);
  if (entrada.freteCombinado?.trim()) partes.push(`Frete: ${entrada.freteCombinado.trim()}.`);
  return partes.join(" ");
}

export function textoDoAcerto(entrada: { numero: number; autor: string; resolucao: TrocaResolucao; diferenca: number }): string {
  return entrada.resolucao === "COBRAR"
    ? `Troca ${entrada.numero}: diferença de ${brlSimples(entrada.diferenca)} recebida da cliente — confirmado por ${entrada.autor}.`
    : `Troca ${entrada.numero}: devolução de ${brlSimples(-entrada.diferenca)} feita à cliente — confirmado por ${entrada.autor}.`;
}

/** O saldo de crédito da cliente é a SOMA das linhas, nunca um número digitado. */
export function saldoDeCredito(linhas: { valor: number }[]): number {
  return round2(linhas.reduce((s, l) => s + l.valor, 0));
}

/**
 * RN-074 · USAR O CRÉDITO NUM PEDIDO NOVO. Em quais pedidos: os que ainda
 * NÃO FORAM PAGOS NEM ENTREGUES (orçamento, aguardando) — no pago o dinheiro
 * já entrou, e abater depois faria a loja "devolver" pelo livro o que a
 * cliente já pagou; e a venda a prazo ENTREGUE já contou comissão no dia da
 * entrega (RN-069) — abater ali baixaria o valor de um mês já fechado e
 * lançado (achado da revisão). O crédito usado antes de entregar segue
 * valendo quando o pedido anda. E nunca na venda da loja online: o valor dela é o
 * da Nuvemshop, que não fica sabendo do crédito.
 */
export const STATUS_QUE_USAM_CREDITO: readonly string[] = ["ORCAMENTO", "AGUARDANDO_PAGAMENTO"];

export function recusaDoCredito(pedido: { status: string; source: string | null; nuvemshopId: string | null }): string | null {
  if (pedido.source === "NUVEMSHOP" || pedido.nuvemshopId)
    return "Venda da loja online não usa crédito daqui — o valor dela é o da Nuvemshop.";
  if (!STATUS_QUE_USAM_CREDITO.includes(pedido.status))
    return pedido.status === "CANCELADO"
      ? "Pedido cancelado não usa crédito."
      : "O crédito só se usa em pedido que ainda não foi pago nem entregue — orçamento ou aguardando pagamento.";
  return null;
}

/**
 * Quanto do crédito entra: tudo o que a cliente tem, até o valor do pedido
 * (produtos − desconto + acréscimo, ANTES do crédito). O frete não é coberto
 * por crédito de troca: ele não é venda (RN-002) e vai para a transportadora.
 */
export function creditoAUsar(saldo: number, valorAntesDoCredito: number, jaAbatido: number): number {
  const espaco = round2(Math.max(0, valorAntesDoCredito - jaAbatido));
  return round2(Math.max(0, Math.min(saldo, espaco)));
}

/**
 * Os motivos da troca são um CARDÁPIO (os chips da tela), com o detalhe
 * opcional depois do travessão — é o que deixa o relatório contar por
 * motivo em vez de uma linha por frase digitada.
 */
export const MOTIVOS_DA_TROCA = ["Tamanho", "Cor", "Modelo", "Defeito", "Outro"] as const;

/** O texto gravado: "Chip — detalhe". Sem chip, o detalhe é "Outro". */
export function textoDoMotivo(chip: string, detalhe: string): string {
  const d = detalhe.trim();
  const c = chip.trim() || (d ? "Outro" : "");
  if (!c) return "";
  return d ? `${c} — ${d}` : c;
}
