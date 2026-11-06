// @vitest-environment jsdom
// Guarda RN-109
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ResaleCatalog } from "@/app/(app)/pedidos/[id]/resale-catalog";

/**
 * A JANELA DO CATÁLOGO DE REVENDA POR CATEGORIA (RN-109) — o comportamento:
 * cada categoria do pedido tem a linha dela com o que a revendedora pagou e
 * o preço que vai sair; margem própria e preço fixo entram no endereço do PDF
 * (só as categorias deste pedido); o preço fixo abaixo do custo avisa em
 * vermelho; a regra lembrada na ficha abre preenchida.
 */

vi.mock("@/components/portal", () => ({ Portal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

afterEach(cleanup);

// três linhas de regata (uma ×2 = 3 peças), um vestido
const pecas = [
  { categoria: "Regatas", pago: 32, quantidade: 2 },
  { categoria: "Regatas", pago: 45, quantidade: 1 },
  { categoria: "Vestidos", pago: 60, quantidade: 1 },
];

function abrir(props: Partial<Parameters<typeof ResaleCatalog>[0]> = {}) {
  render(
    <ResaleCatalog
      orderId="o1"
      customerName="Mayara Santos"
      savedMarkup={100}
      savedRound={false}
      savedStoreName={null}
      pecas={pecas}
      {...props}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Catálogo de revenda/ }));
}
const href = () => decodeURIComponent(screen.getByRole("link", { name: /Gerar PDF/ }).getAttribute("href") ?? "");

describe("as linhas por categoria", () => {
  it("lista cada categoria com o que pagou e o preço pela margem geral", () => {
    abrir();
    const bloco = screen.getByTestId("revenda-categorias");
    expect(bloco.textContent).toContain("Regatas");
    expect(bloco.textContent).toContain("3 peças · pagou R$ 32,00 a R$ 45,00");
    expect(bloco.textContent).toContain("Sai a R$ 64,00 a R$ 90,00 (margem geral)");
    expect(bloco.textContent).toContain("1 peça · pagou R$ 60,00");
    expect(href()).not.toContain("cats=");
  });
  it("margem própria e preço fixo mudam a prévia e vão no endereço — só as categorias com regra", () => {
    abrir();
    fireEvent.change(screen.getByLabelText("Regra de Regatas"), { target: { value: "margem" } });
    fireEvent.change(screen.getByLabelText("Margem de Regatas"), { target: { value: "50" } });
    expect(screen.getByTestId("revenda-categorias").textContent).toContain("Sai a R$ 48,00 a R$ 67,50");
    fireEvent.change(screen.getByLabelText("Regra de Vestidos"), { target: { value: "fixo" } });
    fireEvent.change(screen.getByLabelText("Preço fixo de Vestidos"), { target: { value: "99,90" } });
    expect(screen.getByTestId("revenda-categorias").textContent).toContain("Sai a R$ 99,90");
    expect(href()).toContain('cats={"Regatas":{"tipo":"margem","valor":50},"Vestidos":{"tipo":"fixo","valor":99.9}}');
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("preço fixo abaixo do custo avisa em vermelho; margem fina avisa em amarelo", () => {
    abrir();
    fireEvent.change(screen.getByLabelText("Regra de Regatas"), { target: { value: "fixo" } });
    fireEvent.change(screen.getByLabelText("Preço fixo de Regatas"), { target: { value: "40" } });
    expect(screen.getByRole("alert").textContent).toContain("1 peça custou esse valor ou mais");
    fireEvent.change(screen.getByLabelText("Preço fixo de Regatas"), { target: { value: "49,90" } });
    expect(screen.getByRole("alert").textContent).toContain("Margem de só 11% na peça mais cara (R$ 45,00)");
    fireEvent.change(screen.getByLabelText("Preço fixo de Regatas"), { target: { value: "59,90" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("o campo vazio e o preço fixo zero não viram regra; trocar o modo apaga o número; 1.299,90 é mil e tanto", () => {
    abrir();
    fireEvent.change(screen.getByLabelText("Regra de Regatas"), { target: { value: "fixo" } });
    expect(href()).not.toContain("cats=");
    fireEvent.change(screen.getByLabelText("Preço fixo de Regatas"), { target: { value: "0" } });
    expect(href()).not.toContain("cats=");
    expect(screen.getByRole("alert").textContent).toContain("maior que zero");
    fireEvent.change(screen.getByLabelText("Preço fixo de Regatas"), { target: { value: "1.299,90" } });
    expect(href()).toContain('"valor":1299.9');
    fireEvent.change(screen.getByLabelText("Regra de Regatas"), { target: { value: "margem" } });
    expect((screen.getByLabelText("Margem de Regatas") as HTMLInputElement).value).toBe("");
    expect(href()).not.toContain("cats=");
  });
  it("a margem geral lembrada de 0% abre como 0, não como 100", () => {
    abrir({ savedMarkup: 0, savedCategorias: { Regatas: { tipo: "fixo", valor: 59.9 } } });
    expect(screen.getByDisplayValue("0")).toBeTruthy();
    expect(href()).toContain("markup=0");
  });
  it("regra lembrada de categoria que NÃO está no pedido não liga o preço", () => {
    abrir({ savedMarkup: 0, savedCategorias: { Conjuntos: { tipo: "fixo", valor: 89.9 } } });
    expect(href()).toContain("preco=nao");
  });
  it("a regra lembrada na ficha abre preenchida, e liga o preço mesmo sem margem geral salva", () => {
    abrir({ savedMarkup: 0, savedCategorias: { Vestidos: { tipo: "fixo", valor: 99.9 } } });
    expect((screen.getByLabelText("Regra de Vestidos") as HTMLSelectElement).value).toBe("fixo");
    expect((screen.getByLabelText("Preço fixo de Vestidos") as HTMLInputElement).value).toBe("99.9");
    expect(href()).toContain('cats={"Vestidos":{"tipo":"fixo","valor":99.9}}');
  });
  it("sem preço, as linhas somem e nada de categoria vai no endereço", () => {
    abrir({ savedCategorias: { Regatas: { tipo: "margem", valor: 50 } } });
    fireEvent.click(screen.getByRole("radio", { name: /Sem preço/ }));
    expect(screen.queryByTestId("revenda-categorias")).toBeNull();
    expect(href()).toContain("preco=nao");
    expect(href()).not.toContain("cats=");
  });
});
