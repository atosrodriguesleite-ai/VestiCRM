// Guarda RN-105
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deveAvisarSilencio,
  fraseDaLojaMuda,
  horasDeUmDiaAberto,
  HORAS_REAVISO_SILENCIO,
  HORAS_SILENCIO_CRITICO,
} from "../health-wa";
import { telefoneDaChave, telefoneDoJid } from "../comm/lid";

/**
 * RN-105 — A LOJA CONECTADA E MUDA AVISA; A CONEXÃO SE REINICIA DAQUI; O
 * CONTATO LID NÃO SE PERDE.
 *
 * Incidente de 02/11/2026: quatro lojas "conectadas" sem receber nada há dois
 * dias, e o painel de Saúde sabia — só ele. Quem avisou foi uma vendedora.
 */

const h = (n: number) => n * 3_600_000;
const agora = new Date("2026-11-02T16:00:00Z");
const antes = (horas: number) => new Date(agora.getTime() - h(horas));

describe("deveAvisarSilencio — a loja muda avisa, pela régua do painel", () => {
  it("silêncio abaixo do crítico não avisa (movimento fraco não é defeito)", () => {
    expect(
      deveAvisarSilencio(
        { conectado: true, ultimaRecebida: antes(HORAS_SILENCIO_CRITICO - 1), avisadoEm: null },
        agora
      )
    ).toBe(false);
  });

  it("silêncio crítico e nunca avisada → avisa", () => {
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: antes(25), avisadoEm: null }, agora)
    ).toBe(true);
  });

  it("já avisada neste episódio há pouco → segura (sem spam)", () => {
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: antes(30), avisadoEm: antes(2) }, agora)
    ).toBe(false);
  });

  it("o silêncio continua e o último aviso passou de 24 h → reavisa", () => {
    expect(
      deveAvisarSilencio(
        { conectado: true, ultimaRecebida: antes(60), avisadoEm: antes(HORAS_REAVISO_SILENCIO + 1) },
        agora
      )
    ).toBe(true);
  });

  it("entrou mensagem DEPOIS do último aviso e calou de novo → episódio novo, avisa", () => {
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: antes(26), avisadoEm: antes(40) }, agora)
    ).toBe(true);
  });

  it("loja que nunca recebeu nada não é muda, é nova; desconectada é outro aviso", () => {
    expect(deveAvisarSilencio({ conectado: true, ultimaRecebida: null, avisadoEm: null }, agora)).toBe(false);
    expect(
      deveAvisarSilencio({ conectado: false, ultimaRecebida: antes(50), avisadoEm: null }, agora)
    ).toBe(false);
  });

  it("com horário, um dia cheio de ATENDIMENTO basta (10 h): a loja muda na segunda às 9h é avisada na terça de manhã, não na quarta", () => {
    const dia = [{ de: "08:00", ate: "18:00" }];
    const horario = { dias: [[], dia, dia, dia, dia, dia, []] };
    const segunda0900 = new Date("2026-11-02T12:00:00Z");
    // terça 08:30: 9 h de segunda + 0,5 h de terça = 9,5 h → ainda não
    expect(
      deveAvisarSilencio(
        { conectado: true, ultimaRecebida: segunda0900, avisadoEm: null, horario },
        new Date("2026-11-03T11:30:00Z")
      )
    ).toBe(false);
    // terça 09:30: 10,5 h → avisa (o painel pinta CRÍTICO às 9h de terça, pelo relógio)
    expect(
      deveAvisarSilencio(
        { conectado: true, ultimaRecebida: segunda0900, avisadoEm: null, horario },
        new Date("2026-11-03T12:30:00Z")
      )
    ).toBe(true);
  });

  it("o silêncio do alarme conta só o HORÁRIO DE ATENDIMENTO (RN-079): loja fechada no fim de semana não vira muda na segunda", () => {
    // seg–sex 8h–18h: última mensagem sexta 17:30 (SP), agora segunda 08:30 — 45 h de relógio, 1,5 h de atendimento
    const dia = [{ de: "08:00", ate: "18:00" }];
    const horario = { dias: [[], dia, dia, dia, dia, dia, []] };
    const sexta1730 = new Date("2026-10-30T20:30:00Z");
    const segunda0830 = new Date("2026-11-02T11:30:00Z");
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: sexta1730, avisadoEm: null, horario }, segunda0830)
    ).toBe(false);
    // sem horário cadastrado, conta o relógio de parede (a régua da RN-079)
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: sexta1730, avisadoEm: null, horario: null }, segunda0830)
    ).toBe(true);
    // e com o silêncio atravessando a segunda inteira, avisa na terça de manhã
    const terca0900 = new Date("2026-11-03T12:00:00Z");
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: sexta1730, avisadoEm: null, horario }, terca0900)
    ).toBe(true);
  });

  it("um dia cheio é o da PRÓPRIA loja: 4 h por dia avisa em 4 h de atendimento, 24 h por dia não vira aviso a cada noite", () => {
    const d = (de: string, ate: string) => [{ de, ate }];
    expect(horasDeUmDiaAberto(null)).toBe(24);
    expect(horasDeUmDiaAberto({ dias: [[], d("14:00", "18:00"), d("14:00", "18:00"), [], [], [], []] })).toBe(4);
    expect(horasDeUmDiaAberto({ dias: [d("00:00", "24:00"), d("00:00", "24:00"), [], [], [], [], []] })).toBe(24);
    // manhã e tarde somam: 8–12 + 13–18 = 9 h
    expect(
      horasDeUmDiaAberto({ dias: [[], [{ de: "08:00", ate: "12:00" }, { de: "13:00", ate: "18:00" }], [], [], [], [], []] })
    ).toBe(9);
    // loja de 4 h: muda na segunda às 15h, avisada na terça às 15h (não na quinta)
    const horario = { dias: [[], d("14:00", "18:00"), d("14:00", "18:00"), d("14:00", "18:00"), d("14:00", "18:00"), d("14:00", "18:00"), []] };
    const seg15 = new Date("2026-11-02T18:00:00Z");
    expect(
      deveAvisarSilencio({ conectado: true, ultimaRecebida: seg15, avisadoEm: null, horario }, new Date("2026-11-03T18:30:00Z"))
    ).toBe(true);
  });

  it("o REAVISO também respeita o horário: a loja avisada na sexta não é reavisada no sábado nem no domingo", () => {
    const dia = [{ de: "08:00", ate: "18:00" }];
    const horario = { dias: [[], dia, dia, dia, dia, dia, []] };
    const quarta = new Date("2026-10-28T12:00:00Z");
    const avisadoSexta = new Date("2026-10-30T15:00:00Z"); // sexta 12h SP
    const situacao = { conectado: true, ultimaRecebida: quarta, avisadoEm: avisadoSexta, horario };
    expect(deveAvisarSilencio(situacao, new Date("2026-10-31T16:00:00Z"))).toBe(false); // sábado
    expect(deveAvisarSilencio(situacao, new Date("2026-11-01T16:00:00Z"))).toBe(false); // domingo
    expect(deveAvisarSilencio(situacao, new Date("2026-11-02T20:30:00Z"))).toBe(true); // segunda 17h30
  });

  it("a frase diz há quanto tempo e o que fazer", () => {
    const f = fraseDaLojaMuda(antes(49), agora);
    expect(f).toContain("2 dias");
    expect(f).toContain("Reiniciar conexão");
  });
});

