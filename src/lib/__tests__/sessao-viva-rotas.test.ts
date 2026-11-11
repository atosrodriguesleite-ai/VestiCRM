import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * RN-105 pelo COMPORTAMENTO das portas (achado da revisão: o teste anterior
 * conferia o texto do código). A tela de conexão e o Conectar não acreditam
 * no "open" do servidor sozinho: a sonda decide, com tentativas espaçadas.
 */
const CONEXAO_FECHADA = { status: 400, error: "Bad Request", response: { message: ["Error: Connection Closed"] } };

const estado = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  updates: [] as { where: unknown; data: Record<string, unknown> }[],
  updateManys: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  eventos: [] as { type: string; status: string }[],
}));
const evo = vi.hoisted(() => ({
  state: vi.fn(),
  sonda: vi.fn(),
  connect: vi.fn(),
  create: vi.fn(),
  logout: vi.fn(),
}));
const alerta = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUser: async () => ({ id: "u1", companyId: "loja1", role: "ADMIN", name: "Atos" }),
  };
});
vi.mock("@/lib/db", () => ({
  db: {
    commSettings: {
      findUnique: vi.fn(async () => estado.settings),
      upsert: vi.fn(async () => estado.settings),
      update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => {
        estado.updates.push(a);
        return estado.settings;
      }),
      updateMany: vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        estado.updateManys.push(a);
        return { count: 1 };
      }),
    },
    whatsappConsent: { findFirst: vi.fn(async () => ({ userName: "Atos", acceptedAt: new Date() })) },
    commEvent: {
      create: vi.fn(async ({ data }: { data: { type: string; status: string } }) => {
        estado.eventos.push({ type: data.type, status: data.status });
        return data;
      }),
    },
  },
}));
vi.mock("@/lib/comm/evolution", () => ({
  evolutionEnv: () => ({ configured: true }),
  evoState: (...a: unknown[]) => evo.state(...a),
  evoVersao: async () => "2.3.6",
  evoSondarSessao: (...a: unknown[]) => evo.sonda(...a),
  evoConnect: (...a: unknown[]) => evo.connect(...a),
  evoCreateInstance: (...a: unknown[]) => evo.create(...a),
  evoLogout: (...a: unknown[]) => evo.logout(...a),
  jidToPhone: (jid: string) => jid.match(/^(\d{8,15})@s\.whatsapp\.net$/)?.[1] ?? null,
  TERMO_WA_TEXTO: "termo",
  TERMO_WA_VERSAO: "v1",
  WA_JANELA_HORAS: 24,
  WA_GAP_MIN_SEG: 4,
  WA_GAP_MAX_SEG: 9,
}));
vi.mock("@/lib/comm/garantir-webhook", () => ({
  garantirEventosDoWebhook: async () => "em-dia",
  motivoDaUltimaFalha: () => null,
}));
vi.mock("@/lib/comm/primeira-conexao", () => ({ registrarPrimeiraConexao: async () => {} }));
vi.mock("@/lib/health", () => ({ alertWhatsappDown: alerta }));

import { GET } from "@/app/api/whatsapp/evolution/route";
import { POST as CONECTAR } from "@/app/api/whatsapp/evolution/connect/route";

/** A consulta da tela; com `qr`, a tela está esperando a leitura (RN-110). */
const consulta = (qr = false) => new Request(`http://x/api/whatsapp/evolution${qr ? "?qr=1" : ""}`);

const pedido = (corpo?: unknown) =>
  new Request("http://x/api/whatsapp/evolution/connect", {
    method: "POST",
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

/** As portas esperam entre as sondas: o relógio falso anda por elas. */
async function rodar<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  estado.settings = {
    companyId: "loja1",
    evolutionInstance: "inst-1",
    evolutionWebhookToken: "tok",
    evolutionStatus: "CONECTADO",
    evolutionPhone: null,
    activeProvider: "EVOLUTION",
    reinicioPedidoEm: null,
    waSentDate: null,
    waSentToday: 0,
  };
  estado.updates.length = 0;
  estado.updateManys.length = 0;
  estado.eventos.length = 0;
  for (const f of Object.values(evo)) f.mockReset();
  alerta.mockClear();
  evo.state.mockResolvedValue({
    ok: true,
    status: 200,
    data: { instance: { state: "open", ownerJid: "553398618915@s.whatsapp.net" } },
  });
});
afterEach(() => vi.useRealTimers());

