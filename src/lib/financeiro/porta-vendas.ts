import { after } from "next/server";
import { db } from "../db";
import { round2, PAID_ORDER_STATUSES, orderNumber } from "../orders";
import { dataDoDia, diaSP, valorMovimentado } from "./lancamentos";
import { garantirCategoriasPadrao } from "./cadastros";

/**
 * A PORTA ÚNICA DE ENTRADA DAS VENDAS (RN-031).
 *
 * Toda venda — pedido montado no sistema, pedido do catálogo, venda da
 * Nuvemshop, Pix confirmado e, amanhã, Mercado Livre — entra no financeiro
 * por AQUI. Cada origem só traduz o que tem para o formato da porta; nenhuma
 * escreve lançamento por conta própria. É o desenho que faz "marketplace
 * novo" custar um tradutor, e não uma reforma nas telas.
 *
 * As regras que valem para TODAS as origens:
 *
 *  • 1 PEDIDO = 1 LANÇAMENTO, para sempre. O par (loja, origem, origemId) é
 *    ÚNICO no banco: reprocessar o mesmo pedido — e o gateway REENVIA o mesmo
 *    aviso, é o contrato dele — não cria dois recebimentos.
 *  • A LOJA SEM O MÓDULO NÃO MUDA EM NADA (RN-027): a porta sai calada.
 *  • NUNCA DERRUBA A VENDA, e nunca some: o trabalho vai para o `after()` do
 *    Next (a Vercel CONGELA a função assim que a resposta sai — chamada solta
 *    sem `after` simplesmente não terminaria, e a venda paga desapareceria do
 *    financeiro sem erro nenhum).
 *  • O QUE A LOJISTA FEZ NA MÃO É DELA: baixa e cancelamento manuais nunca
 *    são desfeitos pela porta — ela avisa no histórico e para.
 */

export const ORIGEM_PEDIDO = "PEDIDO";
export const ORIGEM_ETIQUETA = "ETIQUETA";
/** Autor das baixas e dos cancelamentos que a PORTA faz sozinha. */
export const AUTOR_SISTEMA = "Sistema";
/** Marca do cancelamento feito pela porta — é como ela reconhece o seu. */
export const MARCA_CANCELAMENTO = "[porta] lançamento cancelado com o pedido";

/**
 * Qual categoria recebe a venda, pela origem do pedido. Devolve o CÓDIGO da
 * árvore padrão (RN-027); loja que renomeou a categoria continua funcionando,
 * porque o código é do sistema e o nome é dela.
 */
export function codigoDaCategoriaDeVenda(
  source: string,
  priceMode: string | null | undefined
): string {
  if (source === "NUVEMSHOP") return "01.03"; // Venda loja online / marketplaces
  return priceMode === "VAREJO" ? "01.02" : "01.01"; // varejo | atacado
}

/* ---- a máquina de estados (regra pura, sem banco) ---------------------- */

export type EstadoDaVenda = {
  /** status atual do pedido */
  status: string;
  /** o que a cliente paga hoje (com frete) */
  valor: number;
};

export type EstadoDoLancamento = {
  existe: boolean;
  valor: number;
  cancelado: boolean;
  /** o cancelamento foi da PORTA (e não da lojista)? */
  canceladoPelaPorta: boolean;
  /** quanto ainda falta receber */
  saldo: number;
  temBaixaManualViva: boolean;
  temBaixaAutomaticaViva: boolean;
};

export type AcaoDaPorta = {
  criar: boolean;
  /** novo valor quando o pedido mudou de preço (null = não mexer) */
  novoValor: number | null;
  /** valor da baixa automática a dar (null = nenhuma) */
  darBaixa: number | null;
  estornarAutomaticas: boolean;
  cancelar: boolean;
  reativar: boolean;
  /** aviso para o histórico quando a porta decide NÃO mexer */
  aviso: string | null;
};

const NADA: AcaoDaPorta = {
  criar: false,
  novoValor: null,
  darBaixa: null,
  estornarAutomaticas: false,
  cancelar: false,
  reativar: false,
  aviso: null,
};