describe("telefoneDaChave — o contato LID não se perde, em qualquer versão do servidor", () => {
  it("JID de telefone vale direto", () => {
    expect(telefoneDaChave({ remoteJid: "5511999998888@s.whatsapp.net" })).toBe("5511999998888");
    expect(telefoneDoJid("5511999998888@s.whatsapp.net")).toBe("5511999998888");
  });
  it("o par da conversa (remoteJidAlt) vem antes de quem mandou (senderPn): no eco do celular, senderPn pode ser a loja", () => {
    expect(
      telefoneDaChave({
        remoteJid: "9876543@lid",
        senderPn: "5511900000000@s.whatsapp.net",
        remoteJidAlt: "5511999998888@s.whatsapp.net",
      })
    ).toBe("5511999998888");
  });
  it("LID com senderPn (Evolution 2.3.0/2.3.1)", () => {
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "5511999998888@s.whatsapp.net" })).toBe(
      "5511999998888"
    );
  });
  it("LID com remoteJidAlt (Evolution 2.3.6+) — era descartado antes", () => {
    expect(telefoneDaChave({ remoteJid: "9876543@lid", remoteJidAlt: "5511999998888@s.whatsapp.net" })).toBe(
      "5511999998888"
    );
  });
  it("um campo que também é @lid é código, não número: pula para o próximo", () => {
    expect(
      telefoneDaChave({
        remoteJid: "9876543@lid",
        remoteJidAlt: "1111111@lid",
        senderPn: "558999276792@s.whatsapp.net",
      })
    ).toBe("558999276792");
  });
  it("LID sem telefone em campo nenhum → null (vira registro de descarte, nunca cadastro torto)", () => {
    expect(telefoneDaChave({ remoteJid: "9876543@lid" })).toBeNull();
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "12@s.whatsapp.net" })).toBeNull();
  });
  it("sufixo de aparelho do JID é aceito e DESCARTADO (nem perde a mensagem, nem cola no número); só dígitos também vale", () => {
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "5511999998888:3@s.whatsapp.net" })).toBe(
      "5511999998888"
    );
    expect(telefoneDoJid("5511999998888:12@s.whatsapp.net")).toBe("5511999998888");
    expect(telefoneDaChave({ remoteJid: "9876543@lid", remoteJidAlt: "5511999998888" })).toBe("5511999998888");
  });
  it("o campo alternativo é tolerante como o leitor antigo: '+55…' e '@c.us' entram; @lid, grupo e status não", () => {
    expect(telefoneDaChave({ remoteJid: "9876543@lid", remoteJidAlt: "+5511999998888" })).toBe("5511999998888");
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "5511999998888@c.us" })).toBe("5511999998888");
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "120363@g.us" })).toBeNull();
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "status@broadcast" })).toBeNull();
  });
  it("formatação no campo alternativo não perde a mensagem: espaço, hífen e parênteses saem", () => {
    expect(telefoneDaChave({ remoteJid: "9876543@lid", senderPn: "+55 11 99999-8888" })).toBe("5511999998888");
    expect(telefoneDaChave({ remoteJid: "9876543@lid", remoteJidAlt: "(11) 99999-8888@s.whatsapp.net" })).toBe("1199999888" + "8");
  });
  it("grupo, status e chave vazia ficam de fora", () => {
    expect(telefoneDaChave({ remoteJid: "120363@g.us" })).toBeNull();
    expect(telefoneDaChave({ remoteJid: "status@broadcast" })).toBeNull();
    expect(telefoneDaChave(undefined)).toBeNull();
  });
});