describe("tela de conexão (GET): o 'open' só vale com a sonda viva", () => {
  it("sessão morta nas DUAS sondas → DESCONECTADO, sessaoCaida, aviso de queda — e o provedor NÃO vira o simulado", async () => {
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    const res = await rodar(GET(consulta()));
    const d = await res.json();
    expect(d.status).toBe("DESCONECTADO");
    expect(d.sessaoCaida).toBe(true);
    expect(evo.sonda).toHaveBeenCalledTimes(2);
    // a sonda usa o número que o PRÓPRIO servidor informa
    expect(evo.sonda).toHaveBeenCalledWith("inst-1", "553398618915");
    expect(estado.updateManys[0]).toMatchObject({ data: { evolutionStatus: "DESCONECTADO" } });
    expect(estado.eventos.map((e) => e.type)).toContain("wa.conexao.fechada");
    expect(alerta).toHaveBeenCalledWith("loja1");
    expect(estado.updates.at(-1)?.data.activeProvider).not.toBe("MOCK");
  });

  it("soluço: a primeira sonda bate na conexão fechada, a segunda passa → segue CONECTADO, nada marcado", async () => {
    evo.sonda
      .mockResolvedValueOnce({ ok: false, status: 400, data: CONEXAO_FECHADA })
      .mockResolvedValueOnce({ ok: true, status: 201, data: {} });
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("CONECTADO");
    expect(d.sessaoCaida).toBe(false);
    expect(estado.updateManys).toHaveLength(0);
    expect(alerta).not.toHaveBeenCalled();
  });

  it("durante um reinício pedido a sonda nem roda (a sessão ainda assenta)", async () => {
    estado.settings!.reinicioPedidoEm = new Date();
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("CONECTADO");
    expect(evo.sonda).not.toHaveBeenCalled();
  });

  it("a recarga da tela logo depois do reinício NÃO desfaz o 'conexão morta' que o reinício gravou", async () => {
    estado.settings!.reinicioPedidoEm = new Date();
    estado.settings!.evolutionStatus = "DESCONECTADO";
    estado.settings!.evolutionDownSince = new Date();
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("DESCONECTADO");
    expect(estado.updates.some((u) => u.data.evolutionStatus === "CONECTADO")).toBe(false);
  });

  it("sem prova nenhuma (sonda sem resposta), a loja que o sistema marcou desconectada continua desconectada — sem afirmar a queda", async () => {
    estado.settings!.evolutionStatus = "DESCONECTADO";
    estado.settings!.evolutionDownSince = new Date();
    evo.sonda.mockResolvedValue({ ok: false, status: 0, data: null });
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("DESCONECTADO");
    expect(d.sessaoCaida).toBe(false);
  });

  it("provada viva, a loja marcada volta a conectada sem o 'desde quando' da queda", async () => {
    estado.settings!.evolutionStatus = "DESCONECTADO";
    estado.settings!.evolutionDownSince = new Date();
    evo.sonda.mockResolvedValue({ ok: true, status: 201, data: {} });
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("CONECTADO");
    expect(estado.updateManys[0]).toMatchObject({ data: { evolutionDownSince: null } });
  });

  it("vinda do 'aguardando QR': a sonda roda com calma — o soluço da sincronização passa e vira CONECTADO", async () => {
    estado.settings!.evolutionStatus = "AGUARDANDO_QR";
    evo.sonda
      .mockResolvedValueOnce({ ok: false, status: 400, data: CONEXAO_FECHADA })
      .mockResolvedValueOnce({ ok: true, status: 201, data: {} });
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("CONECTADO");
    expect(alerta).not.toHaveBeenCalled();
  });

  it("vinda do 'aguardando QR' com a sessão morrendo: três sondas mortas → DESCONECTADO com o botão do QR, sem tocar o alarme (a pessoa está na tela)", async () => {
    estado.settings!.evolutionStatus = "AGUARDANDO_QR";
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("DESCONECTADO");
    expect(d.sessaoCaida).toBe(true);
    expect(evo.sonda).toHaveBeenCalledTimes(3);
    expect(alerta).not.toHaveBeenCalled();
  });
});

