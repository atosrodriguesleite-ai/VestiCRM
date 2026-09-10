import { db } from "./db";
import { logServerError } from "./health";

/**
 * RN-053 · O ENVIO DE ESTOQUE PARA A NUVEMSHOP NÃO SE PERDE CALADO.
 *
 * Relato do dono (10/09/2026): a mesma peça com 0 aqui e 41 na Nuvemshop, com
 * o vínculo CERTO — a conferência da integração confirmou. Não foi o vínculo:
 * foi o AVISO DA BAIXA que nunca chegou lá.
 *
 * O buraco tinha duas metades, e as duas somem aqui:
 *  1. a resposta da Nuvemshop era IGNORADA — `pushStockToNuvemshop` mandava o
 *     PUT e seguia. Recusa do provedor (token vencido, 422, 500, timeout de
 *     15s) passava como se tivesse dado certo;
 *  2. a chamada era SOLTA (`push(...).catch(() => {})`), fora do `after()` do
 *     Next: a Vercel congela a função junto com a resposta, então o envio
 *     morria no meio sem nem chegar a ser tentado. É a MESMA lição da RN-033.
 *
 * Sem registro nenhum, os dois lados iam divergindo em silêncio até alguém
 * olhar a grade e ver 0 numa peça que existe. E divergência de estoque não é
 * detalhe: ou a loja deixa de vender peça que tem, ou vende peça que não tem.
 *
 * O desenho é o MESMO da RN-028 (o arquivo do WhatsApp que não chegou), que
 * já provou funcionar: a pendência nasce ANTES da tentativa, some só quando o
 * envio é CONFIRMADO, e o que sobrou é repescado de carona no tráfego, com
 * espera crescente e trava por loja — nunca um 3º cron (ADR-002).
 *
 * UMA FILA POR PEÇA (único por `variantId`): a venda seguinte da mesma peça
 * ATUALIZA a linha em vez de empilhar — o que se manda é sempre o estoque de
 * AGORA, lido na hora, então dez baixas seguidas da mesma variação são um
 * envio só. Enfileirar por movimento faria a fila crescer sem necessidade e
 * mandaria números velhos por cima do certo.
 *
 * Desistir é EXPLÍCITO: a peça PARA de ser tentada (perde a data, que é o que
 * a repesca lê), vira linha na Central de Comunicação e caso no painel de
 * Saúde, com o nome da peça — mas a linha FICA, senão o ⚠️ sumia da tela justo
 * na peça que de fato ficou divergente. Qualquer movimento novo daquela peça
 * reabre a rodada. Fila que desiste em silêncio é o problema de novo, com
 * mais código.
 */

/**
 * Quanto esperar antes de tentar de novo, por número de tentativas já feitas.
 *
 * Começa perto (a causa mais comum é oscilação de segundos) e vai afastando;
 * o total cobre ~9 horas. Insistir por dias seria teatro: passado isso a peça
 * para de ser tentada, o caso vai para a Central e para a Saúde, e o ⚠️ fica
 * na linha até o dia em que um envio dela for confirmado — o que acontece
 * sozinho no movimento seguinte da peça, que reabre a rodada.
 */
const ESPERA_POR_TENTATIVA_MS = [
  30_000, // 30 s
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
];

export const MAX_TENTATIVAS_ESTOQUE = ESPERA_POR_TENTATIVA_MS.length;

/** Quantas peças uma rodada de repesca tenta (a rodada pega carona). */
export const PECAS_POR_RODADA = 10;

/**
 * Intervalo mínimo entre duas rodadas da mesma loja (trava no banco).
 *
 * Note que ele é MAIOR que a primeira espera: na prática a primeira repesca
 * acontece no primeiro minuto, não nos primeiros 30s. É de propósito — a
 * rodada pega carona no tráfego, e uma rodada por minuto por loja já é bem
 * mais rápido que o estrago que a regra existe para evitar (dias com o número
 * errado de um dos lados).
 */
export const INTERVALO_DA_REPESCA_MS = 60_000;

/**
 * Orçamento de uma RODADA. A rodada roda depois da resposta (`after`), mas
 * ainda dentro da vida da função: cada PUT pode levar até 15s, então sem teto
 * três peças travadas comeriam a função inteira — e como a trava é tomada
 * ANTES do trabalho, o minuto ia embora sem repescar nada (lição da RN-028).
 */
export const MS_ORCAMENTO_REPESCA_ESTOQUE = 20_000;

/**
 * Freio em MEMÓRIA por instância, antes da trava do banco: o sync da inbox
 * bate a cada 3s por vendedora, e ir ao banco em toda batida só para o UPDATE
 * devolver 0 linhas é custo puro. A trava do banco continua sendo a de verdade
 * entre instâncias e regiões.
 */
