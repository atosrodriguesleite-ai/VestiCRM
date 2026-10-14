/**
 * A LINHA DE 12 MESES (RN-087): tendência, mês a mês, para o dono ver para
 * onde a loja vai — não só "este período contra o anterior".
 *
 * DUAS FONTES, UMA RÉGUA. Os fatos diários (`BiDia`) só cobrem 90 dias
 * (RN-082: o histórico entra 22 dias por rodada e para ali — ler o ano
 * inteiro de mensagens a cada rodada seria a consulta mais pesada do app).
 * Então:
 * - CONTATOS e VENDAS por mês saem direto das tabelas de origem, pela MESMA
 *   régua dos fatos: cliente cadastrada no mês (calendário de SP) e pedido
 *   pago pela data do pagamento, `netTotal` (RN-001/RN-002) — agregados no
 *   banco, uma linha por mês, barato para qualquer loja. O mês de SP em SQL
 *   é `carimbo − 3 horas`, a MESMA conta do `diaSP` (UTC−3 fixo): o
 *   `AT TIME ZONE 'America/Sao_Paulo'` numa coluna sem fuso converte no
 *   sentido ERRADO (lê o UTC como se fosse hora de SP e devolve +3h — o
 *   cadastro das 22h do dia 30 caía no mês seguinte; achado da revisão);
 * - ATENDIMENTO (% no prazo, sem resposta) só existe onde há fato: a linha
 *   do mês soma os `BiDia` que ele tem e DIZ quantos dias cobriu. O mês sem
 *   fato mostra "—", nunca zero disfarçado — e a tela explica que o tempo de
 *   resposta começou a ser contado quando o BI chegou.
 */
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import { diaSP, inicioDoMesSP, mesSP } from "../dia";
import { r2 } from "../tracking/insights-puro";

export const MESES_DA_TENDENCIA = 12;

export type MesDaTendencia = {
  mes: string;
  /** "out/26" */
  rotulo: string;
  leads: number;
  pedidosPagos: number;
  vendido: number;
  ticket: number | null;
  /** nulos sem fato no mês */
  pctNoPrazo: number | null;
  semResposta: number | null;
  respondidas: number | null;
  diasComFato: number;
  diasNoMes: number;
};

const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** os últimos N meses "AAAA-MM" até o de `agora`, do mais antigo ao mais novo (puro) */
export function mesesAte(agora: Date, n = MESES_DA_TENDENCIA): string[] {
  return Array.from({ length: n }, (_, i) => mesSP(inicioDoMesSP(agora, n - 1 - i)));
}

export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${NOMES[Number(m) - 1]}/${ano.slice(2)}`;
}

/** quantos dias tem o mês (o de hoje conta só até hoje) */
export function diasNoMes(mes: string, hoje: string): number {
  const [ano, m] = mes.split("-").map(Number);
  const total = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return hoje.slice(0, 7) === mes ? Number(hoje.slice(8, 10)) : total;
}

/** só o que a tendência usa do fato do dia (sem `hist`/`origens`) */
export type LinhaDeFato = { dia: string; respondidas: number; noPrazo: number; foraDoPrazo: number; semResposta: number };

/** o atendimento de um mês: % no prazo das decididas (a régua de `somarDias`), sem resposta, respondidas */
export function somarAtendimento(linhas: LinhaDeFato[]): { pctNoPrazo: number | null; semResposta: number; respondidas: number } {
  let noPrazo = 0;
  let foraDoPrazo = 0;
  let semResposta = 0;
  let respondidas = 0;
  for (const l of linhas) {
    noPrazo += l.noPrazo;
    foraDoPrazo += l.foraDoPrazo;
    semResposta += l.semResposta;
    respondidas += l.respondidas;
  }
  const decididas = noPrazo + foraDoPrazo;
  return { pctNoPrazo: decididas ? Math.round((noPrazo / decididas) * 100) : null, semResposta, respondidas };
}

/** Junta as três fontes numa linha por mês (puro). */
export function juntarTendencia(
  meses: string[],
  contatos: { mes: string; n: number }[],
  vendas: { mes: string; n: number; vendido: number }[],
  fatos: LinhaDeFato[],
  hoje: string
): MesDaTendencia[] {
  const c = new Map(contatos.map((x) => [x.mes, x.n]));
  const v = new Map(vendas.map((x) => [x.mes, x]));
  const porMes = new Map<string, LinhaDeFato[]>();
  for (const f of fatos) {
    const m = f.dia.slice(0, 7);
    let lista = porMes.get(m);
    if (!lista) porMes.set(m, (lista = []));
    lista.push(f);
  }
  return meses.map((mes) => {
    const venda = v.get(mes);
    const pedidosPagos = venda?.n ?? 0;
    const vendido = r2(venda?.vendido ?? 0);
    const linhas = porMes.get(mes) ?? [];
    const soma = linhas.length ? somarAtendimento(linhas) : null;
    return {
      mes,
      rotulo: rotuloDoMes(mes),
      leads: c.get(mes) ?? 0,
      pedidosPagos,
      vendido,
      ticket: pedidosPagos ? r2(vendido / pedidosPagos) : null,
      pctNoPrazo: soma?.pctNoPrazo ?? null,
      semResposta: soma ? soma.semResposta : null,
      respondidas: soma ? soma.respondidas : null,
      diasComFato: linhas.length,
      diasNoMes: diasNoMes(mes, hoje),
    };
  });
}

export async function montarTendencia(companyId: string, agora = new Date()): Promise<MesDaTendencia[]> {
  const meses = mesesAte(agora);
  const inicio = inicioDoMesSP(agora, MESES_DA_TENDENCIA - 1);
  const [contatos, vendas, fatos] = await Promise.all([
    // mês no calendário de SP (carimbo − 3h, a conta do diaSP), agregado no
    // banco (RN-013 pelo companyId)
    db.$queryRaw<{ mes: string; n: bigint }[]>`
      SELECT to_char("createdAt" - interval '3 hours', 'YYYY-MM') AS mes, COUNT(*)::bigint AS n
      FROM "Customer"
      WHERE "companyId" = ${companyId} AND "createdAt" >= ${inicio}
      GROUP BY 1
    `,
    db.$queryRaw<{ mes: string; n: bigint; vendido: number | null }[]>`
      SELECT to_char("paidAt" - interval '3 hours', 'YYYY-MM') AS mes,
             COUNT(*)::bigint AS n, SUM("netTotal")::float AS vendido
      FROM "Order"
      WHERE "companyId" = ${companyId}
        AND "paidAt" >= ${inicio}
        AND "status" = ANY(${[...PAID_ORDER_STATUSES]}::text[]::"OrderStatus"[])
      GROUP BY 1
    `,
    db.biDia.findMany({
      where: { companyId, dia: { gte: `${meses[0]}-01` } },
      select: { dia: true, respondidas: true, noPrazo: true, foraDoPrazo: true, semResposta: true },
    }),
  ]);
  return juntarTendencia(
    meses,
    contatos.map((x) => ({ mes: x.mes, n: Number(x.n) })),
    vendas.map((x) => ({ mes: x.mes, n: Number(x.n), vendido: x.vendido ?? 0 })),
    fatos,
    diaSP(agora)
  );
}
