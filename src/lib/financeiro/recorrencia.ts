import { db } from "../db";
import { round2 } from "../orders";
import { diaSP } from "./lancamentos";

/**
 * CONTAS FIXAS (RN-029) — aluguel, salário, internet, assinatura.
 *
 * A loja configura UMA vez (valor, dia, categoria, "sem fim" ou até quando) e
 * o sistema materializa os lançamentos dos próximos meses sozinho.
 *
 * COMO ELE RODA: de CARONA NO TRÁFEGO, ao abrir as telas do financeiro —
 * nunca num cron novo. As duas vagas de cron da Vercel estão ocupadas e um
 * terceiro cron trava TODOS os deploys em silêncio (ADR-002). É o mesmo
 * padrão do monitoramento e das automações.
 *
 * COMO ELE NÃO DUPLICA: cada lançamento gerado carrega (recorrenciaId, mês),
 * e esse par é ÚNICO no banco. Duas abas abrindo a tela ao mesmo tempo, ou a
 * mesma rodada repetida, esbarram no índice — nunca em dois aluguéis.
 */

/** Quantos meses à frente o sistema materializa (o mês atual + estes). */
export const HORIZONTE_MESES = 3;
/** Teto por rodada: conta fixa começando anos atrás não trava a tela. */
export const TETO_POR_RODADA = 24;

/** "2026-09-05T12:00Z" → "2026-09" (no fuso de São Paulo). */
export function mesDe(d: Date): string {
  return diaSP(d).slice(0, 7);
}

/** "2026-12" → "2027-01" */
export function proximoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
}

/** Soma N meses a "2026-09" (aceita N negativo). */
export function somarMeses(mes: string, n: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const total = ano * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * O vencimento do mês, respeitando mês curto: dia 31 em fevereiro cai no dia
 * 28 (ou 29). Nunca vaza para o mês seguinte — a parcela sumiria do relatório
 * daquele mês, que é justamente onde a lojista foi procurá-la.
 */
export function vencimentoDoMes(mes: string, dia: number): Date {
  const [ano, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return new Date(Date.UTC(ano, m - 1, Math.min(Math.max(1, dia), ultimoDia), 12, 0, 0));
}

export type MoldeRecorrencia = {
  inicio: Date;
  fim: Date | null;
  ativa: boolean;
  geradoAte: string | null;
};

/**
 * Quais meses ainda faltam materializar. Regra pura (o teste viaja no tempo
 * sem banco): do primeiro mês que falta até o horizonte, sem passar do fim
 * combinado e sem repetir o que já foi gerado.
 */
export function mesesAMaterializar(
  r: MoldeRecorrencia,
  mesDeHoje: string,
  horizonte = HORIZONTE_MESES
): string[] {
  if (!r.ativa) return [];
  const primeiro = r.geradoAte ? proximoMes(r.geradoAte) : mesDe(r.inicio);
  // nunca antes do início combinado (a loja pode ter mudado o início)
  const comeco = primeiro < mesDe(r.inicio) ? mesDe(r.inicio) : primeiro;
  const ate = somarMeses(mesDeHoje, horizonte);
  const limite = r.fim && mesDe(r.fim) < ate ? mesDe(r.fim) : ate;

  const meses: string[] = [];
  let m = comeco;
  while (m <= limite && meses.length < TETO_POR_RODADA) {
    meses.push(m);
    m = proximoMes(m);
  }
  return meses;
}

/**
 * Materializa o que falta de TODAS as contas fixas da loja. Roda ao abrir as
 * telas do financeiro; na esmagadora maioria das vezes não encontra nada para
 * fazer e sai numa consulta só.
 *
 * NUNCA DERRUBA A TELA (achado da revisão 31/08/2026): é trabalho de carona,
 * não é a resposta da página. Uma conta fixa defeituosa daria 500 em Contas a
 * Pagar, Contas a Receber e Extrato ao mesmo tempo — o erro é registrado e a
 * tela abre, com o que já existe.
 */
export async function garantirRecorrencias(
  companyId: string,
  hoje = new Date()
): Promise<number> {
  const mesHoje = mesDe(hoje);
  const horizonteMes = somarMeses(mesHoje, HORIZONTE_MESES);

  // consulta barata: só as contas fixas que ainda não chegaram no horizonte
  const pendentes = await db.finRecorrencia.findMany({
    where: {
      companyId,
      ativa: true,
      OR: [{ geradoAte: null }, { geradoAte: { lt: horizonteMes } }],
    },
  });
  if (pendentes.length === 0) return 0;

  let criados = 0;
  for (const r of pendentes) {
    try {
      const meses = mesesAMaterializar(r, mesHoje);
      let ultimoOk = r.geradoAte;
      for (const mes of meses) {
        try {
          await db.finLancamento.create({
            data: {
              companyId,
              tipo: r.tipo,
              descricao: r.descricao,
              competencia: vencimentoDoMes(mes, r.diaVencimento),
              customerId: r.tipo === "RECEITA" ? r.customerId : null,
              fornecedorId: r.tipo === "RECEITA" ? null : r.fornecedorId,
              categoriaId: r.categoriaId,
              centroCustoId: r.centroCustoId,
              colecaoId: r.colecaoId,
              observacoes: r.observacoes,
              valor: round2(r.valor),
              recorrenciaId: r.id,
              recorrenciaMes: mes,
              parcelas: {
                create: {
                  companyId,
                  numero: 1,
                  vencimento: vencimentoDoMes(mes, r.diaVencimento),
                  valor: round2(r.valor),
                  contaId: r.contaId,
                  forma: r.forma,
                },
              },
              eventos: {
                create: {
                  descricao: `Gerado pela conta fixa "${r.descricao}" (${mes})`,
                  autorNome: "Sistema",
                },
              },
            },
          });
          criados++;
        } catch (e) {
          // P2002 = esse mês já existe (outra aba materializou primeiro). É o
          // caminho esperado da corrida: segue em frente, nada duplicou.
          if ((e as { code?: string })?.code !== "P2002") throw e;
        }
        ultimoOk = mes;
      }
      if (ultimoOk && ultimoOk !== r.geradoAte) {
        await db.finRecorrencia.update({
          where: { id: r.id },
          data: { geradoAte: ultimoOk },
        });
      }
    } catch (e) {
      // uma conta fixa com problema não pode levar as outras (nem a tela)
      console.error("[contas fixas] falhou ao materializar", r.id, e);
    }
  }
  return criados;
}

/**
 * Ao editar/encerrar uma conta fixa, os meses FUTUROS ainda não pagos são
 * refeitos — os passados e QUALQUER um com baixa ficam intocados. É a
 * tradução do "só esta ou esta e as próximas": o passado não se reescreve.
 *
 * Lançamento com ANEXO também fica (achado da revisão 31/08/2026): refazer
 * apagaria em cascata o boleto que a lojista guardou ali, e o módulo inteiro
 * é construído sobre "o que se põe no financeiro não some sozinho".
 */
export async function limparFuturosSemBaixa(
  companyId: string,
  recorrenciaId: string,
  aPartirDe: Date
): Promise<number> {
  const futuros = await db.finLancamento.findMany({
    where: {
      companyId,
      recorrenciaId,
      competencia: { gte: aPartirDe },
      parcelas: { every: { baixas: { none: {} } } },
      anexos: { none: {} },
    },
    select: { id: true },
  });
  if (futuros.length === 0) return 0;
  const { count } = await db.finLancamento.deleteMany({
    where: { id: { in: futuros.map((f) => f.id) }, companyId },
  });
  return count;
}
