// @vitest-environment jsdom
// Guarda RN-104
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { ModoTv } from "@/app/(app)/envios/modo-tv";

/**
 * O MODO TV SE ATUALIZA SOZINHO (RN-104) — o COMPORTAMENTO: pede ao abrir e
 * a cada minuto só com a aba visível; a falha mantém o último número e diz
 * o que foi (403 = o módulo Envios, nunca "o BI"); Esc fecha. O mapa 3D
 * aqui não desenha (jsdom não tem WebGL) — e a tela DIZ isso em vez de
 * ficar em branco.
 */
const resposta = {
  loja: "Toque Leve",
  agora: "2026-10-28T12:00:00.000Z",
  estrada: { origem: null, pontos: [], porUf: [], total: 0, atrasados: 0, parados: 0, semEndereco: 0, cortado: false },
  placar: { aCaminho: 7, atrasados: 2, parados: 0, postadosHoje: 3, entreguesHoje: 1, aguardandoPostagem: 4 },
};
let visibilidade: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  visibilidade = "visible";
});

function responder(fila: { status: number; corpo?: unknown }[]) {
  const f = vi.fn(async () => {
    const r = fila.length > 1 ? fila.shift()! : fila[0];
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("a batida da TV", () => {
  it("pede ao abrir, mostra o placar, e na batida seguinte pede de novo só com a aba visível", async () => {
    const f = responder([{ status: 200, corpo: resposta }]);
    render(<ModoTv aoFechar={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/2 atrasados — passou do prazo/)).toBeTruthy();
    visibilidade = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 * 2 + 10);
    });
    expect(f).toHaveBeenCalledTimes(1); // TV apagada não gasta banco
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a falha 403 mantém o último número e diz que é o módulo Envios — nunca 'o BI'", async () => {
    responder([{ status: 200, corpo: resposta }, { status: 403 }]);
    render(<ModoTv aoFechar={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + 10);
    });
    expect(screen.getByText("7")).toBeTruthy();
    const aviso = screen.getByText(/módulo Envios/);
    expect(aviso.textContent).toMatch(/mostrando o último número/);
    expect(aviso.textContent).not.toMatch(/\bBI\b/);
  });

  it("Esc fecha, e sem WebGL a tela diz em vez de ficar em branco", async () => {
    responder([{ status: 200, corpo: { ...resposta, estrada: { ...resposta.estrada, total: 1, pontos: [{ x: 1, y: 1, cidade: "Recife", uf: "PE", noPrazo: 1, atrasados: 0, parados: 0 }] } } }]);
    const fechar = vi.fn();
    render(<ModoTv aoFechar={fechar} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    // o canvas do jsdom não tem contexto WebGL: o mapa avisa e o placar segue
    await vi.waitFor(() => expect(screen.getByText(/não desenha o mapa 3D/)).toBeTruthy(), { timeout: 3000, interval: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(fechar).toHaveBeenCalledTimes(1);
  });
});
