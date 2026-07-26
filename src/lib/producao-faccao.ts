/**
 * Custo de facção — FONTE ÚNICA da verdade.
 *
 * Toda tela que fala em dinheiro de facção (Lotes, Dashboard, Cortes,
 * custo por peça) calcula por aqui. Regras do negócio:
 *
 * 1. PREÇO HISTÓRICO: o custo por peça é congelado em cada item do lote no
 *    momento do envio. Reajustar a tabela da facção NÃO reescreve o passado.
 *    Lote antigo (sem snapshot, preço 0) cai no preço atual da facção —
 *    é o melhor palpite disponível pra esses casos.
 * 2. PAGA-SE PELA PEÇA BOA: peça que voltou com defeito ou não voltou não
 *    entra na conta (o "previsto" do envio serve só de estimativa).
 * 3. O valor REALMENTE pago pode divergir (acordo, desconto): quando o
 *    lojista informa `paidAmount`, é ele que vale como custo efetivo.
 */

export type ItemCusto = {
  sent: number;
  good: number;
  defect: number;
  pricePerPiece: number;
};

export type LoteCusto = {
  destination: string;
  status: string;
  paymentStatus: string;
  paidAmount: number | null;
  items: ItemCusto[];
  faction?: { pricePerPiece: number } | null;
};

/** Preço por peça do item: snapshot do lote; se 0 (legado), o da facção. */
export function precoDoItem(
  item: { pricePerPiece: number },
  faction?: { pricePerPiece: number } | null
): number {
  return item.pricePerPiece > 0 ? item.pricePerPiece : (faction?.pricePerPiece ?? 0);
}

export type ValoresLote = {
  previsto: number; // enviadas × preço (estimativa do envio)
  aPagar: number; // peças boas × preço (o que a facção ganhou)
  pago: number; // o que foi efetivamente pago (0 enquanto pendente)
  saldo: number; // aPagar − pago (o que ainda se deve)
  pecasBoas: number;
  pecasEnviadas: number;
};

/** Valores financeiros de UM lote. */
export function valoresDoLote(lote: LoteCusto): ValoresLote {
  let previsto = 0;
  let aPagar = 0;
  let pecasBoas = 0;
  let pecasEnviadas = 0;
  for (const i of lote.items) {
    const preco = precoDoItem(i, lote.faction);
    previsto += i.sent * preco;
    aPagar += i.good * preco;
    pecasBoas += i.good;
    pecasEnviadas += i.sent;
  }
  // valor pago: o informado pelo lojista manda; sem valor informado, o
  // lote marcado como PAGO vale o calculado
  const pago =
    lote.paymentStatus === "PAGO"
      ? (lote.paidAmount ?? aPagar)
      : (lote.paidAmount ?? 0);
  return {
    previsto: round2(previsto),
    aPagar: round2(aPagar),
    pago: round2(pago),
    saldo: round2(Math.max(0, aPagar - pago)),
    pecasBoas,
    pecasEnviadas,
  };
}

/**
 * Custo médio REAL por peça costurada na facção — a métrica que entra no
 * custo por peça do Dashboard e da tela de Cortes. Só lotes de facção
 * FECHADOS (com a conta encerrada) e com preço conhecido entram.
 */
export function custoMedioFaccao(lotes: LoteCusto[]): number | null {
  let boas = 0;
  let custo = 0;
  for (const lote of lotes) {
    if (lote.destination !== "FACCAO" || lote.status !== "FECHADO") continue;
    for (const i of lote.items) {
      const preco = precoDoItem(i, lote.faction);
      if (preco <= 0) continue; // sem preço conhecido: fora da média
      boas += i.good;
      custo += i.good * preco;
    }
  }
  return boas > 0 ? round2(custo / boas) : null;
}

/**
 * O custo de facção já está lançado à mão nos custos extras do corte?
 *
 * O "custo completo por peça" soma tecido + extras + a média real da
 * facção. Se o lojista também cadastrou "Facção" na lista de custos
 * extras, a costura entraria DUAS VEZES e inflaria o preço de venda
 * calculado em cima disso. Detectado, o automático se cala e a tela avisa
 * qual valor está valendo.
 */
export function extrasTemFaccao(extras: { name: string }[]): boolean {
  return extras.some((e) =>
    /fac[çc][aãa]o|costur|oficina|terceir/i.test((e.name ?? "").trim())
  );
}

/** Lote atrasado: prazo de devolução venceu e ainda tem peça fora. */
export function loteAtrasado(
  lote: { status: string; dueBackDate: Date | string | null },
  pendentes: number,
  agora = new Date()
): boolean {
  if (lote.status === "FECHADO" || pendentes <= 0 || !lote.dueBackDate) return false;
  return new Date(lote.dueBackDate).getTime() < agora.getTime();
}

/** Pagamento vencido: previsão passou e o lote não foi pago. */
export function pagamentoVencido(
  lote: { paymentStatus: string; dueDate: Date | string | null },
  agora = new Date()
): boolean {
  if (lote.paymentStatus === "PAGO" || !lote.dueDate) return false;
  return new Date(lote.dueDate).getTime() < agora.getTime();
}

const round2 = (n: number) => Math.round(n * 100) / 100;
