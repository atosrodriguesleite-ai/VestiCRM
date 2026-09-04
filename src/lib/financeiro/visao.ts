import { db } from "../db";
import { round2 } from "../orders";
import { pedidosPagosSemBaixa } from "./porta-vendas";
import { saldoAte } from "./extrato";
import {
  grupoDFCdoCodigo,
  type GrupoDFC,
  type LinhaDFC,
  type RelatorioDFC,
} from "./dfc-tipos";
import {
  dataDoDia,
  diaSP,
  saldoDaParcela,
  statusDaParcela,
  valorMovimentado,
} from "./lancamentos";

/**
 * A VISÃO DE DONO (RN-035): saldo previsto e o DFC.
 *
 * As duas perguntas que a lojista faz de manhã e que nenhuma tela respondia:
 * "quanto eu vou ter no dia X?" e "para onde foi o dinheiro do mês?".
 *
 * Regra que vale para as duas: **só entra o que é dinheiro de verdade**.
 * Previsão soma o que está EM ABERTO (nunca o que já foi pago, senão conta
 * duas vezes); o DFC soma o que MOVIMENTOU nas contas (nunca o previsto,
 * senão a loja "gerou caixa" que não existe).
 */

/** Teto de baixas do DFC: período grande demais avisa em vez de travar. */
export const TETO_DFC = 20_000;

/* ---- saldo previsto ----------------------------------------------------- */

export type Previsao = {
  saldoHoje: number;
  aReceber: number;
  aPagar: number;
  saldoPrevisto: number;
  ate: string;
};

/**
 * "Se tudo que vence entrar e sair, quanto eu tenho no dia X?" — saldo de
 * hoje + o que ainda falta receber − o que ainda falta pagar, até a data.
 *
 * O ATRASADO ENTRA: a conta vencida ontem continua sendo dinheiro a receber,
 * e tirá-la da previsão faria a loja se planejar com um número menor do que
 * a realidade. Cancelado fica de fora (nunca vai acontecer).
 */
export async function preverSaldo(
  companyId: string,
  dias: number,
  hoje = new Date()
): Promise<Previsao> {
  const ate = dataDoDia(
    diaSP(new Date(hoje.getTime() + dias * 86_400_000))
  )!;
  const hojeDia = dataDoDia(diaSP(hoje))!;
  const [saldoHoje, aReceber, aPagar] = await Promise.all([
    saldoAte(companyId, null, hojeDia),
    emAbertoAte(companyId, "RECEITA", ate, hojeDia),
    emAbertoAte(companyId, "DESPESA", ate, hojeDia),
  ]);
  return {
    saldoHoje,
    aReceber,
    aPagar,
    saldoPrevisto: round2(saldoHoje + aReceber - aPagar),
    ate: diaSP(ate),
  };
}

/**
 * Quanto FALTA receber (ou pagar) até uma data — somado NO BANCO.
 *
 * A soma é "valor das parcelas − o que já foi abatido nelas": a parcela
 * quitada entra valendo zero dos dois lados, então o resultado é só o que
 * está em aberto. Carregar as parcelas para somar em memória traria a
 * história inteira da loja a cada abertura da tela (a previsão não tem
 * limite para trás: conta vencida há um ano continua sendo dinheiro).
 *
 * O abatimento nunca passa do valor da parcela (`conferirBaixa`), então a
 * conta não vira negativa por parcela paga a mais.
 */
async function emAbertoAte(
  companyId: string,
  tipo: "RECEITA" | "DESPESA",
  ate: Date,
  hojeDia: Date
): Promise<number> {
  const doTipo = { lancamento: { tipo, canceladoEm: null } };
  const [parcelas, abatido] = await Promise.all([
    db.finParcela.aggregate({
      where: { companyId, vencimento: { lte: ate }, ...doTipo },
      _sum: { valor: true },
    }),
    db.finBaixa.aggregate({
      where: {
        companyId,
        estornadaEm: null,
        // SÓ O QUE JÁ ESTÁ NA CONTA. O `saldoHoje` conta baixa até HOJE; se
        // aqui a soma pegasse todas, a baixa com data de AMANHÃ (o cheque
        // que a lojista já registrou) saía das duas pontas e o dinheiro
        // desaparecia da previsão — enquanto o fluxo de caixa, que filtra
        // por data, mostrava o mesmo valor como realizado. Duas telas
        // discordando (auditoria completa do módulo, 03/09/2026).
        data: { lte: hojeDia },
        parcela: { vencimento: { lte: ate }, ...doTipo },
      },
      _sum: { valor: true },
    }),
  ]);
  return round2((parcelas._sum.valor ?? 0) - (abatido._sum.valor ?? 0));
}

