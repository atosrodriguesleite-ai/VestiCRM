// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ValoresEditor } from "../valores-editor";
import { brl } from "@/lib/format";

/**
 * A CAIXINHA DE FRETE GRÁTIS NA FICHA (RN-098), renderizada de verdade: marcar
 * zera o frete da prévia e mostra "Frete · GRÁTIS"; desmarcar DEVOLVE o número
 * digitado (apagar ao marcar fazia um toque errado sumir com R$ 25 de frete,
 * sem marca e sem rastro — achado da revisão); e o que vai para o servidor é
 * frete 0 + a marca. A venda da loja online não vê a caixinha.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function abrir(props: Partial<Parameters<typeof ValoresEditor>[0]> = {}) {
  render(
    <ValoresEditor
      orderId="ped1"
      subtotal={100}
      discount={0}
      discountPct={null}
      surcharge={0}
      surchargePct={null}
      shippingFee={0}
      podeEditar
      {...props}
    />
  );
  fireEvent.click(screen.getByText("Desconto, acréscimo e frete"));
}

// o campo do frete é o que vem logo depois do rótulo "Frete" (desconto e
// acréscimo também têm placeholder "0")
const campoDoFrete = () =>
  screen.getByText("Frete", { selector: "label" }).parentElement!.querySelector("input") as HTMLInputElement;
const caixinha = () => screen.getByLabelText(/Frete grátis/) as HTMLInputElement;

describe("frete grátis na ficha do pedido (RN-098)", () => {
  it("marcar zera o frete na prévia e mostra GRÁTIS; desmarcar devolve o número digitado", () => {
    abrir();
    fireEvent.change(campoDoFrete(), { target: { value: "25" } });
    expect(screen.getByText("Total a pagar").nextSibling?.textContent).toBe(brl(125));

    fireEvent.click(caixinha());
    expect(caixinha().checked).toBe(true);
    expect(campoDoFrete().disabled).toBe(true);
    expect(campoDoFrete().value).toBe("");
    expect(screen.getByText("GRÁTIS")).toBeTruthy();
    expect(screen.getByText("Total a pagar").nextSibling?.textContent).toBe(brl(100));

    fireEvent.click(caixinha());
    expect(caixinha().checked).toBe(false);
    expect(campoDoFrete().value).toBe("25");
    expect(screen.queryByText("GRÁTIS")).toBeNull();
    expect(screen.getByText("Total a pagar").nextSibling?.textContent).toBe(brl(125));
  });

  it("salvar manda frete 0 e a marca para a porta do pedido", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    abrir({ shippingFee: 30 });
    fireEvent.click(caixinha());
    fireEvent.click(screen.getByText("Salvar valores"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const corpo = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(corpo.shippingFee).toBe(0);
    expect(corpo.freteGratis).toBe(true);
  });

  it("pedido já marcado abre com a caixinha ligada e o campo apagado", () => {
    abrir({ freteGratis: true });
    expect(caixinha().checked).toBe(true);
    expect(campoDoFrete().disabled).toBe(true);
  });

  it("venda da loja online não tem a caixinha (o frete é o de lá)", () => {
    abrir({ vendaOnline: true });
    expect(screen.queryByLabelText(/Frete grátis/)).toBeNull();
  });
});
