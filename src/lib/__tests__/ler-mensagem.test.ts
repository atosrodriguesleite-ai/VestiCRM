import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  candidatosDeCor,
  candidatosDaLinha,
  candidatosDeProduto,
  casarPeca,
  casarPecaNosCandidatos,
  desachatarMensagem,
  fraseSemVariacao,
  lerDinheiro,
  lerMensagemDePedido,
  lerTamanhos,
  partirItem,
  pecasLidas,
} from "../catalogo/ler-mensagem";

/** o primeiro candidato no nome mais longo (o atalho das provas de nome) */
const separarProdutoECor = <T extends { id: string; name: string }>(descricao: string, produtos: T[]) =>
  candidatosDeProduto(descricao, produtos)[0] ?? null;
import { CAMPOS_DO_PEDIDO } from "../catalogo/campos-do-pedido";

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

  it('entende o rótulo novo "Nome da loja:" (campo LOJA da RN-027) sem confundir com "Nome:"', () => {
    // desde 23/09/2026 o campo deixou de ser fixo e a mensagem usa o rótulo
    // do cardápio; o formato antigo ("Loja:") segue valendo — o servidor
    // ainda escreve assim na nota do pedido
    const novo = lerMensagemDePedido(
      MENSAGEM.replace("Loja: LOJA DA GABI", "Nome da loja: LOJA DA GABI")
    );
    expect(novo.cliente.loja).toBe("LOJA DA GABI");
    expect(novo.cliente.nome).toBe("Gabriela Cabral Silva");
    // e na mensagem ACHATADA o rótulo comprido vira linha própria INTEIRO —
    // se "Loja"/"Nome" casassem primeiro, "Nome da loja: X" partia no meio
    const achatada = desachatarMensagem(
      "*Novo pedido — Entre Linhas* • Calça Azul — P ×2 (2 peças · R$ 100,00) • Cropped Preto — M ×1 (1 peça · R$ 50,00) Total: 3 peças Nome da loja: LOJA DA GABI Nome: Gabriela Telefone: 31997441595"
    );
    expect(achatada).toContain("Nome da loja: LOJA DA GABI\n");
    const daAchatada = lerMensagemDePedido(achatada);
    expect(daAchatada.cliente.loja).toBe("LOJA DA GABI");
    expect(daAchatada.cliente.nome).toBe("Gabriela");
  });

  it("TODO rótulo do cardápio da RN-027 vira linha própria na mensagem achatada", () => {
    // o formulário imprime `rotulo: valor` para cada campo configurado, e o
    // desachatador mantém a lista de rótulos À MÃO — este teste é o que
    // prende as duas pontas: campo novo no cardápio sem o desachatador
    // aprender o rótulo falha AQUI, não colado na linha do telefone da
    // cliente no navegador do Instagram (achado da revisão, 23/09/2026)
    const dados = Object.values(CAMPOS_DO_PEDIDO)
      .map((def, i) => `${def.rotulo}: VALOR${i}`)
      .join(" ");
    const achatada = desachatarMensagem(
      `*Novo pedido — Loja* • Calça Azul — P ×1 (1 peça · R$ 10,00) • Blusa Preta — M ×1 (1 peça · R$ 10,00) Total: 2 peças ${dados}`
    );
    const linhas = achatada.split("\n");
    Object.values(CAMPOS_DO_PEDIDO).forEach((def, i) => {
      expect(
        linhas.some((l) => l.trim() === `${def.rotulo}: VALOR${i}`),
        `rótulo "${def.rotulo}" não virou linha própria — ensine o desachatarMensagem`
      ).toBe(true);
    });
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

  it("os campos extras da loja (RN-027) não grudam no telefone quando achatados", () => {
    // sem os rótulos novos no desachatar, o CEP colado na linha do telefone
    // virava dígito de telefone ("3199744159557000000") e a leitura casava
    // um cliente fantasma — a mesma praga que a RN-020/021 combatem
    const achatada =
      "*Novo pedido — entre linhas* • Branco — Único ×4 (4 peças · R$ 86,00) • Preto — Único ×2 (2 peças · R$ 43,00) *Total:* 6 peças · R$ 129,00 *Cliente* Nome: Ana Telefone: (31) 99744-1595 CEP: 57000-000 Bairro: Ponta Verde Endereço (rua e número): Rua das Flores, 123";
    const remontada = desachatarMensagem(achatada);
    expect(remontada).toContain("\nCEP: 57000-000");
    expect(remontada).toContain("\nBairro: Ponta Verde");
    expect(remontada).toContain("\nEndereço (rua e número): Rua das Flores, 123");
    const lido = lerMensagemDePedido(achatada);
    expect(lido.cliente.telefone).toBe("31997441595");
  });

  it("o casamento usa o título da seção quando o item vem só com a cor", () => {
    const produtos = [
      {
        id: "p1",
        name: "Blusa Clássica Tule",
        variants: [
          { id: "v1", color: "Branco", size: "Único", stock: 5 },
          { id: "v2", color: "Preto", size: "Único", stock: 5 },
        ],
      },
    ];
    const r = casarPeca(
      { descricao: "Branco", categoria: "Blusa Clássica Tule" },
      "Único",
      4,
      produtos
    );
    expect(r?.produto.id).toBe("p1");
    expect(r?.variante?.id).toBe("v1");
    // e a rota passa pela régua única da lib, não por conta própria
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/orders/ler-mensagem/route.ts"),
      "utf8"
    );
    expect(rota).toContain("candidatosDaLinha(item, produtos)");
    expect(rota).toContain("casarPecaNosCandidatos(candidatos, t.tamanho, t.quantidade)");
  });
});

