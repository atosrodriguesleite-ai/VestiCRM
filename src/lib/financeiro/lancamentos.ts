import { round2 } from "../orders";

/**
 * O MOTOR DO LANÇAMENTO (RN-030) — regras puras, sem banco, testáveis.
 *
 * Conta a receber e conta a pagar são a MESMA peça: um lançamento com uma ou
 * mais PARCELAS, e cada parcela recebendo uma ou mais BAIXAS (o dinheiro
 * andando de verdade). Tudo que a tela mostra em vermelho ou verde é
 * CALCULADO aqui — nada de status digitado, que envelhece sozinho e mente.
 *
 * Três cuidados que já custaram dinheiro em sistemas parecidos moram aqui:
 *
 *  1. CENTAVO NÃO SOME. R$ 100 em 3× não é 33,33 três vezes (dá 99,99): a
 *     sobra vai para a ÚLTIMA parcela. A soma das parcelas é sempre igual ao
 *     valor do lançamento — senão a conta a receber nasce devendo um centavo
 *     para sempre.
 *  2. O DIA É O DE SÃO PAULO. Vencimento é DIA, não instante: guardado ao
 *     MEIO-DIA em UTC, para que nenhum fuso empurre "05/09" para "04/09".
 *  3. DESCONTO E JUROS NÃO SÃO A MESMA COISA QUE O ABATIMENTO. A parcela de
 *     R$ 100 paga com R$ 10 de multa abate 100 (quita) e movimenta 110 na
 *     conta. Misturar os dois faz o extrato divergir do banco.
 */

export type TipoLancamento = "RECEITA" | "DESPESA";

export const FORMAS_PAGAMENTO = [
  "PIX",
  "BOLETO",
  "DINHEIRO",
  "CARTAO",
  "DEBITO",
  "TRANSFERENCIA",
  "OUTRO",
] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const FORMA_LABEL: Record<FormaPagamento, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  DINHEIRO: "Dinheiro",
  CARTAO: "Cartão de crédito",
  DEBITO: "Débito em conta",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

/** O status é sempre DERIVADO (vencimento + baixas), nunca gravado. */
export type StatusParcela =
  | "QUITADA"
  | "PARCIAL"
  | "ATRASADA"
  | "VENCE_HOJE"
  | "PENDENTE"
  | "CANCELADA";

export const STATUS_LABEL: Record<StatusParcela, string> = {
  QUITADA: "Quitado",
  PARCIAL: "Parcial",
  ATRASADA: "Atrasado",
  VENCE_HOJE: "Vence hoje",
  PENDENTE: "Pendente",
  CANCELADA: "Cancelado",
};

export type BaixaSimples = {
  valor: number;
  desconto?: number | null;
  juros?: number | null;
  estornadaEm?: Date | null;
};

export type ParcelaSimples = {
  valor: number;
  vencimento: Date;
  baixas: BaixaSimples[];
};

/* ---- dia de São Paulo -------------------------------------------------- */

/**
 * O dia (AAAA-MM-DD) de um instante no fuso de São Paulo (UTC−3, sem horário
 * de verão desde 2019 — mesma régua já usada no Dashboard e no Financeiro).
 */
