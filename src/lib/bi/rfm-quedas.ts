/**
 * AS QUEDAS DO RFM — a rodada (RN-100). A regra mora em `rfm-quedas-regra.ts`
 * (pura); aqui: a trava de carona, a leitura, e a gravação da memória junto
 * com as tarefas, numa transação só.
 *
 * SEM CRON (ADR-002): pega carona no sync da inbox e na abertura do BI, com
 * trava atômica por loja — uma rodada por DIA de São Paulo (um intervalo em
 * horas escorregaria e poria duas rodadas no mesmo dia, dobrando o teto) —,
 * e só nas lojas com a chave do BI (o RFM é do BI; a memória começa quando a
 * chave liga, e a primeira rodada é só o ponto de partida, sem tarefa).
 */
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { logServerError } from "../health";
import { sendToUser } from "../push";
import { brl } from "../format";
import { fimDeHojeSP } from "../contato-feito";
import { carregarBaseDoRfm } from "./rfm";
import { calcularRfm, ehGrupoRfm } from "./rfm-regra";
import {
  PREFIXO_DA_QUEDA,
  chaveDaQueda,
  decidirQuedas,
  prioridadeDaQueda,
  textoDaQueda,
  type Lembranca,
} from "./rfm-quedas-regra";

const DIA_MS = 24 * 60 * 60 * 1000;
/** memória mais velha que isso (o BI ficou desligado) vira ponto de partida */
const MEMORIA_VALE_MS = 7 * DIA_MS;
/** lote de linhas por instrução (o teto de parâmetros do Postgres) */
const LOTE = 1000;

export type ResultadoDasQuedas = { clientes: number; novas: number; atualizadas: number; seguradas: number; partida: boolean };

/** a tarefa vence às 23:59 de HOJE em SP — no limite da meia-noite ela cairia em "Próximas" e não fecharia sozinha no mesmo dia */
export const vencimentoDaQueda = (agora: Date) => new Date(fimDeHojeSP(agora).getTime() - 60_000);

/**
 * Uma rodada: lê o RFM de agora e a memória, decide, e grava a memória e as
 * tarefas na MESMA transação — tarefa sem memória repetiria a tarefa amanhã;
 * memória sem tarefa calaria a queda para sempre (a lição do lembrete do
 * Calendário, RN-092).
 */
