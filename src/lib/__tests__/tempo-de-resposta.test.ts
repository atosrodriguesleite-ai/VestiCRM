// Guarda RN-080
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ONDE_MENSAGEM_CONTA,
  mensagemConta,
  parearEsperas,
  respostaHumana,
  resumirEsperas,
  type MensagemLeve,
} from "../bi/tempo-de-resposta";
import { HORARIO_SUGERIDO } from "../bi/horario-comercial";

/**
 * RN-080 — a mensagem de ROBÔ é marcada (`Message.automatica`) e nunca conta
 * como resposta à cliente; a espera é pareada da primeira mensagem da
 * cliente sem resposta até a primeira mensagem HUMANA da loja, em minutos
 * de atendimento (RN-079).
 */

const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);
const msg = (
  conversationId: string,
  direction: "IN" | "OUT",
  quando: Date,
  extra: Partial<MensagemLeve> = {}
): MensagemLeve => ({
  conversationId,
  direction,
  kind: "TEXT",
  createdAt: quando,
  authorId: direction === "OUT" ? "ana" : null,
  automatica: false,
  ...extra,
});
// 12/10/2026 é segunda; prazo 30 min; "agora" segunda 18:00
const regua = { horario: HORARIO_SUGERIDO, prazoMin: 30, agora: sp("2026-10-12", "18:00") };

describe("o que é resposta humana", () => {
  it("texto da loja, não automático — nota interna e robô não contam; o eco do celular (sem autor) conta", () => {
    expect(respostaHumana({ direction: "OUT", kind: "TEXT", automatica: false })).toBe(true);
    expect(respostaHumana({ direction: "OUT", kind: "NOTE", automatica: false })).toBe(false);
    expect(respostaHumana({ direction: "OUT", kind: "TEXT", automatica: true })).toBe(false);
    expect(respostaHumana({ direction: "IN", kind: "TEXT", automatica: false })).toBe(false);
  });
});

describe("a régua escrita uma vez vale nos dois lugares", () => {
  it("o fragmento do Prisma (monitor da IA) e a função pura (BI) concordam em toda combinação", () => {
    const casaComFragmento = (m: { kind: "TEXT" | "NOTE"; automatica: boolean }) =>
      (Object.keys(ONDE_MENSAGEM_CONTA) as (keyof typeof ONDE_MENSAGEM_CONTA)[]).every(
        (k) => m[k] === ONDE_MENSAGEM_CONTA[k]
      );
    for (const kind of ["TEXT", "NOTE"] as const)
      for (const automatica of [true, false])
        for (const direction of ["IN", "OUT"] as const) {
          const m = { direction, kind, automatica };
          expect(mensagemConta(m)).toBe(casaComFragmento(m));
          expect(respostaHumana(m)).toBe(direction === "OUT" && casaComFragmento(m));
        }
  });
});

describe("pareamento das esperas", () => {
  it("cinco mensagens seguidas da cliente são UMA espera, contada da primeira", () => {
    const e = parearEsperas(
      [
        msg("c1", "IN", sp("2026-10-12", "10:00")),
        msg("c1", "IN", sp("2026-10-12", "10:05")),
        msg("c1", "IN", sp("2026-10-12", "10:08")),
        msg("c1", "OUT", sp("2026-10-12", "10:20")),
      ],
      regua
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ minutos: 20, noPrazo: true, autoraId: "ana" });
  });

  it("a mensagem do robô NÃO fecha a espera; a humana seguinte fecha", () => {
    const e = parearEsperas(
      [
        msg("c1", "IN", sp("2026-10-12", "10:00")),
        msg("c1", "OUT", sp("2026-10-12", "10:01"), { automatica: true, authorId: null }),
        msg("c1", "OUT", sp("2026-10-12", "10:45")),
      ],
      regua
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ minutos: 45, noPrazo: false });
  });

  it("nota interna não é resposta; o eco do celular da loja (sem autor) é", () => {
    const e = parearEsperas(
      [
        msg("c1", "IN", sp("2026-10-12", "10:00")),
        msg("c1", "OUT", sp("2026-10-12", "10:02"), { kind: "NOTE" }),
        msg("c1", "OUT", sp("2026-10-12", "10:10"), { authorId: null }),
      ],
      regua
    );
    expect(e[0]).toMatchObject({ minutos: 10, noPrazo: true, autoraId: null, respostaEm: sp("2026-10-12", "10:10") });
  });

  it("os minutos são de atendimento: a cliente das 22h respondida às 8h20 esperou 20 e está no prazo", () => {
    const e = parearEsperas(
      [msg("c1", "IN", sp("2026-10-12", "22:00")), msg("c1", "OUT", sp("2026-10-13", "08:20"))],
      { ...regua, agora: sp("2026-10-13", "12:00") }
    );
    expect(e[0]).toMatchObject({ minutos: 20, noPrazo: true });
    // sem horário cadastrado seria 620 min, fora do prazo
    const semHorario = parearEsperas(
      [msg("c1", "IN", sp("2026-10-12", "22:00")), msg("c1", "OUT", sp("2026-10-13", "08:20"))],
      { ...regua, horario: null, agora: sp("2026-10-13", "12:00") }
    );
    expect(semHorario[0]).toMatchObject({ minutos: 620, noPrazo: false });
  });

  it("espera sem resposta conta até agora: já estourou = false, ainda dá tempo = null", () => {
    const e = parearEsperas(
      [msg("c1", "IN", sp("2026-10-12", "16:00")), msg("c2", "IN", sp("2026-10-12", "17:45"))],
      regua
    );
    const c1 = e.find((x) => x.conversationId === "c1")!;
    const c2 = e.find((x) => x.conversationId === "c2")!;
    expect(c1).toMatchObject({ respostaEm: null, minutos: 120, noPrazo: false });
    expect(c2).toMatchObject({ respostaEm: null, minutos: 15, noPrazo: null });
  });

  it("o 'obrigada' do fim de uma conversa ENCERRADA não é cliente esperando; na conversa aberta é", () => {
    const mensagens = [
      msg("c1", "IN", sp("2026-10-12", "10:00")),
      msg("c1", "OUT", sp("2026-10-12", "10:05")),
      msg("c1", "IN", sp("2026-10-12", "10:06")), // "obrigada!"
    ];
    const encerrada = parearEsperas(mensagens, { ...regua, encerradas: new Set(["c1"]) });
    expect(encerrada[1]).toMatchObject({ respostaEm: null, encerrada: true, noPrazo: null });
    const aberta = parearEsperas(mensagens, regua);
    expect(aberta[1]).toMatchObject({ respostaEm: null, encerrada: false, noPrazo: false });
    const r = resumirEsperas(encerrada);
    expect(r).toMatchObject({ total: 2, respondidas: 1, semResposta: 0, encerradasSemResposta: 1, foraDoPrazo: 0 });
  });

  it("cada conversa tem a própria fila, a ordem de chegada não importa, e resposta sem pergunta não vira espera", () => {
    const e = parearEsperas(
      [
        msg("c2", "OUT", sp("2026-10-12", "10:30")),
        msg("c1", "OUT", sp("2026-10-12", "10:10")),
        msg("c2", "IN", sp("2026-10-12", "10:00")),
        msg("c1", "IN", sp("2026-10-12", "10:00")),
        // a loja abordou primeiro (proativa) e a cliente nem respondeu: nenhuma espera
        msg("c3", "OUT", sp("2026-10-12", "09:00")),
      ],
      regua
    );
    expect(e.map((x) => [x.conversationId, x.minutos])).toEqual([
      ["c1", 10],
      ["c2", 30],
    ]);
  });

  it("depois de respondida, a próxima mensagem da cliente abre uma espera nova", () => {
    const e = parearEsperas(
      [
        msg("c1", "IN", sp("2026-10-12", "10:00")),
        msg("c1", "OUT", sp("2026-10-12", "10:05")),
        msg("c1", "IN", sp("2026-10-12", "11:00")),
        msg("c1", "OUT", sp("2026-10-12", "11:50")),
      ],
      regua
    );
    expect(e.map((x) => [x.minutos, x.noPrazo])).toEqual([
      [5, true],
      [50, false],
    ]);
  });
});

