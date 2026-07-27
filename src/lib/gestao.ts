/**
 * Motor de indicadores da PLATAFORMA (painel de gestão do Super Admin).
 *
 * Aqui moram as contas de negócio do AtacadoPro enquanto empresa: quanto cada
 * loja paga, quanto entra por mês, há quanto tempo cada cliente está com a
 * gente e quanto as lojas movimentam dentro do sistema.
 *
 * As funções puras ficam separadas das consultas de propósito: é o que
 * permite travar as regras em teste sem precisar de banco.
 */

/** Ciclos de contrato aceitos (como a recorrência é cobrada). */
export const CICLOS = ["MENSAL", "SEMESTRAL", "ANUAL"] as const;
export type Ciclo = (typeof CICLOS)[number];

export const cicloLabel: Record<string, string> = {
  MENSAL: "Mensal",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

/** Quantos meses cada cobrança cobre. */
export const mesesDoCiclo = (ciclo: string): number =>
  ciclo === "ANUAL" ? 12 : ciclo === "SEMESTRAL" ? 6 : 1;

/**
 * Valor de CADA COBRANÇA do contrato. A mensalidade é a régua (MRR); quem
 * paga semestral desembolsa 6x de uma vez, quem paga anual, 12x.
 */
export const valorDaCobranca = (monthlyFee: number, ciclo: string): number =>
  monthlyFee * mesesDoCiclo(ciclo);

/**
 * LIFETIME em meses: há quanto tempo a loja é cliente.
 * Conta meses cheios e nunca devolve negativo (loja criada "no futuro" por
 * erro de fuso não vira -1).
 */
export function lifetimeMeses(criadaEm: Date, agora = new Date()): number {
  const meses =
    (agora.getFullYear() - criadaEm.getFullYear()) * 12 +
    (agora.getMonth() - criadaEm.getMonth()) -
    (agora.getDate() < criadaEm.getDate() ? 1 : 0);
  return Math.max(0, meses);
}

/** Rótulo humano do tempo de casa ("3 meses", "1 ano e 2 meses"). */
export function lifetimeLabel(meses: number): string {
  if (meses <= 0) return "menos de 1 mês";
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const a = `${anos} ${anos === 1 ? "ano" : "anos"}`;
  return resto ? `${a} e ${resto} ${resto === 1 ? "mês" : "meses"}` : a;
}

/**
 * VALOR JÁ GERADO pelo cliente (implementação paga + recorrências pagas).
 * É o "quanto essa loja já nos deu" — a conta que decide quem é cliente
 * importante de verdade.
 */
export function valorGerado(pagamentos: { amount: number }[]): number {
  return pagamentos.reduce((soma, p) => soma + p.amount, 0);
}

export type SituacaoCobranca = "EM_DIA" | "A_VENCER" | "ATRASADO" | "SEM_COBRANCA";

/**
 * Situação da recorrência de uma loja.
 *
 * `paidThrough` guarda até que competência (mês) a loja pagou. Comparando com
 * o mês corrente e o dia do vencimento, sai a situação — é o que transforma a
 * lista de lojas num painel de cobrança de verdade.
 */
export function situacaoCobranca(input: {
  kind: string; // TESTE | PAGANTE | CORTESIA
  monthlyFee: number;
  dueDay: number;
  paidThrough: Date | null;
  hoje?: Date;
}): SituacaoCobranca {
  const { kind, monthlyFee, dueDay, paidThrough } = input;
  if (kind !== "PAGANTE" || monthlyFee <= 0) return "SEM_COBRANCA";
  const hoje = input.hoje ?? new Date();
  const competenciaAtual = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 1));
  const pago = paidThrough
    ? new Date(Date.UTC(paidThrough.getFullYear(), paidThrough.getMonth(), 1))
    : null;
  if (pago && pago.getTime() >= competenciaAtual.getTime()) return "EM_DIA";
  // ainda não pagou o mês corrente: antes do vencimento é só "a vencer"
  return hoje.getDate() <= dueDay ? "A_VENCER" : "ATRASADO";
}

export const situacaoLabel: Record<SituacaoCobranca, string> = {
  EM_DIA: "Em dia",
  A_VENCER: "A vencer",
  ATRASADO: "Atrasado",
  SEM_COBRANCA: "Sem cobrança",
};

/**
 * RECEITA RECORRENTE MENSAL (MRR): soma das mensalidades das lojas pagantes
 * ativas. Loja suspensa não conta — não está gerando caixa.
 */
export function calcularMRR(
  lojas: { suspended: boolean; kind: string; monthlyFee: number }[]
): number {
  return lojas
    .filter((l) => !l.suspended && l.kind === "PAGANTE")
    .reduce((soma, l) => soma + l.monthlyFee, 0);
}

/**
 * Loja EM RISCO: pagante que não teve ninguém entrando no sistema há muitos
 * dias. Cliente que parou de usar é cliente que vai cancelar — este é o
 * alerta que dá tempo de ligar antes.
 */
export function emRisco(
  loja: { suspended: boolean; kind: string; ultimoAcesso: Date | null },
  diasSemUso = 14,
  hoje = new Date()
): boolean {
  if (loja.suspended || loja.kind !== "PAGANTE") return false;
  if (!loja.ultimoAcesso) return true; // pagante que nunca entrou é o pior caso
  const dias = (hoje.getTime() - loja.ultimoAcesso.getTime()) / 86_400_000;
  return dias >= diasSemUso;
}

/**
 * De onde vieram os leads. A plataforma capta por caminhos diferentes e cada
 * um precisa ser medido separado — é assim que se decide onde investir.
 */
export type CanalDeLead =
  | "LANDING"
  | "BIO"
  | "CATALOGO_PLATAFORMA"
  | "CATALOGO_LOJAS"
  | "OUTROS";

export const canalLeadLabel: Record<CanalDeLead, string> = {
  LANDING: "Site / landing page",
  BIO: "Link da bio",
  CATALOGO_PLATAFORMA: "Catálogo da plataforma",
  CATALOGO_LOJAS: "Catálogos das lojas",
  OUTROS: "Outros canais",
};

/**
 * Classifica um lead da EMPRESA-PLATAFORMA pelo caminho de entrada.
 * `landingSource` começa com "bio" quando a pessoa veio do rodapé de uma bio
 * de loja; o formulário do site entra como SITE; o resto é catálogo/manual.
 */
export function canalDoLead(lead: {
  origin: string;
  landingSource: string | null;
}): CanalDeLead {
  if (lead.landingSource?.startsWith("bio")) return "BIO";
  if (lead.origin === "SITE") return "LANDING";
  if (lead.origin === "CATALOGO_PUBLICO") return "CATALOGO_PLATAFORMA";
  return "OUTROS";
}
