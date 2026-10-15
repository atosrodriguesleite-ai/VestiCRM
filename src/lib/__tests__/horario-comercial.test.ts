// Guarda RN-079
import { describe, it, expect } from "vitest";
import {
  HORARIO_SUGERIDO,
  estaNoHorario,
  lerHorarioComercial,
  minutoDaHora,
  minutosDeAtendimentoEntre,
  prazoNoHorario,
  respondeuNoPrazo,
  validarHorarioComercial,
  type HorarioComercial,
} from "../bi/horario-comercial";

/**
 * RN-079 — HORÁRIO DE ATENDIMENTO DA LOJA: o tempo de resposta conta só o
 * tempo em que a loja estava aberta (relógio de São Paulo), e sem horário
 * cadastrado conta o dia inteiro. O prazo é `Company.intakeSlaMinutes`.
 */

// seg–sex 08:00–12:00 e 13:00–18:00 (almoço fora), sábado 08:00–12:00, domingo fechado
const COM_ALMOCO: HorarioComercial = {
  dias: [
    [],
    [{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }],
    [{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }],
    [{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }],
    [{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }],
    [{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }],
    [{ de: "08:00", ate: "12:00" }],
  ],
};

/** instante no relógio de São Paulo (UTC−3): "2026-10-12 22:00" → Date em UTC */
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);

describe("minutos de atendimento entre dois instantes (fuso de São Paulo)", () => {
  // 12/10/2026 é segunda-feira
  it("mesmo dia, dentro do expediente: conta o relógio normal", () => {
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "10:00"), sp("2026-10-12", "10:45"), HORARIO_SUGERIDO)).toBe(45);
  });

  it("cliente das 22h respondida às 8h30 esperou 30 min de atendimento, não 10 horas", () => {
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "22:00"), sp("2026-10-13", "08:30"), HORARIO_SUGERIDO)).toBe(30);
  });

  it("fim do expediente até o começo do seguinte soma os dois pedaços", () => {
    // 17:30 → 18:00 (30) + 08:00 → 08:30 do dia seguinte (30)
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "17:30"), sp("2026-10-13", "08:30"), HORARIO_SUGERIDO)).toBe(60);
  });

  it("o almoço não conta", () => {
    // 11:50 → 12:00 (10) + 13:00 → 13:10 (10)
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "11:50"), sp("2026-10-12", "13:10"), COM_ALMOCO)).toBe(20);
  });

  it("sábado à tarde e domingo não contam: a cliente de sábado 14h respondida segunda 8h esperou zero", () => {
    // 17/10/2026 é sábado
    expect(minutosDeAtendimentoEntre(sp("2026-10-17", "14:00"), sp("2026-10-19", "08:00"), HORARIO_SUGERIDO)).toBe(0);
    // e respondida segunda 8h15, esperou 15
    expect(minutosDeAtendimentoEntre(sp("2026-10-17", "14:00"), sp("2026-10-19", "08:15"), HORARIO_SUGERIDO)).toBe(15);
  });

  it("uma semana inteira sem resposta soma só as horas de porta aberta", () => {
    // seg 08:00 → seg seguinte 08:00: 5 × 10h + 4h de sábado = 54h
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "08:00"), sp("2026-10-19", "08:00"), HORARIO_SUGERIDO)).toBe(54 * 60);
  });

  it("sem horário cadastrado conta o dia inteiro, madrugada inclusa", () => {
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "22:00"), sp("2026-10-13", "08:30"), null)).toBe(630);
  });

  it("fim antes do início é zero, nunca negativo", () => {
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "10:00"), sp("2026-10-12", "09:00"), HORARIO_SUGERIDO)).toBe(0);
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "10:00"), sp("2026-10-12", "09:00"), null)).toBe(0);
  });

  it("o dia é o de São Paulo, não o de UTC: 23h de SP ainda é o mesmo dia", () => {
    // 12/10 23:30 SP = 13/10 02:30 UTC. Loja aberta até 24:00 na segunda.
    const ateMeiaNoite: HorarioComercial = {
      dias: [[], [{ de: "08:00", ate: "24:00" }], [], [], [], [], []],
    };
    expect(minutosDeAtendimentoEntre(sp("2026-10-12", "23:30"), sp("2026-10-13", "01:00"), ateMeiaNoite)).toBe(30);
    expect(estaNoHorario(sp("2026-10-12", "23:30"), ateMeiaNoite)).toBe(true);
    expect(estaNoHorario(sp("2026-10-13", "00:30"), ateMeiaNoite)).toBe(false);
  });
});

describe("está aberta agora?", () => {
  it("dentro, fora e sem horário cadastrado", () => {
    expect(estaNoHorario(sp("2026-10-12", "09:00"), HORARIO_SUGERIDO)).toBe(true);
    expect(estaNoHorario(sp("2026-10-12", "18:00"), HORARIO_SUGERIDO)).toBe(false); // fim é exclusivo
    expect(estaNoHorario(sp("2026-10-18", "09:00"), HORARIO_SUGERIDO)).toBe(false); // domingo
    expect(estaNoHorario(sp("2026-10-18", "03:00"), null)).toBe(true);
  });
});

describe("prazo de resposta em minutos de atendimento", () => {
  it("prazo de 30 min: 22h → 8h30 do dia seguinte está no prazo; 8h31 não", () => {
    expect(respondeuNoPrazo(sp("2026-10-12", "22:00"), sp("2026-10-13", "08:30"), HORARIO_SUGERIDO, 30)).toBe(true);
    expect(respondeuNoPrazo(sp("2026-10-12", "22:00"), sp("2026-10-13", "08:31"), HORARIO_SUGERIDO, 30)).toBe(false);
  });
});

