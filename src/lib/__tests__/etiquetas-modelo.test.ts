import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  DADOS_DE_EXEMPLO,
  OPCOES_PADRAO,
  elementosCabem,
  encaixarTexto,
  estimarLarguraMm,
  layoutEmbalagem,
  lerOpcoes,
  valorDoCampo,
} from "../etiquetas/modelo";
import { escaparZpl, zplDaEtiqueta, zplDoLote } from "../etiquetas/zpl";
import { svgDaEtiqueta } from "../etiquetas/svg";
import { pdfDoLote } from "../etiquetas/pdf";

/**
 * A ETIQUETA DE EMBALAGEM (RN-059): uma lista de elementos em mm, três
 * desenhadores (ZPL para a Zebra, PDF para qualquer impressora, SVG para a
 * prévia). O que a lojista vê é o que sai.
 */

describe("layoutEmbalagem", () => {
  it("50 × 30 padrão: nome, cor·tamanho, barras e loja no rodapé — tudo dentro da etiqueta", () => {
    const m = layoutEmbalagem(OPCOES_PADRAO);
    expect(m.larguraMm).toBe(50);
    expect(m.alturaMm).toBe(30);
    const campos = m.elementos.filter((e) => e.tipo === "texto").map((e) => e.campo);
    expect(campos).toEqual(["produto", "cor_tamanho", "loja"]);
    const barras = m.elementos.find((e) => e.tipo === "barras")!;
    expect(barras.h).toBeGreaterThanOrEqual(8);
    expect(elementosCabem(m)).toBe(true);
  });

  it("preço e SKU dividem a mesma linha; tirar a loja tira o rodapé", () => {
    const m = layoutEmbalagem({ ...OPCOES_PADRAO, mostrarLoja: false, mostrarSku: true, preco: "atacado" });
    const sku = m.elementos.find((e) => e.tipo === "texto" && e.campo === "sku")!;
    const preco = m.elementos.find((e) => e.tipo === "texto" && e.campo === "preco_atacado")!;
    expect(sku.y).toBe(preco.y);
    expect(sku.x).toBeLessThan(preco.x);
    expect(m.elementos.some((e) => e.tipo === "texto" && e.campo === "loja")).toBe(false);
    expect(elementosCabem(m)).toBe(true);
  });

  it("etiqueta baixa demais para o que foi pedido NÃO cabe — a rota recusa com frase", () => {
    const m = layoutEmbalagem({ larguraMm: 20, alturaMm: 12, mostrarLoja: true, mostrarSku: true, preco: "varejo" });
    expect(elementosCabem(m)).toBe(false);
  });

  it("lerOpcoes: JSON torto ou fora da faixa cai no padrão, campo a campo", () => {
    expect(lerOpcoes(null)).toEqual(OPCOES_PADRAO);
    expect(lerOpcoes("{nao é json")).toEqual(OPCOES_PADRAO);
    expect(lerOpcoes(JSON.stringify({ larguraMm: 999, alturaMm: 40, preco: "varejo", mostrarSku: "sim" }))).toEqual({
      ...OPCOES_PADRAO,
      alturaMm: 40,
      preco: "varejo",
    });
  });

  it("cor·tamanho esconde a cor 'Único' (loja sem cores) e o preço sai em reais", () => {
    const el = { tipo: "texto", campo: "cor_tamanho", x: 0, y: 0, w: 10, h: 3, pt: 8 } as const;
    expect(valorDoCampo(el, DADOS_DE_EXEMPLO)).toBe("Preto · G");
    expect(valorDoCampo(el, { ...DADOS_DE_EXEMPLO, cor: "Único" })).toBe("G");
    expect(valorDoCampo({ ...el, campo: "preco_varejo" }, { ...DADOS_DE_EXEMPLO, precoVarejo: 1234.5 })).toBe("R$ 1.234,50");
  });

  it("texto que não cabe encolhe até 60% e só então corta com reticências", () => {
    const curto = encaixarTexto("Regata", 40, 8, estimarLarguraMm);
    expect(curto).toEqual({ texto: "Regata", pt: 8 });
    const medio = encaixarTexto("Regata Nadador Poliamida Premium", 40, 8, estimarLarguraMm);
    expect(medio.texto).toBe("Regata Nadador Poliamida Premium");
    expect(medio.pt).toBeLessThan(8);
    expect(medio.pt).toBeGreaterThanOrEqual(4.8);
    const longo = encaixarTexto("Regata Nadador Poliamida Premium Zero Transparência Toque Macio", 30, 8, estimarLarguraMm);
    expect(longo.texto.endsWith("…")).toBe(true);
    expect(longo.pt).toBeCloseTo(4.8, 5);
    expect(estimarLarguraMm(longo.texto, longo.pt)).toBeLessThanOrEqual(30);
  });
});

