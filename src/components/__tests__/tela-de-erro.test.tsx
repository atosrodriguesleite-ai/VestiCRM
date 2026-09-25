// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { CHAVE_RECARGAS, CHAVE_RELATO_PENDENTE, EVENTO_RELATO_GUARDADO } from "@/lib/erro-da-tela";

/**
 * A TELA DE SOCORRO, RENDERIZADA DE VERDADE (RN-066).
 *
 * A regra da trava já é guardada pela função pura. Aqui se prova a
 * APLICAÇÃO dela — o lugar onde um descuido vira a página que recarrega
 * sem parar: a recarga acontece no máximo uma vez por janela, a trava é
 * gravada antes, sem armazenamento não há recarga automática, e sem
 * internet ela ESPERA (no app instalado do iPhone, recarregar offline dá a
 * tela branca do sistema, sem botão).
 */

// os parâmetros da rota, como o Next os daria na tela quebrada
const rota = vi.hoisted(() => ({ params: {} as Record<string, string> | null }));
vi.mock("next/navigation", () => ({ useParams: () => rota.params }));

const { TelaDeErro } = await import("../tela-de-erro");

let recarregar: ReturnType<typeof vi.fn>;
const locationOriginal = window.location;

function naTela(pathname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, href: `https://www.atacadopro.com${pathname}?c=SEGREDO`, reload: recarregar },
  });
}

function comInternet(sim: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => sim });
}

beforeEach(() => {
  recarregar = vi.fn();
  naTela("/pedidos");
  comInternet(true);
  rota.params = {};
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: locationOriginal });
});

function versaoVelha() {
  const e = new Error("Loading chunk 482 failed.");
  e.name = "ChunkLoadError";
  return e;
}

describe("versão velha", () => {
  it("recarrega sozinha UMA vez e diz que está atualizando", () => {
    render(<TelaDeErro error={versaoVelha()} />);
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Atualizando para a versão nova…")).toBeTruthy();
    // a trava ficou gravada ANTES da recarga
    expect(JSON.parse(window.sessionStorage.getItem(CHAVE_RECARGAS)!)).toHaveLength(1);
  });

  it("se voltar a quebrar logo depois, NÃO recarrega de novo — mostra o botão", () => {
    // é o cenário do loop: a recarga não curou
    window.sessionStorage.setItem(CHAVE_RECARGAS, JSON.stringify([Date.now() - 5_000]));
    render(<TelaDeErro error={versaoVelha()} />);
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeTruthy();
  });

  it("o relato diz se a recarga ACONTECEU — a barrada pela trava não se passa por 'curada'", () => {
    render(<TelaDeErro error={versaoVelha()} />);
    expect(JSON.parse(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)!).recarregouSozinho).toBe(true);
    cleanup();

    window.localStorage.clear();
    window.sessionStorage.setItem(CHAVE_RECARGAS, JSON.stringify([Date.now() - 5_000]));
    render(<TelaDeErro error={versaoVelha()} />);
    expect(JSON.parse(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)!).recarregouSozinho).toBe(false);
  });

  it("já recarregou 3 vezes na meia hora: para, mesmo com mais de um minuto de folga", () => {
    const agora = Date.now();
    window.sessionStorage.setItem(
      CHAVE_RECARGAS,
      JSON.stringify([agora - 20 * 60_000, agora - 10 * 60_000, agora - 2 * 60_000])
    );
    render(<TelaDeErro error={versaoVelha()} />);
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
  });

  it("sem conseguir gravar a trava, não aposta: nada de recarga automática", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<TelaDeErro error={versaoVelha()} />);
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
  });

  it("gravar e ler de volta outra coisa (armazenamento que finge) também trava", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => null);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    render(<TelaDeErro error={versaoVelha()} />);
    expect(recarregar).not.toHaveBeenCalled();
  });
});

