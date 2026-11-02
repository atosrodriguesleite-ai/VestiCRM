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

/**
 * Postado há mais de isto sem entregar = "parado" — a régua de RESERVA, só
 * para o envio SEM prazo gravado (etiqueta de antes da RN-102). Com o prazo
 * da transportadora, quem decide é `atrasoDoEnvio`.
 */
import { diaSP } from "../dia";
import { TIMEZONE } from "../format";

export const DIAS_PARA_PARADO = 7;
/**
 * FOLGA depois da previsão (RN-102): a transportadora promete em dias úteis
 * e entrega "até"; um dia de tolerância evita acusar atraso na manhã
 * seguinte ao vencimento, quando o pacote ainda está saindo para entrega.
 */
export const FOLGA_DIAS = 1;
/** teto do prazo aceito na compra (dias úteis) — acima disso é número torto */
export const PRAZO_MAXIMO_DIAS = 60;

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

const DIA_MS = 24 * 60 * 60 * 1000;
const aData = (v: Date | string | null | undefined): Date | null =>
  v == null ? null : typeof v === "string" ? new Date(v) : v;

/**
 * O PRAZO em dias úteis que vale guardar (RN-102): número positivo, inteiro,
 * preso entre 1 e o teto — ou `null` quando não há prazo que valha (vazio,
 * zero, texto). É informação, não trava: a compra da etiqueta NUNCA é
 * recusada por causa dele (a tela e a porta passam pelo mesmo filtro).
 */
export function normalizarPrazoDias(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(PRAZO_MAXIMO_DIAS, Math.round(n)));
}

/** fim do dia (23:59:59.999) de São Paulo de um dia AAAA-MM-DD */
const fimDoDiaSP = (iso: string) => new Date(`${iso}T23:59:59.999-03:00`);

/**
 * ATÉ QUANDO A TRANSPORTADORA PROMETEU ENTREGAR (RN-102): `prazoDias` dias
 * ÚTEIS contados da postagem, no calendário de São Paulo (`diaSP`, a régua
 * do dia da casa) — o dia da postagem é o dia zero, sábado e domingo não
 * contam, e a previsão é o FIM do último dia útil (23:59:59 em SP). Feriado
 * não entra (limite dito): a folga de um dia cobre o feriado solto.
 *
 * Postado na sexta com prazo 2 → segunda não conta (é o 1º dia útil DEPOIS
 * da postagem: segunda = 1, terça = 2) → previsão terça 23:59.
 */
export function previsaoDeEntrega(postadoEm: Date | string, prazoDias: number): Date {
  const dias = normalizarPrazoDias(prazoDias) ?? 1;
  // o dia da postagem em SP, como contagem de dias (meio-dia UTC daquele dia)
  const dia = new Date(`${diaSP(aData(postadoEm)!)}T12:00:00.000Z`);
  let uteis = 0;
  while (uteis < dias) {
    dia.setUTCDate(dia.getUTCDate() + 1);
    const semana = dia.getUTCDay();
    if (semana !== 0 && semana !== 6) uteis += 1;
  }
  return fimDoDiaSP(dia.toISOString().slice(0, 10));
}

/**
 * O que a POSTAGEM carimba no envio (RN-102): a previsão de entrega, uma vez
 * só, a partir do prazo da cotação. Escrita UMA vez e usada pelos DOIS
 * caminhos que marcam a saída do pacote — o rastreio da transportadora
 * (`aplicarRastreio`) e o "Enviado" marcado à mão na ficha do pedido —,
 * porque a vendedora costuma marcar Enviado ao deixar a caixa no correio,
 * horas antes de a transportadora dizer "postado"; só o caminho do rastreio
 * carimbar deixava justamente o fluxo mais comum na régua antiga dos 7 dias
 * (achado da revisão). A base é a saída que JÁ está gravada, senão a de agora.
 */
export function carimboDaPostagem(
  envio: { prazoDias?: number | null; previstoAte?: Date | null; shippedAt?: Date | null },
  postou: Date
): { previstoAte: Date } | Record<string, never> {
  if (!envio.prazoDias || envio.previstoAte) return {};
  return { previstoAte: previsaoDeEntrega(envio.shippedAt ?? postou, envio.prazoDias) };
}

export type AtrasoDoEnvio = {
  /** postado, sem desfecho, e passou da previsão (ou dos 7 dias, sem prazo) */
  atrasado: boolean;
  /** a previsão da transportadora, quando existe */
  previstoAte: Date | null;
  /** dias inteiros além da previsão (0 quando não atrasado ou sem previsão) */
  diasAlem: number;
  /** o atraso foi decidido pela régua antiga dos 7 dias (envio sem prazo) */
  pelaReguaAntiga: boolean;
};

/**
 * O envio está ATRASADO? (RN-102) Com previsão gravada: postado, sem desfecho
 * e já passou da previsão mais a folga. Sem previsão: a régua antiga — postado
 * há mais de DIAS_PARA_PARADO. Função pura: a tela, a lista e a contagem no
 * banco (`ondeAtrasado`) têm que concordar, e o teste prende.
 */
