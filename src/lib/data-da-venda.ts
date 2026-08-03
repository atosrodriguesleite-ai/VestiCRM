/**
 * LANÇAMENTO RETROATIVO — pedido do dono (03/08/2026): "preciso lançar
 * vendas do mês passado que não lancei, e elas têm que entrar no faturamento
 * do mês passado".
 *
 * O desenho combinado:
 * - o pedido CONTINUA nascendo com data e hora automáticas (ninguém digita
 *   data no dia a dia);
 * - na ficha do pedido, gerente/admin tem o botão "Editar data da venda"
 *   para o caso à parte;
 * - a edição ajusta a criação E o pagamento (o faturamento conta por
 *   `Order.paidAt` — mudar só a criação não moveria o mês do dinheiro);
 * - TUDO fica registrado na história do pedido (quem mudou, de quando para
 *   quando) — número mexido sem rastro derrubaria a confiança do painel.
 */

/** Retroagir mais que isso é quase certeza de dedo errado no ano. */
export const RETROATIVO_MAX_DIAS = 366;

/**
 * Valida a nova data da venda. Devolve a mensagem de erro (em linguagem de
 * gente) ou null quando está tudo certo. Pura, para o teste travar a regra.
 */
export function validarDataDaVenda(quando: Date, agora = new Date()): string | null {
  if (Number.isNaN(quando.getTime())) return "Data inválida.";
  // 5 min de folga para relógio de aparelho adiantado
  if (quando.getTime() > agora.getTime() + 5 * 60_000)
    return "A data da venda não pode ser no futuro.";
  const limite = agora.getTime() - RETROATIVO_MAX_DIAS * 24 * 60 * 60 * 1000;
  if (quando.getTime() < limite)
    return "Data muito antiga — dá para retroagir no máximo 1 ano.";
  return null;
}

/** Texto do registro de auditoria (um formato só, testável). */
export function descricaoDaMudancaDeData(
  userName: string,
  de: Date,
  para: Date
): string {
  const f = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  return `Data da venda alterada por ${userName}: de ${f(de)} para ${f(para)} (lançamento retroativo)`;
}
