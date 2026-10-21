import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import { isManagerUp } from "../scope";
import {
  MARCOS,
  type Marco,
  type EtapaRegra,
  corValida,
  limparNome,
  posicaoDaNova,
  problemaAoApagar,
  problemaAoCriar,
  problemaNaOrdem,
  problemaNoMarco,
  problemaNoNome,
} from "./etapas-regra";

/**
 * RN-091 · O EDITOR DO FUNIL (servidor).
 *
 * Porteira: chave da loja (`Company.funilEditavelEnabled`, super admin liga)
 * E gerência (admin/gerente). Vendedora e suporte não mexem no funil de
 * todo mundo — uma etapa apagada com 30 cartões bagunça a loja inteira.
 *
 * Cada mudança é UMA transação com o funil TRAVADO (`FOR UPDATE` na linha do
 * Pipeline): duas gerentes editando ao mesmo tempo esperam uma à outra, e a
 * conferência (nome repetido, última etapa aberta, a primeira ser aberta) é
 * feita sobre o que está no banco NAQUELE instante. Toda mudança fica na
 * Central de Comunicação (`funil.editado`) com quem fez — é o que responde
 * "quem mexeu no meu funil?".
 */

export class FunilErro extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function podeEditarFunil(user: SessionUser): boolean {
  return isManagerUp(user);
}

/** Confere a porteira e devolve o funil (da loja!) que vai ser editado. */
export async function porteiraDoEditor(user: SessionUser, pipelineId: string): Promise<string> {
  if (!podeEditarFunil(user))
    throw new FunilErro("Só administrador e gerente editam o funil.", 403);
  const [loja, funil] = await Promise.all([
    db.company.findUnique({
      where: { id: user.companyId },
      select: { funilEditavelEnabled: true },
    }),
    db.pipeline.findFirst({
      where: { id: pipelineId, companyId: user.companyId },
      select: { id: true },
    }),
  ]);
  // sem a chave a porta nem existe (mesmo padrão dos módulos)
  if (!loja?.funilEditavelEnabled) throw new FunilErro("Não encontrado", 404);
  if (!funil) throw new FunilErro("Funil não encontrado.", 404);
  return funil.id;
}

export type EtapaDoEditor = EtapaRegra & { color: string; order: number; cartoes: number };
export type EstadoDoEditor = {
  pipelineId: string;
  etapas: EtapaDoEditor[];
  marcos: Record<Marco, string | null>;
};

type Tx = Prisma.TransactionClient;

async function lerEstado(cliente: Tx | typeof db, pipelineId: string): Promise<EstadoDoEditor> {
  const [etapas, contagem, vinculos] = await Promise.all([
    cliente.stage.findMany({
      where: { pipelineId },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, name: true, color: true, order: true, isWon: true, isLost: true },
    }),
    cliente.opportunity.groupBy({
      by: ["stageId"],
      where: { stage: { pipelineId } },
      _count: { _all: true },
    }),
    cliente.etapaAutomatica.findMany({
      where: { pipelineId },
      select: { marco: true, stageId: true },
    }),
  ]);
  const porEtapa = new Map(contagem.map((c) => [c.stageId, c._count._all]));
  const marcos = Object.fromEntries(MARCOS.map((m) => [m, null])) as Record<Marco, string | null>;
  for (const v of vinculos) if ((MARCOS as readonly string[]).includes(v.marco)) marcos[v.marco as Marco] = v.stageId;
  return {
    pipelineId,
    etapas: etapas.map((e) => ({ ...e, cartoes: porEtapa.get(e.id) ?? 0 })),
    marcos,
  };
}

export function estadoDoEditor(pipelineId: string): Promise<EstadoDoEditor> {
  return lerEstado(db, pipelineId);
}

type EtapaTravada = { id: string; name: string; order: number; isWon: boolean; isLost: boolean };

