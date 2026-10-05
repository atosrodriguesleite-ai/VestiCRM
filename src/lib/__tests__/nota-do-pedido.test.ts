import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  linhasDoSistema,
  montarNota,
  removerLinhaDoSistema,
  separarNotaDoPedido,
} from "../nota-do-pedido";

/**
 * A nota do pedido em três partes (pedido do dono, 05/10/2026): o campo
 * "Observações" — na ficha e no romaneio — mostra SÓ o que a vendedora
 * escreveu; dados e avisos do sistema vão para blocos próprios.
 */

const NOTA_DO_CATALOGO = [
  "Pedido recebido pelo catálogo público.",
  "Loja: Boutique da Ana",
  "Nome: Ivyne Chrystina Rocha de Oliveira",
  "Telefone: (33) 99828-0839",
  "CEP: 35280000",
  "Endereço (rua e número): Rua A, 1",
  "Estado (UF): MG",
  "⚠️ A cliente digitou um telefone diferente do WhatsApp dela (5533999). confira.",
  "🏷 Link da campanha “Black” — 10% de desconto já aplicado.",
  "⚠️ As condições deste link mudaram entre a tela e o envio: a cliente viu 10% de desconto e o link agora dá 5%. O pedido foi gravado pelo valor de AGORA — confirme com a cliente antes de cobrar.",
  "⚠️ Sem estoque para parte do pedido — Regata (Preto M): pediu 3, reservou 1.",
].join("\n");

describe("separarNotaDoPedido: dados × avisos × observação", () => {
  it("o pedido do catálogo sem recado da vendedora tem observação VAZIA", () => {
    const r = separarNotaDoPedido(NOTA_DO_CATALOGO);
    expect(r.observacao).toBe("");
    expect(r.dados).toEqual([
      "Loja: Boutique da Ana",
      "Nome: Ivyne Chrystina Rocha de Oliveira",
      "Telefone: (33) 99828-0839",
      "CEP: 35280000",
      "Endereço (rua e número): Rua A, 1",
      "Estado (UF): MG",
    ]);
    expect(r.avisos).toHaveLength(4);
    expect(r.avisos[0]).toMatch(/^⚠️ A cliente digitou/);
    expect(r.avisos[3]).toMatch(/^⚠️ Sem estoque/);
  });

  it("o recado da vendedora escrito por cima fica inteiro, com as quebras dela", () => {
    const r = separarNotaDoPedido(`${NOTA_DO_CATALOGO}\nReservar até sexta.\nEntregar na portaria: Nome do porteiro é João`);
    expect(r.observacao).toBe("Reservar até sexta.\nEntregar na portaria: Nome do porteiro é João");
  });

  it("colar do WhatsApp: origem e loja da cliente são dados; campanha e linhas que não entraram são avisos", () => {
    const r = separarNotaDoPedido(
      [
        "Pedido lançado a partir da mensagem do WhatsApp.",
        "Loja da cliente: Modas Lu",
        "⚠️ A mensagem citava a campanha “Natal”, que não confere com o cadastro. Os preços são os cheios — confira o valor combinado com a cliente.",
        "⚠️ 2 linha(s) da mensagem não entraram (sem cadastro ou sem estoque) — confira com a cliente.",
      ].join("\n")
    );
    expect(r.dados).toEqual(["Pedido lançado a partir da mensagem do WhatsApp.", "Loja da cliente: Modas Lu"]);
    expect(r.avisos).toHaveLength(2);
    expect(r.observacao).toBe("");
  });

  it("venda da loja online: a origem é dado, não observação", () => {
    const r = separarNotaDoPedido("Venda da loja online (Nuvemshop #1234)");
    expect(r.dados).toEqual(["Venda da loja online (Nuvemshop #1234)"]);
    expect(r.observacao).toBe("");
  });

  it("pedido montado na mão: a nota é toda da vendedora, e nada muda", () => {
    expect(separarNotaDoPedido("todas entregues, exceto a regata")).toEqual({
      dados: [],
      avisos: [],
      observacao: "todas entregues, exceto a regata",
    });
    expect(separarNotaDoPedido(null)).toEqual({ dados: [], avisos: [], observacao: "" });
  });

  it("frase do sistema que a régua NÃO conhece cai na observação — o lado em que nada se perde", () => {
    const r = separarNotaDoPedido("⚠️ Um aviso novo que ninguém cadastrou aqui.");
    expect(r.avisos).toEqual([]);
    expect(r.observacao).toBe("⚠️ Um aviso novo que ninguém cadastrou aqui.");
  });
});

describe("montarNota: salvar a observação não apaga o que o sistema escreveu", () => {
  it("troca só o recado, preservando dados, avisos E o cabeçalho do catálogo", () => {
    const antes = `${NOTA_DO_CATALOGO}\nrecado velho`;
    const depois = montarNota(antes, "recado novo\nsegunda linha");
    expect(depois.startsWith("Pedido recebido pelo catálogo público.\n")).toBe(true);
    expect(depois).toContain("Nome: Ivyne Chrystina Rocha de Oliveira");
    expect(depois).toContain("⚠️ Sem estoque para parte do pedido");
    expect(depois).not.toContain("recado velho");
    expect(depois.endsWith("\nrecado novo\nsegunda linha")).toBe(true);
    // a leitura do que foi gravado devolve exatamente o recado novo
    expect(separarNotaDoPedido(depois).observacao).toBe("recado novo\nsegunda linha");
  });

  it("observação vazia apaga SÓ a observação", () => {
    const depois = montarNota(`${NOTA_DO_CATALOGO}\nrecado velho`, "   ");
    expect(depois).toBe(NOTA_DO_CATALOGO);
    expect(separarNotaDoPedido(depois).observacao).toBe("");
  });

  it("pedido montado na mão: a nota vira o texto digitado, como sempre foi", () => {
    expect(montarNota("recado velho", "recado novo")).toBe("recado novo");
    expect(montarNota(null, "")).toBe("");
    expect(linhasDoSistema("recado velho")).toEqual([]);
  });
});

