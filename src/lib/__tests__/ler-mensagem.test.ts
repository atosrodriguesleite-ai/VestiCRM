import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  candidatosDeCor,
  desachatarMensagem,
  lerDinheiro,
  lerMensagemDePedido,
  lerTamanhos,
  partirItem,
  pecasLidas,
  separarProdutoECor,
} from "../catalogo/ler-mensagem";

// Guarda RN-012 (índice em docs/regras.md; texto no CLAUDE.md).

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

/**
 * MENSAGEM REAL DA ENTRE LINHAS (pedido de 31 peças da LOJA DA GABI).
 *
 * Foi ela que mostrou dois furos na primeira versão:
 *  • o marquinho da lista era "*", e tirar o negrito antes de olhar a linha
 *    apagava o marcador junto — nenhum item era reconhecido;
 *  • o nome do produto já traz a cor ("Blusa Clássica Tule — Baunilha"), e
 *    cortar no PRIMEIRO travessão perdia metade do nome.
 */
const ENTRE_LINHAS = `Novo pedido — Entre Linhas

Blusa Clássica Tule
* Blusa Clássica Tule — Baunilha Baunilha — Único ×1 (1 peça · R$ 21,50)
* Blusa Clássica Tule — Blush Blush — Único ×2 (2 peças · R$ 43,00)
* Blusa Clássica Tule — Branco Branco — Único ×1 (1 peça · R$ 21,50)
* Blusa Clássica Tule — Branco Verde Musgo — Único ×1 (1 peça · R$ 21,50)
* Blusa Clássica Tule — Prata Prata — Único ×1 (1 peça · R$ 21,50)
* Blusa Clássica Tule — Preto Preto — Único ×1 (1 peça · R$ 21,50)

Camiseta Comfort
* Camiseta Comfort — Azul Marinho Azul marinho — M ×1, G ×1, GG ×1 (3 peças · R$ 104,70)
* Camiseta Comfort — Branco Branco — M ×2 (2 peças · R$ 69,80)
* Camiseta Comfort — Goiaba Goiaba — P ×1, M ×1, G ×1, GG ×1 (4 peças · R$ 139,60)

Cropped Tule
* Cropped Tule — Azul marinho Azul marinho — Único ×1 (1 peça · R$ 19,90)
* Cropped Tule — Blush Blush — Único ×1 (1 peça · R$ 19,90)
* Cropped Tule — Chiclete Chiclete — Único ×1 (1 peça · R$ 19,90)
* Cropped Tule — Off White Off White — Único ×1 (1 peça · R$ 19,90)
* Cropped Tule — Oliva Oliva — Único ×1 (1 peça · R$ 19,90)
* Cropped Tule — Preto Preto — Único ×1 (1 peça · R$ 19,90)
* Cropped Tule — Rosa queimado Rosa queimado — Único ×1 (1 peça · R$ 19,90)

Regata Cropped Poliamida
* Regata Cropped Poliamida — Amorinha Amorinha — GG ×1 (1 peça · R$ 27,90)
* Regata Cropped Poliamida — Militar Militar — GG ×1 (1 peça · R$ 27,90)
* Regata Cropped Poliamida — Off White Off White — P ×1, G ×1, GG ×1 (3 peças · R$ 83,70)

Regata Tule
* Regata Tule — Blush Blush — Único ×1 (1 peça · R$ 19,90)
* Regata Tule — Off White Off White — Único ×1 (1 peça · R$ 19,90)
* Regata Tule — Preto Preto — Único ×1 (1 peça · R$ 19,90)

Total: 31 peças · R$ 803,10

Cliente
Loja: LOJA DA GABI
Nome: Gabriela Cabral Silva
Telefone: 31997441595

Valores sujeitos a confirmação.`;

describe("mensagem real da Entre Linhas (31 peças)", () => {
  const lido = lerMensagemDePedido(ENTRE_LINHAS);

  it("reconhece o pedido (o '*' da lista não é negrito)", () => {
    expect(lido.itens.length).toBe(22);
  });

  it("as 31 peças batem com o total declarado", () => {
    expect(pecasLidas(lido)).toBe(31);
    expect(lido.totalPecas).toBe(31);
    expect(lido.totalValor).toBe(803.1);
  });

  it("não perde metade do nome quando a cor está dentro dele", () => {
    expect(lido.itens[0].descricao).toBe("Blusa Clássica Tule — Baunilha Baunilha");
    expect(lido.itens[0].tamanhos).toEqual([{ tamanho: "Único", quantidade: 1 }]);
  });

  it("linha com vários tamanhos entra inteira", () => {
    const camiseta = lido.itens.find((i) => i.descricao.includes("Azul Marinho"))!;
    expect(camiseta.tamanhos).toEqual([
      { tamanho: "M", quantidade: 1 },
      { tamanho: "G", quantidade: 1 },
      { tamanho: "GG", quantidade: 1 },
    ]);
    expect(camiseta.pecas).toBe(3);
  });

  it("os títulos de seção não viram item", () => {
    expect(lido.itens.some((i) => i.descricao === "Cropped Tule")).toBe(false);
  });

  it("pega a cliente certa", () => {
    expect(lido.cliente.nome).toBe("Gabriela Cabral Silva");
    expect(lido.cliente.loja).toBe("LOJA DA GABI");
    expect(lido.cliente.telefone).toBe("31997441595");
  });

  it("casa com o catálogo da loja (nome com a cor dentro)", () => {
    const catalogo = [
      { id: "p1", name: "Blusa Clássica Tule — Baunilha" },
      { id: "p2", name: "Blusa Clássica Tule — Preto" },
      { id: "p3", name: "Cropped Tule — Off White" },
    ];
    const r = separarProdutoECor("Blusa Clássica Tule — Baunilha Baunilha", catalogo);
    expect(r?.produto.id).toBe("p1");
    expect(r?.cor).toBe("Baunilha");
  });
});