/**
 * O que a porta faz, dado o estado do pedido e o do lançamento. Toda a
 * regra de dinheiro da RN-031 mora aqui — pura, para o teste conseguir
 * percorrer as transições sem banco nenhum.
 */
export function decidirAcaoDaPorta(
  pedido: EstadoDaVenda,
  lanc: EstadoDoLancamento
): AcaoDaPorta {
  const pago = (PAID_ORDER_STATUSES as string[]).includes(pedido.status);
  const aguardando = pedido.status === "AGUARDANDO_PAGAMENTO";
  const valeDinheiro = pago || aguardando;

  // ---- o pedido não é mais dinheiro (cancelado ou voltou a orçamento) ----
  if (!valeDinheiro) {
    if (!lanc.existe || lanc.cancelado) return NADA;
    if (lanc.temBaixaManualViva) {
      // o registro é da lojista: a porta não desfaz, avisa
      return {
        ...NADA,
        aviso:
          "O pedido saiu de venda, mas há baixa registrada à mão — confira este lançamento",
      };
    }
    return { ...NADA, estornarAutomaticas: lanc.temBaixaAutomaticaViva, cancelar: true };
  }

  // ---- o pedido vale dinheiro -------------------------------------------
  if (!lanc.existe) {
    return pedido.valor > 0 ? { ...NADA, criar: true } : NADA;
  }

  if (lanc.cancelado) {
    if (!lanc.canceladoPelaPorta) {
      return {
        ...NADA,
        aviso:
          "O pedido voltou a valer, mas este lançamento foi cancelado à mão — reabra se ainda for para receber",
      };
    }
    // reativa e segue para acertar valor/baixa como um lançamento vivo
    const seguindo = decidirAcaoDaPorta(pedido, { ...lanc, cancelado: false });
    return { ...seguindo, reativar: true };
  }

  // o pedido mudou de valor? o financeiro tem que acompanhar — mas nunca
  // por cima do que a lojista registrou na mão
  const mudouValor = round2(lanc.valor) !== round2(pedido.valor);
  if (mudouValor && lanc.temBaixaManualViva) {
    return {
      ...NADA,
      aviso: `O pedido passou a valer R$ ${pedido.valor.toFixed(2)}, mas há baixa registrada à mão — ajuste este lançamento`,
    };
  }

  const novoValor = mudouValor && pedido.valor > 0 ? round2(pedido.valor) : null;
  // trocar o valor exige refazer a baixa automática (ela era do valor velho)
  const estornarPorValor = novoValor !== null && lanc.temBaixaAutomaticaViva;
  const saldoDepois = novoValor !== null
    ? round2(novoValor - (lanc.valor - lanc.saldo) + (estornarPorValor ? somaAutomatica(lanc) : 0))
    : lanc.saldo;

  if (pago) {
    const aReceber = round2(Math.max(0, saldoDepois));
    return {
      ...NADA,
      novoValor,
      estornarAutomaticas: estornarPorValor,
      darBaixa: aReceber > 0 ? aReceber : null,
    };
  }
  // aguardando pagamento: o que a porta baixou sozinha volta a ser dívida
  return { ...NADA, novoValor, estornarAutomaticas: lanc.temBaixaAutomaticaViva };
}

/** Quanto das baixas VIVAS é da porta (o que volta ao estornar). */
function somaAutomatica(lanc: EstadoDoLancamento): number {
  // sem baixa manual viva, tudo que está pago veio da porta
  return lanc.temBaixaAutomaticaViva && !lanc.temBaixaManualViva
    ? round2(lanc.valor - lanc.saldo)
    : 0;
}

/* ---- a aplicação no banco ---------------------------------------------- */

type Resultado =
  | { feito: false; motivo: "modulo-desligado" | "sem-dinheiro" | "nao-encontrado" }
  | { feito: true; lancamentoId: string; acao: "criado" | "atualizado" | "cancelado" | "nada" };

