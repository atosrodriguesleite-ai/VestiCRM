import { describe, it, expect } from "vitest";
import {
  lerDinheiro,
  lerMensagemDePedido,
  lerTamanhos,
  pecasLidas,
  separarProdutoECor,
} from "../catalogo/ler-mensagem";

/**
 * A vendedora cola a mensagem do WhatsApp e o pedido se monta sozinho.
 * É a rede de segurança da venda que só existe na conversa — caso real:
 * pedido de 31 peças da LOJA DA GABI que nunca chegou no sistema.
 */

const MENSAGEM = `*Novo pedido — Entre Linhas*

*Calças*
• Calça Wide Leg Jeans Azul — P ×2, M ×1  (3 peças · R$ 509,70)
• Calça Pantalona Off White — G ×4  (4 peças · R$ 639,60)

*Blusas*
• Cropped Básico Comfy Preto — P ×1, M ×2, G ×1  (4 peças · R$ 199,60)

*Total:* 11 peças · R$ 1.348,90

*Cliente*
Loja: LOJA DA GABI
Nome: Gabriela Cabral Silva
Telefone: 31997441595

_Valores sujeitos a confirmação._`;

describe("lendo a mensagem que a cliente mandou", () => {
  const lido = lerMensagemDePedido(MENSAGEM);

  it("sabe de qual loja é o pedido", () => {
    expect(lido.loja).toBe("Entre Linhas");
  });

  it("pega os dados da cliente (é por eles que achamos o cadastro)", () => {
    expect(lido.cliente.nome).toBe("Gabriela Cabral Silva");
    expect(lido.cliente.loja).toBe("LOJA DA GABI");
    expect(lido.cliente.telefone).toBe("31997441595");
  });

  it("lê todas as peças, com tamanho e quantidade", () => {
    expect(lido.itens).toHaveLength(3);
    expect(lido.itens[0]).toMatchObject({
      descricao: "Calça Wide Leg Jeans Azul",
      tamanhos: [
        { tamanho: "P", quantidade: 2 },
        { tamanho: "M", quantidade: 1 },
      ],
      pecas: 3,
    });
    expect(lido.itens[2].tamanhos).toHaveLength(3);
  });

  it("a conta bate com o total que a mensagem declarou", () => {
    expect(pecasLidas(lido)).toBe(11);
    expect(lido.totalPecas).toBe(11);
    expect(lido.totalValor).toBe(1348.9);
  });

  it("o texto de rodapé não vira item", () => {
    expect(lido.itens.some((i) => /valores sujeitos/i.test(i.descricao))).toBe(false);
  });
});

describe("mensagem colada torta (é WhatsApp, vem de tudo quanto é jeito)", () => {
  it("sem os asteriscos do negrito", () => {
    const lido = lerMensagemDePedido(
      "Novo pedido — Entre Linhas\n\nBlusas\n• Cropped Comfy Preto — P ×2  (2 peças · R$ 99,80)\nTotal: 2 peças · R$ 99,80"
    );
    expect(lido.itens).toHaveLength(1);
    expect(lido.totalPecas).toBe(2);
  });

  it("com hífen no lugar do travessão e 'x' no lugar de '×'", () => {
    const lido = lerMensagemDePedido("- Cropped Comfy Preto - P x2, M x1");
    expect(lido.itens[0].tamanhos).toEqual([
      { tamanho: "P", quantidade: 2 },
      { tamanho: "M", quantidade: 1 },
    ]);
  });

  it("sem o parêntese de conferência no fim", () => {
    const lido = lerMensagemDePedido("• Vestido Midi Aurora Rosa — M ×3");
    expect(lido.itens[0]).toMatchObject({ descricao: "Vestido Midi Aurora Rosa", pecas: null });
    expect(pecasLidas(lido)).toBe(3);
  });

  it("tamanho numérico e 'Único' também são lidos", () => {
    expect(lerTamanhos("38 ×2, 40 ×1")).toEqual([
      { tamanho: "38", quantidade: 2 },
      { tamanho: "40", quantidade: 1 },
    ]);
    expect(lerTamanhos("Único ×5")).toEqual([{ tamanho: "Único", quantidade: 5 }]);
  });

  it("texto que não é pedido não inventa item", () => {
    const lido = lerMensagemDePedido("Oi, tudo bem? Queria saber do vestido rosa");
    expect(lido.itens).toEqual([]);
    expect(lido.cliente.telefone).toBeNull();
  });

  it("texto vazio ou lixo não quebra", () => {
    expect(lerMensagemDePedido("").itens).toEqual([]);
    expect(lerMensagemDePedido("\n\n   \n").itens).toEqual([]);
  });

  it("telefone com máscara vira só dígitos", () => {
    const lido = lerMensagemDePedido("Telefone: (31) 99744-1595");
    expect(lido.cliente.telefone).toBe("31997441595");
  });
});

describe("dinheiro no formato brasileiro", () => {
  it("lê milhar e centavos sem errar a vírgula", () => {
    expect(lerDinheiro("R$ 1.348,90")).toBe(1348.9);
    expect(lerDinheiro("R$ 49,90")).toBe(49.9);
    expect(lerDinheiro("R$ 12.345")).toBe(12345);
    expect(lerDinheiro("R$ 7")).toBe(7);
  });
});

describe("descobrir qual produto é cada linha", () => {
  const catalogo = [
    { id: "p1", name: "Calça Wide" },
    { id: "p2", name: "Calça Wide Leg Jeans" },
    { id: "p3", name: "Cropped Básico Comfy" },
    { id: "p4", name: "Vestido Midi Aurora" },
  ];

  it("separa o nome do produto da cor", () => {
    expect(separarProdutoECor("Cropped Básico Comfy Preto", catalogo)).toEqual({
      produto: catalogo[2],
      cor: "Preto",
    });
  });

  it("cor de duas palavras continua inteira", () => {
    expect(separarProdutoECor("Vestido Midi Aurora Off White", catalogo)?.cor).toBe(
      "Off White"
    );
  });

  it("ganha o nome MAIS LONGO (senão a cor sai errada)", () => {
    const r = separarProdutoECor("Calça Wide Leg Jeans Azul", catalogo);
    expect(r?.produto.id).toBe("p2");
    expect(r?.cor).toBe("Azul"); // e não "Leg Jeans Azul"
  });

  it("acento e caixa não atrapalham (cliente digita de qualquer jeito)", () => {
    const r = separarProdutoECor("CALCA BASICA COMFY Preto", [
      { id: "x", name: "Calça Básica Comfy" },
    ]);
    expect(r?.produto.id).toBe("x");
    expect(r?.cor).toBe("Preto");
  });

  it("produto que não existe no catálogo não é chutado", () => {
    expect(separarProdutoECor("Jaqueta Corta Vento Verde", catalogo)).toBeNull();
  });

  it("produto sem cor no texto ainda é reconhecido", () => {
    expect(separarProdutoECor("Vestido Midi Aurora", catalogo)).toEqual({
      produto: catalogo[3],
      cor: "",
    });
  });
});
