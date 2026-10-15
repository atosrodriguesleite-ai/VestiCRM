// @vitest-environment jsdom
// Guarda RN-088
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { FaixaDeHoje } from "@/app/(app)/bi/faixa-de-hoje";
import { INTERVALO_DA_FAIXA_MS } from "@/lib/bi/hoje-regra";

/**
 * A FAIXA "HOJE" SE ATUALIZA SOZINHA (RN-088) — o COMPORTAMENTO, não o
 * texto do código: com a aba escondida não pede nada; ao voltar, pede na
 * hora; a resposta boa troca os números; a falha mantém o último número e
 * diz o que foi (401 = sessão venceu, não "sem conexão").
 */

const inicial = { dia: "2026-10-13", leads: 3, pedidosPagos: 1, vendido: 100, esperandoAgora: 0, em: "2026-10-13T15:00:00.000Z" };
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

function responder(status: number, corpo: unknown = {}) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("a batida da faixa", () => {
  it("com a aba escondida não pede; ao voltar pede na hora e troca os números", async () => {
    const f = responder(200, { ...inicial, leads: 7, esperandoAgora: 2 });
    visibilidade = "hidden";
    render(<FaixaDeHoje inicial={inicial} prazoMin={30} hrefEsperando="/bi/lista?tipo=esperando-agora" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_FAIXA_MS * 2);
    });
    expect(f).not.toHaveBeenCalled();
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
  it("na batida de 30 s pede de novo; a falha 401 mantém o último número e diz que a sessão venceu", async () => {
    const f = responder(401);
    render(<FaixaDeHoje inicial={inicial} prazoMin={30} hrefEsperando="/x" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_FAIXA_MS + 10);
    });
    expect(f).toHaveBeenCalledTimes(1);
    // o último número bom fica na tela (3 contatos), e o aviso diz o que foi
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(/sessão venceu/)).toBeTruthy();
  });
});