/**
 * Põe o financeiro em dia com o estado ATUAL do pedido. Idempotente: pode ser
 * chamada quantas vezes quiser, em qualquer transição.
 */
export async function sincronizarPedidoNoFinanceiro(
  orderId: string
): Promise<Resultado> {
  const pedido = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      companyId: true,
      number: true,
      customerId: true,
      status: true,
      // frete-ok: contas a RECEBER é o que a cliente paga — frete incluído.
      // Faturamento é outra conta e continua sendo netTotal (RN-002).
      total: true,
      paidAt: true,
      createdAt: true,
      source: true,
      priceMode: true,
      company: { select: { financeEnabled: true } },
      customer: { select: { name: true } },
    },
  });
  if (!pedido) return { feito: false, motivo: "nao-encontrado" };
  // RN-027: loja sem o módulo não muda em NADA
  if (!pedido.company.financeEnabled) return { feito: false, motivo: "modulo-desligado" };

  const existente = await db.finLancamento.findFirst({
    where: { companyId: pedido.companyId, origem: ORIGEM_PEDIDO, origemId: pedido.id },
    include: {
      parcelas: { include: { baixas: true } },
      eventos: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  const estado = estadoDoLancamento(existente);
  const acao = decidirAcaoDaPorta(
    { status: pedido.status, valor: round2(pedido.total) },
    estado
  );

  // ---- criar -------------------------------------------------------------
  if (acao.criar) {
    // a loja pode ter acabado de ganhar o módulo e nunca ter aberto a tela:
    // sem a árvore semeada, a venda nasceria sem categoria PARA SEMPRE
    await garantirCategoriasPadrao(pedido.companyId);
    const categoria = await categoriaPorCodigo(
      pedido.companyId,
      codigoDaCategoriaDeVenda(pedido.source, pedido.priceMode)
    );
    const conta = await contaPadrao(pedido.companyId);
    const quando = diaDoDinheiro(pedido.paidAt ?? pedido.createdAt);
    const valor = round2(pedido.total);
    const criado = await db.finLancamento.create({
      data: {
        companyId: pedido.companyId,
        tipo: "RECEITA",
        descricao: `Venda ${orderNumber(pedido.number)}${
          pedido.customer?.name ? ` — ${pedido.customer.name}` : ""
        }`,
        competencia: quando,
        customerId: pedido.customerId,
        categoriaId: categoria,
        valor,
        origem: ORIGEM_PEDIDO,
        origemId: pedido.id,
        parcelas: {
          create: {
            companyId: pedido.companyId,
            numero: 1,
            vencimento: quando,
            valor,
            contaId: conta,
          },
        },
        eventos: {
          create: {
            descricao: `Criado pela venda ${orderNumber(pedido.number)} (${rotuloDaOrigem(pedido.source)})`,
            autorNome: AUTOR_SISTEMA,
          },
        },
      },
      include: { parcelas: true },
    });
    if ((PAID_ORDER_STATUSES as string[]).includes(pedido.status)) {
      await darBaixaDaPorta(criado.id, criado.parcelas[0].id, pedido.companyId, valor, quando);
    }
    return { feito: true, lancamentoId: criado.id, acao: "criado" };
  }

  if (!existente) return { feito: false, motivo: "sem-dinheiro" };

  // ---- só um aviso -------------------------------------------------------
  if (acao.aviso) {
    await avisarUmaVez(existente.id, acao.aviso, existente.eventos);
    return { feito: true, lancamentoId: existente.id, acao: "nada" };
  }

  let mexeu = false;
  if (acao.reativar) {
    await db.finLancamento.update({
      where: { id: existente.id },
      data: {
        canceladoEm: null,
        eventos: {
          create: { descricao: "Pedido voltou a valer: lançamento reativado", autorNome: AUTOR_SISTEMA },
        },
      },
    });
    mexeu = true;
  }
  if (acao.estornarAutomaticas) {
    await estornarBaixasDaPorta(existente.id, "Pedido mudou");
    mexeu = true;
  }
  if (acao.novoValor !== null) {
    await atualizarValor(existente.id, existente.parcelas[0]?.id, acao.novoValor);
    mexeu = true;
  }
  if (acao.darBaixa !== null && existente.parcelas[0]) {
    await darBaixaDaPorta(
      existente.id,
      existente.parcelas[0].id,
      pedido.companyId,
      acao.darBaixa,
      diaDoDinheiro(pedido.paidAt ?? pedido.createdAt)
    );
    mexeu = true;
  }
  if (acao.cancelar) {
    await db.finLancamento.update({
      where: { id: existente.id },
      data: {
        canceladoEm: new Date(),
        eventos: { create: { descricao: MARCA_CANCELAMENTO, autorNome: AUTOR_SISTEMA } },
      },
    });
    return { feito: true, lancamentoId: existente.id, acao: "cancelado" };
  }

  return { feito: true, lancamentoId: existente.id, acao: mexeu ? "atualizado" : "nada" };
}

/** Traduz o lançamento do banco para o estado que a regra pura entende. */
function estadoDoLancamento(
  l:
    | ({
        valor: number;
        canceladoEm: Date | null;
        parcelas: {
          valor: number;
          baixas: {
            valor: number;
            desconto: number;
            juros: number;
            autorNome: string;
            estornadaEm: Date | null;
          }[];
        }[];
        eventos: { descricao: string; autorNome: string }[];
      })
    | null
): EstadoDoLancamento {
  if (!l)
    return {
      existe: false,
      valor: 0,
      cancelado: false,
      canceladoPelaPorta: false,
      saldo: 0,
      temBaixaManualViva: false,
      temBaixaAutomaticaViva: false,
    };
  const vivas = l.parcelas.flatMap((p) => p.baixas.filter((b) => !b.estornadaEm));
  const abatido = round2(vivas.reduce((s, b) => s + b.valor, 0));
  // o cancelamento é da porta quando o evento mais recente que fala de
  // cancelamento é o dela — o da lojista tem outro autor
  const ultimoCancel = l.eventos.find((e) => /cancelad/i.test(e.descricao));
  return {
    existe: true,
    valor: round2(l.valor),
    cancelado: Boolean(l.canceladoEm),
    canceladoPelaPorta:
      Boolean(l.canceladoEm) && ultimoCancel?.autorNome === AUTOR_SISTEMA,
    saldo: round2(Math.max(0, round2(l.valor) - abatido)),
    temBaixaManualViva: vivas.some((b) => b.autorNome !== AUTOR_SISTEMA),
    temBaixaAutomaticaViva: vivas.some((b) => b.autorNome === AUTOR_SISTEMA),
  };
}

/**
 * ETIQUETA COMPRADA vira despesa de frete (RN-031), já baixada — o dinheiro
 * saiu da carteira do Melhor Envio na hora da compra.
 *
 * A chave é a COMPRA (`meOrderId`), não o envio: cancelar a etiqueta e
 * comprar outra (SEDEX no lugar do PAC) é outra despesa, de outro valor —
 * amarrar ao envio deixaria o financeiro mostrando o frete velho.
 */
export async function registrarEtiquetaNoFinanceiro(
  shippingId: string
): Promise<Resultado> {
  const envio = await db.shipping.findUnique({
    where: { id: shippingId },
    select: {
      id: true,
      mePrice: true,
      meCompradoEm: true,
      meOrderId: true,
      order: {
        select: {
          id: true,
          number: true,
          companyId: true,
          company: { select: { financeEnabled: true } },
        },
      },
    },
  });
  if (!envio?.order) return { feito: false, motivo: "nao-encontrado" };
  if (!envio.order.company.financeEnabled)
    return { feito: false, motivo: "modulo-desligado" };
  const valor = round2(envio.mePrice ?? 0);
  if (!(valor > 0)) return { feito: false, motivo: "sem-dinheiro" };

  const companyId = envio.order.companyId;
  const chave = envio.meOrderId ?? envio.id;
  const jaTem = await db.finLancamento.findFirst({
    where: { companyId, origem: ORIGEM_ETIQUETA, origemId: chave },
    select: { id: true },
  });
  if (jaTem) return { feito: true, lancamentoId: jaTem.id, acao: "nada" };

  await garantirCategoriasPadrao(companyId);
  const quando = diaDoDinheiro(envio.meCompradoEm ?? new Date());
  const categoria = await categoriaPorCodigo(companyId, "04.02"); // Frete e envios
  const conta = await contaPadrao(companyId);
  const criado = await db.finLancamento.create({
    data: {
      companyId,
      tipo: "DESPESA",
      descricao: `Etiqueta de envio — venda ${orderNumber(envio.order.number)}`,
      competencia: quando,
      categoriaId: categoria,
      valor,
      origem: ORIGEM_ETIQUETA,
      origemId: chave,
      parcelas: {
        create: { companyId, numero: 1, vencimento: quando, valor, contaId: conta },
      },
      eventos: {
        create: {
          descricao: "Criado pela compra da etiqueta no Melhor Envio",
          autorNome: AUTOR_SISTEMA,
        },
      },
    },
    include: { parcelas: true },
  });
  await darBaixaDaPorta(criado.id, criado.parcelas[0].id, companyId, valor, quando);
  return { feito: true, lancamentoId: criado.id, acao: "criado" };
}

/**
 * ETIQUETA CANCELADA: o valor volta para a carteira do Melhor Envio, então a
 * despesa some — estornada e cancelada, com rastro, nunca apagada.
 */
export async function cancelarEtiquetaNoFinanceiro(
  companyId: string,
  meOrderId: string | null,
  shippingId: string
): Promise<Resultado> {
  const chave = meOrderId ?? shippingId;
  const lanc = await db.finLancamento.findFirst({
    where: { companyId, origem: ORIGEM_ETIQUETA, origemId: chave },
    include: { parcelas: { include: { baixas: true } } },
  });
  if (!lanc) return { feito: false, motivo: "nao-encontrado" };
  if (lanc.canceladoEm) return { feito: true, lancamentoId: lanc.id, acao: "nada" };

  const estado = estadoDoLancamento({ ...lanc, eventos: [] });
  if (estado.temBaixaManualViva) {
    await db.finLancamentoEvento.create({
      data: {
        lancamentoId: lanc.id,
        descricao:
          "Etiqueta cancelada, mas há baixa registrada à mão — confira este lançamento",
        autorNome: AUTOR_SISTEMA,
      },
    });
    return { feito: true, lancamentoId: lanc.id, acao: "nada" };
  }
  await estornarBaixasDaPorta(lanc.id, "Etiqueta cancelada");
  await db.finLancamento.update({
    where: { id: lanc.id },
    data: {
      canceladoEm: new Date(),
      eventos: { create: { descricao: MARCA_CANCELAMENTO, autorNome: AUTOR_SISTEMA } },
    },
  });
  return { feito: true, lancamentoId: lanc.id, acao: "cancelado" };
}

/* ---- bastidores -------------------------------------------------------- */

/** O DIA do dinheiro, ao meio-dia UTC (RN-028): fuso não muda o mês. */
function diaDoDinheiro(d: Date): Date {
  return dataDoDia(diaSP(d)) ?? d;
}

async function categoriaPorCodigo(companyId: string, codigo: string) {
  const c = await db.finCategoria.findFirst({
    where: { companyId, codigo, arquivadaEm: null },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function contaPadrao(companyId: string) {
  const c = await db.finConta.findFirst({
    where: { companyId, arquivadaEm: null, padrao: true },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function atualizarValor(
  lancamentoId: string,
  parcelaId: string | undefined,
  valor: number
) {
  await db.finLancamento.update({
    where: { id: lancamentoId },
    data: {
      valor,
      eventos: {
        create: {
          descricao: `Valor acertado com o pedido: R$ ${valor.toFixed(2)}`,
          autorNome: AUTOR_SISTEMA,
        },
      },
    },
  });
  if (parcelaId) await db.finParcela.update({ where: { id: parcelaId }, data: { valor } });
}

/**
 * A baixa automática. Sem conta padrão definida, ela NÃO acontece — e o
 * lançamento diz por quê: dinheiro entrando numa conta que a loja não
 * escolheu faria o extrato dela nascer errado.
 */
async function darBaixaDaPorta(
  lancamentoId: string,
  parcelaId: string,
  companyId: string,
  valor: number,
  data: Date
) {
  const conta = await contaPadrao(companyId);
  if (!conta) {
    const eventos = await db.finLancamentoEvento.findMany({
      where: { lancamentoId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { descricao: true, autorNome: true },
    });
    await avisarUmaVez(
      lancamentoId,
      "Venda paga, mas a loja não tem conta padrão — marque a baixa na mão (ou defina a conta padrão em Cadastros)",
      eventos
    );
    return;
  }
  await db.finBaixa.create({
    data: { companyId, parcelaId, contaId: conta, data, valor, autorNome: AUTOR_SISTEMA },
  });
  await db.finLancamentoEvento.create({
    data: {
      lancamentoId,
      descricao: `Recebimento registrado automaticamente em ${diaSP(data)}`,
      autorNome: AUTOR_SISTEMA,
    },
  });
}

/** Estorna SÓ as baixas que a porta deu — as da lojista são intocáveis. */
async function estornarBaixasDaPorta(lancamentoId: string, motivo: string) {
  const { count } = await db.finBaixa.updateMany({
    where: {
      parcela: { lancamentoId },
      estornadaEm: null,
      autorNome: AUTOR_SISTEMA,
    },
    data: { estornadaEm: new Date(), estornoAutor: AUTOR_SISTEMA },
  });
  if (count > 0) {
    await db.finLancamentoEvento.create({
      data: {
        lancamentoId,
        descricao: `${motivo}: recebimento automático estornado`,
        autorNome: AUTOR_SISTEMA,
      },
    });
  }
  return count;
}

/** Aviso que não vira spam: o mesmo texto não repete no histórico. */
async function avisarUmaVez(
  lancamentoId: string,
  texto: string,
  recentes: { descricao: string }[]
) {
  if (recentes.some((e) => e.descricao === texto)) return;
  await db.finLancamentoEvento.create({
    data: { lancamentoId, descricao: texto, autorNome: AUTOR_SISTEMA },
  });
}

function rotuloDaOrigem(source: string): string {
  if (source === "NUVEMSHOP") return "loja online";
  if (source === "CATALOGO") return "catálogo";
  return "pedido do sistema";
}

/* ---- o jeito seguro de chamar de dentro do fluxo de venda -------------- */

/**
 * `after()` e não chamada solta: a Vercel congela a função assim que a
 * resposta sai, e uma promessa pendurada simplesmente não terminaria — a
 * venda paga sumiria do financeiro sem erro nenhum. Com o `after`, o trabalho
 * roda DEPOIS da resposta, sem segurar a tela e sem se perder.
 */
export function sincronizarPedidoSemQuebrar(orderId: string): void {
  after(() =>
    sincronizarPedidoNoFinanceiro(orderId).catch((e) =>
      console.error("[financeiro] falhou ao sincronizar o pedido", orderId, e)
    )
  );
}

export function registrarEtiquetaSemQuebrar(shippingId: string): void {
  after(() =>
    registrarEtiquetaNoFinanceiro(shippingId).catch((e) =>
      console.error("[financeiro] falhou ao registrar a etiqueta", shippingId, e)
    )
  );
}

export function cancelarEtiquetaSemQuebrar(
  companyId: string,
  meOrderId: string | null,
  shippingId: string
): void {
  after(() =>
    cancelarEtiquetaNoFinanceiro(companyId, meOrderId, shippingId).catch((e) =>
      console.error("[financeiro] falhou ao cancelar a etiqueta", shippingId, e)
    )
  );
}
