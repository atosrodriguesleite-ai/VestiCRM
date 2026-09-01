import { describe, it, expect } from "vitest";
import { classificarBusca } from "../busca-de-pedidos";

// A busca da tela Pedidos entende sozinha o que foi digitado: número curto é
// código de pedido, número comprido é telefone, texto é nome. A vendedora
// não deveria precisar saber a diferença — e errar aqui manda a busca para o
// lugar errado em silêncio.

describe("busca inteligente de pedidos — o que foi digitado?", () => {
  it("número curto é código de pedido (#0042, 0042, 42)", () => {
    expect(classificarBusca("42")).toEqual({ tipo: "codigo", numero: 42 });
    expect(classificarBusca("0042")).toEqual({ tipo: "codigo", numero: 42 });
    expect(classificarBusca("#0042")).toEqual({ tipo: "codigo", numero: 42 });
    expect(classificarBusca(" #42 ")).toEqual({ tipo: "codigo", numero: 42 });
    // até 6 dígitos ainda é código (loja grande numera longe)
    expect(classificarBusca("123456")).toEqual({ tipo: "codigo", numero: 123456 });
  });

  it("número comprido é telefone, mesmo decorado ((82) 99999-1234, +55…)", () => {
    expect(classificarBusca("82999991234")).toEqual({ tipo: "telefone", digitos: "82999991234" });
    expect(classificarBusca("(82) 99999-1234")).toEqual({ tipo: "telefone", digitos: "82999991234" });
    expect(classificarBusca("+55 82 99999-1234")).toEqual({ tipo: "telefone", digitos: "5582999991234" });
    // 7+ dígitos só existe como telefone (o fim do número, sem DDD)
    expect(classificarBusca("9999-1234")).toEqual({ tipo: "telefone", digitos: "99991234" });
  });

  it("texto é nome — inclusive nome com número no meio", () => {
    expect(classificarBusca("Maria")).toEqual({ tipo: "nome", texto: "Maria" });
    expect(classificarBusca("maria silva")).toEqual({ tipo: "nome", texto: "maria silva" });
    // letra no meio tira a busca do mundo dos números
    expect(classificarBusca("Loja 21")).toEqual({ tipo: "nome", texto: "Loja 21" });
  });

  it("o # força código, como sempre foi", () => {
    expect(classificarBusca("#123456")).toEqual({ tipo: "codigo", numero: 123456 });
  });

  it("código inválido vira número impossível (a lista sai vazia, nunca inteira nem erro)", () => {
    expect(classificarBusca("#")).toEqual({ tipo: "codigo", numero: -1 });
    expect(classificarBusca("0")).toEqual({ tipo: "codigo", numero: -1 });
    // "#" com telefone colado: acima do teto do INT4 a consulta ESTOURAVA a
    // tela inteira — número impossível devolve "nenhum pedido", nunca erro
    expect(classificarBusca("#82999991234")).toEqual({ tipo: "codigo", numero: -1 });
    expect(classificarBusca("#2147483648")).toEqual({ tipo: "codigo", numero: -1 });
    expect(classificarBusca("#2147483647")).toEqual({ tipo: "codigo", numero: 2147483647 });
  });
});
