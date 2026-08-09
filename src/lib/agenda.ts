import { casaTexto } from "./busca";

/**
 * A REGRA DA AGENDA (abas, busca e ordem) FORA DA TELA.
 *
 * Enquanto isso vivia solto dentro do componente, não dava para testar nada:
 * o bug do "concluí e continua atrasada" passou despercebido justamente
 * porque a lista era um emaranhado de `filter` no meio do JSX.
 *
 * Aqui só entra decisão pura — recebe as tarefas e a hora, devolve a lista.
 */

export type TarefaDaAgenda = {
  id: string;
  title: string;
  dueAt: string;
  priority: string;
  status: string;
  customer: { name: string } | null;
};

export type AbaDaAgenda = "hoje" | "atrasadas" | "proximas" | "concluidas";

/**
 * A virada do dia é a de SÃO PAULO, não a do aparelho.
 *
 * As tarefas nascem vencendo às 23:59 de São Paulo (`fimDoDiaSP`, em
 * automations-run). Se a tela usasse o fuso do aparelho, uma tarefa de hoje
 * cairia em "Próximas" — e o pior: o resultado mudava conforme o celular,
 * então nem dava para testar. Mesma régua de `contato-feito.ts`.
 *
 * Devolve a MEIA-NOITE SEGUINTE (limite de cima, exclusivo).
 */
export function viradaDoDiaSP(agora: Date): Date {
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  // meia-noite de SP = 03:00Z; a virada é a meia-noite seguinte
  return new Date(new Date(`${dia}T03:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
}

/** Em qual aba esta tarefa mora? (uma tarefa mora em UMA aba só) */
export function abaDaTarefa(t: TarefaDaAgenda, agora: Date): AbaDaAgenda {
  // qualquer coisa que NÃO está pendente (CONCLUIDA, CANCELADA) sai das abas
  // de trabalho. Antes só CONCLUIDA saía — uma tarefa CANCELADA pela API
  // ficava eternamente em "Atrasadas", vermelha, parecendo pendente.
  if (t.status !== "PENDENTE") return "concluidas";
  const vence = new Date(t.dueAt).getTime();
  if (vence < agora.getTime()) return "atrasadas";
  if (vence < viradaDoDiaSP(agora).getTime()) return "hoje";
  return "proximas";
}

/**
 * ORDEM: o que não pode esperar primeiro.
 *
 * Antes era só por data. Numa lista de 162 atrasadas, isso põe no topo a
 * tarefa mais VELHA — que costuma ser a mais fria — e enterra a urgente de
 * ontem. Agora: prioridade ALTA primeiro e, dentro dela, a mais antiga.
 */
export function ordenarTarefas<T extends TarefaDaAgenda>(tarefas: T[]): T[] {
  const peso = (p: string) => (p === "ALTA" ? 0 : p === "MEDIA" ? 1 : 2);
  return [...tarefas].sort(
    (a, b) =>
      peso(a.priority) - peso(b.priority) ||
      new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );
}

/** A tarefa casa com a lupa? Procura no título E no nome da cliente. */
export function casaTarefa(t: TarefaDaAgenda, termo: string): boolean {
  if (!termo.trim()) return true;
  return casaTexto(t.title, termo) || casaTexto(t.customer?.name, termo);
}

/** A lista que a aba mostra, já buscada e ordenada. */
export function tarefasDaAba<T extends TarefaDaAgenda>(
  tarefas: T[],
  aba: AbaDaAgenda,
  busca: string,
  agora: Date
): T[] {
  return ordenarTarefas(
    tarefas.filter((t) => abaDaTarefa(t, agora) === aba && casaTarefa(t, busca))
  );
}

/** Os números dos botões — sempre a lista INTEIRA, nunca o resultado da busca. */
export function contarPorAba(
  tarefas: TarefaDaAgenda[],
  agora: Date
): Record<AbaDaAgenda, number> {
  const c: Record<AbaDaAgenda, number> = {
    hoje: 0,
    atrasadas: 0,
    proximas: 0,
    concluidas: 0,
  };
  for (const t of tarefas) c[abaDaTarefa(t, agora)]++;
  return c;
}
