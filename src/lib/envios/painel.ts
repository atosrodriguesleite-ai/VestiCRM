/**
 * Painel da tela Envios — as contas, puras e testáveis.
 *
 * Números que a lojista olha de manhã: quanto gastou de frete no mês, o que
 * está esperando ir para os Correios, o que está na estrada, o que chegou —
 * e o alerta que evita cliente brava: envio POSTADO que não anda há dias.
 *
 * `mePrice` é CUSTO da etiqueta (dinheiro que a loja pagou), não faturamento
 * — RN-002 não se aplica aqui (nada soma `total` de pedido).
 */

/** Postado há mais de isto sem entregar = "parado" (alerta amarelo). */
export const DIAS_PARA_PARADO = 7;

// São Paulo é UTC-3: meia-noite daqui é 03:00 em UTC (mesma régua do
// lib/periodo.ts — usar UTC cru fazia as vendas do fim da noite do dia 31
// caírem no dia 1º; aqui o gasto de agosto zeraria às 21h do dia 31)
const FUSO_SP = 3 * 60 * 60 * 1000;

/** Começo do mês ATUAL no horário de São Paulo (para o "gasto do mês"). */
export function inicioDoMesSP(agora: Date = new Date()): Date {
  const relogioSP = new Date(agora.getTime() - FUSO_SP);
  return new Date(
    Date.UTC(relogioSP.getUTCFullYear(), relogioSP.getUTCMonth(), 1) + FUSO_SP
  );
}

/**
 * Valor em reais digitado do jeito brasileiro (ou não): "1.500,50", "150,5",
 * "150.50" e "1500" têm que virar o número certo. Tratar TODO ponto como
 * milhar transformava "150.50" em 15.050 — e o seguro inflado mudava o preço
 * do frete dito à cliente.
 */
export function lerValorBR(texto: string): number {
  const s = texto.trim().replace(/[R$\s]/g, "");
  if (!s) return NaN;
  // tem vírgula: ela é o decimal, pontos são milhar ("1.500,50")
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  // só pontos no formato de milhar ("1.500", "12.345.678") → remove
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  // o resto é número simples, ponto é decimal ("150.50", "1500")
  return Number(s);
}

/** Situações que contam como "aguardando postagem" (etiqueta na mão). */
export const AGUARDANDO_POSTAGEM = ["COMPRADO", "GERANDO", "ETIQUETA"] as const;

/** O envio está parado? (postado, sem desfecho, há mais de DIAS_PARA_PARADO) */
export function estaParado(
  meStatus: string | null,
  postadoEm: Date | string | null,
  agora: Date = new Date()
): boolean {
  if (meStatus !== "POSTADO" || !postadoEm) return false;
  const d = typeof postadoEm === "string" ? new Date(postadoEm) : postadoEm;
  return agora.getTime() - d.getTime() > DIAS_PARA_PARADO * 24 * 60 * 60 * 1000;
}