/**
 * LOJA QUE CADASTRA UM PRODUTO POR COR, COM O MESMO NOME (Toque Leve,
 * 03/11/2026): o pedido da Tânia tinha seis "Regata Alça" de cores
 * diferentes e a prévia mostrava TODAS como "cafe · M" — o leitor ficava
 * com o primeiro xará, não achava "Amarelo Manteiga" nele e, como o
 * produto só tem uma cor, trocava calado pela Café. Peça errada reservada
 * em silêncio é o pior resultado possível: a cliente recebe a cor que não
 * pediu e a Amarelo Manteiga segue na arara "vendida".
 */
describe("um produto por cor com o mesmo nome (Toque Leve, 03/11/2026)", () => {
  const regata = (id: string, cor: string, tamanhos: string[], stock = 3) => ({
    id,
    name: "Regata Alça",
    variants: tamanhos.map((size) => ({ id: `${id}-${size}`, color: cor, size, stock })),
  });
  const produtos = [
    regata("cafe", "cafe", ["P", "M", "G"]),
    regata("manteiga", "Amarelo Manteiga", ["M", "G"]),
    regata("ceu", "Azul Céu", ["G"]),
    regata("terracota", "Terracota", ["M"]),
    { id: "nad", name: "Regata Alça Nadador", variants: [{ id: "nad-M", color: "Preto", size: "M", stock: 2 }] },
  ];

  it("todos os xarás empatados no nome mais longo são candidatos", () => {
    const c = candidatosDeProduto("Regata Alça Amarelo Manteiga", produtos);
    expect(c.map((x) => x.produto.id)).toEqual(["cafe", "manteiga", "ceu", "terracota"]);
    expect(c.every((x) => x.cor === "Amarelo Manteiga")).toBe(true);
    // o nome mais longo continua vencendo quando casa inteiro
    expect(candidatosDeProduto("Regata Alça Nadador Preto", produtos).map((x) => x.produto.id)).toEqual([
      "nad",
    ]);
  });

  it("a COR escolhe o produto entre os xarás (cor de duas palavras inclusive)", () => {
    const r = casarPeca({ descricao: "Regata Alça Amarelo Manteiga", categoria: null }, "M", 1, produtos);
    expect(r?.produto.id).toBe("manteiga");
    expect(r?.variante?.id).toBe("manteiga-M");
    const ceu = casarPeca({ descricao: "Regata Alça Azul Céu", categoria: null }, "G", 1, produtos);
    expect(ceu?.variante?.id).toBe("ceu-G");
    // caixa e acento não atrapalham
    const cafe = casarPeca({ descricao: "Regata Alça Café", categoria: null }, "P", 1, produtos);
    expect(cafe?.variante?.id).toBe("cafe-P");
  });

  it("cor que NÃO existe nunca é trocada por outra — a linha volta sem variação", () => {
    const r = casarPeca({ descricao: "Regata Alça Verde Militar", categoria: null }, "M", 1, produtos);
    expect(r).not.toBeNull();
    expect(r?.variante).toBeNull();
    expect(r?.cor).toBe("Verde Militar");
  });

  it("o tamanho que só existe em outro xará da mesma cor não cai na cor errada", () => {
    // a Amarelo Manteiga não tem P; a Café tem — e NÃO pode virar Café
    const r = casarPeca({ descricao: "Regata Alça Amarelo Manteiga", categoria: null }, "P", 1, produtos);
    expect(r?.variante).toBeNull();
  });

  it("a mensagem inteira da Tânia sai com cada peça na sua cor", () => {
    const msg = `*Novo pedido — Toque Leve*

*Regata Alça*
• Regata Alça Amarelo Manteiga — M ×1  (1 peça · R$ 32,00)
• Regata Alça cafe — M ×1  (1 peça · R$ 32,00)
• Regata Alça Azul Céu — G ×1  (1 peça · R$ 32,00)
• Regata Alça Terracota — M ×1  (1 peça · R$ 32,00)

*Total:* 4 peças · R$ 128,00

*Cliente*
Nome: Maria Tânia Batista França
Telefone: (33) 99995-6375
CEP: 39625000

_Valores sujeitos a confirmação._`;
    const lido = lerMensagemDePedido(msg);
    const cores = lido.itens.map((i) =>
      casarPeca(i, i.tamanhos[0].tamanho, i.tamanhos[0].quantidade, produtos)?.variante?.color
    );
    expect(cores).toEqual(["Amarelo Manteiga", "cafe", "Azul Céu", "Terracota"]);
  });

  it("cadastro em dobro da mesma cor: vale o que tem estoque para a quantidade", () => {
    const dobro = [regata("a", "Preto", ["M"], 0), regata("b", "Preto", ["M"], 4)];
    expect(casarPeca({ descricao: "Regata Alça Preto", categoria: null }, "M", 2, dobro)?.produto.id).toBe("b");
    // nenhum cobre: o de maior estoque
    const pouco = [regata("a", "Preto", ["M"], 1), regata("b", "Preto", ["M"], 3)];
    expect(casarPeca({ descricao: "Regata Alça Preto", categoria: null }, "M", 9, pouco)?.produto.id).toBe("b");
  });

  it("sem cor no texto (loja que esconde as cores): uma variação do tamanho é ela, duas é dúvida DITA", () => {
    const uma = [regata("cafe", "cafe", ["M"])];
    expect(casarPeca({ descricao: "Regata Alça", categoria: null }, "M", 1, uma)?.variante?.id).toBe("cafe-M");
    const r = casarPeca({ descricao: "Regata Alça", categoria: null }, "M", 1, produtos);
    expect(r?.produto.id).toBe("cafe");
    expect(r?.variante).toBeNull();
    expect(r?.motivo).toBe("mais-de-uma-opcao");
    expect(fraseSemVariacao(r!.motivo!, "", "M", 4)).toContain("4 cadastros com esse nome");
    // um produto só, com duas cores no tamanho: a dúvida é a cor
    const duasCores = [
      { id: "x", name: "Regata Alça", variants: [
        { id: "x-M-p", color: "Preto", size: "M", stock: 1 },
        { id: "x-M-b", color: "Branco", size: "M", stock: 1 },
      ] },
    ];
    const d = casarPeca({ descricao: "Regata Alça", categoria: null }, "M", 1, duasCores);
    expect(d?.motivo).toBe("mais-de-uma-opcao");
    expect(fraseSemVariacao(d!.motivo!, "", "M", 1)).toContain("mais de uma no tamanho M");
    // tamanho que não existe
    const t = casarPeca({ descricao: "Regata Alça", categoria: null }, "XGG", 1, uma);
    expect(t?.motivo).toBe("tamanho-nao-existe");
  });

  it("cor que não existe traz o motivo certo", () => {
    const r = casarPeca({ descricao: "Regata Alça Verde Militar", categoria: null }, "M", 1, produtos);
    expect(r?.motivo).toBe("cor-nao-existe");
    expect(fraseSemVariacao(r!.motivo!, r!.cor, "M", 4)).toBe("Sem essa variação (Verde Militar M)");
  });

  it("o nome mais curto é RESERVA: só entra quando o mais longo não tem a cor", () => {
    const loja = [
      { id: "curto", name: "Regata Alça", variants: [{ id: "curto-G", color: "Azul Céu", size: "G", stock: 2 }] },
      { id: "longo", name: "Regata Alça Azul", variants: [{ id: "longo-G", color: "Marinho", size: "G", stock: 2 }] },
    ];
    // "Regata Alça Azul" + "Céu" não existe; "Regata Alça" + "Azul Céu" existe
    const r = casarPeca({ descricao: "Regata Alça Azul Céu", categoria: null }, "G", 1, loja);
    expect(r?.variante?.id).toBe("curto-G");
    // e o mais longo continua vencendo quando TEM a cor
    const m = casarPeca({ descricao: "Regata Alça Azul Marinho", categoria: null }, "G", 1, loja);
    expect(m?.variante?.id).toBe("longo-G");
    // sem casar em degrau nenhum, a dúvida é do degrau mais longo
    const n = casarPeca({ descricao: "Regata Alça Azul Rosa", categoria: null }, "G", 1, loja);
    expect(n?.produto.id).toBe("longo");
    expect(n?.cor).toBe("Rosa");
    expect(n?.motivo).toBe("cor-nao-existe");
  });

  it("a conta por linha é feita uma vez e serve a todos os tamanhos", () => {
    const degraus = candidatosDaLinha({ descricao: "Regata Alça Amarelo Manteiga", categoria: null }, produtos);
    expect(degraus[0].map((c) => c.produto.id)).toEqual(["cafe", "manteiga", "ceu", "terracota"]);
    expect(casarPecaNosCandidatos(degraus, "M", 1)?.variante?.id).toBe("manteiga-M");
    expect(casarPecaNosCandidatos(degraus, "G", 1)?.variante?.id).toBe("manteiga-G");
  });

  it("nome com a cor dentro e a cor repetida (Nuvemshop) segue casando", () => {
    const nuvem = [
      {
        id: "n",
        name: "Blusa Clássica Tule — Baunilha",
        variants: [{ id: "n-U", color: "Baunilha", size: "Único", stock: 1 }],
      },
    ];
    const r = casarPeca(
      { descricao: "Blusa Clássica Tule — Baunilha Baunilha", categoria: null },
      "Único",
      1,
      nuvem
    );
    expect(r?.variante?.id).toBe("n-U");
  });
});

/**
 * RN-068: a loja escolhe como chamar a unidade ("conjunto", "kit"), e a
 * mensagem do pedido passa a dizer isso. O leitor não pode depender da
 * palavra "peça" — o Total era lido assim, e a loja de conjuntos perderia a
 * conferência do total sem nenhum aviso.
 */
describe("mensagem de loja que vende conjunto (RN-068)", () => {
  it("lê o total e os itens pelo NÚMERO, seja qual for a palavra", () => {
    const lido = lerMensagemDePedido(
      "*Novo pedido — Fit Store*\n\n• Bermuda + Top Azul — M ×2  (2 conjuntos · R$ 173,80)\n• Legging Preta — P ×1  (1 kit · R$ 99,90)\n*Total:* 3 conjuntos · R$ 273,70\n\nNome: Samira\nTelefone: 31997441595"
    );
    expect(lido.totalPecas).toBe(3);
    expect(pecasLidas(lido)).toBe(3);
    expect(lido.itens).toHaveLength(2);
  });
});