describe("cortar a linha do item pelo ÚLTIMO campo", () => {
  it("formato simples: produto e cor grudados", () => {
    expect(partirItem("Cropped Básico Comfy Preto — P ×2, M ×1")).toEqual({
      descricao: "Cropped Básico Comfy Preto",
      tamanhos: "P ×2, M ×1",
    });
  });

  it("formato com a cor dentro do nome: o nome fica inteiro", () => {
    expect(partirItem("Blusa Clássica Tule — Baunilha Baunilha — Único ×1")).toEqual({
      descricao: "Blusa Clássica Tule — Baunilha Baunilha",
      tamanhos: "Único ×1",
    });
  });

  it("hífen dentro da palavra não é separador", () => {
    expect(partirItem("Blusa Off-white — P ×1")).toEqual({
      descricao: "Blusa Off-white",
      tamanhos: "P ×1",
    });
  });

  it("linha sem separador nenhum não vira item", () => {
    expect(partirItem("Cropped Tule")).toBeNull();
  });
});

describe("cor repetida no texto", () => {
  it("a repetição exata é reduzida", () => {
    expect(candidatosDeCor("Baunilha Baunilha")).toContain("Baunilha");
    expect(candidatosDeCor("Azul Marinho Azul marinho")).toContain("Azul Marinho");
  });

  it("cor de verdade com duas palavras não é cortada errado", () => {
    const c = candidatosDeCor("Verde Musgo");
    expect(c[0]).toBe("Verde Musgo"); // a forma literal vem primeiro
  });

  it("travessão que sobrou na frente é removido", () => {
    expect(candidatosDeCor("— Preto Preto")[0]).toBe("Preto Preto");
  });

  it("texto vazio não vira candidato", () => {
    expect(candidatosDeCor("")).toEqual([]);
    expect(candidatosDeCor("  —  ")).toEqual([]);
  });
});

describe("mensagem ACHATADA pelo navegador do anúncio (Entre Linhas, 04/08/2026)", () => {
  // reprodução do print real: veio numa linha só, itens só com a cor e o
  // nome do modelo como título de seção
  const ACHATADA =
    "*Novo pedido — entre linhas* *Blusa Clássica Tule* • Branco — Único ×4 (4 peças · R$ 86,00) • Off White — Único ×2 (2 peças · R$ 43,00) • Preto — Único ×2 (2 peças · R$ 43,00) *Blusão Tule* • Branco — Único ×2 (2 peças · R$ 43,00) • Preto — Único ×3 (3 peças · R$ 64,50) *Total:* 13 peças · R$ 279,50";

  it("desachatar remonta as linhas a partir dos marcadores", () => {
    const remontada = desachatarMensagem(ACHATADA);
    expect(remontada.split("\n").length).toBeGreaterThan(6);
    expect(remontada).toContain("*Blusão Tule*");
  });

  it("a leitura acha loja, itens (com o modelo da seção) e total", () => {
    const lido = lerMensagemDePedido(ACHATADA);
    expect(lido.loja).toBe("entre linhas");
    expect(lido.itens).toHaveLength(5);
    expect(lido.itens[0]).toMatchObject({
      descricao: "Branco",
      categoria: "Blusa Clássica Tule",
    });
    expect(lido.itens[3].categoria).toBe("Blusão Tule");
    expect(lido.totalPecas).toBe(13);
    expect(lido.totalValor).toBe(279.5);
    expect(pecasLidas(lido)).toBe(13);
  });

  it("mensagem normal (com quebras) passa intacta pelo desachatar", () => {
    const normal = "linha 1\nlinha 2\nlinha 3\nlinha 4";
    expect(desachatarMensagem(normal)).toBe(normal);
  });

  it("o casamento usa o título da seção quando o item vem só com a cor", () => {
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/orders/ler-mensagem/route.ts"),
      "utf8"
    );
    expect(rota).toContain("separarProdutoECor(`${item.categoria} ${item.descricao}`");
  });
});
