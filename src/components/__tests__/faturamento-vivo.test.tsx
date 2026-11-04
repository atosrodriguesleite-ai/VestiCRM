// @vitest-environment jsdom
// Guarda RN-108
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen, fireEvent, within } from "@testing-library/react";
import { FaturamentoVivo } from "@/app/(app)/dashboard/faturamento-vivo";
import { montarFaturamento, periodoDeComparacao, type DadosDoFaturamento } from "@/lib/dashboard/faturamento-regra";

/**
 * O GRÁFICO DE FATURAMENTO VIVO NA TELA (RN-108) — o COMPORTAMENTO: passar
 * o mouse (ou andar com as setas) mostra o valor EXATO do dia nos dois
 * períodos e a diferença; trocar a comparação pede à porta com os parâmetros
 * certos e troca os números sem recarregar; a falha mantém a última
 * comparação boa e diz o que foi; o acumulado termina no total do período;
 * a página que troca de período leva a comparação escolhida junto.
 */

const sp = (iso: string) => new Date(`${iso}T12:00:00-03:00`);
const periodo = { de: "2026-11-01", ate: "2026-11-04" };
const inicial: DadosDoFaturamento = montarFaturamento({
  periodo,
  tipo: "anterior",
  comparacao: periodoDeComparacao("anterior", periodo),
  vendas: [
    { paidAt: sp("2026-11-01"), netTotal: 100 },
    { paidAt: sp("2026-11-03"), netTotal: 300 },
    { paidAt: sp("2026-11-04"), netTotal: 2913.8 },
  ],
  vendasComparadas: [{ paidAt: sp("2026-10-31"), netTotal: 1000 }],
});
const anoPassado: DadosDoFaturamento = montarFaturamento({
  periodo,
  tipo: "ano-passado",
  comparacao: periodoDeComparacao("ano-passado", periodo),
  vendas: [
    { paidAt: sp("2026-11-01"), netTotal: 100 },
    { paidAt: sp("2026-11-03"), netTotal: 300 },
    { paidAt: sp("2026-11-04"), netTotal: 2913.8 },
  ],
  vendasComparadas: [{ paidAt: sp("2025-11-04"), netTotal: 5000 }],
});

beforeEach(() => {
  localStorage.clear();
  // o jsdom não tem matchMedia: a tela é "de computador" (o viewBox de 600)
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  // o jsdom não mede: a caixa do gráfico tem 600px de largura para a mira achar o dia pela posição
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function responder(status: number, corpo: unknown = {}) {
  const f = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } })
  );
  vi.stubGlobal("fetch", f);
  return f;
}

// o `brl` separa "R$" do número com espaço duro (U+00A0): o teste lê como espaço comum
const balao = () => (screen.getByRole("status").textContent ?? "").replace(/\u00a0/g, " ");

describe("o valor exato do dia", () => {
  it("as setas andam pelos dias e o balão diz os dois períodos e a diferença", () => {
    responder(200);
    render(<FaturamentoVivo inicial={inicial} />);
    const grafico = screen.getByTestId("faturamento-grafico");
    fireEvent.focus(grafico); // o foco cai no último dia
    expect(balao()).toContain("qua 04/11");
    expect(balao()).toContain("R$ 2.913,80");
    expect(balao()).toContain("1 pedido");
    expect(balao()).toContain("R$ 1.000"); // o dia alinhado do comparado (31/10)
    expect(balao()).toContain("sáb 31/10/2026");
    expect(balao()).toContain("▲ +R$ 1.913,80 (+191,4%)");
    fireEvent.keyDown(grafico, { key: "ArrowLeft" });
    expect(balao()).toContain("ter 03/11");
    expect(balao()).toContain("R$ 300");
    expect(balao()).toContain("R$ 0"); // sem venda no comparado naquele dia
    fireEvent.keyDown(grafico, { key: "Escape" });
    expect(screen.getByRole("status").className).toContain("sr-only");
  });
  it("o mouse acha o dia pela posição", () => {
    responder(200);
    render(<FaturamentoVivo inicial={inicial} />);
    const grafico = screen.getByTestId("faturamento-grafico");
    fireEvent.pointerMove(grafico, { clientX: 12 }); // o começo da área
    expect(balao()).toContain("dom 01/11");
    expect(balao()).toContain("R$ 100");
    fireEvent.pointerMove(grafico, { clientX: 590 });
    expect(balao()).toContain("qua 04/11");
  });
  it("o resumo soma o período e compara", () => {
    responder(200);
    render(<FaturamentoVivo inicial={inicial} />);
    const resumo = within(screen.getByTestId("faturamento-resumo"));
    expect(resumo.getByText("R$ 3.313,80")).toBeTruthy();
    expect(resumo.getByText("▲ +231,4%")).toBeTruthy();
    expect(resumo.getByText("R$ 1.000")).toBeTruthy();
    expect(resumo.getByText(/\+R\$ 2\.313,80 de diferença/)).toBeTruthy();
    expect(resumo.getByText("qua 04/11/2026")).toBeTruthy(); // o melhor dia
    expect(screen.getByText("período anterior · 28/10/2026 a 31/10/2026")).toBeTruthy();
  });
});

