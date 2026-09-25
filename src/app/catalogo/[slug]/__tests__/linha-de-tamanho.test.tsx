// @vitest-environment jsdom
// Guarda RN-067
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LinhaDeTamanho } from "../linha-de-tamanho";

/**
 * A LINHA DE TAMANHO, RENDERIZADA DE VERDADE (RN-067).
 *
 * A conta do teto é guardada por `catalogo-teto-do-estoque.test.ts` (função
 * pura). Aqui o teste faz o que a cliente da Entre Linhas fez: aperta o `+`
 * oito vezes numa peça com 1 — e o número tem que parar em 1. Guarda o
 * COMPORTAMENTO, não o trecho de código (lição do incidente de 28/08/2026).
 */

const cores = { line: "#ddd", soft: "#eee", primary: "#333" };

function Linha({ disponivel, inicial = 0 }: { disponivel: number; inicial?: number }) {
  const [qty, setQty] = useState(inicial);
  return <LinhaDeTamanho size="P" disponivel={disponivel} qty={qty} cores={cores} onChange={setQty} />;
}

const mais = () => screen.getByRole("button", { name: "Mais um P" });
const menos = () => screen.getByRole("button", { name: "Menos um P" });
const quantidade = () => screen.getByLabelText("Quantidade P").textContent;

afterEach(cleanup);

describe("RN-067 · a quantidade PARA no estoque disponível", () => {
  it("peça com 1: oito toques no + deixam 1, o + trava e a linha diz por quê", () => {
    render(<Linha disponivel={1} />);
    expect(screen.getByText("só 1 disponível")).toBeTruthy();
    for (let i = 0; i < 8; i++) fireEvent.click(mais());
    expect(quantidade()).toBe("1");
    expect((mais() as HTMLButtonElement).disabled).toBe(true);
  });

  it("peça com bastante estoque sobe livre e só avisa ao encostar no teto", () => {
    render(<Linha disponivel={12} />);
    expect(screen.queryByText(/disponíve/)).toBeNull();
    for (let i = 0; i < 5; i++) fireEvent.click(mais());
    expect(quantidade()).toBe("5");
    expect(screen.queryByText(/disponíve/)).toBeNull();
    for (let i = 0; i < 20; i++) fireEvent.click(mais());
    expect(quantidade()).toBe("12");
    expect(screen.getByText("só 12 disponíveis")).toBeTruthy();
  });

  it("esgotado: rótulo 'esgotado', nenhum botão responde", () => {
    render(<Linha disponivel={0} />);
    expect(screen.getByText("esgotado")).toBeTruthy();
    expect((mais() as HTMLButtonElement).disabled).toBe(true);
    expect((menos() as HTMLButtonElement).disabled).toBe(true);
  });

  it("a grade que abre com mais do que há hoje (sacola antiga) já mostra o + travado e o − funciona", () => {
    // quem abre a folha já passa a quantidade pelo teto; mesmo que não
    // passasse, a linha não deixa SUBIR além do disponível
    render(<Linha disponivel={2} inicial={2} />);
    expect((mais() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(menos());
    expect(quantidade()).toBe("1");
    expect((mais() as HTMLButtonElement).disabled).toBe(false);
  });

  it("o − não desce de zero", () => {
    render(<Linha disponivel={3} />);
    expect((menos() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(menos());
    expect(quantidade()).toBe("0");
  });
});
