/**
 * O RETRATO DO MÊS NO RFM — a leitura (RN-101). A regra mora em
 * `rfm-movimento-regra.ts` (pura); aqui: o RFM do começo do mês e o do fim
 * (ou de agora, no mês em curso), pela MESMA consulta da aba Clientes com o
 * relógio no instante certo. Nada é gravado.
 */
import { carregarBaseDoRfm, type ClienteDaLista } from "./rfm";
import { calcularRfm, type GrupoRfm } from "./rfm-regra";
import { compararRetratos, inicioDoMes, mesSeguinte, type RetratoDoMes } from "./rfm-movimento-regra";

export type RetratoLido = {
  retrato: RetratoDoMes;
  /** cliente → grupo no começo do mês */
  antes: Map<string, GrupoRfm>;
  /** as clientes no fim do mês (ou agora), com notas e contato */
  depois: ClienteDaLista[];
};

export async function lerRetratoDoMes(companyId: string, mes: string, agora = new Date()): Promise<RetratoLido> {
  const inicio = inicioDoMes(mes);
  const proximo = inicioDoMes(mesSeguinte(mes));
  const emCurso = agora.getTime() < proximo.getTime();
  const fim = emCurso ? agora : proximo;
  const [baseAntes, baseDepois] = await Promise.all([
    carregarBaseDoRfm(companyId, inicio, { soPagoAntes: true }),
    // no mês em curso o "depois" é o RFM de AGORA, a mesma conta da aba (sem corte)
    carregarBaseDoRfm(companyId, fim, { soPagoAntes: !emCurso }),
  ]);
  const antes = new Map(calcularRfm(baseAntes, inicio).map((c) => [c.id, c.grupo] as const));
  const depois = calcularRfm(baseDepois, fim);
  return { retrato: compararRetratos(mes, antes, depois, emCurso), antes, depois };
}