/**
 * Quanto FALTA receber (ou pagar) com vencimento DENTRO de um período —
 * somado NO BANCO, pela mesma régua do saldo previsto.
 *
 * O painel trazia todas as parcelas do mês para a memória (com um teto de
 * 20 mil SEM ordem definida): batendo no teto, o Postgres devolvia um
 * subconjunto ARBITRÁRIO e os cards "a receber"/"a pagar do mês" mudavam de
 * valor entre dois F5, sem nada avisando (auditoria de 03/09/2026).
 */
export async function emAbertoNoPeriodo(
  companyId: string,
  tipo: "RECEITA" | "DESPESA",
  de: Date,
  ate: Date
): Promise<number> {
  const doTipo = { lancamento: { tipo, canceladoEm: null } };
  const naJanela = { vencimento: { gte: de, lte: ate } };
  const [parcelas, abatido] = await Promise.all([
    db.finParcela.aggregate({
      where: { companyId, ...naJanela, ...doTipo },
      _sum: { valor: true },
    }),
    db.finBaixa.aggregate({
      where: {
        companyId,
        estornadaEm: null,
        parcela: { ...naJanela, ...doTipo },
      },
      _sum: { valor: true },
    }),
  ]);
  return round2(
    Math.max(0, (parcelas._sum.valor ?? 0) - (abatido._sum.valor ?? 0))
  );
}

/* ---- DFC: por onde o dinheiro andou ------------------------------------- */

// os nomes dos blocos, o formato do relatório e a regra de qual bloco cada
// categoria pertence vivem em `dfc-tipos.ts` (puro) — a TELA do DFC precisa
// deles e não pode arrastar o banco para o navegador. Reexportados aqui para
// quem já lê o DFC por este arquivo.
export {
  DFC_LABEL,
  grupoDFCdoCodigo,
  type GrupoDFC,
  type LinhaDFC,
  type RelatorioDFC,
} from "./dfc-tipos";

/**
 * O DFC do período: só o que MOVIMENTOU nas contas, agrupado em operacional,
 * investimento e financiamento.
 *
 * O teste de honestidade do relatório: saldo inicial + gerado = saldo final.
 * Se não fechar, alguma coisa ficou de fora — e é por isso que a
 * transferência entre contas próprias aparece separada, valendo zero no
 * total da loja (RN-032).
 */
