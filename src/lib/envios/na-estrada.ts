import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { atrasoDoEnvio } from "./painel";
import { montarNaEstrada, type MapaNaEstrada, type PacoteNaEstrada } from "./mapa";

/**
 * A LISTA "NA ESTRADA" TEM UM LEITOR SÓ (RN-103/RN-104): o mapa 2D da tela
 * Envios e a TV leem os pacotes a caminho por AQUI — a mesma cláusula, o
 * mesmo teto, a mesma régua de atraso (RN-102). Copiada em duas rotas, uma
 * mexida na régua chegava a uma e não à outra, e o mapa e a TV discordavam
 * sobre quem está a caminho.
 */

/** Teto largo: é o que está na rua AGORA, nunca a história da loja. */
export const TETO_NA_ESTRADA = 2_000;

export type NaEstradaLida = {
  /** a camada do mapa (agregada por cidade; o sem UF fica em `semEndereco`) */
  estrada: MapaNaEstrada;
  /** todos os pacotes lidos, com a situação de cada um — inclusive os sem UF */
  pacotes: PacoteNaEstrada[];
};

/**
 * Lê os pacotes POSTADOS sem entrega (nem a marcada à mão na ficha) no
 * recorte dado, os mais antigos primeiro (se o teto cortar, quem fica de
 * fora é o recém-postado, nunca o que pode estar atrasado), e o remetente
 * cadastrado no Melhor Envio — de onde os arcos saem.
 */
export async function lerNaEstrada(escopo: Prisma.ShippingWhereInput, companyId: string, agora: Date): Promise<NaEstradaLida> {
  const [lidos, remetente] = await Promise.all([
    db.shipping.findMany({
      where: { ...escopo, meStatus: "POSTADO", shippedAt: { not: null }, deliveredAt: null },
      select: { city: true, state: true, shippedAt: true, previstoAte: true },
      orderBy: { shippedAt: "asc" },
      take: TETO_NA_ESTRADA,
    }),
    db.melhorEnvioConnection.findUnique({ where: { companyId }, select: { fromCity: true, fromState: true } }),
  ]);
  const pacotes: PacoteNaEstrada[] = lidos.map((e) => {
    const a = atrasoDoEnvio({ meStatus: "POSTADO", postadoEm: e.shippedAt, previstoAte: e.previstoAte }, agora);
    return {
      cidade: e.city,
      uf: e.state,
      // "parado" é o sem prazo na régua antiga: diz parado, nunca atrasado (RN-102)
      situacao: !a.atrasado ? "no-prazo" : a.pelaReguaAntiga ? "parado" : "atrasado",
    };
  });
  const estrada = montarNaEstrada(pacotes, remetente ? { cidade: remetente.fromCity, uf: remetente.fromState } : null, {
    cortado: lidos.length >= TETO_NA_ESTRADA,
  });
  return { estrada, pacotes };
}
