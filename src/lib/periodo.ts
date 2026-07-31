/**
 * PERÍODO DE UM RELATÓRIO — atalho rápido OU datas escolhidas a dedo.
 *
 * Os botões prontos ("30 dias", "1 ano") resolvem o dia a dia, mas não o que
 * a lojista pergunta de verdade: "quanto vendi na Black Friday?", "como foi
 * o mês passado fechado?", "e a semana da campanha do dia das mães?". Para
 * isso ela precisa dizer DE e ATÉ.
 *
 * Duas regras que valem para os dois casos:
 *
 *   • FUSO DE SÃO PAULO. Escolher "01/07 a 31/07" tem que pegar o dia 31
 *     INTEIRO no horário do Brasil. Usando UTC cru, as vendas do fim da noite
 *     do dia 31 caíam no dia 1º e sumiam do relatório.
 *   • DATAS TROCADAS NÃO QUEBRAM: se ela põe o "até" antes do "de", o sistema
 *     inverte em vez de devolver relatório vazio.
 */

import type { Period } from "./tracking/insights";
import { periodFromDays } from "./tracking/insights";

/** Atalhos oferecidos na tela (em dias). */
export const DIAS_PERMITIDOS = [1, 7, 30, 90, 365] as const;

// São Paulo é UTC-3: meia-noite daqui é 03:00 em UTC
const FUSO_SP = 3 * 60 * 60 * 1000;

/** "AAAA-MM-DD" → começo daquele dia no horário de São Paulo. */
export function inicioDoDiaSP(d: string | null | undefined): Date | null {
  if (!d) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + FUSO_SP);
}

/** "AAAA-MM-DD" → fim daquele dia (23:59:59) no horário de São Paulo. */
export function fimDoDiaSP(d: string | null | undefined): Date | null {
  if (!d) return null;
  const t = Date.parse(`${d}T23:59:59.999Z`);
  return Number.isNaN(t) ? null : new Date(t + FUSO_SP);
}

export type FiltroDePeriodo = {
  /** o período em si, pronto para as consultas */
  period: Period;
  /** o atalho escolhido, ou `null` quando o período é personalizado */
  dias: number | null;
  /** as datas do formulário, para a tela redesenhar do jeito que ficou */
  de: string | null;
  ate: string | null;
  /** true quando a lojista escolheu as datas na mão */
  personalizado: boolean;
};

/**
 * Lê o período pedido na URL.
 *
 * DE e ATÉ mandam: preenchendo qualquer um dos dois, o período passa a ser o
 * escolhido. Só um preenchido também vale — "de 01/06 até hoje" ou "tudo até
 * 31/05" são perguntas legítimas.
 *
 * Sem nada disso, cai no atalho (`dias`), e o padrão é 30 dias.
 */
export function lerPeriodo(sp: {
  dias?: string;
  de?: string;
  ate?: string;
}): FiltroDePeriodo {
  let de = inicioDoDiaSP(sp.de) ? sp.de! : null;
  let ate = fimDoDiaSP(sp.ate) ? sp.ate! : null;

  // DATAS TROCADAS: inverte as DATAS e recalcula. Trocar só os horários já
  // prontos punha o começo às 23:59 e o fim à meia-noite — o intervalo saía
  // errado por um dia nas duas pontas.
  if (de && ate && de > ate) [de, ate] = [ate, de];

  const inicio = inicioDoDiaSP(de);
  const fim = fimDoDiaSP(ate);

  if (inicio || fim) {
    return {
      period: {
        // só o "até" preenchido = desde sempre até aquele dia
        from: inicio ?? new Date(0),
        // só o "de" preenchido = daquele dia até agora
        to: fim ?? new Date(),
      },
      dias: null,
      de,
      ate,
      personalizado: true,
    };
  }

  const pedido = Number(sp.dias);
  const dias = (DIAS_PERMITIDOS as readonly number[]).includes(pedido) ? pedido : 30;
  return { period: periodFromDays(dias), dias, de: null, ate: null, personalizado: false };
}

/** Os mesmos parâmetros de volta na URL (links de exportação, paginação). */
export function paramsDoPeriodo(f: FiltroDePeriodo): string {
  if (f.personalizado) {
    return [f.de ? `de=${f.de}` : null, f.ate ? `ate=${f.ate}` : null]
      .filter(Boolean)
      .join("&");
  }
  return `dias=${f.dias ?? 30}`;
}

/** "01/07/2026 a 31/07/2026" — o período escrito por extenso, para a tela. */
export function periodoPorExtenso(f: FiltroDePeriodo): string {
  const dia = (d: Date) =>
    d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (!f.personalizado) return "";
  const inicio = f.de ? dia(f.period.from) : "início";
  const fim = f.ate ? dia(f.period.to) : "hoje";
  return `${inicio} a ${fim}`;
}
