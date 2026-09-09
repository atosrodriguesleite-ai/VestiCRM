import { db } from "../db";

/**
 * A ABA PRODUÇÃO DO ESTOQUE (RN-052, Fase 4) — SÓ LEITURA.
 *
 * A confecção pergunta duas coisas que o Inventário não responde: "quanto
 * está CORTADO esperando costura?" e "quanto TECIDO ainda tenho para
 * cortar?". As duas respostas já existem no módulo Produção; aqui elas são
 * mostradas ao lado do estoque de produto, com o atalho para a tela que
 * LANÇA (a costura). Nada é gravado por esta aba: o caminho de "cortado
 * vira produto" continua sendo o de sempre (`lancaNoEstoque`, que sobe o
 * estoque, escreve a ENTRADA no livro e espelha para a Nuvemshop).
 */

export type ResumoDaProducao = {
  cortadas: {
    /** peças cortadas que ainda não foram lançadas como produto */
    aguardando: number;
    /** por modelo/cor/tamanho, as maiores primeiro */
    itens: { productName: string; color: string | null; size: string | null; pendentes: number; cutCode: number | null }[];
  };
  faccao: {
    /** peças fora, em facção, ainda não devolvidas */
    fora: number;
    lotesAbertos: number;
  };
  rolos: {
    quantidade: number;
    kg: number;
    valor: number;
    /** por tecido e cor */
    porTecido: { tecido: string; cor: string; rolos: number; kg: number; valor: number }[];
  };
};

export const TETO_DOS_ITENS = 40;

export async function resumoDaProducao(companyId: string): Promise<ResumoDaProducao> {
  const [sewing, lotes, rolos] = await Promise.all([
    db.sewingItem.findMany({
      where: { companyId },
      select: { productName: true, color: true, size: true, cutPieces: true, donePieces: true, cutCode: true },
    }),
    db.sewingBatch.findMany({
      where: { companyId, destination: "FACCAO", status: { not: "FECHADO" } },
      select: { items: { select: { sent: true, good: true, defect: true } } },
    }),
    db.fabricRoll.findMany({
      where: { fabric: { companyId }, remainingKg: { gt: 0 } },
      select: { color: true, remainingKg: true, pricePerKg: true, fabric: { select: { name: true } } },
    }),
  ]);

  const itens = sewing
    .map((s) => ({
      productName: s.productName,
      color: s.color,
      size: s.size,
      cutCode: s.cutCode,
      pendentes: Math.max(0, s.cutPieces - s.donePieces),
    }))
    .filter((s) => s.pendentes > 0)
    .sort((a, b) => b.pendentes - a.pendentes);

  const fora = lotes.reduce(
    (s, b) => s + b.items.reduce((t, i) => t + Math.max(0, i.sent - i.good - i.defect), 0),
    0
  );

  const porTecido = new Map<string, ResumoDaProducao["rolos"]["porTecido"][number]>();
  for (const r of rolos) {
    const k = `${r.fabric.name}|${r.color}`;
    const t = porTecido.get(k) ?? { tecido: r.fabric.name, cor: r.color, rolos: 0, kg: 0, valor: 0 };
    t.rolos++;
    t.kg += r.remainingKg;
    t.valor += r.remainingKg * r.pricePerKg;
    porTecido.set(k, t);
  }

  return {
    cortadas: {
      aguardando: itens.reduce((s, i) => s + i.pendentes, 0),
      itens: itens.slice(0, TETO_DOS_ITENS),
    },
    faccao: { fora, lotesAbertos: lotes.length },
    rolos: {
      quantidade: rolos.length,
      kg: rolos.reduce((s, r) => s + r.remainingKg, 0),
      valor: rolos.reduce((s, r) => s + r.remainingKg * r.pricePerKg, 0),
      porTecido: [...porTecido.values()].sort((a, b) => b.kg - a.kg),
    },
  };
}
