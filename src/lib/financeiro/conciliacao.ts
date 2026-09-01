import { Prisma } from "@prisma/client";
import { db } from "../db";
import { round2 } from "../orders";
import { dataDoDia, diaSP, valorMovimentado } from "./lancamentos";
import { lerOFX, type MovimentoOFX } from "./ofx";

/**
 * CONCILIAÇÃO BANCÁRIA (RN-037) — "o sistema bate com o banco?".
 *
 * De um lado o extrato que o banco exportou (OFX), do outro as baixas que a
 * loja registrou. Conciliar é dizer, movimento a movimento: este dinheiro do
 * banco é aquele lançamento daqui.
 *
 * Três decisões que sustentam tudo:
 *  • QUEM DIZ QUE É O MESMO MOVIMENTO É O BANCO: o `FITID` de cada linha é o
 *    identificador do próprio banco, e o único (loja, conta, fitid) faz
 *    reimportar o mesmo arquivo — ou dois arquivos que se sobrepõem, que é o
 *    normal — não duplicar nada;
 *  • O CASAMENTO ÓBVIO É FEITO SOZINHO (mesmo valor, mesma janela de dias) e
 *    fica marcado como automático: a lojista confere, não digita;
 *  • UM DEPÓSITO PODE PAGAR VÁRIAS PARCELAS. Por isso o vínculo é tabela
 *    própria, e a conciliação só fecha quando os dois lados SOMAM IGUAL.
 *
 * O que o extrato NUNCA faz é mexer no dinheiro sozinho: conciliar não cria,
 * não apaga e não altera baixa nenhuma. Ele carimba "conferido".
 */

/** Quantos dias de folga entre a data da baixa e a do banco no casamento automático. */
export const JANELA_DIAS = 3;
/** Teto de linhas por arquivo — extrato anual de loja grande não trava a tela. */
export const TETO_LINHAS_OFX = 5_000;

export type ResultadoImportacao =
  | {
      ok: true;
      importacaoId: string;
      lidas: number;
      novas: number;
      repetidas: number;
      /** movimentos que o arquivo trazia e não deu para ler (ditos na tela) */
      descartadas: number;
      casadas: number;
    }
  | { ok: false; erro: string; status: number };

/**
 * Importa um arquivo OFX para uma conta: grava as linhas novas, ignora as
 * que já estavam aqui e tenta casar sozinho o que for óbvio.
 */
export async function importarOFX(
  companyId: string,
  contaId: string,
  arquivo: { nome: string; texto: string },
  autorNome: string
): Promise<ResultadoImportacao> {
  const conta = await db.finConta.findFirst({
    where: { id: contaId, companyId },
    select: { id: true },
  });
  if (!conta)
    return { ok: false, erro: "Conta não encontrada nesta loja", status: 404 };

  const extrato = lerOFX(arquivo.texto);
  if (extrato.movimentos.length === 0)
    return {
      ok: false,
      erro: "Não encontrei movimentos neste arquivo — confira se é o OFX que o banco exporta",
      status: 400,
    };
  if (extrato.movimentos.length > TETO_LINHAS_OFX)
    return {
      ok: false,
      erro: `Este extrato tem ${extrato.movimentos.length} movimentos — exporte um período menor (o teto é ${TETO_LINHAS_OFX})`,
      status: 400,
    };

  const dias = extrato.movimentos.map((m) => m.dia).sort();
  const importacao = await db.finOfxImportacao.create({
    data: {
      companyId,
      contaId,
      arquivo: arquivo.nome.slice(0, 200),
      banco: extrato.banco,
      periodoDe: dataDoDia(dias[0]),
      periodoAte: dataDoDia(dias[dias.length - 1]),
      linhas: extrato.movimentos.length,
      autorNome,
    },
    select: { id: true },
  });

  // o único (loja, conta, fitid) é quem garante o "não duplica"; o
  // skipDuplicates é o que deixa reimportar o mesmo arquivo sem susto
  const criadas = await db.finOfxLinha.createMany({
    data: extrato.movimentos.map((m: MovimentoOFX) => ({
      companyId,
      contaId,
      importacaoId: importacao.id,
      fitid: m.fitid,
      data: dataDoDia(m.dia)!,
      valor: m.valor,
      descricao: m.descricao,
    })),
    skipDuplicates: true,
  });

  await db.finOfxImportacao.update({
    where: { id: importacao.id },
    data: { novas: criadas.count },
  });

  const casadas = await casarSozinho(
    companyId,
    contaId,
    { de: dataDoDia(dias[0])!, ate: dataDoDia(dias[dias.length - 1])! },
    autorNome
  );
  return {
    ok: true,
    importacaoId: importacao.id,
    lidas: extrato.movimentos.length,
    novas: criadas.count,
    repetidas: extrato.movimentos.length - criadas.count,
    descartadas: extrato.descartados,
    casadas,
  };
}