describe("trocar a comparação", () => {
  it("pede à porta com o período da tela e o tipo, e troca os números sem recarregar", async () => {
    const f = responder(200, anoPassado);
    render(<FaturamentoVivo inicial={inicial} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mesmo período do ano passado" }));
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("/api/dashboard/faturamento?de=2026-11-01&ate=2026-11-04&tipo=ano-passado");
    expect(screen.getByText("mesmo período do ano passado · 01/11/2025 a 04/11/2025")).toBeTruthy();
    const resumo = within(screen.getByTestId("faturamento-resumo"));
    expect(resumo.getByText("R$ 5.000")).toBeTruthy();
    expect(resumo.getByText("▼ −33,7%")).toBeTruthy();
    fireEvent.focus(screen.getByTestId("faturamento-grafico"));
    expect(balao()).toContain("ter 04/11/2025");
    expect(balao()).toContain("▼ −R$ 2.086,20");
    // a escolha fica no aparelho
    expect(JSON.parse(localStorage.getItem("dashboard:faturamento") ?? "{}").tipo).toBe("ano-passado");
  });
  it("outra data: só pede depois de uma data válida, e manda o cmpDe", async () => {
    const f = responder(200, anoPassado);
    render(<FaturamentoVivo inicial={inicial} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Outra data" }));
    });
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByText("· escolha a data de começo")).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Começo do período comparado"), { target: { value: "2026-10-01" } });
    });
    expect(String(f.mock.calls[0][0])).toBe("/api/dashboard/faturamento?de=2026-11-01&ate=2026-11-04&tipo=personalizado&cmpDe=2026-10-01");
    expect(screen.getByText(/até 04\/10\/2026/)).toBeTruthy();
  });
  it("a falha mantém a última comparação boa e diz o que foi (401 = sessão venceu)", async () => {
    responder(401);
    render(<FaturamentoVivo inicial={inicial} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mesmo período do ano passado" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("sua sessão venceu");
    expect(screen.getByText("período anterior · 28/10/2026 a 31/10/2026")).toBeTruthy();
    expect(within(screen.getByTestId("faturamento-resumo")).getByText("R$ 1.000")).toBeTruthy();
  });
  it("a página que troca de período leva a comparação escolhida junto", async () => {
    const f = responder(200, anoPassado);
    const { rerender } = render(<FaturamentoVivo inicial={inicial} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mesmo período do ano passado" }));
    });
    const outroPeriodo = { de: "2026-10-01", ate: "2026-10-31" };
    const novo = montarFaturamento({
      periodo: outroPeriodo,
      tipo: "anterior",
      comparacao: periodoDeComparacao("anterior", outroPeriodo),
      vendas: [],
      vendasComparadas: [],
    });
    await act(async () => {
      rerender(<FaturamentoVivo inicial={novo} />);
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1][0])).toBe("/api/dashboard/faturamento?de=2026-10-01&ate=2026-10-31&tipo=ano-passado");
  });
  it("a preferência guardada vale na abertura seguinte", async () => {
    localStorage.setItem("dashboard:faturamento", JSON.stringify({ tipo: "ano-passado", cmpDe: "", modo: "acumulado" }));
    const f = responder(200, anoPassado);
    await act(async () => {
      render(<FaturamentoVivo inicial={inicial} />);
    });
    expect(String(f.mock.calls[0][0])).toContain("tipo=ano-passado");
    expect(screen.getByRole("button", { name: "Acumulado" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("período longo e período gigante", () => {
  it("por semana: o título diz, e o balão diz de que dia a que dia o ponto soma nos dois períodos", () => {
    responder(200);
    const longo = { de: "2026-01-01", ate: "2026-04-10" }; // 100 dias → 15 semanas
    const dados = montarFaturamento({
      periodo: longo,
      tipo: "anterior",
      comparacao: periodoDeComparacao("anterior", longo),
      vendas: [{ paidAt: sp("2026-01-09"), netTotal: 70 }],
      vendasComparadas: [{ paidAt: sp("2025-10-01"), netTotal: 30 }],
    });
    render(<FaturamentoVivo inicial={dados} />);
    expect(screen.getByText("· por semana")).toBeTruthy();
    const grafico = screen.getByTestId("faturamento-grafico");
    fireEvent.focus(grafico);
    for (let i = 0; i < 13; i++) fireEvent.keyDown(grafico, { key: "ArrowLeft" });
    expect(balao()).toContain("08/01 a 14/01");
    expect(balao()).toContain("R$ 70");
    expect(balao()).toContain("30/09 a 06/10/2025");
    expect(balao()).toContain("R$ 30");
  });
  it("período acima do teto: a tela DIZ que mostra os primeiros 4 anos", () => {
    responder(200);
    const gigante = { de: "2020-01-01", ate: "2026-11-04" };
    const dados = montarFaturamento({ periodo: gigante, tipo: "anterior", comparacao: periodoDeComparacao("anterior", gigante), vendas: [], vendasComparadas: [] });
    render(<FaturamentoVivo inicial={dados} />);
    expect(screen.getByText("· mostrando os primeiros 4 anos do período")).toBeTruthy();
  });
  it("voltar ao período anterior reaproveita o que a página mandou, sem ir à porta", async () => {
    const f = responder(200, anoPassado);
    render(<FaturamentoVivo inicial={inicial} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mesmo período do ano passado" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByText("período anterior · 28/10/2026 a 31/10/2026")).toBeTruthy();
    expect(screen.queryByText("Atualizando…")).toBeNull();
  });
});

describe("o acumulado", () => {
  it("termina no total do período, nos dois lados", () => {
    responder(200);
    render(<FaturamentoVivo inicial={inicial} />);
    fireEvent.click(screen.getByRole("button", { name: "Acumulado" }));
    fireEvent.focus(screen.getByTestId("faturamento-grafico"));
    expect(balao()).toContain("até 04/11");
    expect(balao()).toContain("R$ 3.313,80");
    expect(balao()).toContain("3 pedidos");
    expect(balao()).toContain("R$ 1.000");
    expect(balao()).toContain("▲ +R$ 2.313,80");
  });
});