describe("Conectar: o servidor que acha a sessão 'open' não entrega QR — o botão nunca vira beco", () => {
  beforeEach(() => {
    estado.settings!.evolutionStatus = "DESCONECTADO";
    evo.create.mockResolvedValue({ ok: false, status: 409, data: null });
    evo.logout.mockResolvedValue({ ok: true, status: 200, data: null });
    evo.connect.mockResolvedValueOnce({ ok: true, status: 200, data: { instance: { state: "open" } } });
  });

  it("a sessão ainda sendo apagada recusa a recriação (403): uma segunda tentativa", async () => {
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    evo.logout.mockResolvedValue({ ok: true, status: 200, data: null });
    evo.create
      .mockResolvedValueOnce({ ok: false, status: 409, data: null })
      .mockResolvedValueOnce({ ok: false, status: 403, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });
    evo.connect.mockResolvedValueOnce({ ok: true, status: 200, data: { base64: "QR3" } });
    const res = await rodar(CONECTAR(pedido({})));
    expect((await res.json()).qr).toBe("QR3");
    expect(evo.create).toHaveBeenCalledTimes(3);
  });

  it("sessão morta → grava desconectada ANTES de derrubar, recria e devolve o QR Code", async () => {
    evo.sonda.mockResolvedValue({ ok: false, status: 400, data: CONEXAO_FECHADA });
    evo.connect.mockResolvedValueOnce({ ok: true, status: 200, data: { base64: "QR" } });
    evo.create
      .mockResolvedValueOnce({ ok: false, status: 409, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });
    evo.logout.mockImplementation(async () => {
      // cortada aqui, a tela mostraria o Conectar — nunca "Conectado"
      expect(estado.updates.at(-1)?.data.evolutionStatus).toBe("DESCONECTADO");
      return { ok: true, status: 200, data: null };
    });
    const res = await rodar(CONECTAR(pedido({})));
    expect(res.status).toBe(200);
    expect((await res.json()).qr).toBe("QR");
    expect(evo.logout).toHaveBeenCalledWith("inst-1", 15_000);
    expect(evo.create).toHaveBeenCalledTimes(2);
    expect(estado.eventos).toContainEqual({ type: "wa.conexao.recriada", status: "OK" });
  });

  it("sessão viva → não derruba nada: grava CONECTADO com o provedor do WhatsApp e a tela volta ao ramo conectado", async () => {
    evo.sonda.mockResolvedValue({ ok: true, status: 201, data: {} });
    const res = await rodar(CONECTAR(pedido({})));
    expect(res.status).toBe(409);
    expect((await res.json()).jaConectado).toBe(true);
    expect(evo.logout).not.toHaveBeenCalled();
    expect(estado.updates.at(-1)?.data).toMatchObject({
      evolutionStatus: "CONECTADO",
      activeProvider: "EVOLUTION",
      evolutionAlertAt: null,
    });
  });

  it("sem prova nenhuma → pergunta antes de derrubar; com a confirmação da pessoa, recria", async () => {
    evo.sonda.mockResolvedValue({ ok: false, status: 0, data: null });
    const res = await rodar(CONECTAR(pedido({})));
    expect(res.status).toBe(409);
    expect((await res.json()).perguntarRecriar).toBe(true);
    expect(evo.logout).not.toHaveBeenCalled();

    evo.connect
      .mockResolvedValueOnce({ ok: true, status: 200, data: { instance: { state: "open" } } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { base64: "QR2" } });
    const res2 = await rodar(CONECTAR(pedido({ recriar: true })));
    expect((await res2.json()).qr).toBe("QR2");
    expect(evo.logout).toHaveBeenCalledTimes(1);
  });
});

// A porta da RN-110 (o guardião declarado é qr-da-conexao.test.ts)
describe("o QR Code de agora (GET ?qr=1): só com o servidor esperando a leitura", () => {
  const esperando = { ok: true, status: 200, data: { instance: { state: "connecting" } } };
  beforeEach(() => {
    estado.settings = { ...estado.settings, evolutionStatus: "AGUARDANDO_QR" };
  });

  it("esperando a leitura e a tela pediu → devolve o código que o servidor tem AGORA", async () => {
    evo.state.mockResolvedValue(esperando);
    evo.connect.mockResolvedValue({ ok: true, status: 200, data: { base64: "data:image/png;base64,NOVO" } });
    const d = await (await rodar(GET(consulta(true)))).json();
    expect(d.status).toBe("AGUARDANDO_QR");
    expect(d.qr).toBe("data:image/png;base64,NOVO");
    expect(evo.connect).toHaveBeenCalledTimes(1);
    expect(evo.connect.mock.calls[0][0]).toBe("inst-1");
  });

  it("sem a tela pedir, o servidor não é chamado (o painel e a primeira carga não buscam código)", async () => {
    evo.state.mockResolvedValue(esperando);
    const d = await (await rodar(GET(consulta()))).json();
    expect(d.status).toBe("AGUARDANDO_QR");
    expect(d.qr).toBeNull();
    expect(evo.connect).not.toHaveBeenCalled();
  });

  it("conexão FECHADA nunca busca código: buscar ali abriria uma tentativa nova sozinho", async () => {
    evo.state.mockResolvedValue({ ok: true, status: 200, data: { instance: { state: "close" } } });
    const d = await (await rodar(GET(consulta(true)))).json();
    expect(d.status).toBe("DESCONECTADO");
    expect(d.qr).toBeNull();
    expect(evo.connect).not.toHaveBeenCalled();
  });

  it("já conectada não busca código; e a busca que falha ou vem sem imagem não derruba a consulta", async () => {
    evo.sonda.mockResolvedValue({ ok: true, status: 201, data: {} });
    const aberta = await (await rodar(GET(consulta(true)))).json();
    expect(aberta.status).toBe("CONECTADO");
    expect(evo.connect).not.toHaveBeenCalled();

    evo.state.mockResolvedValue(esperando);
    evo.connect.mockRejectedValueOnce(new Error("caiu"));
    expect((await (await rodar(GET(consulta(true)))).json()).qr).toBeNull();
    evo.connect.mockResolvedValueOnce({ ok: true, status: 200, data: { code: "sem-imagem" } });
    const semImagem = await (await rodar(GET(consulta(true)))).json();
    expect(semImagem.qr).toBeNull();
    expect(semImagem.status).toBe("AGUARDANDO_QR");
  });
});