const ultimaTentativa = new Map<string, number>();

/** Quando tentar de novo, dado o número de tentativas JÁ feitas. */
export function proximaTentativa(tentativasFeitas: number, agora = new Date()): Date | null {
  const espera = ESPERA_POR_TENTATIVA_MS[tentativasFeitas];
  if (espera === undefined) return null; // acabaram as tentativas
  return new Date(agora.getTime() + espera);
}

/**
 * Marca a peça como "envio ainda não confirmado", ANTES de tentar.
 *
 * Nasce com zero tentativas: quem acabou de chamar vai tentar agora, e o
 * resultado é que decide (some no sucesso, vira tentativa 1 na falha). Se a
 * função for congelada no meio, a linha fica e a repesca cuida — que é
 * exatamente o caso que ninguém via.
 *
 * Peça que JÁ estava na fila não volta para o começo (`update: {}`): a conta
 * de tentativas é da peça, não da venda.
 */
export async function marcarEnvioPendente(companyId: string, variantId: string) {
  // Peça que já tinha DESISTIDO (sem data) volta ao começo: um movimento novo
  // é motivo para tentar de novo, e sem isso a peça ficava divergente PARA
  // SEMPRE — o token vence às 9h, a peça esgota as tentativas às 18h, a
  // lojista renova às 19h e nada mais repescava (achado da revisão). Reabrir
  // não vira spam: o alarme só toca ao esgotar a rodada inteira de novo.
  await db.nuvemshopEstoquePendente.updateMany({
    where: { companyId, variantId, proximaEm: null },
    data: { tentativas: 0, proximaEm: proximaTentativa(0) },
  });
  await db.nuvemshopEstoquePendente.upsert({
    where: { variantId },
    create: {
      companyId,
      variantId,
      tentativas: 0,
      proximaEm: proximaTentativa(0),
    },
    update: {},
  });
}

/** Envio CONFIRMADO pela Nuvemshop: a peça sai da fila. */
export async function confirmarEnvio(variantId: string, stockEnviado?: number) {
  // "Em dia" é o que a Nuvemshop recebeu ser IGUAL ao que temos agora. Se o
  // número mudou entre a leitura e o PUT — outra venda da mesma peça no meio,
  // e cada PUT pode levar 15s — o que chegou lá já é velho: a peça FICA na
  // fila e a repesca manda o número certo. Sem esta conferência o caminho de
  // sucesso com número velho era indistinguível do sucesso de verdade, e a
  // divergência voltava calada (achado da revisão, 10/09/2026).
  if (stockEnviado !== undefined) {
    const atual = await db.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true },
    });
    if (!atual || atual.stock !== stockEnviado) return;
  }
  await db.nuvemshopEstoquePendente.deleteMany({ where: { variantId } });
}

/**
 * Tentativa que falhou: conta mais uma e agenda a próxima.
 *
 * Devolve `false` quando acabaram as tentativas — aí quem chama desiste
 * (`desistirDoEnvio`), em vez de a linha ficar viva para sempre com uma data
 * que nunca chega.
 */
export async function registrarFalhaDeEnvio(
  companyId: string,
  variantId: string,
  motivo: string
): Promise<boolean> {
  const atual = await db.nuvemshopEstoquePendente.findUnique({ where: { variantId } });
  const feitas = (atual?.tentativas ?? 0) + 1;
  const quando = proximaTentativa(feitas);
  // Acabaram as tentativas: quem escreve é `desistirDoEnvio`, e ele precisa
  // encontrar a linha AINDA com data para saber que a desistência é NOVA (é
  // assim que o alarme toca uma vez só). Zerar a data aqui apagava esse
  // sinal e a loja nunca ficava sabendo da peça que ficou para trás.
  if (quando === null) return false;
  await db.nuvemshopEstoquePendente.upsert({
    where: { variantId },
    create: {
      companyId,
      variantId,
      tentativas: feitas,
      proximaEm: quando,
      ultimoErro: motivo.slice(0, 300),
    },
    update: { tentativas: feitas, proximaEm: quando, ultimoErro: motivo.slice(0, 300) },
  });
  return true;
}

/**
 * Acabaram as tentativas: para de tentar e o caso APARECE — linha na Central
 * de Comunicação e caso no painel de Saúde, com o nome da peça. É o que separa
 * "a loja sabe que tem uma peça para acertar" de "o número está errado e
 * ninguém faz ideia".
 *
 * A linha NÃO é apagada, só perde a data (`proximaEm: null`, que a repesca
 * nunca pega): apagando, o ⚠️ sumia da tela justo na peça que de fato ficou
 * divergente — o aviso desapareceria no pior momento. Ela sai sozinha no dia
 * em que um envio daquela peça for confirmado (a venda seguinte, ou o acerto
 * pela tela de Configurações), que é quando os dois lados voltam a bater.
 */