describe("as duas portas de entrada leem pela MESMA chave", () => {
  const raiz = process.cwd();
  it("webhook e importação de histórico usam telefoneDaChave, e a régua do JID tem um dono", () => {
    const webhook = readFileSync(join(raiz, "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"), "utf8");
    const importacao = readFileSync(join(raiz, "src/lib/comm/history-import.ts"), "utf8");
    const evolution = readFileSync(join(raiz, "src/lib/comm/evolution.ts"), "utf8");
    expect(webhook).toContain("telefoneDaChave(m.key)");
    expect(importacao).toContain("telefoneDaChave(r.key)");
    expect(evolution).toContain("return telefoneDoJid(jid)");
  });
});

// ---------------------------------------------------------------------------
// O REINÍCIO DA CONEXÃO E O VIGIA, pelo comportamento (servidor e banco fingidos)
const evo = vi.hoisted(() => ({
  restart: vi.fn(),
  state: vi.fn(),
  sonda: vi.fn(),
  sendText: vi.fn(),
  configured: true,
}));
const eventos = vi.hoisted(
  () => [] as { type: string; status: string; error: string | null; payload: string }[]
);
const settings = vi.hoisted(() => ({
  companyId: "loja1",
  evolutionInstance: "inst-1",
  evolutionWebhookToken: "tok",
  evolutionWebhookEventos: null as string | null,
  reinicioPedidoEm: null as Date | null,
  evolutionPhone: null as string | null,
  evolutionStatus: "CONECTADO",
}));
const garantir = vi.hoisted(() => vi.fn());
const vigia = vi.hoisted(() => ({
  ultimas: [] as { companyId: string; _max: { lastInboundAt: Date | null } }[],
  ultimaComId: null as { createdAt: Date } | null,
  carimbos: [] as { companyId: string; silencioAvisadoEm: Date | null }[],
  claimCount: 1,
  claims: [] as unknown[],
  sinos: [] as { companyId: string; userId: string; title: string }[],
  pushes: [] as { companyId: string; title: string; tag?: string }[],
}));

const pushFalha = vi.hoisted(() => ({ valor: null as Error | null }));
const sinoFalha = vi.hoisted(() => ({ valor: null as Error | null }));
vi.mock("../push", () => ({
  sendToCompany: vi.fn(async (companyId: string, p: { title: string; tag?: string }) => {
    vigia.pushes.push({ companyId, title: p.title, tag: p.tag });
  }),
  // o celular da loja muda é o do ADMIN, pessoa a pessoa
  sendToUser: vi.fn(async (userId: string, p: { title: string; tag?: string }) => {
    if (pushFalha.valor) throw pushFalha.valor;
    vigia.pushes.push({ companyId: `user:${userId}`, title: p.title, tag: p.tag });
  }),
}));