export async function montarDFC(
  companyId: string,
  de: Date,
  ate: Date
): Promise<RelatorioDFC> {
  const [saldoInicial, saldoFinal, aberturas, baixas] = await Promise.all([
    saldoAte(companyId, null, new Date(de.getTime() - 1)),
    saldoAte(companyId, null, ate),
    // conta cadastrada COM saldo inicial dentro do período: o dinheiro
    // aparece no saldo final sem ter sido gerado nem transferido. Sem esta
    // linha ele caía na sobra e a tela chamava de "transferência" — dizer o
    // nome errado do dinheiro é pior que não mostrar.
    db.finConta.aggregate({
      // cartão não guarda dinheiro (RN-039) e está fora do saldo: incluí-lo
      // aqui quebraria o teste de honestidade do DFC
      where: {
        companyId,
        tipo: { not: "CARTAO" },
        saldoInicialEm: { gte: de, lte: ate },
      },
      _sum: { saldoInicial: true },
    }),
    db.finBaixa.findMany({
      where: { companyId, estornadaEm: null, data: { gte: de, lte: ate } },
      select: {
        valor: true,
        desconto: true,
        juros: true,
        parcela: {
          select: {
            lancamento: {
              select: {
                tipo: true,
                categoria: { select: { nome: true, codigo: true, sistema: true } },
              },
            },
          },
        },
      },
      // era o ÚNICO relatório sem teto, com o período vindo da URL: um
      // "?de=2020-01-01&ate=2030-12-31" carregava todas as baixas da loja
      // com o join até a categoria e estourava a memória da função. O DRE e
      // o fluxo já param em TETO_RELATORIO e AVISAM na tela; aqui não havia
      // nem teto nem campo para dizer que faltou (auditoria de 03/09/2026).
      orderBy: { data: "asc" },
      take: TETO_DFC + 1,
    }),
  ]);
  const truncado = baixas.length > TETO_DFC;
  const usadas = truncado ? baixas.slice(0, TETO_DFC) : baixas;

  const raizesDoSistema = new Set(
    (
      await db.finCategoria.findMany({
        where: { companyId, sistema: true, paiId: null },
        select: { codigo: true },
      })
    ).map((r) => r.codigo)
  );
  /**
   * Quem diz se o "07" é o NOSSO bloco de investimentos é a RAIZ da árvore,
   * não a folha: a loja pode ter criado uma categoria dela com o código "07"
   * (aí a despesa dela é despesa mesmo), e pode ter criado "07.01 Máquinas"
   * DENTRO do nosso bloco (aí é investimento). Auditoria de 03/09/2026.
   */
  const raizEhDoSistema = (codigo: string | null) => {
    const raiz = codigo ? codigo.split(".")[0] : null;
    return raiz === null ? true : raizesDoSistema.has(raiz);
  };

  const porChave = new Map<string, LinhaDFC>();
  for (const b of usadas) {
    const l = b.parcela.lancamento;
    const codigo = l.categoria?.codigo ?? null;
    const grupo = grupoDFCdoCodigo(codigo, raizEhDoSistema(codigo));
    const nome = l.categoria
      ? `${l.categoria.codigo} · ${l.categoria.nome}`
      : "Sem categoria";
    const chave = `${grupo}|${nome}`;
    const atual =
      porChave.get(chave) ??
      ({ grupo, categoria: nome, entrou: 0, saiu: 0, resultado: 0 } as LinhaDFC);
    const mov = valorMovimentado(b);
    if (l.tipo === "RECEITA") atual.entrou = round2(atual.entrou + mov);
    else atual.saiu = round2(atual.saiu + mov);
    atual.resultado = round2(atual.entrou - atual.saiu);
    porChave.set(chave, atual);
  }

  const ordem: GrupoDFC[] = ["OPERACIONAL", "INVESTIMENTO", "FINANCIAMENTO"];
  const grupos = ordem.map((grupo) => {
    const linhas = [...porChave.values()]
      .filter((l) => l.grupo === grupo)
      .sort((a, b) => a.categoria.localeCompare(b.categoria));
    const entrou = round2(linhas.reduce((s, l) => s + l.entrou, 0));
    const saiu = round2(linhas.reduce((s, l) => s + l.saiu, 0));
    return { grupo, entrou, saiu, resultado: round2(entrou - saiu), linhas };
  });

  const geradoNoPeriodo = round2(grupos.reduce((s, g) => s + g.resultado, 0));
  const saldosDeclarados = round2(aberturas._sum.saldoInicial ?? 0);
  return {
    saldoInicial,
    saldoFinal,
    grupos,
    geradoNoPeriodo,
    saldosDeclarados,
    truncado,
    // o que ainda sobra entre o gerado e a diferença dos saldos é
    // transferência entrando/saindo do recorte (RN-032) — dita na tela,
    // nunca escondida. A conta FECHA: inicial + gerado + declarado +
    // transferências = final.
    transferencias: round2(
      saldoFinal - saldoInicial - geradoNoPeriodo - saldosDeclarados
    ),
  };
}

/* ---- inadimplência ------------------------------------------------------ */

export type LinhaInadimplencia = {
  parcelaId: string;
  lancamentoId: string;
  clienteId: string | null;
  clienteNome: string;
  temWhatsapp: boolean;
  descricao: string;
  vencimento: string;
  diasAtraso: number;
  falta: number;
  cobradoHoje: boolean;
  cobradoEm: string | null;
};

