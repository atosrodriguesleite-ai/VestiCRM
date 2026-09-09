import { db } from "../db";
import { sendToUser } from "../push";
import { linhasDoEstoque, type LinhaDoInventario } from "./inventario";
import { noMinimo } from "./minimos";

/**
 * O ALERTA DE MÍNIMO, SEM SPAM (RN-051).
 *
 * A loja vende o dia inteiro e ninguém abre o Inventário para conferir; o
 * aviso tem que chegar sozinho — no sino e no push da gerência. Duas
 * decisões evitam que ele vire ruído e seja desligado na primeira semana:
 *
 *  • UMA variação avisa UMA vez: ao chegar ao mínimo ela é carimbada
 *    (`ProductVariant.lowStockAlertedAt`) e só volta a avisar depois de
 *    SUBIR acima do mínimo e cair de novo (o carimbo zera na recuperação).
 *    Sem isso, a peça que a loja decidiu não repor apareceria todo dia.
 *  • UM aviso por rodada, em RESUMO ("7 peças chegaram ao mínimo", as
 *    primeiras pelo nome, e o link para a lista) — nunca sete avisos.
 *
 * Roda DE CARONA no tráfego (sync da inbox, abertura do Estoque), com trava
 * atômica por loja (`Company.estoqueAlertaRunAt`) — nunca um 3º cron
 * (ADR-002). Sem o módulo ligado a varredura não roda: o alerta é do módulo.
 */

/** Intervalo mínimo entre duas varreduras da mesma loja. */
export const INTERVALO_DA_VARREDURA_MS = 30 * 60_000;

/** Quantas peças cabem no texto do aviso; o resto vira "e mais N". */
export const PECAS_NO_AVISO = 4;

export type DecisaoDoAlerta = {
  /** variações que chegaram ao mínimo AGORA (sem carimbo) → avisar e carimbar */
  avisar: string[];
  /** variações que voltaram acima do mínimo com carimbo → limpar */
  limpar: string[];
};

/** A decisão pura: quem avisa, quem limpa. */
export function decidirAlertas(
  linhas: Pick<LinhaDoInventario, "variantId" | "disponivel" | "minimo" | "ativo">[],
  carimbadas: Set<string>
): DecisaoDoAlerta {
  const avisar: string[] = [];
  const limpar: string[] = [];
  for (const l of linhas) {
    const no = noMinimo(l.disponivel, l.minimo);
    const carimbada = carimbadas.has(l.variantId);
    // produto inativo não avisa (não está à venda); se estava carimbado, solta
    if (l.ativo && no && !carimbada) avisar.push(l.variantId);
    if ((!no || !l.ativo) && carimbada) limpar.push(l.variantId);
  }
  return { avisar, limpar };
}

/** O texto do aviso: título + corpo, em português de loja (puro). */
export function textoDoAlerta(
  pecas: Pick<LinhaDoInventario, "produto" | "cor" | "tamanho" | "disponivel" | "minimo">[]
): { title: string; body: string } {
  const n = pecas.length;
  const title =
    n === 1 ? "⚠️ 1 peça chegou ao mínimo" : `⚠️ ${n} peças chegaram ao mínimo`;
  const nomes = pecas
    .slice(0, PECAS_NO_AVISO)
    .map((p) => `${[p.produto, p.cor, p.tamanho].filter(Boolean).join(" ")} (${p.disponivel}/${p.minimo})`);
  const resto = n - nomes.length;
  const body = `${nomes.join(", ")}${resto > 0 ? ` e mais ${resto}` : ""}. Veja o que repor na tela Estoque.`;
  return { title, body };
}

/**
 * A varredura: confere a trava, decide, grava carimbos e avisa a gerência.
 * Nunca lança — é carona, não pode derrubar a rota que a chamou.
 */
export async function varrerMinimosSeDevido(companyId: string): Promise<void> {
  try {
    const agora = new Date();
    const claimed = await db.company.updateMany({
      where: {
        id: companyId,
        estoqueEnabled: true,
        OR: [
          { estoqueAlertaRunAt: null },
          { estoqueAlertaRunAt: { lt: new Date(agora.getTime() - INTERVALO_DA_VARREDURA_MS) } },
        ],
      },
      data: { estoqueAlertaRunAt: agora },
    });
    if (claimed.count === 0) return;
    await varrerMinimos(companyId);
  } catch (e) {
    console.error("[estoque] alerta de mínimo falhou", e);
  }
}

/** A rodada em si (sem trava — quem chama garante). Devolve quantas avisou. */
export async function varrerMinimos(companyId: string): Promise<number> {
  // inclui inativos para LIMPAR o carimbo de quem foi desativado
  const { linhas } = await linhasDoEstoque(companyId, { incluirInativos: true });
  const carimbadasRows = await db.productVariant.findMany({
    where: { product: { companyId }, lowStockAlertedAt: { not: null } },
    select: { id: true },
  });
  const carimbadas = new Set(carimbadasRows.map((v) => v.id));
  const { avisar, limpar } = decidirAlertas(linhas, carimbadas);

  if (limpar.length) {
    await db.productVariant.updateMany({
      where: { id: { in: limpar } },
      data: { lowStockAlertedAt: null },
    });
  }
  if (avisar.length === 0) return 0;

  const agora = new Date();
  await db.productVariant.updateMany({
    where: { id: { in: avisar } },
    data: { lowStockAlertedAt: agora },
  });

  const gerencia = await db.user.findMany({
    where: { companyId, role: { in: ["ADMIN", "MANAGER"] }, active: true },
    select: { id: true },
  });
  if (gerencia.length === 0) return avisar.length;

  const porId = new Map(linhas.map((l) => [l.variantId, l]));
  // as mais urgentes primeiro (menos disponível em relação ao mínimo)
  const pecas = avisar
    .map((id) => porId.get(id)!)
    .sort((a, b) => a.disponivel - b.disponivel || a.produto.localeCompare(b.produto));
  const { title, body } = textoDoAlerta(pecas);

  await db.notification.createMany({
    data: gerencia.map((u) => ({ companyId, userId: u.id, type: "ESTOQUE", title, body })),
  });
  await Promise.all(
    gerencia.map((u) =>
      sendToUser(u.id, { title, body, url: "/estoque?filtro=baixo", tag: "estoque-minimo" }).catch(
        () => null
      )
    )
  );
  return avisar.length;
}
