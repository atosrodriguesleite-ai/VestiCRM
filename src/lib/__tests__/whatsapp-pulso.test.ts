// Guarda RN-106
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decidirPulso,
  fraseDoWebhookCalado,
  HORAS_ENTRE_CURAS,
  HORAS_REAVISO_CALADO,
  leituraDoPulso,
  MINUTOS_SEM_ECO,
  motivoDaQueda,
  MS_FOLGA_DO_RELOGIO,
  MS_REGRAVAR_SINAL,
  podeCurar,
  provaAntesDoReinicio,
  quedaTemCura,
  webhookCalado,
} from "../comm/pulso-regra";
import { diagnosticoLoja } from "../health-wa";

/**
 * RN-106 — O PULSO DO WHATSAPP: o teste do eco, a cura automática, o motivo
 * da queda e o despertador externo do vigia.
 *
 * O incidente de 02/11/2026: o WhatsApp "conectado", envios saindo e nenhuma
 * mensagem de cliente entrando; o alarme de loja muda só tocaria depois de um
 * dia de atendimento. O eco do envio prova o caminho em minutos.
 */

const MIN = 60_000;
const HORA = 60 * MIN;
const agora = new Date("2026-11-03T15:00:00Z");
const antes = (ms: number) => new Date(agora.getTime() - ms);

describe("o teste do eco — a régua pura", () => {
  it("envio sem eco só vira 'calado' depois de MINUTOS_SEM_ECO (o eco leva segundos)", () => {
    expect(webhookCalado(null, agora)).toBe(false);
    expect(webhookCalado(antes((MINUTOS_SEM_ECO - 1) * MIN), agora)).toBe(false);
    expect(webhookCalado(antes(MINUTOS_SEM_ECO * MIN), agora)).toBe(true);
  });

  it("decidirPulso: sem envio esperando, nada; esperando, aguarda; calado, cura primeiro", () => {
    expect(decidirPulso({ envioSemEcoDesde: null, curaEm: null, avisadoEm: null }, agora)).toBe("ok");
    expect(decidirPulso({ envioSemEcoDesde: antes(3 * MIN), curaEm: null, avisadoEm: null }, agora)).toBe("esperando");
    expect(decidirPulso({ envioSemEcoDesde: antes(15 * MIN), curaEm: null, avisadoEm: null }, agora)).toBe("curar");
    // a cura de 7 h atrás já pode rodar de novo
    expect(
      decidirPulso({ envioSemEcoDesde: antes(15 * MIN), curaEm: antes((HORAS_ENTRE_CURAS + 1) * HORA), avisadoEm: null }, agora)
    ).toBe("curar");
  });

  it("o envio sem eco de ANTES do último reinício só espera a próxima prova — nem cura de novo, nem alarma", () => {
    expect(
      decidirPulso(
        { envioSemEcoDesde: antes(2 * HORA), curaEm: antes(HORA), reiniciadoEm: antes(HORA), avisadoEm: null },
        agora
      )
    ).toBe("aguardando-prova");
    // a vez da cura gasta, mas o servidor RECUSOU o reinício (sem
    // `reiniciadoEm`): a prova continua valendo e o alarme sai
    expect(
      decidirPulso({ envioSemEcoDesde: antes(2 * HORA), curaEm: antes(HORA), reiniciadoEm: null, avisadoEm: null }, agora)
    ).toBe("avisar");
    // o reinício do BOTÃO não gasta a vez da cura automática
    expect(
      decidirPulso({ envioSemEcoDesde: antes(30 * MIN), curaEm: null, reiniciadoEm: antes(HORA), avisadoEm: null }, agora)
    ).toBe("curar");
    expect(provaAntesDoReinicio(antes(2 * HORA), antes(HORA))).toBe(true);
    expect(provaAntesDoReinicio(antes(HORA), antes(2 * HORA))).toBe(false);
    expect(provaAntesDoReinicio(antes(HORA), null)).toBe(false);
  });

  it("calado DE NOVO depois da cura: avisa, uma vez por episódio, e reavisa depois de HORAS_REAVISO_CALADO", () => {
    const curaRecente = antes(HORA);
    expect(decidirPulso({ envioSemEcoDesde: antes(15 * MIN), curaEm: curaRecente, avisadoEm: null }, agora)).toBe("avisar");
    // já avisada depois deste envio sem eco → não repete
    expect(
      decidirPulso({ envioSemEcoDesde: antes(30 * MIN), curaEm: curaRecente, avisadoEm: antes(10 * MIN) }, agora)
    ).toBe("ja-avisado");
    // o envio sem eco é MAIS NOVO que o último aviso → episódio novo
    expect(
      decidirPulso({ envioSemEcoDesde: antes(15 * MIN), curaEm: curaRecente, avisadoEm: antes(40 * MIN) }, agora)
    ).toBe("avisar");
    // o mesmo episódio longo: reaviso
    expect(
      decidirPulso(
        {
          envioSemEcoDesde: antes(4 * HORA),
          curaEm: antes(5 * HORA),
          avisadoEm: antes((HORAS_REAVISO_CALADO + 1) * HORA),
        },
        agora
      )
    ).toBe("avisar");
  });

  it("a cura roda no máximo uma vez a cada HORAS_ENTRE_CURAS", () => {
    expect(podeCurar(null, agora)).toBe(true);
    expect(podeCurar(antes((HORAS_ENTRE_CURAS - 1) * HORA), agora)).toBe(false);
    expect(podeCurar(antes(HORAS_ENTRE_CURAS * HORA), agora)).toBe(true);
  });

  it("a frase do alarme diz há quanto tempo, que a cura não resolveu e o que fazer", () => {
    const f = fraseDoWebhookCalado(antes(17 * MIN), agora);
    expect(f).toContain("17 min");
    expect(f).toContain("tentou reiniciar a conexão sozinho");
    // sem reinício de verdade, não diz que reiniciou — manda tocar o botão
    const semReinicio = fraseDoWebhookCalado(antes(40 * MIN), agora, false);
    expect(semReinicio).not.toContain("tentou reiniciar");
    expect(semReinicio).toContain("Reiniciar conexão");
    expect(f).toContain("QR Code");
  });
});

