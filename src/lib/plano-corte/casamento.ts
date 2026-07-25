import type { ContornoPdf } from "./pdf";
import type { ModeloCorte } from "./types";

/**
 * Casamento por medidas: pareia os contornos vindos do PDF (que têm a
 * CURVA mas não têm nome) com as peças do modelo .adsx (que têm NOME,
 * tamanho e as medidas exatas de cada peça). A caixa da peça funciona
 * como impressão digital: a curva de 103,0 × 50,0 cm só pode ser a peça
 * que o .adsx diz ter 103,0 × 50,0 cm.
 *
 * Peça "par" (cortada 2x) aparece duplicada no PDF com a MESMA medida —
 * qualquer uma das cópias serve, o formato é o mesmo.
 */

export type ResultadoCasamento = {
  casadas: number; // peça×tamanho que ganhou curva
  totalAlvos: number; // peça×tamanho existentes no modelo
  sobrando: number; // contornos do PDF que não casaram com ninguém
  detalhes: { peca: string; tamanho: string; ok: boolean }[];
};

/** Tolerância: peça do CAD e curva do PDF podem divergir uns milímetros. */
const TOLERANCIA_CM = 1.2;

export function casarCurvas(
  modelo: ModeloCorte,
  contornos: ContornoPdf[]
): ResultadoCasamento {
  const usados = new Set<number>();
  const detalhes: ResultadoCasamento["detalhes"] = [];
  let casadas = 0;
  let totalAlvos = 0;

  for (const peca of modelo.pecas) {
    for (const [tamanho, med] of Object.entries(peca.tamanhos)) {
      totalAlvos++;
      // melhor candidato: menor distância de medidas dentro da tolerância
      // (testa também trocando w/h — o PDF pode desenhar a peça deitada)
      let melhor = -1;
      let melhorDist = Infinity;
      let melhorGirado = false;
      for (let i = 0; i < contornos.length; i++) {
        if (usados.has(i)) continue;
        const c = contornos[i];
        const dReto = Math.max(Math.abs(c.w - med.w), Math.abs(c.h - med.h));
        const dGirado = Math.max(Math.abs(c.h - med.w), Math.abs(c.w - med.h));
        const d = Math.min(dReto, dGirado);
        if (d < melhorDist) {
          melhorDist = d;
          melhor = i;
          melhorGirado = dGirado < dReto;
        }
      }
      const ok = melhor >= 0 && melhorDist <= TOLERANCIA_CM;
      if (ok) {
        usados.add(melhor);
        const c = contornos[melhor];
        // gira 90° se o PDF desenhou a peça deitada em relação ao CAD
        med.contorno = melhorGirado
          ? c.contorno.map(([x, y]) => [y, x] as [number, number])
          : c.contorno;
        casadas++;
      }
      detalhes.push({ peca: peca.nome, tamanho, ok });
    }
  }

  return {
    casadas,
    totalAlvos,
    sobrando: contornos.length - usados.size,
    detalhes,
  };
}