describe("quando o prazo vence (a tarefa de primeiro atendimento, RN-008)", () => {
  it("lead das 22h com prazo de 30 min vence às 8h30 do dia seguinte, não às 22h30", () => {
    expect(prazoNoHorario(sp("2026-10-12", "22:00"), 30, HORARIO_SUGERIDO).toISOString()).toBe(
      sp("2026-10-13", "08:30").toISOString()
    );
  });
  it("dentro do expediente é só somar", () => {
    expect(prazoNoHorario(sp("2026-10-12", "10:00"), 45, HORARIO_SUGERIDO).toISOString()).toBe(
      sp("2026-10-12", "10:45").toISOString()
    );
  });
  it("atravessa o fim do dia e o almoço", () => {
    // 17:50 + 30 min: 10 até 18:00, 20 a partir de 8:00 → 8:20
    expect(prazoNoHorario(sp("2026-10-12", "17:50"), 30, HORARIO_SUGERIDO).toISOString()).toBe(
      sp("2026-10-13", "08:20").toISOString()
    );
    // 11:50 + 20 min com almoço: 10 até 12:00, 10 a partir de 13:00 → 13:10
    expect(prazoNoHorario(sp("2026-10-12", "11:50"), 20, COM_ALMOCO).toISOString()).toBe(
      sp("2026-10-12", "13:10").toISOString()
    );
  });
  it("sábado à tarde pula para segunda", () => {
    expect(prazoNoHorario(sp("2026-10-17", "14:00"), 15, HORARIO_SUGERIDO).toISOString()).toBe(
      sp("2026-10-19", "08:15").toISOString()
    );
  });
  it("sem horário cadastrado é relógio de parede; horário que nunca abre também (nunca trava)", () => {
    expect(prazoNoHorario(sp("2026-10-12", "22:00"), 30, null).toISOString()).toBe(
      sp("2026-10-12", "22:30").toISOString()
    );
    const nuncaAbre = { dias: [[], [], [], [], [], [], []] };
    expect(prazoNoHorario(sp("2026-10-12", "22:00"), 30, nuncaAbre).toISOString()).toBe(
      sp("2026-10-12", "22:30").toISOString()
    );
  });
  it("o vencimento fecha com a conta de minutos: no instante devolvido passaram exatamente 'prazo' minutos", () => {
    const inicio = sp("2026-10-16", "17:45"); // sexta
    const vence = prazoNoHorario(inicio, 90, COM_ALMOCO);
    expect(minutosDeAtendimentoEntre(inicio, vence, COM_ALMOCO)).toBe(90);
    expect(respondeuNoPrazo(inicio, vence, COM_ALMOCO, 90)).toBe(true);
    expect(respondeuNoPrazo(inicio, new Date(vence.getTime() + 60_000), COM_ALMOCO, 90)).toBe(false);
  });
});

describe("o que a tela manda é conferido antes de gravar", () => {
  it("aceita o padrão e devolve os intervalos em ordem", () => {
    const v = validarHorarioComercial({
      dias: [[], [{ de: "13:00", ate: "18:00" }, { de: "08:00", ate: "12:00" }], [], [], [], [], []],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.horario.dias[1]).toEqual([{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }]);
    expect(validarHorarioComercial(HORARIO_SUGERIDO).ok).toBe(true);
  });

  it("recusa hora que não existe, fim antes do início, sobreposição, 3 períodos, loja que nunca abre", () => {
    const so = (dia: unknown) => validarHorarioComercial({ dias: [[], dia, [], [], [], [], []] });
    expect(so([{ de: "25:00", ate: "26:00" }])).toMatchObject({ ok: false });
    expect(so([{ de: "8:00", ate: "18:00" }])).toMatchObject({ ok: false });
    expect(so([{ de: "18:00", ate: "08:00" }])).toMatchObject({ ok: false });
    expect(so([{ de: "08:00", ate: "13:00" }, { de: "12:00", ate: "18:00" }])).toMatchObject({ ok: false });
    expect(so([{ de: "08:00", ate: "09:00" }, { de: "10:00", ate: "11:00" }, { de: "12:00", ate: "13:00" }])).toMatchObject({ ok: false });
    expect(validarHorarioComercial({ dias: [[], [], [], [], [], [], []] })).toMatchObject({
      ok: false,
      erro: expect.stringContaining("pelo menos um dia"),
    });
    expect(validarHorarioComercial({ dias: [[]] })).toMatchObject({ ok: false });
    expect(validarHorarioComercial(null)).toMatchObject({ ok: false });
    // a frase diz QUAL dia
    expect(so([{ de: "18:00", ate: "08:00" }])).toMatchObject({ erro: expect.stringContaining("Segunda") });
  });

  it("minuto da hora: 24:00 é o fim do dia; 24:01 não existe", () => {
    expect(minutoDaHora("24:00")).toBe(1440);
    expect(minutoDaHora("24:01")).toBeNull();
    expect(minutoDaHora("08:30")).toBe(510);
  });
});

describe("a leitura do que está gravado nunca derruba nada", () => {
  it("vazio, nulo, JSON torto e horário inválido viram 'sem horário' (conta o dia inteiro)", () => {
    expect(lerHorarioComercial(null)).toBeNull();
    expect(lerHorarioComercial("")).toBeNull();
    expect(lerHorarioComercial("{nope")).toBeNull();
    expect(lerHorarioComercial(JSON.stringify({ dias: [[], [], [], [], [], [], []] }))).toBeNull();
    expect(lerHorarioComercial(JSON.stringify(HORARIO_SUGERIDO))).toEqual(HORARIO_SUGERIDO);
  });
});