vi.mock("../db", () => ({
  db: {
    commSettings: {
      findUnique: vi.fn(async () => settings),
      update: vi.fn(async ({ data }: { data: { reinicioPedidoEm?: Date } }) => {
        if (data.reinicioPedidoEm) settings.reinicioPedidoEm = data.reinicioPedidoEm;
        return settings;
      }),
      findMany: vi.fn(async () => vigia.carimbos),
      updateMany: vi.fn(async (args: unknown) => {
        vigia.claims.push(args);
        return { count: vigia.claimCount };
      }),
    },
    conversation: { groupBy: vi.fn(async () => vigia.ultimas) },
    message: { findFirst: vi.fn(async () => vigia.ultimaComId) },
    user: {
      findMany: vi.fn(async ({ where }: { where: { companyId: string; role: { in: string[] } } }) =>
        where.role.in.includes("MANAGER")
          ? [{ id: `${where.companyId}-admin` }, { id: `${where.companyId}-gerente` }]
          : [{ id: `${where.companyId}-admin` }]
      ),
      findFirst: vi.fn(async () => ({ companyId: "plataforma" })),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: { companyId: string; userId: string; title: string }[] }) => {
        if (sinoFalha.valor) throw sinoFalha.valor;
        vigia.sinos.push(...data);
        return { count: data.length };
      }),
    },
    company: { findUnique: vi.fn(async () => ({ name: "Toque Leve" })) },
    errorLog: { create: vi.fn(async () => ({})) },
    commEvent: {
      create: vi.fn(
        async ({ data }: { data: { type: string; status: string; error: string | null; payload: string } }) => {
          eventos.push({ type: data.type, status: data.status, error: data.error, payload: data.payload });
          return data;
        }
      ),
    },
  },
}));
vi.mock("../comm/evolution", () => ({
  evolutionEnv: () => ({ configured: evo.configured }),
  evoRestart: (...a: unknown[]) => evo.restart(...a),
  evoState: (...a: unknown[]) => evo.state(...a),
  evoSondarSessao: (...a: unknown[]) => evo.sonda(...a),
  evoSendText: (...a: unknown[]) => evo.sendText(...a),
  jidDeNumero: (n: string) => `${n}@s.whatsapp.net`,
  jidToPhone: (jid: string) => jid.match(/^(\d{8,15})@s\.whatsapp\.net$/)?.[1] ?? null,
}));
vi.mock("../comm/garantir-webhook", () => ({
  garantirEventosDoWebhook: (...a: unknown[]) => garantir(...a),
  descreverRecusa: (r: { status: number }) => `o servidor respondeu ${r.status}`,
}));

import { reiniciarConexaoDaLoja, fraseDoReinicio, reinicioEmCurso } from "../comm/reiniciar-conexao";
import { confirmarConexaoFechada } from "../comm/sessao-viva";
import { EvolutionProvider } from "../comm/providers";
import {
  FRASE_CONEXAO_FECHADA,
  lerSonda,
  respostaDizConexaoFechada,
  veredictoDasSondas,
} from "../comm/conexao-fechada";
import { avisarLojasMudas } from "../health";

