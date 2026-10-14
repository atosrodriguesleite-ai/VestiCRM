/**
 * METAS DO MÊS DO BI (RN-082) — lista fechada, regra pura.
 *
 * Decisão do dono (13/10/2026): "pode colocar tudo, o cliente personaliza da
 * forma que fizer sentido para ele". Então o cardápio é fechado (cada tipo
 * tem uma conta de "realizado" que o painel sabe fazer) e a loja escolhe
 * QUAIS preencher, mês a mês. Meta sem número não aparece no painel.
 */

export const TIPOS_DE_META = [
  { tipo: "FATURAMENTO", rotulo: "Faturamento do mês", unidade: "R$", formato: "brl" },
  { tipo: "PEDIDOS_PAGOS", rotulo: "Pedidos pagos", unidade: "pedidos", formato: "int" },
  { tipo: "NOVOS_CONTATOS", rotulo: "Novos contatos (leads)", unidade: "contatos", formato: "int" },
  { tipo: "RESPOSTA_NO_PRAZO_PCT", rotulo: "Respostas dentro do prazo", unidade: "%", formato: "pct" },
  { tipo: "TICKET_MEDIO", rotulo: "Ticket médio", unidade: "R$", formato: "brl" },
  { tipo: "RECOMPRA_PCT", rotulo: "Taxa de recompra", unidade: "%", formato: "pct" },
] as const;
export type TipoDeMeta = (typeof TIPOS_DE_META)[number]["tipo"];
export const TIPOS: readonly string[] = TIPOS_DE_META.map((t) => t.tipo);

export function ehTipoDeMeta(t: string): t is TipoDeMeta {
  return TIPOS.includes(t);
}

/** Confere um valor de meta: número finito, não negativo, % até 100. */
export function validarMeta(tipo: string, valor: number): string | null {
  if (!ehTipoDeMeta(tipo)) return "Tipo de meta desconhecido.";
  if (!Number.isFinite(valor) || valor < 0) return "A meta precisa ser um número maior ou igual a zero.";
  const def = TIPOS_DE_META.find((t) => t.tipo === tipo)!;
  if (def.formato === "pct" && valor > 100) return "Meta em % vai até 100.";
  return null;
}

/** "2026-10" válido? */
export function mesValido(mes: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2020 && Number(m[1]) <= 2100;
}

/** Quanto do caminho já foi (0–100+), nulo sem meta ou sem realizado. */
export function progressoDaMeta(realizado: number | null, meta: number | null): number | null {
  if (meta == null || meta <= 0 || realizado == null) return null;
  return Math.round((realizado / meta) * 100);
}