/** Abre a transação com o funil travado; etapas e marcos lidos sob a trava. */
async function comFunilTravado<T>(
  pipelineId: string,
  trabalho: (tx: Tx, etapas: EtapaTravada[], comMarco: string[]) => Promise<T>
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Pipeline" WHERE id = ${pipelineId} FOR UPDATE`;
      const [etapas, marcos] = await Promise.all([
        tx.stage.findMany({
          where: { pipelineId },
          orderBy: [{ order: "asc" }, { id: "asc" }],
          select: { id: true, name: true, order: true, isWon: true, isLost: true },
        }),
        tx.etapaAutomatica.findMany({ where: { pipelineId }, select: { stageId: true } }),
      ]);
      return trabalho(tx, etapas, [...new Set(marcos.map((m) => m.stageId))]);
    },
    // o banco fica longe (Neon): o padrão de 5s do Prisma é curto para uma
    // exclusão que move cartões, regra de origem, marcos e renumera
    { timeout: 15_000, maxWait: 5_000 }
  );
}

/** Grava a ordem 0..n-1 na sequência dada, num comando só (uma viagem). */
async function numerar(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const linhas = Prisma.join(ids.map((id, i) => Prisma.sql`(${id}, ${i}::int)`));
  await tx.$executeRaw`
    UPDATE "Stage" AS s SET "order" = v.ordem
    FROM (VALUES ${linhas}) AS v(id, ordem)
    WHERE s.id = v.id AND s."order" <> v.ordem`;
}

async function registrar(tx: Tx, user: SessionUser, acao: string, detalhe: Record<string, unknown>) {
  await tx.commEvent.create({
    data: {
      companyId: user.companyId,
      direction: "OUT",
      type: "funil.editado",
      status: "OK",
      payload: JSON.stringify({ por: { id: user.id, nome: user.name }, acao, ...detalhe }),
    },
  });
}

export async function criarEtapa(
  user: SessionUser,
  pipelineId: string,
  pedido: { name: string; color: string }
): Promise<EstadoDoEditor> {
  if (!corValida(pedido.color)) throw new FunilErro("Cor inválida.");
  return comFunilTravado(pipelineId, async (tx, etapas) => {
    const problema = problemaAoCriar(etapas) ?? problemaNoNome(pedido.name, etapas);
    if (problema) throw new FunilErro(problema);
    const pos = posicaoDaNova(etapas);
    const nova = await tx.stage.create({
      data: { pipelineId, name: limparNome(pedido.name), color: pedido.color, order: pos },
      select: { id: true },
    });
    const ids = etapas.map((e) => e.id);
    ids.splice(pos, 0, nova.id);
    await numerar(tx, ids);
    await registrar(tx, user, "criou", { etapa: limparNome(pedido.name) });
    return lerEstado(tx, pipelineId);
  });
}

export async function editarEtapa(
  user: SessionUser,
  pipelineId: string,
  stageId: string,
  pedido: { name?: string; color?: string }
): Promise<EstadoDoEditor> {
  if (pedido.color !== undefined && !corValida(pedido.color)) throw new FunilErro("Cor inválida.");
  return comFunilTravado(pipelineId, async (tx, etapas) => {
    const etapa = etapas.find((e) => e.id === stageId);
    if (!etapa) throw new FunilErro("Essa etapa não existe mais. Feche e abra o editor de novo.", 409);
    const dados: { name?: string; color?: string } = {};
    // só o que MUDOU de verdade (espaço a mais e a cor que já era não viram
    // registro de "editou" — o histórico responde "quem mexeu no funil?")
    if (pedido.name !== undefined && limparNome(pedido.name) !== etapa.name) {
      const problema = problemaNoNome(pedido.name, etapas, stageId);
      if (problema) throw new FunilErro(problema);
      dados.name = limparNome(pedido.name);
    }
    if (pedido.color !== undefined) {
      const atual = await tx.stage.findUnique({ where: { id: stageId }, select: { color: true } });
      if (atual?.color !== pedido.color) dados.color = pedido.color;
    }
    if (Object.keys(dados).length) {
      await tx.stage.update({ where: { id: stageId }, data: dados });
      await registrar(tx, user, "editou", {
        etapa: etapa.name,
        ...(dados.name ? { novoNome: dados.name } : {}),
        ...(dados.color ? { cor: dados.color } : {}),
      });
    }
    return lerEstado(tx, pipelineId);
  });
}

