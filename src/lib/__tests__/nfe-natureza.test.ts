// Guarda RN-054
import { describe, it, expect } from "vitest";
import {
  explicarNatureza,
  naturezaDaNota,
  tipoDaCompradora,
} from "../nfe-natureza";

/**
 * RN-054 · A natureza de operação da nota segue o DOCUMENTO de quem compra.
 *
 * O que está em jogo não é tela: é documento fiscal. Natureza errada na nota
 * é a loja respondendo perante o fisco — então a régua tem que ser explícita,
 * conservadora na dúvida, e invisível para quem não configurou nada.
 */

const NATUREZAS = {
  contribuinte: "Venda de mercadoria",
  naoContribuinte: "Venda de mercadoria a não contribuinte",
};

describe("quem é contribuinte", () => {
  it("CNPJ COM inscrição estadual é contribuinte", () => {
    expect(
      tipoDaCompradora({ cnpj: "11.222.333/0001-81", stateRegistration: "123456789" })
    ).toBe("CONTRIBUINTE");
  });

  it("CNPJ SEM inscrição estadual NÃO é contribuinte (existe CNPJ isento)", () => {
    expect(tipoDaCompradora({ cnpj: "11.222.333/0001-81" })).toBe("NAO_CONTRIBUINTE");
    expect(
      tipoDaCompradora({ cnpj: "11.222.333/0001-81", stateRegistration: "  " })
    ).toBe("NAO_CONTRIBUINTE");
  });

  it("a lojista que compra no CPF é consumidora final — é a maioria da clientela", () => {
    expect(tipoDaCompradora({ cpf: "123.456.789-09" })).toBe("NAO_CONTRIBUINTE");
  });

  it("ficha sem documento nenhum cai no caso conservador", () => {
    expect(tipoDaCompradora({})).toBe("NAO_CONTRIBUINTE");
    expect(tipoDaCompradora({ cpf: null, cnpj: null })).toBe("NAO_CONTRIBUINTE");
  });

  it("IE só vale com CNPJ: inscrição solta numa ficha de CPF não vira contribuinte", () => {
    expect(tipoDaCompradora({ cpf: "12345678909", stateRegistration: "123456" })).toBe(
      "NAO_CONTRIBUINTE"
    );
  });
});

describe("a natureza escolhida", () => {
  it("contribuinte leva a natureza de contribuinte", () => {
    expect(
      naturezaDaNota({ cnpj: "11222333000181", stateRegistration: "123" }, NATUREZAS)
    ).toBe("Venda de mercadoria");
  });

  it("consumidora final leva a de não contribuinte", () => {
    expect(naturezaDaNota({ cpf: "12345678909" }, NATUREZAS)).toBe(
      "Venda de mercadoria a não contribuinte"
    );
  });

  it("LOJA QUE NÃO CONFIGUROU NADA não muda em nada: nenhum campo vai na nota", () => {
    expect(naturezaDaNota({ cpf: "12345678909" }, {})).toBeNull();
    expect(
      naturezaDaNota({ cnpj: "11222333000181", stateRegistration: "1" }, {})
    ).toBeNull();
  });

  it("configurou só um lado: o outro continua saindo pela padrão do Bling", () => {
    const so = { naoContribuinte: "Venda de mercadoria a não contribuinte" };
    expect(naturezaDaNota({ cpf: "12345678909" }, so)).toBe(
      "Venda de mercadoria a não contribuinte"
    );
    expect(
      naturezaDaNota({ cnpj: "11222333000181", stateRegistration: "1" }, so)
    ).toBeNull();
  });

  it("espaço em branco não é natureza (campo digitado e apagado)", () => {
    expect(naturezaDaNota({ cpf: "12345678909" }, { naoContribuinte: "   " })).toBeNull();
  });
});

describe("a tela DIZ antes de emitir — nota não se desfaz com um clique", () => {
  it("diz a natureza e o porquê, para a loja conferir", () => {
    const frase = explicarNatureza(
      { cnpj: "11222333000181", stateRegistration: "123" },
      NATUREZAS
    );
    expect(frase).toContain("Venda de mercadoria");
    expect(frase).toContain("inscrição estadual");
  });

  it("separa CNPJ sem IE de CPF na explicação (são motivos diferentes)", () => {
    expect(explicarNatureza({ cnpj: "11222333000181" }, NATUREZAS)).toContain(
      "sem inscrição estadual"
    );
    expect(explicarNatureza({ cpf: "12345678909" }, NATUREZAS)).toContain("CPF");
  });

  it("sem configuração, avisa que vale a padrão do Bling e diz onde configurar", () => {
    const frase = explicarNatureza({ cpf: "12345678909" }, {});
    expect(frase).toContain("PADRÃO");
    expect(frase).toContain("Configurações");
  });
});