export async function desistirDoEnvio(
  companyId: string,
  variantId: string,
  nomeDaPeca: string,
  motivo: string
) {
  // o alarme toca UMA vez por rodada de tentativas: quem já tinha desistido
  // segue tentando de graça a cada venda nova daquela peça (é a chance de o
  // problema ter passado), mas sem repetir o aviso a cada venda — desistência
  // que vira spam faz a loja parar de ler a Central, e aí o aviso não vale
  // nada. Quem conta é o próprio banco (`count`), sem uma leitura a mais.
  const parou = await db.nuvemshopEstoquePendente.updateMany({
    where: { companyId, variantId, proximaEm: { not: null } },
    data: { proximaEm: null, ultimoErro: motivo.slice(0, 300) },
  });
  if (parou.count === 0) return;
  await db.commEvent
    .create({
      data: {
        companyId,
        direction: "OUT",
        type: "nuvemshop.estoque-nao-enviado",
        status: "ERRO",
        payload: JSON.stringify({ variantId, peca: nomeDaPeca }),
        error: motivo.slice(0, 300),
        attempts: MAX_TENTATIVAS_ESTOQUE,
      },
    })
    .catch(() => null);
  await logServerError({
    source: "server",
    path: "/nuvemshop/estoque",
    message: `Estoque de "${nomeDaPeca}" não chegou na Nuvemshop`,
    // o ErrorLog não tem companyId: sem isso o caso no painel de Saúde não
    // diz de QUAL loja é (achado da revisão)
    detail: `loja ${companyId}: ${motivo}`.slice(0, 4000),
  });
}

/**
 * Peças desta loja cujo envio ainda não foi confirmado, para a tela pintar o
 * ⚠️ na própria linha (Inventário e Produtos). Sem isso a divergência só
 * aparece quando alguém roda a conferência da integração — e foi assim que a
 * peça ficou dias com 0 aqui e 41 lá.
 */
export async function envioPendentePorVariacao(
  companyId: string,
  variantIds: string[]
): Promise<Set<string>> {
  if (variantIds.length === 0) return new Set();
  // a consulta é pela LOJA, não pela lista de ids: a tela Produtos de uma
  // loja com 500 modelos mandaria ~4.000 parâmetros para ler uma tabela que,
  // por desenho, tem poucas linhas (só o que está esperando envio). O
  // cruzamento sai de graça em memória (achado da revisão de performance).
  const linhas = await db.nuvemshopEstoquePendente.findMany({
    where: { companyId },
    select: { variantId: true },
  });
  const pedidos = new Set(variantIds);
  return new Set(linhas.map((l) => l.variantId).filter((id) => pedidos.has(id)));
}

/**
 * Toma a trava da rodada, se for a hora. Devolve o carimbo tomado (para
 * devolver a trava se a rodada quebrar) ou `null` se outra já está rodando.
 *
 * A trava é ATÔMICA (`updateMany` condicionado à data que estava lá): duas
 * regiões batendo no mesmo instante, só uma leva.
 */
export async function tomarTravaDaRepesca(companyId: string): Promise<Date | null> {
  const agora = Date.now();
  const ultima = ultimaTentativa.get(companyId) ?? 0;
  if (agora - ultima < INTERVALO_DA_REPESCA_MS) return null;
  ultimaTentativa.set(companyId, agora);

  const quando = new Date(agora);
  const claimed = await db.company.updateMany({
    where: {
      id: companyId,
      OR: [
        { nsEstoqueRunAt: null },
        { nsEstoqueRunAt: { lt: new Date(agora - INTERVALO_DA_REPESCA_MS) } },
      ],
    },
    data: { nsEstoqueRunAt: quando },
  });
  return claimed.count > 0 ? quando : null;
}

/** Devolve a trava (a rodada quebrou): a próxima batida tenta de novo. */
export async function devolverTravaDaRepesca(companyId: string, tomadaEm: Date) {
  ultimaTentativa.delete(companyId);
  await db.company
    .updateMany({ where: { id: companyId, nsEstoqueRunAt: tomadaEm }, data: { nsEstoqueRunAt: null } })
    .catch(() => null);
}

/** Peças com envio vencido, mais antigas primeiro, com teto por rodada. */
export async function pecasParaRepescar(companyId: string) {
  return db.nuvemshopEstoquePendente.findMany({
    where: { companyId, proximaEm: { lte: new Date() } },
    orderBy: { proximaEm: "asc" },
    take: PECAS_POR_RODADA,
    select: { variantId: true, tentativas: true },
  });
}
