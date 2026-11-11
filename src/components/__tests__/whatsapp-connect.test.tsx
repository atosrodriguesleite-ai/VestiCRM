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
type Resposta = { status: string; qr?: string | null };
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
        return { ok: true, json: async () => ({ qr: "data:image/png;base64,PRIMEIRO" }) };
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
    fila.push({ status: "AGUARDANDO_QR", qr: "data:image/png;base64,SEGUNDO" });
    await andar();
    expect(imagem()?.src).toContain("SEGUNDO");
    expect(pedidos.at(-1)).toBe("GET /api/whatsapp/evolution?qr=1");
    expect(screen.getByRole("status").textContent).toContain("renovado 1×");
    // sem código na resposta, fica o que está na tela
    fila.push({ status: "AGUARDANDO_QR", qr: null });
    await andar();
    expect(imagem()?.src).toContain("SEGUNDO");
  });

  it("conectou → o código sai e a tela mostra Conectado", async () => {
    await abrirComQr();
    fila.push({ status: "CONECTADO" });
    await andar();
    expect(imagem()).toBeNull();
    expect(screen.getByText(/Conectado/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
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