describe("ZPL (Zebra 220, 203 dpi)", () => {
  const m = layoutEmbalagem(OPCOES_PADRAO);

  it("cabeçalho em UTF-8, medidas em pontos, EAN nativo com 12 dígitos e a quantidade", () => {
    const z = zplDaEtiqueta(m, DADOS_DE_EXEMPLO, 3);
    expect(z.startsWith("^XA\n^CI28\n^PW400\n^LL240")).toBe(true);
    // barras SEM a linha de interpretação da impressora (ela tem altura
    // própria e invadia o rodapé): o número é desenhado por nós, na mesma
    // posição do PDF e da prévia
    expect(z).toMatch(/\^BEN,\d+,N,N/);
    expect(z).toContain("^FD200000000001^FS"); // os 12 primeiros; a Zebra põe o verificador
    expect(z).toContain("^FD2000000000015^FS"); // o número embaixo, completo
    expect(z).toContain("^PQ3");
    expect(z.trim().endsWith("^XZ")).toBe(true);
    // o texto passa pelo escape hexadecimal
    expect(z).toContain("^FH_^FDRegata Nadador Poliamida^FS");
  });

  it("acento, ^ e ~ viram bytes escapados (nada de comando disfarçado de texto)", () => {
    expect(escaparZpl("Calça ^x ~y_z")).toBe("Cal_C3_A7a _5Ex _7Ey_5Fz");
  });

  it("o lote junta uma etiqueta por peça com a quantidade dela; zero fica de fora", () => {
    const z = zplDoLote(m, [
      { dados: DADOS_DE_EXEMPLO, quantidade: 2 },
      { dados: { ...DADOS_DE_EXEMPLO, codigo: "2000000000022" }, quantidade: 0 },
      { dados: { ...DADOS_DE_EXEMPLO, codigo: "2000000000022" }, quantidade: 1 },
    ]);
    expect(z.match(/\^XA/g)).toHaveLength(2);
    expect(z).toContain("^PQ2");
    expect(z).toContain("^PQ1");
  });

  it("código inválido não vira barra (a etiqueta sai sem código, nunca com código errado)", () => {
    const z = zplDaEtiqueta(m, { ...DADOS_DE_EXEMPLO, codigo: "123" });
    expect(z).not.toContain("^BEN");
  });
});

describe("SVG (prévia)", () => {
  it("desenha na medida em mm, com as barras e o número", () => {
    const s = svgDaEtiqueta(layoutEmbalagem(OPCOES_PADRAO), DADOS_DE_EXEMPLO);
    expect(s).toContain('viewBox="0 0 50 30"');
    expect((s.match(/<rect /g) ?? []).length).toBeGreaterThan(25);
    expect(s).toContain(">2000000000015</text>");
    expect(s).toContain("Regata Nadador Poliamida");
    expect(s).toContain("Toque Leve");
  });

  it("texto é escapado", () => {
    const s = svgDaEtiqueta(layoutEmbalagem(OPCOES_PADRAO), { ...DADOS_DE_EXEMPLO, produto: "A <b> & C" });
    expect(s).toContain("A &lt;b&gt; &amp; C");
    expect(s).not.toContain("<b>");
  });
});

describe("PDF (qualquer impressora)", () => {
  it("uma página por etiqueta, na medida exata, com o teto respeitado", async () => {
    const bytes = await pdfDoLote(layoutEmbalagem(OPCOES_PADRAO), [
      { dados: DADOS_DE_EXEMPLO, quantidade: 2 },
      { dados: { ...DADOS_DE_EXEMPLO, produto: "Calça Ç", codigo: "2000000000022" }, quantidade: 1 },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo((50 * 72) / 25.4, 3);
    expect(height).toBeCloseTo((30 * 72) / 25.4, 3);
  });

  it("nunca passa de 500 páginas num PDF só", async () => {
    const bytes = await pdfDoLote(layoutEmbalagem(OPCOES_PADRAO), [{ dados: DADOS_DE_EXEMPLO, quantidade: 600 }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(500);
  }, 30_000);
});