export async function rodarQuedasDoRfm(companyId: string, agora = new Date()): Promise<ResultadoDasQuedas> {
  const [base, memoria, company, abertas] = await Promise.all([
    carregarBaseDoRfm(companyId, agora),
    db.rfmEstado.findMany({ where: { companyId }, select: { customerId: true, grupo: true, seguradaDesde: true } }),
    db.company.findUnique({ where: { id: companyId }, select: { rfmQuedasOkEm: true } }),
    // a tarefa de queda ainda aberta de cada cliente: cair de novo a atualiza
    db.task.findMany({
      where: { companyId, status: "PENDENTE", customerId: { not: null }, autoRule: { startsWith: PREFIXO_DA_QUEDA } },
      select: { id: true, customerId: true },
    }),
  ]);
  const clientes = calcularRfm(base, agora);
  const anteriores = new Map<string, Lembranca>();
  // grupo gravado que não é mais da lista (renomeado no código) vira ponto de partida, nunca queda
  for (const m of memoria) if (ehGrupoRfm(m.grupo)) anteriores.set(m.customerId, { grupo: m.grupo, seguradaDesde: m.seguradaDesde });
  const okEm = company?.rfmQuedasOkEm;
  const partida = memoria.length === 0 || !okEm || agora.getTime() - okEm.getTime() > MEMORIA_VALE_MS;
  const abertaDe = new Map(abertas.map((t) => [t.customerId!, t.id]));
  const decisao = decidirQuedas(
    anteriores,
    clientes.map((c) => ({ id: c.id, grupo: c.grupo, ltv: c.ltv, donaId: c.dona?.id ?? null })),
    { comTarefaAberta: new Set(abertaDe.keys()), partida }
  );
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const vence = vencimentoDaQueda(agora);
  /** quem de fato ganhou tarefa NOVA (o aviso conta só estas) */
  const novasPorDona = new Map<string, number>();
  let atualizadas = 0;

  await db.$transaction(
    async (tx) => {
      for (let i = 0; i < decisao.apagar.length; i += LOTE) {
        await tx.rfmEstado.deleteMany({ where: { companyId, customerId: { in: decisao.apagar.slice(i, i + LOTE) } } });
      }
      // a memória: uma instrução por lote, só para cliente que ainda existe
      // NESTA loja (a cliente apagada no meio da rodada não derruba nada)
      for (let i = 0; i < decisao.gravar.length; i += LOTE) {
        const lote = decisao.gravar.slice(i, i + LOTE);
        await tx.$executeRaw`
          INSERT INTO "RfmEstado" ("id", "companyId", "customerId", "grupo", "desde", "seguradaDesde", "atualizadoEm")
          SELECT x.id, ${companyId}, x.cliente, x.grupo, ${agora}, NULL, ${agora}
          FROM unnest(${lote.map(() => randomUUID())}::text[], ${lote.map((g) => g.customerId)}::text[], ${lote.map((g) => g.grupo)}::text[])
               AS x(id, cliente, grupo)
          JOIN "Customer" c ON c."id" = x.cliente AND c."companyId" = ${companyId}
          ON CONFLICT ("customerId") DO UPDATE
            SET "grupo" = EXCLUDED."grupo", "desde" = EXCLUDED."desde", "seguradaDesde" = NULL, "atualizadoEm" = EXCLUDED."atualizadoEm"
            WHERE "RfmEstado"."companyId" = EXCLUDED."companyId"
        `;
      }
      // a queda que espera a vez: a memória fica, e marca desde quando espera
      for (let i = 0; i < decisao.seguradas.length; i += LOTE) {
        await tx.rfmEstado.updateMany({
          where: { companyId, customerId: { in: decisao.seguradas.slice(i, i + LOTE).map((q) => q.customerId) }, seguradaDesde: null },
          data: { seguradaDesde: agora },
        });
      }
      if (decisao.tarefas.length > 0) {
        const ids = decisao.tarefas.map((t) => t.customerId);
        const vivas = new Set(
          (await tx.customer.findMany({ where: { companyId, id: { in: ids } }, select: { id: true } })).map((c) => c.id)
        );
        for (const q of decisao.tarefas) {
          if (!vivas.has(q.customerId)) continue;
          const c = porId.get(q.customerId)!;
          const texto = textoDaQueda(q, { nome: c.nome, diasDesde: c.diasDesde, compras12: c.compras12, valor12: c.valor12 }, brl);
          const dados = {
            title: texto.titulo,
            description: texto.descricao,
            ...prioridadeDaQueda(q.para),
            assigneeId: q.donaId,
            autoRule: chaveDaQueda(q.para, q.customerId),
          };
          const aberta = abertaDe.get(q.customerId);
          if (q.atualizar && aberta) {
            // a data fica a que está: a vendedora pode ter adiado ("ligar dia
            // 20"), e a tarefa atrasada continua atrasada
            const r = await tx.task.updateMany({ where: { id: aberta, status: "PENDENTE" }, data: dados });
            if (r.count > 0) {
              atualizadas++;
              continue;
            }
          }
          await tx.task.create({ data: { companyId, customerId: q.customerId, dueAt: vence, ...dados } });
          novasPorDona.set(q.donaId, (novasPorDona.get(q.donaId) ?? 0) + 1);
        }
      }
      await tx.company.update({ where: { id: companyId }, data: { rfmQuedasOkEm: agora } });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );

  // UM aviso por vendedora, contando só as tarefas NOVAS de verdade — depois
  // do commit, e falhar aqui não desfaz nada (as tarefas já estão na Agenda)
  for (const [donaId, n] of novasPorDona) {
    await sendToUser(donaId, {
      title: n === 1 ? "📉 Uma cliente sua esfriou" : `📉 ${n} clientes suas esfriaram`,
      body: "Caíram de grupo no RFM — a tarefa com a mensagem pronta está na sua agenda.",
      url: "/tarefas",
      tag: "rfm-quedas",
    }).catch(() => null);
  }

  return {
    clientes: clientes.length,
    novas: [...novasPorDona.values()].reduce((s, n) => s + n, 0),
    atualizadas,
    seguradas: decisao.seguradas.length,
    partida,
  };
}

/**
 * A trava: loja com a chave do BI, não suspensa, que ainda não rodou HOJE no
 * calendário de São Paulo (um intervalo em horas escorregaria e poria duas
 * rodadas no mesmo dia, dobrando o teto de tarefas).
 */
export function ondeDaTrava(agora: Date) {
  const inicioDeHoje = new Date(fimDeHojeSP(agora).getTime() - DIA_MS);
  return {
    biEnabled: true,
    suspended: false,
    OR: [{ rfmQuedasRunAt: null }, { rfmQuedasRunAt: { lt: inicioDeHoje } }],
  };
}

/** Freio em memória por instância, antes da trava do banco (curto: a trava do banco é que manda). */
const ultimaTentativa = new Map<string, number>();
const FREIO_MS = 10 * 60 * 1000;

/**
 * A carona: confere a trava e roda. Nunca lança — é carona, não pode derrubar
 * a rota que a chamou.
 */
export async function quedasDoRfmSeDevido(companyId: string): Promise<void> {
  const ms = Date.now();
  if (ms - (ultimaTentativa.get(companyId) ?? 0) < FREIO_MS) return;
  ultimaTentativa.set(companyId, ms);
  try {
    const agora = new Date();
    const pegou = await db.company.updateMany({
      where: { id: companyId, ...ondeDaTrava(agora) },
      data: { rfmQuedasRunAt: agora },
    });
    if (pegou.count === 0) return;
    await rodarQuedasDoRfm(companyId, agora);
  } catch (e) {
    // A TRAVA FICA (a régua da RN-082): devolvê-la faria o sync de 3 s repetir
    // a rodada a cada batida. Nada se perde — a memória só anda quando a
    // transação fecha, e a queda de hoje aparece na rodada de amanhã (falhando
    // por mais de uma semana, a rodada seguinte recomeça do ponto de partida). SEM
    // alarme (RN-066): fica no painel de Saúde.
    await logServerError({
      source: "server",
      path: "/bi/rfm-quedas",
      message: `RFM: rodada das quedas falhou (loja ${companyId})`,
      detail: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
      alarme: false,
    }).catch(() => null);
  }
}