describe("o painel de Saúde lê o pulso", () => {
  it("leituraDoPulso: eco voltando, esperando, calado e sem medida", () => {
    expect(leituraDoPulso({ conectado: true, envioSemEcoDesde: null, ultimoSinal: antes(MIN) }, agora).tom).toBe("ok");
    expect(leituraDoPulso({ conectado: true, envioSemEcoDesde: antes(2 * MIN), ultimoSinal: null }, agora).tom).toBe(
      "esperando"
    );
    const calado = leituraDoPulso({ conectado: true, envioSemEcoDesde: antes(20 * MIN), ultimoSinal: null }, agora);
    expect(calado.tom).toBe("calado");
    expect(calado.texto).toContain("20 min");
    expect(leituraDoPulso({ conectado: true, envioSemEcoDesde: null, ultimoSinal: null }, agora).tom).toBe("sem-dado");
    // sinal de 2 dias atrás NÃO é "o eco está voltando" (a loja que só
    // responde pelo celular não tem envio para provar o caminho)
    // reiniciada depois do envio sem eco: "esperando a prova", nunca verde
    const reiniciada = leituraDoPulso(
      { conectado: true, envioSemEcoDesde: antes(30 * MIN), ultimoSinal: antes(MIN), reiniciadoEm: antes(10 * MIN) },
      agora
    );
    expect(reiniciada.tom).toBe("esperando");
    expect(reiniciada.texto).toContain("próxima mensagem");
    const velho = leituraDoPulso({ conectado: true, envioSemEcoDesde: null, ultimoSinal: antes(48 * HORA) }, agora);
    expect(velho.tom).toBe("sem-dado");
    expect(velho.texto).toContain("48 h");
    expect(leituraDoPulso({ conectado: false, envioSemEcoDesde: antes(20 * MIN), ultimoSinal: null }, agora).tom).toBe(
      "sem-dado"
    );
  });

  it("o diagnóstico da loja fica CRÍTICO com o eco calado — muito antes das 24 h de silêncio", () => {
    const base = { conectado: true, ultimaRecebida: antes(HORA), presas: 0, falhas24: 0, jaTeveTrafego: true };
    expect(diagnosticoLoja({ ...base, envioSemEcoDesde: antes(20 * MIN) }, agora).nivel).toBe("CRITICO");
    expect(diagnosticoLoja({ ...base, envioSemEcoDesde: antes(2 * MIN) }, agora).nivel).toBe("OK");
    expect(diagnosticoLoja({ ...base, envioSemEcoDesde: null }, agora).nivel).toBe("OK");
    // já reiniciada depois do envio: atenção (falta a prova), não crítico
    expect(diagnosticoLoja({ ...base, envioSemEcoDesde: antes(30 * MIN), reiniciadoEm: antes(10 * MIN) }, agora).nivel).toBe(
      "ATENCAO"
    );
  });
});