describe("sem internet", () => {
  it("NÃO recarrega offline — espera a conexão e só então recarrega", () => {
    comInternet(false);
    render(<TelaDeErro error={versaoVelha()} />);
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText("Sem conexão com a internet")).toBeTruthy();
    // e não é beco: se o aviso da conexão nunca vier, o botão está ali
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeTruthy();

    comInternet(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("a conexão voltou mas a trava não deixa: vira a tela com o botão", () => {
    comInternet(false);
    window.sessionStorage.setItem(CHAVE_RECARGAS, JSON.stringify([Date.now() - 5_000]));
    render(<TelaDeErro error={versaoVelha()} />);
    comInternet(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
  });

  it("erro de verdade sem internet avisa, para ela não recarregar no escuro", () => {
    comInternet(false);
    render(<TelaDeErro error={new Error("quebrou")} />);
    expect(screen.getByText(/sem internet agora/)).toBeTruthy();
  });
});

describe("qualquer outro erro", () => {
  it("NUNCA recarrega sozinho — mostra o que houve, em português, com o botão", () => {
    render(<TelaDeErro error={new TypeError("x.map is not a function")} />);
    expect(recarregar).not.toHaveBeenCalled();
    expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
    expect(screen.getByText(/O que já estava salvo continua salvo/)).toBeTruthy();
    // o detalhe técnico fica, pequeno, para o print chegar ao suporte
    expect(screen.getByText(/TypeError: x.map is not a function/)).toBeTruthy();
  });

  it("o botão recarrega", () => {
    render(<TelaDeErro error={new Error("quebrou")} />);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar a página" }));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("o código do Next aparece quando existe (casa com o erro do servidor)", () => {
    render(<TelaDeErro error={Object.assign(new Error("x"), { digest: "998877" })} />);
    expect(screen.getByText(/código 998877/)).toBeTruthy();
  });
});

describe("o relato fica guardado para o painel de Saúde", () => {
  it("quebra sem recarga avisa na hora quem manda o relato; com recarga, não", () => {
    const avisos = vi.fn();
    window.addEventListener(EVENTO_RELATO_GUARDADO, avisos);
    render(<TelaDeErro error={new Error("quebrou")} />);
    expect(avisos).toHaveBeenCalledTimes(1);
    cleanup();
    // a recarga vem já: avisar agora faria o envio ser cortado no meio
    render(<TelaDeErro error={versaoVelha()} />);
    expect(avisos).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVENTO_RELATO_GUARDADO, avisos);
  });

  it("erro do SERVIDOR (com digest) não é guardado — o servidor já registrou", () => {
    render(<TelaDeErro error={Object.assign(new Error("x"), { digest: "998877" })} />);
    expect(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)).toBeNull();
  });

  it("guarda o erro — mesmo quando vai recarregar — sem busca", () => {
    render(<TelaDeErro error={versaoVelha()} />);
    const guardado = JSON.parse(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)!);
    expect(guardado.versaoVelha).toBe(true);
    expect(guardado.caminho).toBe("/pedidos");
    expect(JSON.stringify(guardado)).not.toContain("SEGREDO");
  });

  it("o código de acesso que mora NO CAMINHO não vai junto", () => {
    naTela("/dados/Xy12AbCdEfG");
    rota.params = { token: "Xy12AbCdEfG" };
    render(<TelaDeErro error={new Error("quebrou")} />);
    const guardado = JSON.parse(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)!);
    expect(guardado.caminho).toBe("/dados/[token]");
  });

  it("sem os parâmetros (roteador caído), fica só o primeiro pedaço", () => {
    naTela("/ficha/Q9w8e7r6t5y");
    rota.params = null;
    render(<TelaDeErro error={new Error("quebrou")} />);
    const guardado = JSON.parse(window.localStorage.getItem(CHAVE_RELATO_PENDENTE)!);
    expect(guardado.caminho).toBe("/ficha/…");
  });

  it("armazenamento bloqueado não impede a tela de aparecer", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(<TelaDeErro error={new Error("quebrou")} />);
    expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
  });
});