export function atrasoDoEnvio(
  envio: {
    meStatus: string | null;
    postadoEm: Date | string | null;
    previstoAte?: Date | string | null;
    /** a entrega marcada À MÃO na ficha (o pedido virou Entregue antes de a transportadora dizer): chegou, não há atraso */
    entregueEm?: Date | string | null;
  },
  agora: Date = new Date()
): AtrasoDoEnvio {
  const postou = aData(envio.postadoEm);
  const previsto = aData(envio.previstoAte);
  const nada: AtrasoDoEnvio = { atrasado: false, previstoAte: previsto, diasAlem: 0, pelaReguaAntiga: false };
  if (envio.meStatus !== "POSTADO" || !postou || aData(envio.entregueEm)) return nada;
  if (previsto) {
    const alem = (agora.getTime() - previsto.getTime()) / DIA_MS;
    return { atrasado: alem > FOLGA_DIAS, previstoAte: previsto, diasAlem: Math.max(0, Math.floor(alem)), pelaReguaAntiga: false };
  }
  const parado = agora.getTime() - postou.getTime() > DIAS_PARA_PARADO * DIA_MS;
  return { atrasado: parado, previstoAte: null, diasAlem: 0, pelaReguaAntiga: true };
}

/**
 * A MESMA régua de `atrasoDoEnvio`, escrita para o banco (o `where` do
 * Prisma): postado, COM data de postagem, SEM entrega marcada, E (previsão
 * vencida com a folga OU, sem previsão, postado há mais de 7 dias). Uma
 * cláusula só para a contagem e a lista dos atrasados — e o e2e confere,
 * linha a linha, que ela e a função pura concordam. O `shippedAt` não nulo
 * entra nos dois ramos de propósito: voltar o pedido para antes do envio
 * limpa a postagem (e a previsão), e a linha que só tivesse a previsão
 * contaria no cartão sem aparecer na aba (achado da revisão). E
 * `deliveredAt` nulo: a entrega marcada À MÃO na ficha ("a cliente avisou
 * que chegou") deixa o `meStatus` em POSTADO até a transportadora dizer —
 * sem isso o pacote entregue virava "atrasado" no mapa e no sino (achado da
 * revisão).
 */
export function ondeAtrasado(agora: Date = new Date()) {
  return {
    meStatus: "POSTADO" as const,
    shippedAt: { not: null },
    deliveredAt: null,
    OR: [
      { previstoAte: { lt: new Date(agora.getTime() - FOLGA_DIAS * DIA_MS) } },
      { previstoAte: null, shippedAt: { lt: new Date(agora.getTime() - DIAS_PARA_PARADO * DIA_MS) } },
    ],
  };
}

/** dd/mm no calendário de São Paulo, para o texto do aviso */
const ddmm = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIMEZONE });

/**
 * O TEXTO DO AVISO quando o pacote atrasa (RN-103) — função pura, uma para o
 * sino, o push e a linha no histórico do pedido. Com previsão: diz a data
 * prometida e quantos dias já passaram, e manda cobrar a transportadora e
 * avisar a cliente. Sem previsão (régua antiga): diz "parado", nunca
 * "atrasado" — a mesma honestidade do chip da tela. Sem atraso, `null`.
 */
export function avisoDeAtraso(
  envio: { pedido: string; cliente: string; transportadora?: string | null },
  atraso: AtrasoDoEnvio
): { titulo: string; corpo: string; evento: string } | null {
  if (!atraso.atrasado) return null;
  const quem = `${envio.pedido} · ${envio.cliente}`;
  const transp = envio.transportadora ? ` (${envio.transportadora})` : "";
  if (atraso.pelaReguaAntiga || !atraso.previstoAte) {
    return {
      titulo: "📦 Pacote parado no caminho",
      corpo: `${quem} — postado há mais de ${DIAS_PARA_PARADO} dias e ainda não chegou${transp}. Confira o rastreio.`,
      evento: `📦 Pacote parado no caminho: postado há mais de ${DIAS_PARA_PARADO} dias sem entrega${transp}. Aviso automático, uma vez por pacote.`,
    };
  }
  const dias = `${atraso.diasAlem} dia${atraso.diasAlem === 1 ? "" : "s"}`;
  return {
    titulo: "⏰ Pacote atrasado",
    corpo: `${quem} — a transportadora${transp} prometeu entregar até ${ddmm(atraso.previstoAte)} e já passaram ${dias}. Vale cobrar a transportadora e avisar a cliente.`,
    evento: `⏰ Pacote atrasado: a transportadora${transp} prometeu até ${ddmm(atraso.previstoAte)} e já passaram ${dias}. Aviso automático, uma vez por pacote.`,
  };
}

export type ResumoEnvios = {
  /** custo das etiquetas compradas no mês (etiqueta cancelada fica de fora) */
  gastoMes: number;
  /**
   * FRETE COBRADO DAS CLIENTES no mês — RN-065 (pedido do dono, 23/09/2026:
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
  /** postados e atrasados: passaram da previsão da transportadora (ou dos 7 dias, sem prazo) */
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