describe("a corrida do eco — as duas pontas se protegem", () => {
  it("o sinal não regravado cabe na folga do relógio: o eco engolido nunca deixa o envio se carimbar 'sem eco'", () => {
    // com a regravação maior que a folga, o eco que chegasse antes da
    // resposta do envio caía no intervalo sem regravar e o envio se
    // carimbava por cima dele (o alarme falso que a revisão achou)
    expect(MS_REGRAVAR_SINAL).toBeLessThanOrEqual(MS_FOLGA_DO_RELOGIO);
  });

  it("a queda que só volta com o QR Code não gasta a cura; rede, reinício e sem código, sim", () => {
    for (const c of [401, 403, 411, 440, 500, "401"]) expect(quedaTemCura(c)).toBe(false);
    for (const c of [408, 428, 503, 515, undefined, null, "abc"]) expect(quedaTemCura(c)).toBe(true);
  });
});

describe("motivoDaQueda — o código do WhatsApp em português", () => {
  it("traduz os códigos conhecidos e diz quando não sabe", () => {
    expect(motivoDaQueda(401)).toContain("desconectada pelo celular");
    expect(motivoDaQueda("440")).toContain("outra conexão");
    expect(motivoDaQueda(515)).toContain("reiniciar");
    expect(motivoDaQueda(408)).toContain("tempo esgotado");
    expect(motivoDaQueda(999)).toContain("código 999");
    expect(motivoDaQueda(undefined)).toBe("motivo não informado pelo WhatsApp");
    expect(motivoDaQueda("abc")).toBe("motivo não informado pelo WhatsApp");
  });
});

// ---------------------------------------------------------------------------
// A CURA AUTOMÁTICA (banco e reinício fingidos)
const estado = vi.hoisted(() => ({
  status: "DESCONECTADO",
  aoVivo: "close" as string | null,
  vez: 1,
  gates: [] as unknown[],
  eventos: [] as { type: string; status: string; payload: string }[],
  reinicio: null as null | (() => Promise<unknown>),
  reinicios: 0,
}));

vi.mock("../db", () => ({
  db: {
    commSettings: {
      findUnique: vi.fn(async () => ({
        evolutionStatus: estado.status,
        evolutionInstance: "inst-1",
        reinicioPedidoEm: null,
      })),
      updateMany: vi.fn(async (args: unknown) => {
        estado.gates.push(args);
        return { count: estado.vez };
      }),
    },
    commEvent: {
      create: vi.fn(async ({ data }: { data: { type: string; status: string; payload: string } }) => {
        estado.eventos.push(data);
        return data;
      }),
    },
    $executeRaw: vi.fn(async () => 1),
  },
}));
vi.mock("../comm/evolution", () => ({
  evoState: vi.fn(async () => ({ ok: true, status: 200, data: { instance: { state: estado.aoVivo } } })),
}));
vi.mock("../comm/reiniciar-conexao", () => ({
  reiniciarConexaoDaLoja: vi.fn(async () => {
    estado.reinicios++;
    return estado.reinicio!();
  }),
}));

import { tentarCuraAutomatica, NOME_DA_CURA } from "../comm/pulso-do-webhook";
import { reiniciarConexaoDaLoja } from "../comm/reiniciar-conexao";

