/** As abas do BI — a lista mora aqui (pura) para a tela e as listas lerem a mesma. */
export type AbaDoBi = "painel" | "vendedoras" | "clientes" | "anuncios";

export const ABAS_DO_BI: readonly AbaDoBi[] = ["painel", "vendedoras", "clientes", "anuncios"];

/** A aba pedida na URL — uma fonte só com a lista (aba nova entra aqui e chega a todos). */
export function lerAba(pedida: string | undefined): AbaDoBi {
  return ABAS_DO_BI.includes(pedida as AbaDoBi) ? (pedida as AbaDoBi) : "painel";
}