describe("o resumo do painel", () => {
  it("conta respondidas, sem resposta, no prazo, fora do prazo, mediana, média e p90", () => {
    const base = sp("2026-10-12", "10:00");
    const min = (n: number) => new Date(base.getTime() + n * 60_000);
    const mensagens: MensagemLeve[] = [];
    // 5 esperas respondidas em 2, 4, 6, 8 e 60 min; 1 aberta estourada; 1 aberta no prazo
    [2, 4, 6, 8, 60].forEach((t, i) => {
      mensagens.push(msg(`r${i}`, "IN", base), msg(`r${i}`, "OUT", min(t)));
    });
    mensagens.push(msg("aberta-velha", "IN", base));
    mensagens.push(msg("aberta-nova", "IN", min(100)));
    const r = resumirEsperas(parearEsperas(mensagens, { ...regua, agora: min(110) }));
    expect(r).toEqual({
      total: 7,
      respondidas: 5,
      semResposta: 2,
      encerradasSemResposta: 0,
      noPrazo: 4,
      foraDoPrazo: 2, // a de 60 min + a aberta há 110
      pctNoPrazo: 67, // 4 de 6 decididas; a aberta no prazo não decide ainda
      medianaMin: 6,
      mediaMin: 16,
      p90Min: 60,
    });
  });

  it("sem nenhuma espera, os números são nulos — nunca zero disfarçado de 'ótimo'", () => {
    expect(resumirEsperas([])).toEqual({
      total: 0,
      respondidas: 0,
      semResposta: 0,
      encerradasSemResposta: 0,
      noPrazo: 0,
      foraDoPrazo: 0,
      pctNoPrazo: null,
      medianaMin: null,
      mediaMin: null,
      p90Min: null,
    });
  });
});

describe("o sistema está amarrado", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("a recuperação automática marca a mensagem como de robô", () => {
    const fonte = ler("src/lib/recuperacao.ts");
    const envio = fonte.slice(fonte.indexOf('authorName: "Recuperação automática"') - 400);
    expect(envio).toMatch(/automatica: true/);
  });
  it("no motor, mensagem sem autor é de robô por padrão; o monitor da IA lê pela MESMA régua (o fragmento)", () => {
    expect(ler("src/lib/comm/engine.ts")).toMatch(/const automatica = input\.automatica \?\? !input\.authorId/);
    expect(ler("src/lib/ia.ts")).toMatch(/\.\.\.ONDE_MENSAGEM_CONTA/);
  });
  it("o eco do robô não conclui a tarefa de primeiro atendimento, e o robô não avança o funil", () => {
    const webhook = ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts");
    expect(webhook).toMatch(/if \(!pendente\.automatica\) \{\s*await concluirTarefasDeContato/);
    expect(ler("src/lib/comm/engine.ts")).toMatch(/!isNote && !automatica && !conv\.lastOutboundAt/);
  });
});