describe("tentarCuraAutomatica — reinicia sozinha, uma vez, e diz o desfecho", () => {
  beforeEach(() => {
    estado.status = "DESCONECTADO";
    estado.aoVivo = "close";
    estado.vez = 1;
    estado.gates.length = 0;
    estado.eventos.length = 0;
    estado.reinicios = 0;
    estado.reinicio = async () => ({ ok: true, estado: "open", sonda: "viva", avisos: "reassinada", mensagem: "" });
  });

  it("toma a vez de forma atômica e reinicia pela MESMA porta do botão, com o nome do vigia no rastro", async () => {
    const r = await tentarCuraAutomatica("loja1", "queda", agora);
    expect(r).toMatchObject({ feita: true, desfecho: "voltou" });
    expect(estado.gates[0]).toMatchObject({
      where: { companyId: "loja1", OR: [{ autoCuraEm: null }, { autoCuraEm: { lt: antes(HORAS_ENTRE_CURAS * HORA) } }] },
      data: { autoCuraEm: agora },
    });
    // as esperas do botão, sem encurtar (a mesma opção espaça as sondas)
    expect(vi.mocked(reiniciarConexaoDaLoja)).toHaveBeenLastCalledWith("loja1", { nome: NOME_DA_CURA });
    expect(estado.eventos[0]).toMatchObject({ type: "wa.conexao.cura-automatica", status: "OK" });
  });

  it("a vez já tomada (outra rodada, ou cura nas últimas 6 h): não reinicia", async () => {
    estado.vez = 0;
    expect(await tentarCuraAutomatica("loja1", "queda", agora)).toEqual({ feita: false, motivo: "sem-vez" });
    expect(estado.reinicios).toBe(0);
    expect(estado.eventos).toHaveLength(0);
  });

  it("webhook calado: a vez só é tomada se o eco AINDA está calado, e a prova NÃO é apagada (o painel não pinta verde)", async () => {
    await tentarCuraAutomatica("loja1", "webhook-calado", agora);
    expect(estado.gates[0]).toMatchObject({
      where: { envioSemEcoDesde: { lte: antes(MINUTOS_SEM_ECO * MIN) } },
      data: { autoCuraEm: agora },
    });
    expect((estado.gates[0] as { data: Record<string, unknown> }).data).not.toHaveProperty("envioSemEcoDesde");
    await tentarCuraAutomatica("loja1", "queda", agora);
    expect((estado.gates[1] as { where: Record<string, unknown> }).where).not.toHaveProperty("envioSemEcoDesde");
  });

  it("a queda só é reiniciada DESCONECTADA e com o servidor dizendo fechada — nunca por cima de quem religa ou lê o QR", async () => {
    for (const [status, aoVivo] of [
      ["AGUARDANDO_QR", "close"],
      ["CONECTADO", "close"],
      ["DESCONECTADO", "open"],
      ["DESCONECTADO", "connecting"],
    ] as const) {
      estado.status = status;
      estado.aoVivo = aoVivo;
      expect(await tentarCuraAutomatica("loja1", "queda", agora)).toMatchObject({ feita: false, motivo: "sem-necessidade" });
    }
    expect(estado.reinicios).toBe(0);
    expect(estado.gates).toHaveLength(0); // nem tomou a vez
    // o eco calado não depende do estado (a conexão está aberta e muda)
    estado.status = "CONECTADO";
    estado.aoVivo = "open";
    expect(await tentarCuraAutomatica("loja1", "webhook-calado", agora)).toMatchObject({ feita: true });
  });

  it("'open' com a sonda morta não é volta; 'connecting' é pendente; erro é falha registrada", async () => {
    estado.reinicio = async () => ({ ok: false, estado: "open", sonda: "morta", avisos: null, mensagem: "não resolveu" });
    expect(await tentarCuraAutomatica("loja1", "queda", agora)).toMatchObject({ desfecho: "falhou" });
    estado.reinicio = async () => ({ ok: true, estado: "connecting", avisos: null, mensagem: "" });
    expect(await tentarCuraAutomatica("loja1", "queda", agora)).toMatchObject({ desfecho: "pendente" });
    estado.reinicio = async () => {
      throw new Error("servidor sumiu");
    };
    expect(await tentarCuraAutomatica("loja1", "queda", agora)).toMatchObject({ desfecho: "falhou" });
    expect(estado.eventos.at(-1)).toMatchObject({ status: "ERRO" });
  });
});

// ---------------------------------------------------------------------------
// O DESPERTADOR EXTERNO (ADR-024)
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void fn() };
});
const vigia = vi.hoisted(() => ({ rodou: 0 }));
vi.mock("../health", () => ({
  runWatchdogIfDue: vi.fn(async () => {
    vigia.rodou++;
  }),
}));

describe("o despertador do vigia", () => {
  it("é público no porteiro e só acorda o vigia — responde ok, sem dado nenhum", async () => {
    const { GET } = await import("@/app/api/vigia/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vigia.rodou).toBe(1);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const middleware = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(middleware).toContain('"/api/vigia"');
  });
});