export async function reordenarEtapas(
  user: SessionUser,
  pipelineId: string,
  ids: string[]
): Promise<EstadoDoEditor> {
  return comFunilTravado(pipelineId, async (tx, etapas, comMarco) => {
    const problema = problemaNaOrdem(etapas, ids, comMarco);
    if (problema) throw new FunilErro(problema, 409);
    await numerar(tx, ids);
    await registrar(tx, user, "reordenou", {
      ordem: ids.map((id) => etapas.find((e) => e.id === id)?.name),
    });
    return lerEstado(tx, pipelineId);
  });
}

/**
 * Apaga a etapa levando TUDO o que apontava para ela ao destino: os cartões,
 * a regra de "em qual etapa cada origem entra" (`OriginRule`) e os marcos do
 * sistema — "o que ia para X agora vai para Y". Cartão nunca some.
 */
export async function apagarEtapa(
  user: SessionUser,
  pipelineId: string,
  stageId: string,
  destinoId: string | null
): Promise<EstadoDoEditor & { cartoesMovidos: number }> {
  try {
    return await comFunilTravado(pipelineId, async (tx, etapas, comMarco) => {
      const problema = problemaAoApagar(etapas, stageId, destinoId, comMarco.includes(stageId));
      if (problema) throw new FunilErro(problema, 409);
      const alvo = etapas.find((e) => e.id === stageId)!;
      const destino = etapas.find((e) => e.id === destinoId)!;
      const movidos = await tx.opportunity.updateMany({
        where: { stageId, companyId: user.companyId },
        data: { stageId: destino.id },
      });
      await tx.originRule.updateMany({
        where: { stageId, companyId: user.companyId },
        data: { stageId: destino.id },
      });
      const marcos = await tx.etapaAutomatica.updateMany({
        where: { stageId, pipelineId },
        data: { stageId: destino.id },
      });
      await tx.stage.delete({ where: { id: stageId } });
      const resto = etapas.filter((e) => e.id !== stageId);
      await numerar(tx, resto.map((e) => e.id));
      await registrar(tx, user, "apagou", {
        etapa: alvo.name,
        destino: destino.name,
        cartoesMovidos: movidos.count,
        marcosMovidos: marcos.count,
      });
      return { ...(await lerEstado(tx, pipelineId)), cartoesMovidos: movidos.count };
    });
  } catch (e) {
    // um cartão NOVO entrou na etapa entre mover e apagar (lead chegando
    // naquele segundo): a chave estrangeira recusa a exclusão e a transação
    // inteira volta — nada se perde, é só tentar de novo
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")
      throw new FunilErro("Entrou um cartão novo nessa etapa agora mesmo. Tente apagar de novo.", 409);
    throw e;
  }
}

/** Para qual etapa o sistema move o cartão sozinho (null = não mover). */
export async function salvarMarcos(
  user: SessionUser,
  pipelineId: string,
  pedido: Partial<Record<Marco, string | null>>
): Promise<EstadoDoEditor> {
  return comFunilTravado(pipelineId, async (tx, etapas) => {
    const mudancas: Record<string, string | null> = {};
    for (const marco of MARCOS) {
      if (!(marco in pedido)) continue;
      const stageId = pedido[marco] ?? null;
      const problema = problemaNoMarco(etapas, stageId);
      if (problema) throw new FunilErro(problema, 409);
      if (stageId === null) {
        await tx.etapaAutomatica.deleteMany({ where: { pipelineId, marco } });
      } else {
        await tx.etapaAutomatica.upsert({
          where: { pipelineId_marco: { pipelineId, marco } },
          create: { pipelineId, marco, stageId },
          update: { stageId },
        });
      }
      mudancas[marco] = stageId ? (etapas.find((e) => e.id === stageId)?.name ?? null) : null;
    }
    if (Object.keys(mudancas).length) await registrar(tx, user, "automaticas", { marcos: mudancas });
    return lerEstado(tx, pipelineId);
  });
}
