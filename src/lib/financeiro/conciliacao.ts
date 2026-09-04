import { Prisma } from "@prisma/client";
import { db } from "../db";
import { round2 } from "../orders";
import {
  dataDoDia,
  diaSP,
  saldoDaParcela,
  valorMovimentado,
} from "./lancamentos";
import { lerOFX, type MovimentoOFX } from "./ofx";
import {
  combinaComALinha,
  dividirBaixaNasParcelas,
  JANELA_DIAS,
} from "./conciliacao-tela";
import { conferirLancamento, type LancamentoInput } from "./lancamento-form";


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
  // A MESMA RÉGUA DA TELA: `combinaComALinha` é o que faz o ✨ subir as
  // candidatas prováveis. Tendo duas cópias, afrouxar a tolerância de um
  // lado fazia a tela prometer par que o automático não casava — e nenhum
  // teste pegava, porque cada lado tinha o seu (auditoria de 03/09/2026).
  const combina = (l: ParaCasar, b: ParaCasar) => combinaComALinha(b, l, janelaDias);

  /**
   * INDEXADO POR VALOR: comparar todas as linhas com todas as baixas é
   * quadrático, e `casarSozinho` alimenta esta função com até 5.000 de cada
   * lado — 25 milhões de comparações, cada uma construindo duas datas.
   * A primeira importação de um extrato anual estourava os 60 segundos da
   * função e morria no meio (auditoria de 03/09/2026). O valor tem que
   * bater EXATO (< meio centavo), então ele é a chave natural.
   */
  const centavos = (v: number) => Math.round(v * 100);
  const porValor = new Map<number, ParaCasar[]>();
  for (const b of baixas) {
    const k = centavos(b.valor);
    const atual = porValor.get(k);
    if (atual) atual.push(b);
    else porValor.set(k, [b]);
  }
  const linhasPorValor = new Map<number, ParaCasar[]>();
  for (const l of linhas) {
    const k = centavos(l.valor);
    const atual = linhasPorValor.get(k);
    if (atual) atual.push(l);
    else linhasPorValor.set(k, [l]);
  }

  const pares: { linhaId: string; baixaId: string }[] = [];
  for (const linha of linhas) {
    const candidatas = (porValor.get(centavos(linha.valor)) ?? []).filter((b) =>
      combina(linha, b)
    );
    if (candidatas.length !== 1) continue;
    // e do outro lado? a baixa também precisa ter uma única linha possível
    const escolhida = candidatas[0];
    const linhasQueServem = (linhasPorValor.get(centavos(escolhida.valor)) ?? []).filter(
      (l) => combina(l, escolhida)
    );
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

/* ---- criar o lançamento que faltava ------------------------------------- */

export type ResultadoCriacao =
  | {
      ok: true;
      lancamentoId: string;
      /** quanto do dinheiro do banco virou baixa */
      baixado: number;
      conciliada: boolean;
      /** o que ainda falta para a linha do banco fechar */
      falta: number;
    }
  | { ok: false; erro: string; status: number };

/**
 * O MOVIMENTO QUE O SISTEMA NÃO TINHA (RN-037).
 *
 * O extrato mostra uma tarifa, um Pix de uma venda anotada só no caderno, um
 * pagamento que ninguém lançou. Até aqui a lojista tinha duas saídas ruins:
 * marcar como "fora do sistema" (e o dinheiro sumia do DRE e do fluxo) ou
 * sair da conferência, abrir Contas a Pagar, lançar, voltar e procurar a
 * linha de novo. Na terceira vez ela desiste da conciliação.
 *
 * Então o lançamento nasce DAQUI, pela ficha completa de sempre (RN-030,
 * mesmo validador — parcelas, categoria, centro de custo, coleção), já com o
 * valor, a data e a conta que o BANCO informou.
 *
 * Uma coisa este caminho faz que o botão "Conferir" nunca faz: ele REGISTRA A
 * BAIXA. E é o certo — aqui o dinheiro comprovadamente andou, é o extrato do
 * banco dizendo. O que a conciliação continua sem fazer é mexer em baixa que
 * já existe: conferir carimba, nunca quita (era o risco de a lojista dar por
 * recebida uma venda que ninguém pagou).
 *
 * SERIALIZÁVEL: sem isso duas abas criando da mesma linha do banco passariam
 * as duas pela conferência e o mesmo dinheiro entraria dobrado.
 */
export async function criarLancamentoDaLinha(
  companyId: string,
  linhaId: string,
  dados: LancamentoInput,
  autorNome: string
): Promise<ResultadoCriacao> {
  const linha = await db.finOfxLinha.findFirst({
    where: { id: linhaId, companyId },
    include: { vinculos: { select: { id: true } } },
  });
  if (!linha) return { ok: false, erro: "Linha não encontrada", status: 404 };
  if (linha.ignoradaEm)
    return {
      ok: false,
      erro: "Esta linha está marcada como fora do sistema — traga ela de volta para a fila antes",
      status: 409,
    };
  if (linha.vinculos.length > 0)
    return { ok: false, erro: "Esta linha já está conferida", status: 409 };


  // linha de R$ 0,00 (estorno já casado, tarifa isenta) não vira lançamento:
  // nenhuma ficha jamais soma zero, então ela nasceria SEM baixa nenhuma e a
  // tela ainda diria "criado e baixado" (achado da auditoria, 03/09/2026).
  if (Math.abs(linha.valor) < 0.005)
    return {
      ok: false,
      erro: "Esta linha do banco é de R$ 0,00 — não há dinheiro para lançar. Marque como fora do sistema.",
      status: 400,
    };

  // o LADO tem que bater com o sinal do banco: dinheiro que entrou é conta a
  // receber, dinheiro que saiu é conta a pagar. Trocado, o DRE somaria ao
  // contrário e o extrato da conta ficaria com o dobro do erro.
  const entrou = linha.valor > 0;
  if (entrou && dados.tipo !== "RECEITA")
    return {
      ok: false,
      erro: "Este dinheiro ENTROU na conta — crie uma conta a receber",
      status: 400,
    };
  if (!entrou && dados.tipo !== "DESPESA")
    return {
      ok: false,
      erro: "Este dinheiro SAIU da conta — crie uma conta a pagar",
      status: 400,
    };

  const conferido = await conferirLancamento(companyId, dados);
  if ("erro" in conferido)
    return { ok: false, erro: conferido.erro, status: 400 };

  const alvo = round2(Math.abs(linha.valor));

  /**
   * A FICHA TEM QUE COBRIR A LINHA INTEIRA.
   *
   * Cobrindo menos, a versão anterior criava a baixa e NÃO escrevia vínculo
   * nenhum — e isso abria dois buracos de dinheiro (auditoria de 03/09/2026):
   * sem vínculo, nada detectava o reenvio da mesma ficha (a lojista clica de
   * novo depois de um erro de rede e o dinheiro entra duas vezes), e a baixa
   * solta virava candidata do casamento automático da importação seguinte —
   * carimbada contra OUTRA linha do banco, que nunca foi dela.
   *
   * O depósito que pagou duas contas continua tendo caminho, e é o de
   * sempre: lançar as duas (aqui ou em Contas a Receber) e marcar as duas no
   * "Conferir", que fecha as duas pontas de uma vez só.
   */
  const somaDaFicha = round2(
    conferido.dados.parcelas.reduce((soma, p) => soma + p.valor, 0)
  );
  if (somaDaFicha < alvo - 0.005)
    return {
      ok: false,
      erro:
        `Esta ficha soma R$ ${somaDaFicha.toFixed(2)} e a linha do banco é de R$ ${alvo.toFixed(2)}. ` +
        "Se este dinheiro pagou mais de uma conta, lance cada uma e depois marque todas em \"Conferir\".",
      status: 400,
    };

  try {
    return await db.$transaction(
      async (tx) => {
        // outra aba pode ter conferido esta linha enquanto a ficha estava
        // aberta: no SERIALIZÁVEL esta leitura é o que segura a corrida
        // ONDE O DINHEIRO ANDA NÃO PODE SER CARTÃO (RN-039): o cartão não
        // guarda dinheiro, junta compras numa fatura — baixar aqui quitaria
        // a parcela fora de qualquer fatura. Conta arquivada também não
        // recebe movimento novo. A conferência mora DENTRO da transação,
        // como na porta normal de baixa: lida de fora, o admin podia
        // converter a conta em cartão com a ficha aberta e a baixa entrava
        // assim mesmo (auditoria de 03/09/2026).
        const conta = await tx.finConta.findFirst({
          where: { id: linha.contaId, companyId },
          select: { tipo: true, arquivadaEm: true },
        });
        if (!conta)
          return { ok: false as const, erro: "Conta não encontrada", status: 404 };
        if (conta.tipo === "CARTAO")
          return {
            ok: false as const,
            erro: "No cartão de crédito o dinheiro não anda — a compra entra na fatura, e a fatura é que se paga",
            status: 400,
          };
        if (conta.arquivadaEm)
          return { ok: false as const, erro: "Esta conta está arquivada", status: 409 };

        const jaTem = await tx.finOfxVinculo.count({ where: { linhaId: linha.id } });
        if (jaTem > 0)
          return {
            ok: false as const,
            erro: "Alguém conferiu esta linha agora mesmo — atualize a tela",
            status: 409,
          };

        const lancamento = await tx.finLancamento.create({
          data: {
            companyId,
            ...conferido.dados.cabecalho,
            parcelas: {
              create: conferido.dados.parcelas.map((p) => ({ companyId, ...p })),
            },
            eventos: {
              create: {
                descricao: `Lançamento criado pelo extrato do banco (${diaSP(linha.data)}) em ${conferido.dados.parcelas.length}× no valor de R$ ${conferido.dados.cabecalho.valor.toFixed(2)}`,
                autorNome,
              },
            },
          },
          select: {
            id: true,
            parcelas: { orderBy: { numero: "asc" }, select: { id: true, valor: true } },
          },
        });

        // o dinheiro do banco vai baixando as parcelas em ordem, cada uma até
        // o seu valor: um Pix de R$ 100 num lançamento de 3× quita a primeira
        // e para — nunca paga mais do que a parcela vale
        const aBaixar = dividirBaixaNasParcelas(alvo, lancamento.parcelas);
        const baixaIds: string[] = [];
        for (const item of aBaixar) {
          const baixa = await tx.finBaixa.create({
            data: {
              companyId,
              parcelaId: item.parcelaId,
              contaId: linha.contaId,
              data: linha.data,
              valor: item.valor,
              autorNome,
              observacao: `Do extrato: ${linha.descricao}`.slice(0, 200),
            },
            select: { id: true },
          });
          baixaIds.push(baixa.id);
        }
        const baixado = round2(aBaixar.reduce((s, i) => s + i.valor, 0));

        await tx.finLancamentoEvento.create({
          data: {
            lancamentoId: lancamento.id,
            descricao: `${entrou ? "Recebimento" : "Pagamento"} de R$ ${baixado.toFixed(2)} registrado pelo extrato em ${diaSP(linha.data)}`,
            autorNome,
          },
        });

        // a ficha cobre a linha (conferido lá em cima), então o dinheiro do
        // banco vira baixa por inteiro e a linha fecha SEMPRE — nenhuma baixa
        // nasce solta deste caminho
        const conciliada = baixaIds.length > 0 && Math.abs(baixado - alvo) < 0.005;
        if (!conciliada)
          throw new Error(
            `[conciliacao] a ficha deveria cobrir a linha: baixado ${baixado} de ${alvo}`
          );
        await tx.finOfxVinculo.createMany({
          data: baixaIds.map((baixaId) => ({
            companyId,
            linhaId: linha.id,
            baixaId,
            automatico: false,
            autorNome,
          })),
        });

        return {
          ok: true as const,
          lancamentoId: lancamento.id,
          baixado,
          conciliada,
          falta: round2(alvo - baixado),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // o padrão do Prisma é 5s, e aqui cabem até 60 criações de baixa
        // (um TED único quitando um lançamento em 60×): estourando, o P2028
        // subia como 500 depois de a lojista preencher a ficha inteira
        timeout: 30_000,
        maxWait: 10_000,
      }
    );
  } catch (e) {
    // corrida de verdade no serializável (P2034) ou o único do vínculo
    const code = (e as { code?: string })?.code;
    // P2028 = a transação estourou o tempo; P2034 = corrida no serializável
    if (code === "P2034" || code === "P2002" || code === "P2028")
      return {
        ok: false,
        erro: "Duas pessoas mexeram nesta linha ao mesmo tempo — tente de novo",
        status: 409,
      };
    throw e;
  }
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

/**
 * A conta que a loja registrou e AINDA NÃO RECEBEU.
 *
 * Ela não pode ser conciliada (conferir carimba, nunca quita — RN-037), mas
 * PRECISA aparecer: sem isso o painel dizia "nada registrado esperando
 * conferência" para uma venda de R$ 1.500 que estava ali, em aberto, e o
 * texto ainda mandava a lojista usar o "Lançar" — que criava uma SEGUNDA
 * receita do mesmo dinheiro. Receita em dobro no DRE, a parcela original
 * virando atrasada e a cobrança (RN-034) indo atrás de dinheiro que já
 * entrou. Achado da auditoria completa do módulo, 03/09/2026.
 *
 * Aqui ela aparece com o botão de registrar o recebimento: um clique, e aí
 * sim ela vira candidata e a linha do banco fecha.
 */
export type ParcelaEmAberto = {
  parcelaId: string;
  lancamentoId: string;
  numero: number;
  descricao: string;
  pessoa: string | null;
  vencimento: string;
  tipo: "RECEITA" | "DESPESA";
  /** o que ainda falta receber/pagar, com sinal (para comparar com a linha) */
  falta: number;
};

export type PainelConciliacao = {
  linhas: LinhaDoBanco[];
  candidatas: BaixaCandidata[];
  emAberto: ParcelaEmAberto[];
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
  const [linhas, baixas, abertas, pendentes, conciliadas, ignoradas, semExtrato] =
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
    // as contas EM ABERTO da janela: não se conciliam (conferir nunca quita),
    // mas precisam APARECER — senão a lojista lança o mesmo dinheiro de novo
    db.finParcela.findMany({
      where: {
        companyId,
        vencimento: janelaCandidatas,
        lancamento: { canceladoEm: null },
        // a tela confere UMA conta: a parcela desta conta, ou a que ainda
        // não tem conta prevista (o caso mais comum). Sem o filtro, as
        // contas das outras enchiam o teto de uma tela que não é delas
        OR: [{ contaId }, { contaId: null }],
      },
      select: {
        id: true,
        numero: true,
        valor: true,
        vencimento: true,
        baixas: { select: { valor: true, estornadaEm: true } },
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
      orderBy: { vencimento: "asc" },
      take: 300,
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
    emAberto: abertas
      .map((p) => ({ p, falta: saldoDaParcela(p) }))
      .filter(({ falta }) => falta > 0.004)
      .map(({ p, falta }) => ({
        parcelaId: p.id,
        lancamentoId: p.lancamento.id,
        numero: p.numero,
        descricao: p.lancamento.descricao,
        pessoa:
          p.lancamento.customer?.name ?? p.lancamento.fornecedor?.nome ?? null,
        vencimento: diaSP(p.vencimento),
        tipo: p.lancamento.tipo === "RECEITA" ? ("RECEITA" as const) : ("DESPESA" as const),
        falta: round2((p.lancamento.tipo === "RECEITA" ? 1 : -1) * falta),
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
