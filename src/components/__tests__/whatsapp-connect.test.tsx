// @vitest-environment jsdom
// Guarda RN-110
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WhatsappConnect } from "@/app/(app)/comunicacao/whatsapp-connect";
import { FECHADAS_PARA_VENCER, MS_ENTRE_CONSULTAS_DO_QR } from "@/lib/qr-da-conexao";

const base = {
  serverConfigured: true,
  consent: { userName: "Atos", acceptedAt: "2026-11-01T00:00:00.000Z" },
  termo: null,
  phone: null,
  limites: { janelaHoras: 24, ritmoMinSeg: 4, ritmoMaxSeg: 9, enviadosHoje: 0 },
};
type Resposta = { status: string; qr?: string | null; qrNumero?: number; aberta?: boolean; sessaoCaida?: boolean };
let fila: Resposta[] = [];
let pedidos: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  fila = [];
  pedidos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/connect")) {
        return { ok: true, json: async () => ({ qr: "data:image/png;base64,PRIMEIRO", qrNumero: 1 }) };
      }
      const proxima = fila.shift() ?? { status: "AGUARDANDO_QR" };
      return { ok: true, json: async () => ({ ...base, ...proxima }) };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const andar = async (vezes = 1) => {
  for (let i = 0; i < vezes; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_ENTRE_CONSULTAS_DO_QR);
    });
  }
};
const imagem = () => screen.queryByAltText("QR Code de conexão do WhatsApp") as HTMLImageElement | null;
const barra = () => screen.getByRole("progressbar");
const estados = () =>
  [...screen.getByTestId("andamento-da-conexao").querySelectorAll("li")].map((li) => li.getAttribute("data-estado"));

async function abrirComQr() {
  fila.push({ status: "DESCONECTADO" });
  render(<WhatsappConnect canEdit />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Conectar WhatsApp/ }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("RN-110 · a tela de conexão troca o QR Code sozinha", () => {
  it("o código da tela é trocado pelo de agora a cada consulta, pedindo com ?qr=1", async () => {
    await abrirComQr();
    expect(imagem()?.src).toContain("PRIMEIRO");
    fila.push({ status: "AGUARDANDO_QR", qr: "data:image/png;base64,SEGUNDO", qrNumero: 2 });
    await andar();
    expect(imagem()?.src).toContain("SEGUNDO");
    expect(pedidos.at(-1)).toBe("GET /api/whatsapp/evolution?qr=1");
    expect(screen.getByRole("status").textContent).toContain("este é o 2º");
    // sem código na resposta, fica o que está na tela
    fila.push({ status: "AGUARDANDO_QR", qr: null });
    await andar();
    expect(imagem()?.src).toContain("SEGUNDO");
  });

  it("a conexão fechou e não voltou → a tela DIZ que venceu e oferece gerar outro, em vez de girar para sempre", async () => {
    await abrirComQr();
    // um fechado no meio (o reinício do pareamento) não encerra
    fila.push({ status: "DESCONECTADO" }, { status: "AGUARDANDO_QR", qr: "data:image/png;base64,TERCEIRO" });
    await andar(2);
    expect(imagem()?.src).toContain("TERCEIRO");
    for (let i = 0; i < FECHADAS_PARA_VENCER; i++) fila.push({ status: "DESCONECTADO" });
    await andar(FECHADAS_PARA_VENCER);
    expect(imagem()).toBeNull();
    expect(screen.queryByTestId("andamento-da-conexao")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("O código venceu");
    const antes = pedidos.length;
    await andar(3);
    expect(pedidos.length).toBe(antes); // parou de consultar
    // gerar outro recomeça a tentativa, sem o aviso
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Gerar código novo/ }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(imagem()?.src).toContain("PRIMEIRO");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("RN-110 · o andamento na tela só anda com o sinal real do servidor", () => {
  it("com o código na tela: passo 2 de 3, a leitura andando, a barra em 1 de 3 — e NÃO anda sozinha com o tempo", async () => {
    await abrirComQr();
    expect(estados()).toEqual(["feito", "andando", "espera"]);
    expect(barra().getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("Passo 2 de 3")).toBeTruthy();
    // dez consultas sem novidade: o relógio corre, o andamento fica onde está
    await andar(10);
    expect(estados()).toEqual(["feito", "andando", "espera"]);
    expect(barra().getAttribute("aria-valuenow")).toBe("1");
  });

  it("o servidor abriu → 'celular leu' fica feito, o código sai, e a conferência é pedida NA HORA; conferido → barra cheia e Conectado", async () => {
    await abrirComQr();
    let soltar: (v: Resposta) => void = () => {};
    const conferencia = new Promise<Resposta>((ok) => (soltar = ok));
    fila.push({ status: "AGUARDANDO_QR", aberta: true });
    // a conferência demora (a sonda): a tela fica no passo 3 enquanto isso
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      pedidos.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("conferir=1")) return { ok: true, json: async () => ({ ...base, ...(await conferencia) }) };
      const proxima = fila.shift() ?? { status: "AGUARDANDO_QR" };
      return { ok: true, json: async () => ({ ...base, ...proxima }) };
    });
    await andar();
    expect(pedidos.at(-1)).toBe("GET /api/whatsapp/evolution?qr=1&conferir=1");
    expect(estados()).toEqual(["feito", "feito", "andando"]);
    expect(barra().getAttribute("aria-valuenow")).toBe("2");
    expect(imagem()).toBeNull();
    expect(screen.getByText(/Conferindo se ela está viva/)).toBeTruthy();
    expect(screen.queryByText(/WhatsApp conectado/)).toBeNull();

    await act(async () => {
      soltar({ status: "CONECTADO" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(estados()).toEqual(["feito", "feito", "feito"]);
    expect(barra().getAttribute("aria-valuenow")).toBe("3");
    expect(screen.getByText("WhatsApp conectado")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const antes = pedidos.length;
    await andar(3);
    expect(pedidos.length).toBe(antes); // acabou: para de consultar
  });

  it("abriu mas a conferência achou a conexão morta → o andamento some e a tela diz que caiu (nunca barra cheia)", async () => {
    await abrirComQr();
    fila.push({ status: "AGUARDANDO_QR", aberta: true }, { status: "DESCONECTADO", sessaoCaida: true });
    await andar();
    expect(screen.queryByTestId("andamento-da-conexao")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("a conexão com o celular da loja caiu");
    expect(screen.queryByText("WhatsApp conectado")).toBeNull();
  });

  it("a loja que já estava conectada ao abrir a tela não ganha o andamento (ele é só da tentativa desta tela)", async () => {
    fila.push({ status: "CONECTADO" });
    render(<WhatsappConnect canEdit />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("andamento-da-conexao")).toBeNull();
    expect(screen.getByText(/Conectado/)).toBeTruthy();
  });
});
