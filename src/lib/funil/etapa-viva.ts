import { Prisma } from "@prisma/client";

/**
 * RN-091: a gerência pode APAGAR uma etapa enquanto um lead/pedido está
 * nascendo nela. Quem cria cartão lê a etapa e depois cria — se a exclusão
 * cair entre as duas coisas, a chave estrangeira recusa (P2003) e o lead ou
 * o pedido do catálogo quebraria por causa do funil. Aqui a criação tenta de
 * novo UMA vez, resolvendo a etapa outra vez (a exclusão já levou a regra de
 * origem para o destino, então a segunda leitura acha a etapa certa).
 */
export async function naEtapaViva<S, T>(
  resolver: () => Promise<S | null>,
  criar: (etapa: S) => Promise<T>
): Promise<{ etapa: S; criado: T } | null> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const etapa = await resolver();
    if (!etapa) return null;
    try {
      return { etapa, criado: await criar(etapa) };
    } catch (e) {
      const etapaSumiu = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
      if (etapaSumiu && tentativa === 0) continue;
      throw e;
    }
  }
  return null;
}