/**
 * O casamento óbvio: linha do banco e baixa da MESMA conta, mesmo valor
 * (com o sinal certo) e data dentro da janela. Só casa quando a resposta é
 * ÚNICA dos dois lados — duas baixas de R$ 300 no mesmo dia são exatamente o
 * caso em que o palpite erra, e conciliar errado é pior que não conciliar.
 */
export type ParaCasar = { id: string; dia: string; valor: number };

/**
 * QUEM CASA COM QUEM — regra pura, sem banco.
 *
 * Só vira casamento o par que é ÚNICO DOS DOIS LADOS: a linha do banco tem
 * uma única baixa possível E aquela baixa tem uma única linha possível. Duas
 * baixas de R$ 300 no mesmo dia (ou dois depósitos iguais para um lançamento
 * só) são exatamente onde o palpite erra — e conciliar errado é pior que não
 * conciliar, porque some da fila sem ninguém conferir.
 */
export function casamentosObvios(
  linhas: ParaCasar[],
  baixas: ParaCasar[],
  janelaDias = JANELA_DIAS
): { linhaId: string; baixaId: string }[] {
  const dia = (d: string) => new Date(`${d}T12:00:00Z`).getTime();
  const combina = (l: ParaCasar, b: ParaCasar) =>
    Math.abs(b.valor - l.valor) < 0.005 &&
    Math.abs(dia(b.dia) - dia(l.dia)) <= janelaDias * 86_400_000;

  const pares: { linhaId: string; baixaId: string }[] = [];
  for (const linha of linhas) {
    const candidatas = baixas.filter((b) => combina(linha, b));
    if (candidatas.length !== 1) continue;
    // e do outro lado? a baixa também precisa ter uma única linha possível
    const escolhida = candidatas[0];
    const linhasQueServem = linhas.filter((l) => combina(l, escolhida));
    if (linhasQueServem.length !== 1) continue;
    pares.push({ linhaId: linha.id, baixaId: escolhida.id });
  }
  return pares;
}

/**
 * Casa sozinho o que é óbvio nas linhas AINDA PENDENTES da conta, dentro da
 * janela de datas do extrato que acabou de entrar.
 *
 * Olha as pendentes TODAS, não só as do arquivo de agora: linha que ficou
 * para trás por falta de par ganha o casamento quando o lançamento aparece —
 * e subir o mesmo arquivo de novo (que a tela diz ser seguro) continua
 * conciliando o que dá, mesmo sem nenhuma linha nova.
 */
