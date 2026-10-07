import { describe, it, expect } from "vitest";
import { mensagemDeRecuperacao } from "../recuperar-venda";

/** Recuperar a venda perdida (pedido do dono, 07/10/2026): a mensagem que vai pronta para o campo da Central. */
describe("mensagemDeRecuperacao", () => {
  it("primeiro nome, número do pedido, quantidade e modelos sem repetição", () => {
    const m = mensagemDeRecuperacao({
      nomeDaCliente: "Nátaly Makohin",
      numero: "#0173",
      totalDePecas: 62,
      pecas: ["Regata Alça", "Regata Alça", "Regata Alça"],
    });
    expect(m).toContain("Oi, Nátaly!");
    expect(m).toContain("#0173 (62 peças — Regata Alça)");
    expect(m).toContain("Ainda tem interesse?");
  });

  it("uma peça no singular; sem peças carregadas não inventa parêntese vazio", () => {
    expect(mensagemDeRecuperacao({ nomeDaCliente: "Juh", numero: "#0156", totalDePecas: 1, pecas: ["Top"] })).toContain("(1 peça — Top)");
    expect(mensagemDeRecuperacao({ nomeDaCliente: "Juh", numero: "#0156", totalDePecas: 0, pecas: [] })).not.toContain("(");
  });

  it("nome em branco não quebra a frase", () => {
    expect(mensagemDeRecuperacao({ nomeDaCliente: "  ", numero: "#1", totalDePecas: 2, pecas: [] })).toContain("Oi, tudo bem!");
  });
});