/** Teto da lista de atrasados: acima disso a tela DIZ que está mostrando parte. */
export const TETO_INADIMPLENCIA = 500;

/**
 * Quem está devendo, do mais atrasado para o menos.
 *
 * A LISTA tem teto, mas o TOTAL não: ele é somado no banco sobre o período
 * inteiro (mesma régua da RN-030 — card que soma só as linhas exibidas mostra
 * menos dívida do que existe, e a lojista se planeja com o número errado).
 */
export async function carregarInadimplencia(
  companyId: string,
  hoje = new Date()
): Promise<{
  linhas: LinhaInadimplencia[];
  total: number;
  clientes: number;
  truncado: boolean;
}> {
  const limite = dataDoDia(diaSP(hoje))!;
  const vencidasEmAberto = {
    companyId,
    vencimento: { lt: limite },
    lancamento: { tipo: "RECEITA", canceladoEm: null },
  } as const;
  const [somaParcelas, somaAbatido] = await Promise.all([
    db.finParcela.aggregate({ where: vencidasEmAberto, _sum: { valor: true } }),
    db.finBaixa.aggregate({
      where: { companyId, estornadaEm: null, parcela: vencidasEmAberto },
      _sum: { valor: true },
    }),
  ]);
  const total = round2((somaParcelas._sum.valor ?? 0) - (somaAbatido._sum.valor ?? 0));

  // O "ainda em aberto" é filtrado NO BANCO (valor > soma das baixas vivas):
  // trazer as 500 mais antigas e só então descartar as pagas gastava a vaga
  // com quem já quitou — loja com histórico via "Atrasado: R$ 12.000" ao lado
  // de uma lista VAZIA, e a cobrança pelo WhatsApp não tinha em quem clicar.
  const idsEmAberto = await db.$queryRaw<{ id: string }[]>`
    SELECT p."id"
      FROM "FinParcela" p
      JOIN "FinLancamento" l ON l."id" = p."lancamentoId"
     WHERE p."companyId" = ${companyId}
       AND p."vencimento" < ${limite}
       AND l."tipo" = 'RECEITA'
       AND l."canceladoEm" IS NULL
       AND p."valor" > COALESCE((
             SELECT SUM(b."valor") FROM "FinBaixa" b
              WHERE b."parcelaId" = p."id" AND b."estornadaEm" IS NULL
           ), 0)
     ORDER BY p."vencimento" ASC
     LIMIT ${TETO_INADIMPLENCIA}
  `;
  const parcelas = idsEmAberto.length === 0 ? [] : await db.finParcela.findMany({
    where: { companyId, id: { in: idsEmAberto.map((r) => r.id) } },
    include: {
      baixas: true,
      lancamento: {
        select: {
          id: true,
          descricao: true,
          cobradoEm: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
    orderBy: { vencimento: "asc" },
  });

  const linhas: LinhaInadimplencia[] = [];
  for (const p of parcelas) {
    if (statusDaParcela(p, hoje) !== "ATRASADA") continue;
    const falta = saldoDaParcela(p);
    if (falta <= 0) continue;
    const l = p.lancamento;
    linhas.push({
      parcelaId: p.id,
      lancamentoId: l.id,
      clienteId: l.customer?.id ?? null,
      clienteNome: l.customer?.name ?? "Sem cliente",
      temWhatsapp: Boolean(l.customer?.phone),
      descricao: l.descricao,
      vencimento: diaSP(p.vencimento),
      diasAtraso: Math.round(
        (new Date(`${diaSP(hoje)}T12:00:00Z`).getTime() -
          new Date(`${diaSP(p.vencimento)}T12:00:00Z`).getTime()) /
          86_400_000
      ),
      falta,
      cobradoHoje: Boolean(l.cobradoEm && diaSP(l.cobradoEm) === diaSP(hoje)),
      cobradoEm: l.cobradoEm ? diaSP(l.cobradoEm) : null,
    });
  }
  linhas.sort((a, b) => b.diasAtraso - a.diasAtraso);
  return {
    linhas,
    total,
    clientes: new Set(linhas.map((l) => l.clienteId ?? l.lancamentoId)).size,
    truncado: idsEmAberto.length >= TETO_INADIMPLENCIA,
  };
}

/* ---- o aviso da conta padrão -------------------------------------------- */

export type AvisoContaPadrao = {
  /** a loja ainda não cadastrou nenhuma conta de dinheiro */
  semConta: boolean;
  /** tem conta, mas nenhuma escolhida como padrão */
  semPadrao: boolean;
  /** vendas pagas esperando a baixa que a porta não pôde dar (RN-033) */
  vendasParadas: number;
};

/** Quantas vendas paradas o aviso chega a contar — o número é para assustar, não para auditar. */
const TETO_AVISO = 200;

/**
 * SEM CONTA PADRÃO, A VENDA PAGA NÃO VIRA DINHEIRO NA CONTA (RN-033).
 *
 * A porta única de entrada das vendas não inventa uma conta: ela registra o
 * recebimento em aberto e escreve o motivo no histórico do lançamento — onde
 * ninguém olha. O resultado, na loja de verdade: a lojista marcava o pedido
 * como PAGO e via a mesma venda no card "Atrasado", achando que o sistema
 * tinha perdido o dinheiro dela.
 *
 * Por isso o painel DIZ, em vermelho, o que está faltando configurar. Trava
 * que não explica vira "não funciona".
 */
const SEM_AVISO: AvisoContaPadrao = {
  semConta: false,
  semPadrao: false,
  vendasParadas: 0,
};

/**
 * NUNCA DERRUBA A TELA: é um aviso, não a resposta da página. Uma falha aqui
 * daria 500 no painel E em Contas a Receber ao mesmo tempo — a mesma lição do
 * `garantirRecorrencias`.
 */
/** Quanto tempo o aviso reaproveita a resposta anterior da mesma loja. */
const MS_AVISO = 60_000;
const cacheDoAviso = new Map<string, { em: number; aviso: AvisoContaPadrao }>();

/**
 * Esquece o aviso guardado desta loja. A rota das contas chama ao salvar:
 * sem isso a lojista escolhia a conta padrão e o aviso vermelho continuava
 * na tela por até um minuto, dizendo que falta o que ela acabou de fazer.
 */
export function esquecerAvisoDaContaPadrao(companyId: string): void {
  cacheDoAviso.delete(companyId);
}

export async function conferirContaPadrao(
  companyId: string
): Promise<AvisoContaPadrao> {
  // a consulta é a MESMA da varredura (três subconsultas correlacionadas), e
  // a lojista abre painel, Contas a Receber e Contas a Pagar em sequência.
  // O número serve para assustar, não para auditar: um minuto de memória
  // basta e tira o custo de cada clique (auditoria de 03/09/2026).
  const guardado = cacheDoAviso.get(companyId);
  if (guardado && Date.now() - guardado.em < MS_AVISO) return guardado.aviso;
  try {
    const aviso = await conferirContaPadraoOuFalha(companyId);
    cacheDoAviso.set(companyId, { em: Date.now(), aviso });
    return aviso;
  } catch (e) {
    console.error("[financeiro] aviso da conta padrão falhou", e);
    return SEM_AVISO;
  }
}

async function conferirContaPadraoOuFalha(
  companyId: string
): Promise<AvisoContaPadrao> {
  const [contas, padrao] = await Promise.all([
    // cartão de crédito não guarda dinheiro e nunca é padrão (RN-039)
    db.finConta.count({
      where: { companyId, arquivadaEm: null, tipo: { not: "CARTAO" } },
    }),
    db.finConta.count({ where: { companyId, arquivadaEm: null, padrao: true } }),
  ]);
  if (padrao > 0) return SEM_AVISO;

  // as vendas que estão esperando — mesma fonte da repescagem (RN-033), com
  // o filtro do status do pedido DENTRO da consulta: buscar lançamento sem
  // baixa e só depois perguntar quais estão pagos fazia os pedidos em aberto
  // (que também nascem sem baixa) encherem a janela e zerarem o número
  const vendasParadas = (await pedidosPagosSemBaixa(companyId, TETO_AVISO)).length;

  return { semConta: contas === 0, semPadrao: contas > 0, vendasParadas };
}