describe("reiniciarConexaoDaLoja — registra o pedido, reinicia, reaplica os avisos, lê o estado e deixa rastro", () => {
  beforeEach(() => {
    eventos.length = 0;
    settings.reinicioPedidoEm = null;
    vigia.claims.length = 0;
    evo.restart.mockReset();
    evo.state.mockReset();
    garantir.mockReset();
  });

  it("servidor aceitou: pedido registrado ANTES, instância reiniciada, webhook reaplicado com `sempre`, frase diz o que fazer", async () => {
    evo.restart.mockResolvedValue({ ok: true, status: 200, data: {} });
    garantir.mockResolvedValue("reassinada");
    evo.state.mockResolvedValue({ ok: true, status: 200, data: { instance: { state: "open" } } });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.estado).toBe("open");
    expect(evo.restart).toHaveBeenCalledWith("inst-1");
    expect(garantir).toHaveBeenCalledWith(settings, { sempre: true });
    expect(r.mensagem).toContain("teste");
    // o PEDIDO fica registrado antes do reinício (é por ele que o webhook não trata o "fechou" como queda)
    expect(eventos.map((e) => e.type)).toEqual(["wa.conexao.reinicio-pedido", "wa.conexao.reiniciada"]);
    expect(eventos[1].status).toBe("OK");
    expect(JSON.parse(eventos[1].payload)).toMatchObject({ quem: "Atos", estado: "open", avisos: "reassinada" });
    // o carimbo do pedido fica na loja (é o que o webhook e o vigia leem)
    expect(settings.reinicioPedidoEm).toBeInstanceOf(Date);
    // e "open" grava CONECTADO por cima do "connecting" irmão que o webhook pode ter gravado
    expect(vigia.claims).toHaveLength(2);
    expect(vigia.claims[0]).toMatchObject({
      where: { companyId: "loja1", evolutionStatus: { not: "CONECTADO" } },
      data: { evolutionStatus: "CONECTADO", evolutionDownSince: null },
    });
    // e a janela encolhe: sobram ~15 s para o "fechou" atrasado do próprio reinício
    const encolhe = vigia.claims[1] as { where: { reinicioPedidoEm: Date }; data: { reinicioPedidoEm: Date } };
    expect(encolhe.where.reinicioPedidoEm).toBeInstanceOf(Date);
    const sobra = encolhe.data.reinicioPedidoEm.getTime() + 3 * 60_000 - Date.now();
    expect(sobra).toBeGreaterThan(5_000);
    expect(sobra).toBeLessThanOrEqual(15_000);
  });

  it("o estado é lido até ASSENTAR: close → close → open vira 'reiniciada', sem mandar ler o QR", async () => {
    evo.restart.mockResolvedValue({ ok: true, status: 200, data: {} });
    garantir.mockResolvedValue("reassinada");
    evo.state
      .mockResolvedValueOnce({ ok: true, status: 200, data: { instance: { state: "close" } } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { instance: { state: "connecting" } } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { instance: { state: "open" } } });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(evo.state).toHaveBeenCalledTimes(3);
    expect(r.estado).toBe("open");
    expect(r.mensagem).not.toContain("QR Code");
  });

  it("leitura do estado que falha não insiste: uma vez e para, sem gravar status", async () => {
    evo.restart.mockResolvedValue({ ok: true, status: 200, data: {} });
    garantir.mockResolvedValue("reassinada");
    evo.state.mockResolvedValue({ ok: false, status: 0, data: null });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(evo.state).toHaveBeenCalledTimes(1);
    expect(r.estado).toBeNull();
    expect(vigia.claims).toHaveLength(0);
  });

  it("servidor só DEMOROU (incerto): não é recusa — reaplica os avisos, lê o estado e diz que demorou", async () => {
    evo.restart.mockResolvedValue({ ok: false, status: 0, data: null, incerto: true });
    garantir.mockResolvedValue("reassinada");
    evo.state.mockResolvedValue({ ok: true, status: 200, data: { instance: { state: "connecting" } } });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(r.ok).toBe(true);
    expect(garantir).toHaveBeenCalledWith(settings, { sempre: true });
    expect(r.mensagem).toContain("demorou");
    expect(r.mensagem).toContain("1 minuto");
    expect(eventos.at(-1)?.status).toBe("OK");
    expect(JSON.parse(eventos.at(-1)!.payload)).toMatchObject({ demorou: true });
  });

  it("servidor recusou: não reaplica nada, devolve a frase com o motivo e registra ERRO", async () => {
    evo.restart.mockResolvedValue({ ok: false, status: 500, data: { message: "boom" } });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain("500");
    expect(r.mensagem).toContain("Hostinger");
    expect(garantir).not.toHaveBeenCalled();
    expect(evo.state).not.toHaveBeenCalled();
    expect(eventos.map((e) => [e.type, e.status])).toEqual([
      ["wa.conexao.reinicio-pedido", "OK"],
      ["wa.conexao.reiniciada", "ERRO"],
    ]);
    // nada reiniciou: o carimbo volta ao que era, só se ainda é o nosso
    expect(vigia.claims.at(-1)).toMatchObject({
      where: { companyId: "loja1", reinicioPedidoEm: expect.any(Date) },
      data: { reinicioPedidoEm: null },
    });
  });

  it("sessão que não voltou (close): grava DESCONECTADO (o webhook calou o close deste reinício) para a tela mostrar o QR", async () => {
    evo.restart.mockResolvedValue({ ok: true, status: 200, data: {} });
    garantir.mockResolvedValue("reassinada");
    evo.state.mockResolvedValue({ ok: true, status: 200, data: { instance: { state: "close" } } });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(evo.state).toHaveBeenCalledTimes(3); // insistiu, e só então concluiu
    expect(r.estado).toBe("close");
    expect(r.mensagem).toContain("QR Code");
    expect(vigia.claims).toHaveLength(1);
    expect(vigia.claims[0]).toMatchObject({
      where: { companyId: "loja1", evolutionStatus: "CONECTADO" },
      data: { evolutionStatus: "DESCONECTADO" },
    });
  });

  it("a ordem é: reiniciar → esperar → reaplicar avisos → ler estado (reaplicar na hora levava recusa passageira)", async () => {
    const ordem: string[] = [];
    evo.restart.mockImplementation(async () => {
      ordem.push("restart");
      return { ok: true, status: 200, data: {} };
    });
    garantir.mockImplementation(async () => {
      ordem.push("webhook");
      return "reassinada";
    });
    evo.state.mockImplementation(async () => {
      ordem.push("state");
      return { ok: true, status: 200, data: { instance: { state: "open" } } };
    });
    await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(ordem).toEqual(["restart", "webhook", "state"]);
  });

  it("sessão que não voltou (close) manda ler o QR; connecting manda esperar; a frase não se contradiz", () => {
    expect(fraseDoReinicio("close", "reassinada")).toContain("QR Code");
    expect(fraseDoReinicio("connecting", "reassinada")).toContain("1 minuto");
    expect(fraseDoReinicio("open", "falhou")).toContain("NÃO foram reaplicados");
    expect(fraseDoReinicio("open", "falhou")).not.toContain("e avisos reaplicados");
    expect(fraseDoReinicio("open", "reassinada")).toContain("e avisos reaplicados");
  });

  it("a janela do reinício é pura: sem carimbo, ou carimbo velho, o 'fechou' é queda de verdade", () => {
    expect(reinicioEmCurso(null)).toBe(false);
    expect(reinicioEmCurso(new Date(agora.getTime() - 4 * 60_000), agora)).toBe(false);
    expect(reinicioEmCurso(new Date(agora.getTime() - 2 * 60_000), agora)).toBe(true);
  });
});