export async function casarSozinho(
  companyId: string,
  contaId: string,
  periodo: { de: Date; ate: Date },
  autorNome: string
): Promise<number> {
  const folga = JANELA_DIAS * 86_400_000;
  const linhas = await db.finOfxLinha.findMany({
    where: {
      companyId,
      contaId,
      ignoradaEm: null,
      vinculos: { none: {} },
      data: {
        gte: new Date(periodo.de.getTime() - folga),
        lte: new Date(periodo.ate.getTime() + folga),
      },
    },
    select: { id: true, data: true, valor: true },
    take: TETO_LINHAS_OFX,
  });
  if (linhas.length === 0) return 0;

  const de = new Date(Math.min(...linhas.map((l) => l.data.getTime())) - folga);
  const ate = new Date(Math.max(...linhas.map((l) => l.data.getTime())) + folga);
  const baixas = await db.finBaixa.findMany({
    where: {
      companyId,
      contaId,
      estornadaEm: null,
      data: { gte: de, lte: ate },
      vinculoOfx: { is: null },
    },
    select: {
      id: true,
      data: true,
      valor: true,
      desconto: true,
      juros: true,
      parcela: { select: { lancamento: { select: { tipo: true } } } },
    },
    take: TETO_LINHAS_OFX,
  });

  const pares = casamentosObvios(
    linhas.map((l) => ({ id: l.id, dia: diaSP(l.data), valor: l.valor })),
    baixas.map((b) => ({
      id: b.id,
      dia: diaSP(b.data),
      valor: round2(
        (b.parcela.lancamento.tipo === "RECEITA" ? 1 : -1) * valorMovimentado(b)
      ),
    }))
  );
  if (pares.length === 0) return 0;

  // uma escrita só: extrato perto do teto faria centenas de idas ao banco
  // dentro do tempo da função (e o retry cairia num arquivo já importado)
  const criados = await db.finOfxVinculo.createMany({
    data: pares.map((p) => ({
      companyId,
      linhaId: p.linhaId,
      baixaId: p.baixaId,
      automatico: true,
      autorNome,
    })),
    skipDuplicates: true,
  });
  return criados.count;
}

/**
 * Solta a conciliação de uma baixa que foi ESTORNADA. Sem isso a linha do
 * banco ficaria "conferida" para sempre contra dinheiro que voltou atrás — e
 * a conferência do mês fecharia com um erro que ninguém consegue achar.
 */
export async function soltarConciliacaoDaBaixa(baixaId: string): Promise<void> {
  await db.finOfxVinculo.deleteMany({ where: { baixaId } });
}

/* ---- conciliar na mão --------------------------------------------------- */

export type ResultadoVinculo =
  | { ok: true; conciliado: number }
  | { ok: false; erro: string; status: number };

/**
 * Concilia uma linha do banco com uma ou VÁRIAS baixas (o depósito único que
 * pagou três duplicatas). Só fecha quando os dois lados somam igual — o
 * "quase igual" é justamente o erro que a conciliação existe para achar.
 */
