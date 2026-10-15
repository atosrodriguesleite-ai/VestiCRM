/**
 * HORÁRIO DE ATENDIMENTO DA LOJA (RN-079) — regra pura, sem banco.
 *
 * É a base do BI de vendas do WhatsApp: "tempo de resposta" só é justo se
 * contar o tempo em que a loja ESTAVA ABERTA. A cliente que escreve às 22h e
 * recebe resposta às 8h05 esperou 5 minutos de atendimento, não 10 horas —
 * e a vendedora que respondeu assim que chegou não pode aparecer no painel
 * como a mais lenta da equipe.
 *
 * Decisões (com o dono, 13/10/2026):
 * - O horário é DA LOJA, cadastrado por ela (Configurações), por dia da
 *   semana, com até DOIS intervalos por dia (manhã e tarde — a pausa de
 *   almoço de confecção é real).
 * - SEM horário cadastrado, o tempo conta o dia INTEIRO, madrugada inclusa
 *   (`null` = "não sei quando a loja abre", e inventar um horário mentiria
 *   para o lado bom). A tela diz isso e oferece o padrão com um clique.
 * - O PRAZO de resposta é o que a loja já tinha: `Company.intakeSlaMinutes`
 *   ("SLA do 1º atendimento", Entrada de leads). Um segundo campo com o
 *   mesmo significado seria onde os dois números um dia discordam.
 * - O relógio é o de São Paulo (UTC−3, sem horário de verão desde 2019), a
 *   mesma régua de `diaSP` (lib/dia.ts) e de todo o Financeiro. Limite dito:
 *   loja no Acre ou em Manaus cadastra o horário "em hora de Brasília".
 *
 * O formato gravado (`Company.horarioComercial`, JSON em texto, o padrão de
 * `categoryUnits`): `{ "dias": [[...], [...], ...] }` com 7 posições, da
 * ordem do JavaScript (0 = domingo … 6 = sábado); cada posição é a lista
 * de intervalos `{ de: "08:00", ate: "18:00" }` daquele dia — lista vazia é
 * dia fechado.
 */

export type Intervalo = { de: string; ate: string };
/** 7 posições, 0 = domingo … 6 = sábado; [] = fechado nesse dia */
export type HorarioComercial = { dias: Intervalo[][] };

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
export const INTERVALOS_POR_DIA = 2;
/**
 * Teto do laço de `prazoNoHorario`: horário que nunca abre (só possível num
 * literal montado em código — a porta recusa) cairia num laço sem fim. A
 * validação garante pelo menos um dia aberto, então 14 dias cobrem qualquer
 * prazo razoável; passou disso, vale o relógio de parede.
 */
const TETO_DIAS_DO_PRAZO = 14;

export const NOMES_DOS_DIAS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/** Sugestão para a loja que ainda não cadastrou: seg–sex 8h–18h, sáb 8h–12h. */
export const HORARIO_SUGERIDO: HorarioComercial = {
  dias: [
    [],
    [{ de: "08:00", ate: "18:00" }],
    [{ de: "08:00", ate: "18:00" }],
    [{ de: "08:00", ate: "18:00" }],
    [{ de: "08:00", ate: "18:00" }],
    [{ de: "08:00", ate: "18:00" }],
    [{ de: "08:00", ate: "12:00" }],
  ],
};

