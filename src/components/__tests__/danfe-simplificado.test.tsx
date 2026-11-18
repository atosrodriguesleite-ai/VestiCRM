// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { DanfeSimplificado } from "@/components/pedido/danfe-simplificado";

/**
 * OS BOTÕES DO DANFE SIMPLIFICADO (RN-111) — o COMPORTAMENTO: a versão para a
 * impressora de etiqueta é um BOTÃO com o nome do papel, não um link miúdo.
 * Relato do dono (18/11/2026): o botão grande abria o A4, ele mandou o A4
 * para a Zebra e o DANFE saiu cortado.
 */

afterEach(cleanup);

describe("os dois papéis do DANFE simplificado", () => {
  it("cada papel é um botão com o NOME dele, levando ao formato certo", () => {
    render(<DanfeSimplificado orderId="ped1" />);
    const etiqueta = screen.getByRole("link", { name: /etiqueta 10 × 15 cm/ });
    const a4 = screen.getByRole("link", { name: /folha A4/ });
    expect(etiqueta.getAttribute("href")).toBe("/danfe-simplificado/ped1?formato=etiqueta");
    expect(a4.getAttribute("href")).toBe("/danfe-simplificado/ped1?formato=a4");
    // nenhum botão sem dizer o papel (era o "DANFE simplificado" que abria o A4)
    for (const link of screen.getAllByRole("link"))
      expect(link.textContent).toMatch(/10 × 15 cm|A4/);
  });
  it("os dois têm o mesmo peso na tela — a etiqueta não é um link miúdo", () => {
    render(<DanfeSimplificado orderId="ped1" />);
    const [um, dois] = screen.getAllByRole("link");
    expect(um.className).toBe(dois.className);
  });
  it("a chave da etiqueta viaja nos dois (a porta recusa a nota trocada)", () => {
    render(<DanfeSimplificado orderId="ped1" chaveDaEtiqueta="35261100000000000000550010000000951000000950" />);
    for (const link of screen.getAllByRole("link"))
      expect(link.getAttribute("href")).toContain("chave=35261100000000000000550010000000951000000950");
  });
  it("a tela diz como imprimir na impressora de etiqueta: tamanho real", () => {
    render(<DanfeSimplificado orderId="ped1" />);
    expect(screen.getByText(/escala\s+100%/)).toBeTruthy();
  });
});
