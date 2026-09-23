// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { EnviarRelatoDeErro } from "../enviar-relato-de-erro";
import { CHAVE_RELATO_PENDENTE, EVENTO_RELATO_GUARDADO } from "@/lib/erro-da-tela";

/**
 * O RELATO GUARDADO CHEGA AO SERVIDOR — e só sai do aparelho quando é a
 * hora (RN-065). Quem quebrou com a sessão vencida só consegue mandar depois
 * do login: o 401 NÃO pode apagar o relato, senão justamente esse caso
 * nunca chegaria ao painel.
 */

const RELATO = JSON.stringify({
  mensagem: "TypeError: x",
  detalhe: null,
  caminho: "/pedidos",
  versaoVelha: false,
  quando: new Date().toISOString(),
});

function responder(status: number) {
  const f = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mandar o relato pendente", () => {
  it("sem relato guardado, não vai ao servidor", () => {
    const f = responder(200);
    render(<EnviarRelatoDeErro />);
    expect(f).not.toHaveBeenCalled();
  });

  it("aceito: manda o que estava guardado e apaga", async () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
    const f = responder(200);
    render(<EnviarRelatoDeErro />);
    await waitFor(() => expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBeNull());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/erro-da-tela");
    expect(JSON.parse(init.body as string)).toEqual(JSON.parse(RELATO));
  });

  it("o envio sobrevive à recarga (keepalive) — o servidor ignora o id repetido", async () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
    const f = responder(200);
    render(<EnviarRelatoDeErro />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.keepalive).toBe(true);
  });

  it("quebra DEPOIS de montado (app aberto por dias): manda na hora, sem esperar recarregar", async () => {
    const f = responder(200);
    render(<EnviarRelatoDeErro />);
    expect(f).not.toHaveBeenCalled();
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
    window.dispatchEvent(new Event(EVENTO_RELATO_GUARDADO));
    await waitFor(() => expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBeNull());
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sessão vencida (401): o relato ESPERA o próximo login", async () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
    const f = responder(401);
    render(<EnviarRelatoDeErro />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBe(RELATO);
  });

  it("servidor com defeito (5xx) ou sem rede: fica para a próxima", async () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
    responder(500);
    render(<EnviarRelatoDeErro />);
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBe(RELATO);

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<EnviarRelatoDeErro />);
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBe(RELATO);
  });

  it("recusado ou barrado pelo ritmo (4xx): encerra — reenviar seria spam", async () => {
    for (const status of [400, 429]) {
      window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
      responder(status);
      render(<EnviarRelatoDeErro />);
      await waitFor(() => expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBeNull());
      cleanup();
    }
  });

  it("uma quebra NOVA gravada durante o envio não some junto", async () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, RELATO);
    const novo = RELATO.replace("TypeError: x", "TypeError: outra");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        window.localStorage.setItem(CHAVE_RELATO_PENDENTE, novo);
        return new Response("{}", { status: 200 });
      })
    );
    render(<EnviarRelatoDeErro />);
    await new Promise((r) => setTimeout(r, 0));
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBe(novo);
  });

  it("relato de mais de uma semana (aparelho sem login esse tempo todo) não viaja", () => {
    const velho = JSON.stringify({ ...JSON.parse(RELATO), quando: "2026-01-01T00:00:00.000Z" });
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, velho);
    const f = responder(200);
    render(<EnviarRelatoDeErro />);
    expect(f).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBeNull();
  });

  it("relato ilegível é descartado sem ir ao servidor", () => {
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, "{isso não é json");
    const f = responder(200);
    render(<EnviarRelatoDeErro />);
    expect(f).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBeNull();
  });
});