export type ResumoEnvios = {
  /** custo das etiquetas compradas no mês (etiqueta cancelada fica de fora) */
  gastoMes: number;
  /**
   * FRETE COBRADO DAS CLIENTES no mês — RN-064 (pedido do dono, 23/09/2026:
   * "temos o gasto com as etiquetas, queria o quanto recebi de frete"). É a
   * soma do campo de frete (`Order.shippingFee`) dos pedidos PAGOS (RN-001)
   * pela data do pagamento — a mesma régua do faturamento —, não do `total`
   * (que teria o valor das peças junto). Frete é receita à parte do valor
   * vendido (RN-002), por isso tem número próprio e não entra em nenhum
   * faturamento. Todos os canais: pedido da loja online também cobrou frete.
   */
  freteRecebidoMes: number;
  /** quantos pedidos pagos no mês tinham frete cobrado (> 0) */
  pedidosComFreteMes: number;
  /**
   * O SALDO É SOBRE OS MESMOS PEDIDOS (achado da revisão, 23/09/2026): a
   * primeira versão subtraía o "gasto do mês" (etiquetas COMPRADAS no mês,
   * de qualquer pedido) do frete dos pedidos PAGOS no mês — duas populações.
   * Pedido pago dia 30 com etiqueta comprada dia 1º do mês seguinte virava
   * "faltou R$ 35" em vermelho num frete totalmente coberto; e pedido da
   * Nuvemshop (frete cobrado lá, etiqueta comprada lá) inflava a sobra.
   * Agora o saldo compara, DENTRO dos pedidos pagos no mês, só os que têm
   * etiqueta comprada AQUI (não cancelada): o frete cobrado neles menos o
   * que essas etiquetas custaram. Mesma turma dos dois lados.
   */
  freteComEtiquetaMes: number;
  /** o que as etiquetas DESSES pedidos custaram (não canceladas) */
  custoDasEtiquetasMes: number;
  /** freteComEtiquetaMes − custoDasEtiquetasMes; null = nenhum pedido pago do mês tem etiqueta daqui */
  saldoFreteMes: number | null;
  /** etiqueta comprada, caixa ainda na loja */
  aguardandoPostagem: number;
  /** na estrada (postado, sem desfecho) */
  emTransito: number;
  entregues: number;
  devolvidos: number;
  /** postados há mais de DIAS_PARA_PARADO sem entregar */
  parados: number;
  /** média postagem→entrega dos desfechos recentes, em dias (null = sem dado) */
  mediaEntregaDias: number | null;
};

export function resumoDosEnvios(dados: {
  porStatus: { meStatus: string | null; quantidade: number }[];
  gastoMes: number;
  freteRecebidoMes: {
    soma: number;
    pedidos: number;
    /** só os pedidos pagos do mês COM etiqueta daqui: frete cobrado e custo */
    comEtiqueta: { frete: number; custo: number; pedidos: number };
  };
  parados: number;
  entregues: { shippedAt: Date | null; deliveredAt: Date | null }[];
}): ResumoEnvios {
  const conta = (situacoes: readonly string[]) =>
    dados.porStatus
      .filter((s) => s.meStatus && situacoes.includes(s.meStatus))
      .reduce((soma, s) => soma + s.quantidade, 0);

  // média em DIAS CORRIDOS, uma casa: postado 10h de sexta, entregue 9h de
  // segunda = 3 dias na cabeça da lojista (é o que a cliente sente)
  const duracoes = dados.entregues
    .filter((e) => e.shippedAt && e.deliveredAt)
    .map(
      (e) =>
        (e.deliveredAt!.getTime() - e.shippedAt!.getTime()) / (24 * 60 * 60 * 1000)
    )
    .filter((d) => d >= 0);
  const mediaEntregaDias =
    duracoes.length > 0
      ? Math.round((duracoes.reduce((s, d) => s + d, 0) / duracoes.length) * 10) / 10
      : null;

  const centavos = (n: number) => Math.round(n * 100) / 100;
  const { comEtiqueta } = dados.freteRecebidoMes;
  const freteComEtiquetaMes = centavos(comEtiqueta.frete);
  const custoDasEtiquetasMes = centavos(comEtiqueta.custo);
  return {
    gastoMes: centavos(dados.gastoMes),
    freteRecebidoMes: centavos(dados.freteRecebidoMes.soma),
    pedidosComFreteMes: dados.freteRecebidoMes.pedidos,
    freteComEtiquetaMes,
    custoDasEtiquetasMes,
    // em centavos, senão 0,1 + 0,2 vira 0,30000000000000004 na tela; sem
    // pedido com etiqueta não há saldo a dizer (null, não zero)
    saldoFreteMes:
      comEtiqueta.pedidos > 0 ? centavos(freteComEtiquetaMes - custoDasEtiquetasMes) : null,
    aguardandoPostagem: conta(AGUARDANDO_POSTAGEM),
    emTransito: conta(["POSTADO"]),
    entregues: conta(["ENTREGUE"]),
    devolvidos: conta(["DEVOLVIDO"]),
    parados: dados.parados,
    mediaEntregaDias,
  };
}