describe("as portas de reinício: quem pode", () => {
  const raiz = process.cwd();
  it("a rota do Super Admin exige SUPERADMIN; a da loja exige gerência", () => {
    const plataforma = readFileSync(join(raiz, "src/app/api/companies/whatsapp-reiniciar/route.ts"), "utf8");
    expect(plataforma).toContain('user.role !== "SUPERADMIN"');
    const loja = readFileSync(join(raiz, "src/app/api/whatsapp/evolution/reiniciar/route.ts"), "utf8");
    expect(loja).toContain("if (!isAdmin(user))");
  });
});

describe("avisarLojasMudas — o vigia avisa a loja muda (banco e celular fingidos)", () => {
  beforeEach(() => {
    vigia.ultimas = [];
    vigia.carimbos = [];
    vigia.claimCount = 1;
    vigia.claims.length = 0;
    vigia.sinos.length = 0;
    vigia.pushes.length = 0;
  });

  it("loja muda há 2 dias e nunca avisada: toma o carimbo, sino só para o admin da loja, celular da loja e da plataforma", async () => {
    vigia.ultimas = [{ companyId: "loja1", _max: { lastInboundAt: antes(50) } }];
    vigia.carimbos = [{ companyId: "loja1", silencioAvisadoEm: null }];
    await avisarLojasMudas([{ companyId: "loja1", horario: null }], agora);
    expect(vigia.claims).toHaveLength(1);
    // só o admin da loja no sino (a gerente não vê o botão); a plataforma recebe o dela
    expect(vigia.sinos.map((n) => n.userId)).toEqual(["loja1-admin", "plataforma-admin", "plataforma-gerente"]);
    expect(vigia.sinos[0].title).toContain("sem receber mensagens");
    expect(vigia.pushes.map((p) => p.tag)).toEqual(["wa-mudo", "wa-mudo-loja1"]);
    // o celular é só o do admin (a vendedora inscrita nas vendas não recebe o botão que não tem)
    expect(vigia.pushes[0].companyId).toBe("user:loja1-admin");
    expect(vigia.pushes[1].title).toContain("Toque Leve");
  });

  it("loja com mensagem recente, loja que nunca recebeu e loja já avisada neste episódio: nada sai", async () => {
    vigia.ultimas = [
      { companyId: "viva", _max: { lastInboundAt: antes(2) } },
      { companyId: "muda-avisada", _max: { lastInboundAt: antes(40) } },
    ];
    vigia.carimbos = [{ companyId: "muda-avisada", silencioAvisadoEm: antes(3) }];
    await avisarLojasMudas(
      [
        { companyId: "viva", horario: null },
        { companyId: "nova", horario: null },
        { companyId: "muda-avisada", horario: null },
      ],
      agora
    );
    expect(vigia.claims).toHaveLength(0);
    expect(vigia.sinos).toHaveLength(0);
    expect(vigia.pushes).toHaveLength(0);
  });

  it("loja sem lastInboundAt em conversa nenhuma (histórico importado antes da regra) não é 'nova': vale a última mensagem com id do WhatsApp", async () => {
    vigia.ultimas = [{ companyId: "loja1", _max: { lastInboundAt: null } }];
    vigia.ultimaComId = { createdAt: antes(50) };
    vigia.carimbos = [{ companyId: "loja1", silencioAvisadoEm: null }];
    await avisarLojasMudas([{ companyId: "loja1", horario: null }], agora);
    expect(vigia.claims).toHaveLength(1);
    expect(vigia.sinos.length).toBeGreaterThan(0);
    vigia.ultimaComId = null;
  });

  it("o SINO que falha depois do carimbo devolve o carimbo (a próxima rodada tenta de novo); o celular que falha, não", async () => {
    vigia.ultimas = [{ companyId: "loja1", _max: { lastInboundAt: antes(50) } }];
    vigia.carimbos = [{ companyId: "loja1", silencioAvisadoEm: null }];
    sinoFalha.valor = new Error("banco caiu");
    await avisarLojasMudas([{ companyId: "loja1", horario: null }], agora);
    sinoFalha.valor = null;
    // claim + devolução do carimbo, condicionada ao carimbo ser o nosso
    expect(vigia.claims).toHaveLength(2);
    expect(vigia.claims[1]).toMatchObject({
      where: { companyId: "loja1", silencioAvisadoEm: agora },
      data: { silencioAvisadoEm: null },
    });
    expect(vigia.pushes).toHaveLength(0);

    vigia.claims.length = 0;
    pushFalha.valor = new Error("push caiu");
    await avisarLojasMudas([{ companyId: "loja1", horario: null }], agora);
    pushFalha.valor = null;
    // o sino saiu: o carimbo FICA (devolver faria o sino tocar de novo a cada 5 min)
    expect(vigia.claims).toHaveLength(1);
    expect(vigia.sinos.some((n) => n.userId === "loja1-admin")).toBe(true);
  });

  it("duas rodadas que se cruzam: quem NÃO toma o carimbo não avisa", async () => {
    vigia.ultimas = [{ companyId: "loja1", _max: { lastInboundAt: antes(50) } }];
    vigia.carimbos = [{ companyId: "loja1", silencioAvisadoEm: null }];
    vigia.claimCount = 0;
    await avisarLojasMudas([{ companyId: "loja1", horario: null }], agora);
    expect(vigia.claims).toHaveLength(1);
    expect(vigia.sinos).toHaveLength(0);
    expect(vigia.pushes).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// O "CONECTADO" QUE MENTIA (02/11/2026): o reinício disse "reiniciada" e o
// envio seguinte voltou "Connection Closed". A sonda é a prova da sessão viva.
const CONEXAO_FECHADA = { status: 400, error: "Bad Request", response: { message: ["Error: Connection Closed"] } };

describe("conexão fechada — a regra pura", () => {
  it("reconhece a resposta do servidor com a conexão fechada (a do print) e só ela", () => {
    expect(respostaDizConexaoFechada(CONEXAO_FECHADA)).toBe(true);
    expect(respostaDizConexaoFechada({ response: { message: ["Error: Connection Terminated"] } })).toBe(true);
    expect(respostaDizConexaoFechada({ response: { message: [{ exists: false, jid: "x" }] } })).toBe(false);
    expect(respostaDizConexaoFechada(null)).toBe(false);
  });
  it("a sonda só diz 'morta' quando o servidor RESPONDE conexão fechada; tempo esgotado ou rota ausente não decide", () => {
    expect(lerSonda({ ok: true, status: 201, data: {} })).toBe("viva");
    expect(lerSonda({ ok: false, status: 400, data: CONEXAO_FECHADA })).toBe("morta");
    expect(lerSonda({ ok: false, status: 0, data: null })).toBe("sem-resposta");
    expect(lerSonda({ ok: false, status: 404, data: { message: "Cannot POST" } })).toBe("sem-resposta");
    expect(lerSonda(null)).toBe("sem-resposta");
  });
  it("o veredito: qualquer 'viva' decide viva; 'sem-resposta' não decide; só é 'morta' se TODAS bateram no muro", () => {
    expect(veredictoDasSondas(["morta", "viva"])).toBe("viva");
    expect(veredictoDasSondas(["morta", "sem-resposta"])).toBe("sem-resposta");
    expect(veredictoDasSondas(["morta", "morta"])).toBe("morta");
    expect(veredictoDasSondas([])).toBe("sem-resposta");
  });
  it("com a conexão fechada a resposta citando NÃO repete o envio sem a citação (bateria no mesmo muro)", async () => {
    evo.sendText.mockReset();
    evo.sendText.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    await new EvolutionProvider("inst-1").send({
      to: "5533988585607",
      text: "Olá",
      replyTo: { externalId: "ABC", fromMe: false, texto: "oi" },
    });
    expect(evo.sendText).toHaveBeenCalledTimes(1);
  });
  it("o envio que bate na conexão fechada vira frase em português, com a bandeira para o motor conferir", async () => {
    evo.sendText.mockResolvedValueOnce({ ok: false, status: 400, data: CONEXAO_FECHADA });
    const r = await new EvolutionProvider("inst-1").send({ to: "5533988585607", text: "Olá" });
    expect(r).toEqual({ ok: false, error: FRASE_CONEXAO_FECHADA, conexaoFechada: true });
    // não afirma a queda (um "Connection Closed" pode ser o soluço da reconexão)
    expect(FRASE_CONEXAO_FECHADA).toContain("Tente reenviar em 1 minuto");
  });
});

describe("o reinício não diz 'reiniciada' com a sessão morta", () => {
  beforeEach(() => {
    eventos.length = 0;
    settings.reinicioPedidoEm = null;
    settings.evolutionPhone = "553398618915";
    vigia.claims.length = 0;
    evo.restart.mockReset();
    evo.state.mockReset();
    evo.sonda.mockReset();
    garantir.mockReset();
  });

  it("estado 'open' + sonda bate na conexão fechada → NÃO é sucesso: grava DESCONECTADO e manda ler o QR Code", async () => {
    evo.restart.mockResolvedValue({ ok: true, status: 200, data: {} });
    garantir.mockResolvedValue("reassinada");
    evo.state.mockResolvedValue({ ok: true, status: 200, data: { instance: { state: "open" } } });
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.sonda).toBe("morta");
    expect(r.mensagem).toContain("o reinício não resolveu");
    expect(r.mensagem).toContain("QR Code");
    expect(r.mensagem).not.toContain("Conexão reiniciada");
    expect(evo.sonda).toHaveBeenCalledWith("inst-1", "553398618915");
    // três tentativas: a sessão recém-reiniciada ainda assenta
    expect(evo.sonda).toHaveBeenCalledTimes(3);
    expect(vigia.claims.at(-1)).toMatchObject({ data: { evolutionStatus: "DESCONECTADO" } });
    expect(eventos.at(-1)).toMatchObject({ type: "wa.conexao.reiniciada", status: "ERRO" });
  });

  it("estado 'open' + sonda viva → reiniciada de verdade", async () => {
    evo.restart.mockResolvedValue({ ok: true, status: 200, data: {} });
    garantir.mockResolvedValue("reassinada");
    evo.state.mockResolvedValue({ ok: true, status: 200, data: { instance: { state: "open" } } });
    evo.sonda.mockResolvedValue({ ok: true, status: 201, data: {} });
    const r = await reiniciarConexaoDaLoja("loja1", { nome: "Atos" }, { esperarMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.sonda).toBe("viva");
    expect(r.mensagem).toContain("Conexão reiniciada");
  });
});

describe("o envio que volta 'conexão fechada' marca a loja desconectada — só com a sonda confirmando", () => {
  beforeEach(() => {
    // o servidor diz "open" — e informa o número do aparelho
    evo.state.mockReset();
    evo.state.mockResolvedValue({
      ok: true,
      status: 200,
      data: { instance: { state: "open", ownerJid: "553398618915@s.whatsapp.net" } },
    });
    eventos.length = 0;
    settings.reinicioPedidoEm = null;
    settings.evolutionPhone = "553398618915";
    settings.evolutionStatus = "CONECTADO";
    vigia.claims.length = 0;
    vigia.claimCount = 1;
    vigia.sinos.length = 0;
    evo.sonda.mockReset();
  });

  it("sonda morta nas DUAS tentativas → DESCONECTADO, registro na Central e o aviso de queda; a conferência seguinte é freada", async () => {
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    const agora = new Date("2026-11-02T22:35:00Z");
    vi.useFakeTimers();
    const p = confirmarConexaoFechada("loja-morta", agora);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await p).toBe(true);
    expect(vigia.claims[0]).toMatchObject({
      where: { companyId: "loja-morta", evolutionStatus: { not: "DESCONECTADO" } },
      data: { evolutionStatus: "DESCONECTADO" },
    });
    expect(eventos.map((e) => e.type)).toContain("wa.conexao.fechada");
    // dez envios falhando juntos sondam uma vez
    expect(await confirmarConexaoFechada("loja-morta", new Date(agora.getTime() + 30_000))).toBe(false);
    expect(evo.sonda).toHaveBeenCalledTimes(2);
  });

  it("soluço (morta e depois viva), viva ou sem resposta → nada é marcado", async () => {
    evo.sonda
      .mockResolvedValueOnce({ ok: false, status: 400, data: CONEXAO_FECHADA })
      .mockResolvedValueOnce({ ok: true, status: 201, data: {} });
    vi.useFakeTimers();
    const p = confirmarConexaoFechada("loja-soluco", new Date());
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await p).toBe(false);
    evo.sonda.mockResolvedValueOnce({ ok: true, status: 201, data: {} });
    expect(await confirmarConexaoFechada("loja-viva", new Date())).toBe(false);
    evo.sonda.mockResolvedValueOnce({ ok: false, status: 0, data: null });
    expect(await confirmarConexaoFechada("loja-muda", new Date())).toBe(false);
    expect(vigia.claims).toHaveLength(0);
  });

  it("sem número gravado aqui, a sonda usa o número que o PRÓPRIO servidor informa (loja antiga não escapa)", async () => {
    settings.evolutionPhone = null;
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    vi.useFakeTimers();
    const p = confirmarConexaoFechada("loja-sem-numero", new Date());
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await p).toBe(true);
    expect(evo.sonda).toHaveBeenCalledWith("inst-1", "553398618915");
  });

  it("reinício pedido há pouco não é queda; loja que não estava conectada não é tocada", async () => {
    settings.reinicioPedidoEm = new Date();
    expect(await confirmarConexaoFechada("loja-reiniciando", new Date())).toBe(false);
    settings.reinicioPedidoEm = null;
    settings.evolutionStatus = "DESCONECTADO";
    expect(await confirmarConexaoFechada("loja-desligada", new Date())).toBe(false);
    expect(evo.sonda).not.toHaveBeenCalled();
  });
});
