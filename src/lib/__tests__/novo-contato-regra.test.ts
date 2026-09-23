import { describe, it, expect } from "vitest";
import {
  digitosDoTelefone,
  precisaConfirmarFicha,
  telefoneCompleto,
} from "../comm/novo-contato-regra";

// Régua da janela "Novo contato" da Central (a entrada em si é guardada
// pelo portão único de leads — RN-008, `intake.test.ts`).

describe("Novo contato — telefone completo antes de ir ao servidor", () => {
  it("aceita DDD + número (10/11) e o formato com DDI 55 (12/13)", () => {
    expect(telefoneCompleto(digitosDoTelefone("(82) 98877-1122"))).toBe(true);
    expect(telefoneCompleto(digitosDoTelefone("(82) 8877-1122"))).toBe(true);
    expect(telefoneCompleto("5582988771122")).toBe(true);
    expect(telefoneCompleto("558288771122")).toBe(true);
  });

  it("barra o obviamente torto: curto, comprido e 12 dígitos sem o 55", () => {
    expect(telefoneCompleto("8298")).toBe(false);
    expect(telefoneCompleto("829887711223344")).toBe(false);
    // 12 dígitos que não começam com 55 são dedo errado, não país novo
    expect(telefoneCompleto("829888771122")).toBe(false);
    expect(telefoneCompleto("")).toBe(false);
  });
});

describe("Novo contato — quando o dedup pede confirmação", () => {
  it("ficha existente com OUTRO nome pede confirmação (abrir calado parece defeito)", () => {
    expect(precisaConfirmarFicha(true, "Maria Silva", "Ana Souza")).toBe(true);
  });

  it("mesmo nome (com caixa/espaço diferentes) abre direto", () => {
    expect(precisaConfirmarFicha(true, "Maria Silva", "  maria silva ")).toBe(false);
  });

  it("só com o NÚMERO (nome em branco) abre direto: não há nome para divergir", () => {
    // a vendedora às vezes tem só o telefone — a ficha existente é de quem é
    // dono daquele número, e perguntar "é a Maria?" não ajudaria em nada
    expect(precisaConfirmarFicha(true, "Maria Silva", "")).toBe(false);
    expect(precisaConfirmarFicha(true, "Maria Silva", "   ")).toBe(false);
  });

  it("cadastro novo nunca pede confirmação; ficha sem nome também não", () => {
    expect(precisaConfirmarFicha(false, "Maria Silva", "Ana")).toBe(false);
    expect(precisaConfirmarFicha(true, "", "Ana")).toBe(false);
    expect(precisaConfirmarFicha(true, null, "Ana")).toBe(false);
  });
});
