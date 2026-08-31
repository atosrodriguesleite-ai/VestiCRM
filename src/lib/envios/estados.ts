/**
 * Nome de cada UF — módulo pequeno e SEM as bases geográficas pesadas, para
 * a tela poder importar (o mapa.ts puxa os ~170 KB de municípios e por isso
 * é só do servidor).
 */
import { normalizarBusca } from "../busca";

export const NOME_DO_ESTADO: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia",
  RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe",
  TO: "Tocantins",
};

/**
 * A UF do cadastro nem sempre é a sigla: a Nuvemshop manda o NOME do estado
 * ("Minas Gerais"), e a cliente digita "alagoas" no formulário do catálogo.
 * Mora aqui (módulo leve) porque telas e o catálogo público importam — o
 * mapa.ts puxa ~170 KB de municípios e é só do servidor.
 */
const POR_NOME = new Map(
  Object.entries(NOME_DO_ESTADO).map(([sigla, nome]) => [normalizarBusca(nome), sigla])
);

/** Devolve a sigla de 2 letras, aceitando sigla ou nome por extenso. */
export function siglaDoEstado(bruto: string | null | undefined): string | null {
  const t = (bruto ?? "").trim();
  if (!t) return null;
  const sigla = t.toUpperCase();
  if (NOME_DO_ESTADO[sigla]) return sigla;
  return POR_NOME.get(normalizarBusca(t)) ?? null;
}
