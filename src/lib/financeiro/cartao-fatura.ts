/**
 * A REGRA DA FATURA DO CARTÃO (RN-037) — parte PURA.
 *
 * Mora sozinha porque quem mais precisa dela é o FORMULÁRIO de lançamento, que
 * roda no navegador: importar do motor arrastaria o banco para dentro do
 * pacote da tela (o defeito de 17/08/2026, guardado pelo
 * `navegador-sem-servidor.test.ts`).
 */

export type RegraDoCartao = { diaFechamento: number; diaVencimento: number };

/** O último dia do mês (mês curto não deixa vazar para o seguinte, RN-028). */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Para qual fatura vai uma compra — regra pura.
 *
 * Comprou ANTES do fechamento, entra na fatura que vence agora; comprou DEPOIS
 * (ou no próprio dia do fechamento), entra na próxima. É assim que o cartão
 * funciona, e é a pergunta que a lojista faz na hora de comprar: "isso cai na
 * fatura deste mês ou do que vem?".
 *
 * Quando o vencimento cai ANTES do fechamento no calendário (fecha dia 28,
 * vence dia 5), o vencimento é no mês seguinte ao do fechamento.
 */
export function faturaDaCompra(
  diaDaCompra: string,
  regra: RegraDoCartao
): { fatura: string; vencimento: string } {
  const [ano, mes, dia] = diaDaCompra.split("-").map(Number);
  const fechaEsteMes = Math.min(regra.diaFechamento, ultimoDiaDoMes(ano, mes));

  // mês do FECHAMENTO que vai cobrar esta compra
  let anoF = ano;
  let mesF = mes;
  if (dia >= fechaEsteMes) {
    mesF += 1;
    if (mesF > 12) {
      mesF = 1;
      anoF += 1;
    }
  }

  // o vencimento é depois do fechamento: se o dia do vencimento for menor
  // que o do fechamento, ele cai no mês seguinte
  let anoV = anoF;
  let mesV = mesF;
  if (regra.diaVencimento < regra.diaFechamento) {
    mesV += 1;
    if (mesV > 12) {
      mesV = 1;
      anoV += 1;
    }
  }
  const diaV = Math.min(regra.diaVencimento, ultimoDiaDoMes(anoV, mesV));
  const dois = (n: number) => String(n).padStart(2, "0");
  return {
    fatura: `${anoV}-${dois(mesV)}`,
    vencimento: `${anoV}-${dois(mesV)}-${dois(diaV)}`,
  };
}
