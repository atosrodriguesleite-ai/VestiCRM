import { db } from "../db";
import type { VolumePacote } from "../melhorenvio-tipos";

/**
 * SIMULADOR DE FRETE (RN-019) — a memória de embalagem da loja.
 *
 * A dor: a cliente pergunta o frete ANTES de pagar, mas a caixa só existe
 * DEPOIS que a expedição embala. A saída combinada com o dono (19/08/2026):
 * o sistema NÃO CHUTA uma embalagem — ele mostra os envios REAIS parecidos
 * ("teve um envio de 23 peças nessa caixa, o que acha?") e a VENDEDORA
 * escolhe qual usar na cotação. Certeiro porque é medida de balança e fita,
 * não estimativa de fórmula.
 *
 * A memória é POR LOJA (multi-tenant, RN-013): embalagem de uma loja jamais
 * aparece para outra. E o recurso inteiro fica atrás do interruptor
 * `Company.freteSimuladorEnabled` — desligado, nada muda para a loja.
 */

/** Um envio passado que pode servir de referência para a cotação. */
export type EmbalagemCandidata = {
  /** id do REGISTRO DE ENVIO (não do pedido) — chave neutra para a tela */
  id: string;
  orderId: string;
  /** número do pedido (para a vendedora reconhecer: "ah, o da Paula") */
  orderNumber: number;
  /** quando a etiqueta foi comprada (recência desempata) */
  compradoEm: Date;
  /** quantas peças o pedido tinha na compra da etiqueta */
  pecas: number;
  /** os volumes que a etiqueta declarou (medidas reais) */
  volumes: VolumePacote[];
  /** peso somado dos volumes, em kg */
  pesoKg: number;
};

/** Peso somado dos volumes (kg, 3 casas — mesmo arredondamento da cotação). */
export function pesoTotalKg(volumes: VolumePacote[]): number {
  return Math.round(volumes.reduce((s, v) => s + v.pesoKg, 0) * 1000) / 1000;
}

/**
 * Até quantas peças de diferença um envio passado ainda "parece" com o
 * pedido de agora. Curta demais, loja nova nunca vê sugestão; larga demais,
 * 10 peças viram referência para 40. A régua: 3 peças ou 20% do pedido, o
 * que for maior (pedido de atacado grande aceita diferença maior).
 */
export function toleranciaDePecas(pecas: number): number {
  return Math.max(3, Math.ceil(pecas * 0.2));
}

/**
 * Ordena as candidatas: quem tem o número de peças MAIS PERTO vence; empate
 * vai para a mais RECENTE (a embalagem de hoje representa melhor a expedição
 * de hoje do que a de seis meses atrás). Função pura — é ela que o teste
 * guarda.
 */
export function ordenarEmbalagens(
  pecas: number,
  candidatas: EmbalagemCandidata[]
): EmbalagemCandidata[] {
  const tol = toleranciaDePecas(pecas);
  return candidatas
    .filter((c) => Math.abs(c.pecas - pecas) <= tol)
    .sort((a, b) => {
      const da = Math.abs(a.pecas - pecas);
      const dbb = Math.abs(b.pecas - pecas);
      if (da !== dbb) return da - dbb;
      return b.compradoEm.getTime() - a.compradoEm.getTime();
    });
}

/** JSON gravado na etiqueta → volumes, ou null se o registro estiver torto. */
export function lerVolumesJson(json: string | null): VolumePacote[] | null {
  if (!json) return null;
  try {
    const lista = JSON.parse(json) as unknown;
    if (!Array.isArray(lista) || lista.length === 0) return null;
    const volumes: VolumePacote[] = [];
    for (const v of lista) {
      const { pesoKg, alturaCm, larguraCm, comprimentoCm } = (v ?? {}) as Record<
        string,
        unknown
      >;
      const nums = [pesoKg, alturaCm, larguraCm, comprimentoCm].map(Number);
      if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
      volumes.push({
        pesoKg: nums[0],
        alturaCm: nums[1],
        larguraCm: nums[2],
        comprimentoCm: nums[3],
      });
    }
    return volumes;
  } catch {
    return null;
  }
}

/** Quantas sugestões a tela mostra (mais que isso vira lista, não escolha). */
const MAXIMO_SUGESTOES = 5;

/**
 * Envios passados da LOJA parecidos com um pedido de `pecas` peças.
 *
 * Só entra memória confiável: etiqueta com volumes gravados, não cancelada
 * (etiqueta cancelada pode ter sido exatamente por medida errada) e de pedido
 * vivo. A janela de 400 etiquetas mais recentes é de sobra — a ordenação
 * fina acontece em memória, na função pura.
 */
export async function embalagensParecidas(
  companyId: string,
  pecas: number
): Promise<EmbalagemCandidata[]> {
  const tol = toleranciaDePecas(pecas);
  const linhas = await db.shipping.findMany({
    where: {
      volumesJson: { not: null },
      pieces: { gte: pecas - tol, lte: pecas + tol },
      meStatus: { not: "CANCELADO" },
      order: { companyId, status: { not: "CANCELADO" as never } },
    },
    orderBy: { id: "desc" },
    take: 400,
    select: {
      id: true,
      orderId: true,
      volumesJson: true,
      pieces: true,
      meCompradoEm: true,
      shippedAt: true,
      order: { select: { number: true, createdAt: true } },
    },
  });
  const candidatas: EmbalagemCandidata[] = [];
  for (const l of linhas) {
    const volumes = lerVolumesJson(l.volumesJson);
    if (!volumes || !l.pieces) continue;
    candidatas.push({
      id: l.id,
      orderId: l.orderId,
      orderNumber: l.order.number,
      // etiquetas antigas (de antes desta coluna) caem na data do pedido —
      // régua de recência boa o bastante (a etiqueta nasce dias depois dele)
      compradoEm: l.meCompradoEm ?? l.shippedAt ?? l.order.createdAt,
      pecas: l.pieces,
      volumes,
      pesoKg: pesoTotalKg(volumes),
    });
  }
  return ordenarEmbalagens(pecas, candidatas).slice(0, MAXIMO_SUGESTOES);
}