/** "08:30" → 510 (minutos desde a meia-noite); "24:00" vale (fim do dia). */
export function minutoDaHora(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 24 * 60;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export type Validacao =
  | { ok: true; horario: HorarioComercial }
  | { ok: false; erro: string };

/**
 * Confere o que a tela mandou e devolve o horário NORMALIZADO (intervalos em
 * ordem) ou a frase, em português, do que está errado. Quem grava chama isto;
 * quem lê chama `lerHorarioComercial`.
 */
export function validarHorarioComercial(input: unknown): Validacao {
  if (!input || typeof input !== "object") return { ok: false, erro: "Horário inválido." };
  const dias = (input as { dias?: unknown }).dias;
  if (!Array.isArray(dias) || dias.length !== 7)
    return { ok: false, erro: "O horário precisa ter os 7 dias da semana." };
  const normalizado: Intervalo[][] = [];
  let abreAlgumDia = false;
  for (let d = 0; d < 7; d++) {
    const lista = dias[d];
    if (!Array.isArray(lista))
      return { ok: false, erro: `${NOMES_DOS_DIAS[d]}: horário inválido.` };
    if (lista.length > INTERVALOS_POR_DIA)
      return {
        ok: false,
        erro: `${NOMES_DOS_DIAS[d]}: no máximo ${INTERVALOS_POR_DIA} períodos por dia (manhã e tarde).`,
      };
    const intervalos: { de: number; ate: number }[] = [];
    for (const item of lista) {
      const de = typeof item?.de === "string" ? minutoDaHora(item.de) : null;
      const ate = typeof item?.ate === "string" ? minutoDaHora(item.ate) : null;
      if (de == null || ate == null)
        return { ok: false, erro: `${NOMES_DOS_DIAS[d]}: use horas no formato 08:00.` };
      if (ate <= de)
        return {
          ok: false,
          erro: `${NOMES_DOS_DIAS[d]}: o fim (${item.ate}) precisa ser depois do início (${item.de}).`,
        };
      intervalos.push({ de, ate });
    }
    intervalos.sort((a, b) => a.de - b.de);
    for (let i = 1; i < intervalos.length; i++) {
      if (intervalos[i].de < intervalos[i - 1].ate)
        return {
          ok: false,
          erro: `${NOMES_DOS_DIAS[d]}: os dois períodos se sobrepõem.`,
        };
    }
    if (intervalos.length) abreAlgumDia = true;
    normalizado.push(intervalos.map((i) => ({ de: horaDoMinuto(i.de), ate: horaDoMinuto(i.ate) })));
  }
  if (!abreAlgumDia)
    return { ok: false, erro: "A loja precisa abrir em pelo menos um dia da semana." };
  return { ok: true, horario: { dias: normalizado } };
}

function horaDoMinuto(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Lê o que está gravado. Texto vazio, nulo ou torto vira `null` = "sem
 * horário cadastrado" (conta o dia inteiro) — a leitura nunca derruba a tela
 * nem a conta: o pior caso é voltar ao comportamento de sempre.
 */
export function lerHorarioComercial(json: string | null | undefined): HorarioComercial | null {
  if (!json) return null;
  try {
    const v = validarHorarioComercial(JSON.parse(json));
    return v.ok ? v.horario : null;
  } catch {
    return null;
  }
}

/** Dia da semana (0–6) e minuto do dia do instante, no relógio de São Paulo. */
function relogioSP(d: Date): { diaSemana: number; minutoDoDia: number; meiaNoiteMs: number } {
  const spMs = d.getTime() - SP_OFFSET_MS;
  const diaIndice = Math.floor(spMs / DIA_MS);
  const meiaNoiteMs = diaIndice * DIA_MS + SP_OFFSET_MS; // instante UTC da 0h de SP
  const diaSemana = new Date(diaIndice * DIA_MS).getUTCDay();
  const minutoDoDia = Math.floor((spMs - diaIndice * DIA_MS) / 60_000);
  return { diaSemana, minutoDoDia, meiaNoiteMs };
}

type IntervaloMin = { de: number; ate: number };

/**
 * Os períodos em MINUTOS, uma vez por chamada: a conta dia a dia reusa os
 * mesmos números e um horário torto montado em código (a porta recusa, mas
 * o tipo permite) vira período IGNORADO em vez de NaN silencioso na soma.
 */
function emMinutos(horario: HorarioComercial): IntervaloMin[][] {
  return horario.dias.map((lista) =>
    lista.flatMap((i) => {
      const de = minutoDaHora(i.de);
      const ate = minutoDaHora(i.ate);
      return de != null && ate != null && ate > de ? [{ de, ate }] : [];
    })
  );
}

/** A loja está aberta neste instante? Sem horário cadastrado, sempre. */
export function estaNoHorario(instante: Date, horario: HorarioComercial | null): boolean {
  if (!horario) return true;
  const { diaSemana, minutoDoDia } = relogioSP(instante);
  return emMinutos(horario)[diaSemana].some((i) => minutoDoDia >= i.de && minutoDoDia < i.ate);
}

/**
 * QUANTOS MINUTOS DE ATENDIMENTO passaram entre dois instantes.
 *
 * É a conta do tempo de resposta: só o tempo em que a loja estava aberta
 * conta. Sem horário cadastrado, conta o relógio de parede. Fim antes do
 * início é zero (nunca negativo). Resultado em minutos, com fração.
 */
export function minutosDeAtendimentoEntre(
  inicio: Date,
  fim: Date,
  horario: HorarioComercial | null
): number {
  const inicioMs = inicio.getTime();
  const fimMs = fim.getTime();
  if (!(fimMs > inicioMs)) return 0;
  if (!horario) return (fimMs - inicioMs) / 60_000;

  const dias = emMinutos(horario);
  let totalMs = 0;
  let cursor = inicioMs;
  // um passo por dia do intervalo — sem teto: cortar a soma em silêncio
  // devolveria menos tempo do que passou, e a média do BI sairia enviesada
  while (cursor < fimMs) {
    const { diaSemana, meiaNoiteMs } = relogioSP(new Date(cursor));
    for (const i of dias[diaSemana]) {
      const a = meiaNoiteMs + i.de * 60_000;
      const b = meiaNoiteMs + i.ate * 60_000;
      const sobreposicao = Math.min(b, fimMs) - Math.max(a, cursor);
      if (sobreposicao > 0) totalMs += sobreposicao;
    }
    cursor = meiaNoiteMs + DIA_MS;
  }
  return totalMs / 60_000;
}

/**
 * QUANDO O PRAZO VENCE: o instante em que `prazoMin` minutos de atendimento
 * terão passado desde `inicio`. É o que a tarefa de primeiro atendimento
 * usa como vencimento (RN-008): o lead das 22h com prazo de 30 min vence às
 * 8h30 do dia seguinte, não às 22h30 — senão a tarefa amanhecia atrasada
 * para a vendedora que ainda nem chegou, enquanto o BI dizia "no prazo".
 * Sem horário cadastrado, é relógio de parede.
 */
export function prazoNoHorario(
  inicio: Date,
  prazoMin: number,
  horario: HorarioComercial | null
): Date {
  const inicioMs = inicio.getTime();
  const paredeMs = inicioMs + Math.max(0, prazoMin) * 60_000;
  if (!horario || prazoMin <= 0) return new Date(paredeMs);
  const dias = emMinutos(horario);
  let restanteMs = prazoMin * 60_000;
  let cursor = inicioMs;
  for (let passo = 0; passo < TETO_DIAS_DO_PRAZO; passo++) {
    const { diaSemana, meiaNoiteMs } = relogioSP(new Date(cursor));
    for (const i of dias[diaSemana]) {
      const a = Math.max(meiaNoiteMs + i.de * 60_000, cursor);
      const b = meiaNoiteMs + i.ate * 60_000;
      if (b <= a) continue;
      if (b - a >= restanteMs) return new Date(a + restanteMs);
      restanteMs -= b - a;
    }
    cursor = meiaNoiteMs + DIA_MS;
  }
  return new Date(paredeMs);
}

/**
 * A resposta chegou DENTRO do prazo? O prazo é em minutos de atendimento
 * (`Company.intakeSlaMinutes`): a cliente das 22h com prazo de 30 min está
 * no prazo se a resposta sair até 8h30 do dia seguinte.
 */
export function respondeuNoPrazo(
  chegada: Date,
  resposta: Date,
  horario: HorarioComercial | null,
  prazoMin: number
): boolean {
  return minutosDeAtendimentoEntre(chegada, resposta, horario) <= prazoMin;
}
