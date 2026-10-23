// @vitest-environment jsdom
// Guarda RN-092
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CalendarioView } from "../calendario-view";
import { montarOcorrencias, intervaloDaTela, SEGMENTOS } from "@/lib/calendario/datas";

/**
 * A TELA DO CALENDÁRIO, RENDERIZADA DE VERDADE (RN-092): a data que entrou na
 * antecedência aparece em "É hora de começar", o filtro troca a lista e a
 * ficha diz quando começar. Guarda o comportamento, não o texto do código.
 */
const hoje = "2026-10-23";
const { de, ate } = intervaloDaTela(hoje);

function tela(antecedenciaDias = 45, segmentosDaLoja: string[] = []) {
  const ocorrencias = montarOcorrencias({ de, ate, segmentos: segmentosDaLoja, ocultas: [], eventos: [] });
  return render(
    <CalendarioView
      hoje={hoje}
      antecedenciaDias={antecedenciaDias}
      segmentosDaLoja={segmentosDaLoja}
      ocultas={[]}
      ocorrencias={ocorrencias}
      segmentos={SEGMENTOS.map((s) => ({ chave: s.chave, nome: s.nome, datas: s.datas.map((d) => d.titulo) }))}
    />
  );
}

afterEach(cleanup);

describe("RN-092 · a tela do calendário", () => {
  it("a Black Friday entrou nos 45 dias e aparece em \"É hora de começar\"; o Natal ainda não", () => {
    tela(45, ["praia"]);
    const bloco = screen.getByText("É hora de começar").closest("div")!;
    expect(bloco.textContent).toContain("Black Friday");
    expect(bloco.textContent).not.toContain("Natal");
  });

  it("com 70 dias de antecedência o Natal também já é hora de começar", () => {
    tela(70, ["praia"]);
    const bloco = screen.getByText("É hora de começar").closest("div")!;
    expect(bloco.textContent).toContain("Natal");
  });

  it("o filtro Lançamentos sem nenhum lançamento diz como criar", () => {
    tela(45, ["praia"]);
    fireEvent.click(screen.getByRole("button", { name: /Lançamentos/ }));
    expect(screen.getByText("Nenhuma data neste filtro")).toBeTruthy();
  });

  it("abrir a data mostra quando começar, pela antecedência da loja", () => {
    tela(45, ["praia"]);
    fireEvent.click(screen.getAllByRole("button", { name: /Dia das Mães/ })[0]);
    // 09/05/2027 − 45 dias = 25/03/2027
    expect(screen.getByText(/Começar 45 dias antes — em 25\/03/)).toBeTruthy();
  });
});
