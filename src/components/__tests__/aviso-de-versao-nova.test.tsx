// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";
import { AvisoDeVersaoNova } from "@/components/aviso-de-versao-nova";
import { CHAVE_VERSAO_TENTADA, MS_DO_DEPOIS, MS_ENTRE_CONFERENCIAS } from "@/lib/versao-do-app";

/**
 * O AVISO DE VERSÃO NOVA (RN-113) — o COMPORTAMENTO: pergunta só com a aba à
 * vista e no ritmo; aparece quando a versão do ar é outra; e NUNCA recarrega
 * sozinho — só no clique de "Atualizar agora", depois de dizer o que se perde.
 */

let visibilidade: DocumentVisibilityState = "visible";
let online = true;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  visibilidade = "visible";
  online = true;
});

function servidorDiz(versao: string, status = 200) {
  const f = vi.fn(
    async (_endereco: string, _opcoes?: RequestInit) =>
      new Response(JSON.stringify(status === 200 ? { versao } : { error: "Não autenticado" }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", f);
  return f;
}

const passar = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("quando pergunta", () => {
  it("ao carregar NÃO pergunta (a tela é a versão do ar); passado o intervalo, pergunta", async () => {
    const f = servidorDiz("aaa");
    render(<AvisoDeVersaoNova versao="aaa" recarregar={vi.fn()} />);
    await passar(MS_ENTRE_CONFERENCIAS - 61_000);
    expect(f).not.toHaveBeenCalled();
    await passar(2 * 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("/api/versao");
    // mesma versão: nada na tela
    expect(screen.queryByText("Versão nova")).toBeNull();
  });
  it("com a aba escondida não pergunta; ao voltar, pergunta na hora", async () => {
    const f = servidorDiz("bbb");
    visibilidade = "hidden";
    render(<AvisoDeVersaoNova versao="aaa" recarregar={vi.fn()} />);
    await passar(MS_ENTRE_CONFERENCIAS * 3);
    expect(f).not.toHaveBeenCalled();
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Versão nova")).toBeTruthy();
  });
  it("sem versão conhecida (fora da Vercel) nunca pergunta nem avisa", async () => {
    const f = servidorDiz("bbb");
    render(<AvisoDeVersaoNova versao="" recarregar={vi.fn()} />);
    await passar(MS_ENTRE_CONFERENCIAS * 4);
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByText("Versão nova")).toBeNull();
  });
  it("sessão vencida (401) ou servidor sem versão: não sabe, não avisa", async () => {
    const f = servidorDiz("", 401);
    render(<AvisoDeVersaoNova versao="aaa" recarregar={vi.fn()} />);
    await passar(MS_ENTRE_CONFERENCIAS + 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Versão nova")).toBeNull();
  });
  it("achou a versão nova: para de perguntar", async () => {
    const f = servidorDiz("bbb");
    render(<AvisoDeVersaoNova versao="aaa" recarregar={vi.fn()} />);
    await passar(MS_ENTRE_CONFERENCIAS * 5);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("o que faz com a versão nova", () => {
  async function comAviso() {
    servidorDiz("bbb");
    const recarregar = vi.fn();
    render(<AvisoDeVersaoNova versao="aaa" recarregar={recarregar} />);
    await passar(MS_ENTRE_CONFERENCIAS + 60_000);
    expect(screen.getByText("Versão nova")).toBeTruthy();
    return recarregar;
  }

  it("NUNCA recarrega sozinho — nem horas depois, nem com a aba escondida", async () => {
    const recarregar = await comAviso();
    visibilidade = "hidden";
    await passar(6 * 60 * 60_000);
    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(recarregar).not.toHaveBeenCalled();
  });
  it("'Atualizar' primeiro DIZ o que se perde; só 'Atualizar agora' recarrega, e anota a versão", async () => {
    const recarregar = await comAviso();
    fireEvent.click(screen.getByText("Atualizar"));
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText(/ainda não enviado se perde/)).toBeTruthy();
    fireEvent.click(screen.getByText("Atualizar agora"));
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHAVE_VERSAO_TENTADA)).toBe("bbb");
  });
  it("sem internet não recarrega (o app instalado ficaria em branco) e diz por quê", async () => {
    const recarregar = await comAviso();
    online = false;
    fireEvent.click(screen.getByText("Atualizar"));
    fireEvent.click(screen.getByText("Atualizar agora"));
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText(/Sem internet agora/)).toBeTruthy();
    // a conexão voltou: o mesmo botão recarrega
    online = true;
    fireEvent.click(screen.getByText("Atualizar agora"));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
  it("'Depois' tira o aviso da frente e ele volta em uma hora", async () => {
    const recarregar = await comAviso();
    fireEvent.click(screen.getByLabelText("Agora não, avisar depois"));
    expect(screen.queryByText("Versão nova")).toBeNull();
    await passar(MS_DO_DEPOIS - 2 * 60_000);
    expect(screen.queryByText("Versão nova")).toBeNull();
    await passar(4 * 60_000);
    expect(screen.getByText("Versão nova")).toBeTruthy();
    expect(recarregar).not.toHaveBeenCalled();
  });
  it("a aba que já recarregou por causa DESTA versão não é avisada de novo", async () => {
    window.sessionStorage.setItem(CHAVE_VERSAO_TENTADA, "bbb");
    const f = servidorDiz("bbb");
    render(<AvisoDeVersaoNova versao="aaa" recarregar={vi.fn()} />);
    await passar(MS_ENTRE_CONFERENCIAS + 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Versão nova")).toBeNull();
  });
});