export function diaSP(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * "2026-09-05" (o que o campo de data manda) → instante do MEIO-DIA em UTC.
 *
 * Guardar meia-noite UTC parece inocente e não é: em São Paulo isso é 21h do
 * dia ANTERIOR, e a parcela apareceria vencendo um dia antes na tela e nos
 * relatórios. Ao meio-dia, qualquer fuso de ±11h continua no mesmo dia.
 */
export function dataDoDia(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(`${iso.trim()}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // "2026-02-30" não existe: o JavaScript viraria 2 de MARÇO em silêncio, e
  // um vencimento digitado errado cairia noutro mês sem ninguém ver. Se o dia
  // que saiu não é o dia que entrou, a data não existe — devolve null e quem
  // chama avisa a lojista.
  const [, ano, mes, dia] = m;
  if (
    d.getUTCFullYear() !== Number(ano) ||
    d.getUTCMonth() + 1 !== Number(mes) ||
    d.getUTCDate() !== Number(dia)
  )
    return null;
  return d;
}

/* ---- parcelamento ------------------------------------------------------ */

/**
 * Divide o valor em N parcelas SEM PERDER CENTAVO: todas iguais, e a sobra
 * (ou a falta) da divisão vai para a última. R$ 100 em 3× = 33,33 + 33,33 +
 * 33,34 — a soma bate com o valor, sempre.
 */
export function dividirEmParcelas(valor: number, n: number): number[] {
  if (n < 1) return [];
  const centavos = Math.round(round2(valor) * 100);
  const base = Math.trunc(centavos / n);
  const parcelas = Array.from({ length: n }, () => base / 100);
  const sobra = centavos - base * n;
  parcelas[n - 1] = round2(parcelas[n - 1] + sobra / 100);
  return parcelas;
}

/**
 * Vencimentos mensais a partir do primeiro: dia 31 em mês de 30 cai no dia
 * 30 (e não vaza para o mês seguinte, que é o que `setMonth` faz sozinho —
 * 31/01 + 1 mês viraria 03/03 e a parcela sumiria do mês de fevereiro).
 */
export function vencimentosMensais(primeiro: Date, n: number): Date[] {
  const dia = Number(diaSP(primeiro).slice(8, 10));
  const [ano, mes] = diaSP(primeiro).split("-").map(Number);
  const datas: Date[] = [];
  for (let i = 0; i < n; i++) {
    const alvoMes = mes - 1 + i; // 0-based para o Date
    const anoAlvo = ano + Math.floor(alvoMes / 12);
    const mesAlvo = ((alvoMes % 12) + 12) % 12;
    // dia 0 do mês SEGUINTE = último dia do mês alvo
    const ultimoDia = new Date(Date.UTC(anoAlvo, mesAlvo + 1, 0)).getUTCDate();
    datas.push(
      new Date(Date.UTC(anoAlvo, mesAlvo, Math.min(dia, ultimoDia), 12, 0, 0))
    );
  }
  return datas;
}

/* ---- baixas ------------------------------------------------------------ */

/** Baixa estornada não conta em lugar nenhum (mas continua no histórico). */
export function baixaAtiva(b: BaixaSimples): boolean {
  return !b.estornadaEm;
}

/**
 * O que a baixa MOVIMENTOU na conta: abatimento − desconto + juros.
 * É este número que entra no extrato e no saldo — não o abatimento.
 */
export function valorMovimentado(b: BaixaSimples): number {
  return round2(b.valor - (b.desconto ?? 0) + (b.juros ?? 0));
}

/** Quanto da parcela já foi abatido (só baixas ativas). */
export function totalAbatido(baixas: BaixaSimples[]): number {
  return round2(
    baixas.filter(baixaAtiva).reduce((s, b) => s + b.valor, 0)
  );
}

/** Quanto ainda falta pagar/receber desta parcela (nunca negativo). */
export function saldoDaParcela(p: ParcelaSimples): number {
  return round2(Math.max(0, p.valor - totalAbatido(p.baixas)));
}

/**
 * Uma baixa cabe? Não se pode abater mais do que a parcela deve — senão a
 * conta a receber fica "paga demais" e o relatório de recebimento estoura.
 * Devolve a mensagem do problema, ou null quando está tudo certo.
 */
export function conferirBaixa(
  p: ParcelaSimples,
  entrada: { valor: number; desconto?: number; juros?: number }
): string | null {
  if (!(entrada.valor > 0)) return "O valor da baixa precisa ser maior que zero";
  if ((entrada.desconto ?? 0) < 0 || (entrada.juros ?? 0) < 0)
    return "Desconto e juros não podem ser negativos";
  // desconto maior que o abatimento faria a baixa MOVIMENTAR NEGATIVO na
  // conta — dinheiro saindo de um recebimento (achado da revisão)
  if ((entrada.desconto ?? 0) > entrada.valor)
    return "O desconto não pode ser maior que o valor da baixa";
  const saldo = saldoDaParcela(p);
  if (saldo <= 0) return "Esta parcela já está quitada";
  // meio centavo de tolerância: o arredondamento do parcelamento não pode
  // impedir a lojista de quitar a última parcela
  if (entrada.valor > saldo + 0.005)
    return `Valor maior que o saldo da parcela (R$ ${saldo.toFixed(2)})`;
  return null;
}

/* ---- status ------------------------------------------------------------ */

/**
 * O status da parcela, calculado. `hoje` entra por parâmetro (nunca
 * `new Date()` aqui dentro) para o teste poder viajar no tempo.
 */
export function statusDaParcela(
  p: ParcelaSimples,
  hoje: Date,
  cancelado = false
): StatusParcela {
  if (cancelado) return "CANCELADA";
  const abatido = totalAbatido(p.baixas);
  // meio centavo de tolerância: R$ 33,33 + 33,33 + 33,34 fecha R$ 100
  if (abatido >= round2(p.valor) - 0.005) return "QUITADA";

  // O VENCIMENTO MANDA (achado da revisão 31/08/2026): parcela paga pela
  // metade E vencida é ATRASADA, não "parcial" — o dinheiro está atrasado do
  // mesmo jeito. Antes ela entrava no card "Atrasado" mas sumia ao filtrar
  // por atrasado, e a lojista cobrava a metade errada da lista.
  // PARCIAL fica sendo o que já tem parte paga e AINDA NÃO venceu.
  const dia = diaSP(p.vencimento);
  const hojeSP = diaSP(hoje);
  if (dia < hojeSP) return "ATRASADA";
  if (dia === hojeSP) return "VENCE_HOJE";
  if (abatido > 0) return "PARCIAL";
  return "PENDENTE";
}

/** Dias de atraso (0 quando não está atrasada) — a lista ordena por isso. */
export function diasDeAtraso(p: ParcelaSimples, hoje: Date): number {
  const venc = new Date(`${diaSP(p.vencimento)}T12:00:00.000Z`).getTime();
  const ref = new Date(`${diaSP(hoje)}T12:00:00.000Z`).getTime();
  return Math.max(0, Math.round((ref - venc) / (24 * 60 * 60 * 1000)));
}

/* ---- resumo do período -------------------------------------------------- */

export type ResumoPeriodo = {
  atrasado: number;
  venceHoje: number;
  pendente: number;
  quitado: number;
  total: number;
};

/**
 * Os cards do topo da tela. Cada parcela entra em UM balde só, e os quatro
 * baldes somam o total do período — se não somarem, algum status ficou de
 * fora e a lojista vê um dinheiro que não existe (ou deixa de ver um que
 * existe). O que ainda falta receber usa o SALDO; o quitado usa o abatido.
 */
export function resumoDoPeriodo(
  parcelas: (ParcelaSimples & { cancelado?: boolean })[],
  hoje: Date,
  /**
   * Recorte de LIQUIDAÇÃO: quando a tela pergunta "o que entrou/saiu de
   * verdade neste período", o card de recebido/pago não pode somar o
   * abatimento inteiro da parcela (que pode ter sido pago mês passado) —
   * soma o que MOVIMENTOU na conta dentro da janela, com juros e desconto,
   * que é o número que bate com o extrato do banco.
   */
  janelaLiquidacao?: { de: Date; ate: Date }
): ResumoPeriodo {
  const r: ResumoPeriodo = {
    atrasado: 0,
    venceHoje: 0,
    pendente: 0,
    quitado: 0,
    total: 0,
  };
  const dentro = janelaLiquidacao
    ? (b: BaixaSimples & { data?: Date }) =>
        !!b.data &&
        diaSP(b.data) >= diaSP(janelaLiquidacao.de) &&
        diaSP(b.data) <= diaSP(janelaLiquidacao.ate)
    : null;

  for (const p of parcelas) {
    const status = statusDaParcela(p, hoje, p.cancelado);
    if (status === "CANCELADA") continue;
    const saldo = saldoDaParcela(p);
    const ativas = p.baixas.filter(baixaAtiva);
    const quitadoAqui = dentro
      ? round2(ativas.filter(dentro).reduce((s, b) => s + valorMovimentado(b), 0))
      : totalAbatido(p.baixas);
    r.quitado = round2(r.quitado + quitadoAqui);
    if (status === "ATRASADA") r.atrasado = round2(r.atrasado + saldo);
    else if (status === "VENCE_HOJE") r.venceHoje = round2(r.venceHoje + saldo);
    else if (status !== "QUITADA") r.pendente = round2(r.pendente + saldo);
    r.total = round2(r.total + p.valor);
  }
  return r;
}

/* ---- o que pode ser mexido ---------------------------------------------- */

/**
 * Pode CANCELAR o lançamento? Não com baixa ativa: primeiro estorna (com
 * rastro), depois cancela. Apagar dinheiro que andou quebraria o extrato e a
 * conciliação — por isso a API nem tem DELETE.
 */
export function podeCancelarLancamento(parcelas: ParcelaSimples[]): string | null {
  const comBaixa = parcelas.some((p) => p.baixas.some(baixaAtiva));
  return comBaixa
    ? "Este lançamento tem baixa registrada. Estorne a baixa antes de cancelar."
    : null;
}

/**
 * Pode EDITAR valores/parcelas? Mesma régua: com dinheiro já movimentado, a
 * edição mudaria o passado. E lançamento que veio de venda (Fase 4) nunca
 * aceita edição de valor — a fonte da verdade é o pedido.
 */
export function podeEditarValores(
  parcelas: ParcelaSimples[],
  origem: string
): string | null {
  if (origem !== "MANUAL")
    return "Este lançamento veio de uma venda — o valor é o do pedido.";
  // QUALQUER baixa trava a edição, inclusive a já estornada (achado da
  // revisão 31/08/2026): editar refaz as parcelas, e as baixas penduradas
  // nelas iriam junto — inclusive as estornadas, que são justamente o
  // registro de que algo deu errado. Lançamento com movimento se CANCELA e
  // se refaz; o passado não se reescreve.
  const teveMovimento = parcelas.some((p) => p.baixas.length > 0);
  return teveMovimento
    ? "Este lançamento já teve baixa. Estorne e cancele-o, depois faça um novo — o histórico do dinheiro não se reescreve."
    : null;
}