describe("removerLinhaDoSistema: o aviso já resolvido sai, o resto fica", () => {
  it("tira só a linha pedida (uma vez) e mantém o recado da vendedora", () => {
    const antes = `${NOTA_DO_CATALOGO}\nReservar até sexta.`;
    const alvo = "⚠️ Sem estoque para parte do pedido — Regata (Preto M): pediu 3, reservou 1.";
    const depois = removerLinhaDoSistema(antes, alvo);
    expect(depois).not.toContain(alvo);
    expect(depois).toContain("Nome: Ivyne Chrystina Rocha de Oliveira");
    expect(depois).toContain("🏷 Link da campanha");
    expect(separarNotaDoPedido(depois).observacao).toBe("Reservar até sexta.");
  });

  it("linha que não existe: nada muda", () => {
    expect(removerLinhaDoSistema("a\nb", "zzz")).toBe("a\nb");
  });
});

/**
 * A RÉGUA TEM QUE CONHECER CADA FRASE QUE O CÓDIGO ESCREVE NA NOTA. Se quem
 * escreve mudar a frase e esquecer daqui, o aviso cai na observação da
 * vendedora e volta a poluir o campo — este teste prende as duas pontas.
 */
describe("as frases que o sistema escreve na nota estão reconhecidas", () => {
  const raiz = join(__dirname, "..", "..");
  const catalogo = readFileSync(join(raiz, "app/api/catalog/order/route.ts"), "utf8");
  const importar = readFileSync(join(raiz, "app/(app)/pedidos/importar-mensagem.tsx"), "utf8");
  const nuvemshop = readFileSync(join(raiz, "lib/nuvemshop.ts"), "utf8");

  const frases: Array<[string, string, "dados" | "avisos"]> = [
    [catalogo, '"Pedido recebido pelo catálogo público."', "dados"],
    [catalogo, "`Loja: ${", "dados"],
    [catalogo, "`Nome: ${", "dados"],
    [catalogo, "`Telefone: ${", "dados"],
    [catalogo, "`⚠️ A cliente digitou um telefone diferente", "avisos"],
    [catalogo, "`⚠️ As condições deste link mudaram", "avisos"],
    [catalogo, "`⚠️ Sem estoque para parte do pedido", "avisos"],
    [catalogo, "`🏷 Link da campanha", "avisos"],
    [importar, '"Pedido lançado a partir da mensagem do WhatsApp."', "dados"],
    [importar, "`Loja da cliente: ${", "dados"],
    [importar, "`🏷 Link da campanha", "avisos"],
    [importar, "`⚠️ A mensagem citava a campanha", "avisos"],
    [importar, "linha(s) da mensagem não entraram", "avisos"],
    [nuvemshop, "`Venda da loja online (Nuvemshop #${", "dados"],
  ];

  it.each(frases)("a fonte ainda escreve %#", (fonte, trecho) => {
    expect(fonte).toContain(trecho);
  });

  it("cada frase, como gravada, cai no bloco certo", () => {
    const exemplos: Array<[string, "dados" | "avisos" | "cabecalho"]> = [
      ["Pedido recebido pelo catálogo público.", "cabecalho"],
      ["Loja: X", "dados"],
      ["Nome: X", "dados"],
      ["Telefone: X", "dados"],
      ["CEP: 1", "dados"],
      ["Endereço (rua e número): X", "dados"],
      ["Bairro: X", "dados"],
      ["Cidade: X", "dados"],
      ["Estado (UF): X", "dados"],
      ["Nome da loja: X", "dados"],
      ["⚠️ A cliente digitou um telefone diferente do WhatsApp dela (1). x", "avisos"],
      ["⚠️ As condições deste link mudaram entre a tela e o envio: x", "avisos"],
      ["⚠️ Sem estoque para parte do pedido — x.", "avisos"],
      ["🏷 Link da campanha “X” — 5% de desconto já aplicado.", "avisos"],
      ["Pedido lançado a partir da mensagem do WhatsApp.", "dados"],
      ["Loja da cliente: X", "dados"],
      ["⚠️ A mensagem citava a campanha “X”, que não confere com o cadastro.", "avisos"],
      ["⚠️ 3 linha(s) da mensagem não entraram (sem cadastro ou sem estoque) — confira com a cliente.", "avisos"],
      ["Venda da loja online (Nuvemshop #9)", "dados"],
    ];
    for (const [linha, bloco] of exemplos) {
      const r = separarNotaDoPedido(linha);
      expect(r.observacao, linha).toBe("");
      if (bloco === "cabecalho") {
        expect(r.dados, linha).toEqual([]);
        expect(linhasDoSistema(linha), linha).toEqual([linha]); // mas é preservado ao gravar
      } else {
        expect(r[bloco], linha).toEqual([linha]);
      }
    }
  });
});