export async function conciliar(
  companyId: string,
  linhaId: string,
  baixaIds: string[],
  autorNome: string
): Promise<ResultadoVinculo> {
  if (baixaIds.length === 0)
    return { ok: false, erro: "Escolha pelo menos um lançamento", status: 400 };

  const linha = await db.finOfxLinha.findFirst({
    where: { id: linhaId, companyId },
    include: { vinculos: true },
  });
  if (!linha) return { ok: false, erro: "Linha não encontrada", status: 404 };
  if (linha.ignoradaEm)
    return { ok: false, erro: "Esta linha foi marcada como fora do sistema", status: 409 };
  if (linha.vinculos.length > 0)
    return { ok: false, erro: "Esta linha já está conciliada", status: 409 };

  const baixas = await db.finBaixa.findMany({
    where: { id: { in: baixaIds }, companyId, contaId: linha.contaId },
    select: {
      id: true,
      valor: true,
      desconto: true,
      juros: true,
      estornadaEm: true,
      parcela: { select: { lancamento: { select: { tipo: true } } } },
      vinculoOfx: { select: { id: true } },
    },
  });
  if (baixas.length !== baixaIds.length)
    return {
      ok: false,
      erro: "Algum lançamento não é desta conta — a conciliação é conta a conta",
      status: 400,
    };
  if (baixas.some((b) => b.estornadaEm))
    return { ok: false, erro: "Lançamento estornado não se concilia", status: 409 };
  if (baixas.some((b) => b.vinculoOfx))
    return {
      ok: false,
      erro: "Algum destes lançamentos já foi conciliado com outra linha",
      status: 409,
    };

  const soma = round2(
    baixas.reduce((s, b) => {
      const sinal = b.parcela.lancamento.tipo === "RECEITA" ? 1 : -1;
      return s + sinal * valorMovimentado(b);
    }, 0)
  );
  if (Math.abs(soma - linha.valor) >= 0.005)
    return {
      ok: false,
      erro: `Os dois lados não batem: o banco diz R$ ${linha.valor.toFixed(2)} e o que você marcou soma R$ ${soma.toFixed(2)}`,
      status: 400,
    };

  try {
    await db.finOfxVinculo.createMany({
      data: baixas.map((b) => ({
        companyId,
        linhaId: linha.id,
        baixaId: b.id,
        automatico: false,
        autorNome,
      })),
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return {
        ok: false,
        erro: "Alguém conciliou este lançamento agora mesmo — atualize a tela",
        status: 409,
      };
    throw e;
  }
  return { ok: true, conciliado: baixas.length };
}

/** Desfaz a conciliação de uma linha (conferiu errado, acontece). */
export async function desconciliar(
  companyId: string,
  linhaId: string
): Promise<ResultadoVinculo> {
  const linha = await db.finOfxLinha.findFirst({
    where: { id: linhaId, companyId },
    select: { id: true },
  });
  if (!linha) return { ok: false, erro: "Linha não encontrada", status: 404 };
  const apagados = await db.finOfxVinculo.deleteMany({
    where: { companyId, linhaId },
  });
  return { ok: true, conciliado: apagados.count };
}

/** "Isto não é do sistema" (tarifa que ela não lança, engano do banco). */
export async function ignorarLinha(
  companyId: string,
  linhaId: string,
  autorNome: string,
  ignorar: boolean
): Promise<ResultadoVinculo> {
  const linha = await db.finOfxLinha.findFirst({
    where: { id: linhaId, companyId },
    include: { vinculos: true },
  });
  if (!linha) return { ok: false, erro: "Linha não encontrada", status: 404 };
  if (ignorar && linha.vinculos.length > 0)
    return {
      ok: false,
      erro: "Esta linha está conciliada — desfaça a conciliação antes",
      status: 409,
    };
  await db.finOfxLinha.update({
    where: { id: linha.id },
    data: {
      ignoradaEm: ignorar ? new Date() : null,
      ignoradaPor: ignorar ? autorNome : null,
    },
  });
  return { ok: true, conciliado: 0 };
}

/* ---- a tela ------------------------------------------------------------- */

export type LinhaDoBanco = {
  id: string;
  dia: string;
  valor: number;
  descricao: string;
  conciliada: boolean;
  automatica: boolean;
  ignorada: boolean;
  /** o que ficou conciliado com ela, para a lojista conferir */
  lancamentos: { baixaId: string; lancamentoId: string; descricao: string; valor: number }[];
};

export type BaixaCandidata = {
  id: string;
  lancamentoId: string;
  dia: string;
  descricao: string;
  pessoa: string | null;
  /** com sinal, para comparar com a linha do banco */
  valor: number;
};

export type PainelConciliacao = {
  linhas: LinhaDoBanco[];
  candidatas: BaixaCandidata[];
  resumo: { pendentes: number; conciliadas: number; ignoradas: number; semExtrato: number };
};

/**
 * O painel: as linhas do banco de um lado, as baixas ainda não conferidas do
 * outro. `aba` decide o que a lista mostra; as candidatas são sempre as que
 * ainda estão sem conciliação, que é o que a lojista precisa arrastar.
 */
export async function carregarConciliacao(
  companyId: string,
  contaId: string,
  aba: "pendente" | "conciliado" | "ignorado",
  de: Date,
  ate: Date
): Promise<PainelConciliacao> {
  const daJanela = { companyId, contaId, data: { gte: de, lte: ate } };
  // as candidatas ganham a MESMA folga do casamento automático: linha na
  // borda do período não pode ficar sem par para a lojista marcar
  const folga = JANELA_DIAS * 86_400_000;
  const janelaCandidatas = {
    gte: new Date(de.getTime() - folga),
    lte: new Date(ate.getTime() + folga),
  };
  const [linhas, baixas, pendentes, conciliadas, ignoradas, semExtrato] =
    await Promise.all([
    db.finOfxLinha.findMany({
      where: {
        ...daJanela,
        ...(aba === "pendente"
          ? { ignoradaEm: null, vinculos: { none: {} } }
          : aba === "conciliado"
            ? { vinculos: { some: {} } }
            : { ignoradaEm: { not: null } }),
      },
      include: {
        vinculos: {
          include: {
            baixa: {
              select: {
                id: true,
                valor: true,
                desconto: true,
                juros: true,
                parcela: {
                  select: {
                    lancamento: { select: { id: true, descricao: true, tipo: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { data: "asc" },
      take: 500,
    }),
    db.finBaixa.findMany({
      where: {
        companyId,
        contaId,
        estornadaEm: null,
        data: janelaCandidatas,
        vinculoOfx: { is: null },
      },
      select: {
        id: true,
        data: true,
        valor: true,
        desconto: true,
        juros: true,
        parcela: {
          select: {
            lancamento: {
              select: {
                id: true,
                descricao: true,
                tipo: true,
                customer: { select: { name: true } },
                fornecedor: { select: { nome: true } },
              },
            },
          },
        },
      },
      orderBy: { data: "asc" },
      take: 500,
    }),
    db.finOfxLinha.count({ where: { ...daJanela, ignoradaEm: null, vinculos: { none: {} } } }),
    db.finOfxLinha.count({ where: { ...daJanela, vinculos: { some: {} } } }),
    db.finOfxLinha.count({ where: { ...daJanela, ignoradaEm: { not: null } } }),
    // card conta o PERÍODO INTEIRO (RN-030), nunca as 500 linhas exibidas
    db.finBaixa.count({
      where: {
        companyId,
        contaId,
        estornadaEm: null,
        data: janelaCandidatas,
        vinculoOfx: { is: null },
      },
    }),
  ]);

  const comSinal = (b: {
    valor: number;
    desconto: number;
    juros: number;
    parcela: { lancamento: { tipo: string } };
  }) =>
    round2(
      (b.parcela.lancamento.tipo === "RECEITA" ? 1 : -1) * valorMovimentado(b)
    );

  return {
    linhas: linhas.map((l) => ({
      id: l.id,
      dia: diaSP(l.data),
      valor: l.valor,
      descricao: l.descricao,
      conciliada: l.vinculos.length > 0,
      automatica: l.vinculos.some((v) => v.automatico),
      ignorada: l.ignoradaEm !== null,
      lancamentos: l.vinculos.map((v) => ({
        baixaId: v.baixa.id,
        lancamentoId: v.baixa.parcela.lancamento.id,
        descricao: v.baixa.parcela.lancamento.descricao,
        valor: comSinal(v.baixa),
      })),
    })),
    candidatas: baixas.map((b) => ({
      id: b.id,
      lancamentoId: b.parcela.lancamento.id,
      dia: diaSP(b.data),
      descricao: b.parcela.lancamento.descricao,
      pessoa:
        b.parcela.lancamento.customer?.name ??
        b.parcela.lancamento.fornecedor?.nome ??
        null,
      valor: comSinal(b),
    })),
    resumo: {
      pendentes,
      conciliadas,
      ignoradas,
      // o outro lado da pergunta: o que a loja registrou e o banco não mostra
      semExtrato,
    },
  };
}
