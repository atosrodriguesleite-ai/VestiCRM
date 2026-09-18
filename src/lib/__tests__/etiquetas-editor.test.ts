import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  DADOS_DE_EXEMPLO,
  OPCOES_PADRAO,
  elementosCabem,
  estimarLarguraMm,
  layoutComposicao,
  layoutEnvio,
  lerElementos,
  linhasDoElemento,
  modeloDaLinhaGravada,
  opcoesIniciais,
  quebrarTexto,
  type ElementoTexto,
} from "../etiquetas/modelo";
import { zplDaEtiqueta } from "../etiquetas/zpl";
import { svgDaEtiqueta } from "../etiquetas/svg";
import { pdfDoLote } from "../etiquetas/pdf";
import { empacotarBits, pretosDoRgba } from "../etiquetas/rasterizar";
import { composicaoEfetiva, remetenteDaLoja } from "../etiquetas/imprimir";
import { itemVisivel } from "../menu-grupos";

/**
 * O EDITOR DE MODELOS (RN-059): texto em várias linhas, imagem nas três
 * saídas, a lista de elementos gravada lida campo a campo, os desenhos por
 * regra de composição e envio, e a composição da peça herdando a categoria.
 */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("texto em várias linhas", () => {
  it("quebra por palavra e a última linha que não coube ganha reticências", () => {
    const linhas = quebrarTexto("8% elastano, 92% poliamida premium importada da Itália", 20, 6, 2, estimarLarguraMm);
    expect(linhas).toHaveLength(2);
    expect(linhas[1].endsWith("…")).toBe(true);
    expect(quebrarTexto("curto", 40, 6, 3, estimarLarguraMm)).toEqual(["curto"]);
  });

  it("palavra maior que a linha é cortada no meio, nunca derruba a etiqueta", () => {
    const linhas = quebrarTexto("Supercalifragilisticexpialidocious", 10, 8, 5, estimarLarguraMm);
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(estimarLarguraMm(l, 8)).toBeLessThanOrEqual(10 + 0.01);
  });

  it("linhasDoElemento: 1 linha encolhe/corta; N linhas quebram, no máximo o que cabe na caixa", () => {
    const uma: ElementoTexto = { tipo: "texto", campo: "composicao", x: 0, y: 0, w: 20, h: 3, pt: 8 };
    const r1 = linhasDoElemento(uma, DADOS_DE_EXEMPLO, estimarLarguraMm);
    expect(r1.linhas).toHaveLength(1);
    expect(r1.pt).toBeLessThan(8);
    // caixa de 3 mm só cabe uma linha de 8 pt (3,36 mm), mesmo pedindo 3
    const tres: ElementoTexto = { ...uma, h: 3, linhas: 3 };
    expect(linhasDoElemento(tres, DADOS_DE_EXEMPLO, estimarLarguraMm).linhas).toHaveLength(1);
    const altas: ElementoTexto = { ...uma, h: 12, linhas: 3 };
    expect(linhasDoElemento(altas, DADOS_DE_EXEMPLO, estimarLarguraMm).linhas.length).toBeGreaterThan(1);
  });
});

describe("desenhos por regra: composição e envio", () => {
  it("composição 23 × 48 (4 colunas): gira, tecido em 3 linhas, tamanho grande, loja no rodapé", () => {
    const m = layoutComposicao(opcoesIniciais("COMPOSICAO"));
    expect(m.girada).toBe(true);
    expect(m.colunas).toBe(4);
    const campos = m.elementos.filter((e) => e.tipo === "texto").map((e) => e.campo);
    expect(campos).toContain("composicao");
    expect(campos).toContain("tamanho");
    expect(campos).toContain("loja");
    const tamanho = m.elementos.find((e) => e.tipo === "texto" && e.campo === "tamanho") as ElementoTexto;
    expect(tamanho.pt).toBeGreaterThanOrEqual(10);
    expect(elementosCabem(m)).toBe(true);
  });

  it("envio 100 × 60: pedido, cliente, endereço em 2 linhas, CEP/telefone e remetente — tudo dentro", () => {
    const m = layoutEnvio(opcoesIniciais("ENVIO"));
    const campos = m.elementos.filter((e) => e.tipo === "texto").map((e) => e.campo);
    expect(campos).toEqual(expect.arrayContaining(["pedido", "cliente", "endereco", "bairro_cidade", "cep", "telefone", "remetente"]));
    expect(m.elementos.some((e) => e.tipo === "barras")).toBe(false);
    expect(elementosCabem(m)).toBe(true);
  });
});

describe("a lista de elementos gravada (JSON do editor)", () => {
  it("lê campo a campo; elemento torto cai fora; imagem só PNG/JPEG em data-URL", () => {
    const json = JSON.stringify([
      { tipo: "texto", campo: "produto", x: 1, y: 1, w: 30, h: 4, pt: 8, negrito: true, alinhar: "centro", linhas: 2 },
      { tipo: "texto", campo: "inventado", x: 1, y: 1, w: 30, h: 4, pt: 8 },
      { tipo: "texto", campo: "texto", texto: "Feito no Brasil", x: 1, y: 6, w: 30, h: 4, pt: 500 },
      { tipo: "barras", x: 1, y: 10, w: 40, h: 10, numero: false },
      { tipo: "imagem", x: 1, y: 1, w: 5, h: 5, src: PNG_1PX, bitmap: { w: 8, h: 1, hex: "FF" } },
      { tipo: "imagem", x: 1, y: 1, w: 5, h: 5, src: "javascript:alert(1)" },
      { tipo: "imagem", x: 1, y: 1, w: 5, h: 5, src: PNG_1PX, bitmap: { w: 8, h: 1, hex: "ZZ" } },
      { tipo: "texto", campo: "produto", x: -1, y: 1, w: 30, h: 4, pt: 8 },
    ]);
    const lidos = lerElementos(json)!;
    expect(lidos).toHaveLength(4);
    expect(lidos[0]).toEqual({ tipo: "texto", campo: "produto", x: 1, y: 1, w: 30, h: 4, pt: 8, negrito: true, alinhar: "centro", linhas: 2 });
    expect(lidos[1]).toEqual({ tipo: "barras", x: 1, y: 10, w: 40, h: 10, numero: false });
    expect(lidos[2]).toMatchObject({ tipo: "imagem", bitmap: { w: 8, h: 1, hex: "FF" } });
    // bitmap com hexadecimal inválido é descartado, a imagem fica
    expect(lidos[3]).toMatchObject({ tipo: "imagem" });
    expect((lidos[3] as { bitmap?: unknown }).bitmap).toBeUndefined();
    expect(lerElementos("nao é json")).toBeNull();
    expect(lerElementos(JSON.stringify({ x: 1 }))).toBeNull();
  });

  it("a linha gravada com elementos usa o desenho do editor; sem elementos, o desenho por regra do tipo", () => {
    const base = { tipo: "COMPOSICAO", larguraMm: 23, alturaMm: 48, colunas: 4, espacoMm: 2, girada: true, opcoes: "{}" };
    const porRegra = modeloDaLinhaGravada({ ...base, elementos: null });
    expect(porRegra.elementos.some((e) => e.tipo === "texto" && e.campo === "composicao")).toBe(true);
    const editado = modeloDaLinhaGravada({ ...base, elementos: JSON.stringify([{ tipo: "texto", campo: "loja", x: 0, y: 0, w: 10, h: 3, pt: 6 }]) });
    expect(editado.elementos).toHaveLength(1);
    expect(editado.girada).toBe(true);
    expect(editado.colunas).toBe(4);
  });
});

describe("imagem nas três saídas", () => {
  const modelo = {
    ...OPCOES_PADRAO,
    girada: false,
    elementos: [{ tipo: "imagem" as const, x: 2, y: 2, w: 4, h: 2, src: PNG_1PX, bitmap: { w: 32, h: 16, hex: "F".repeat(4 * 16 * 2) } }],
  };
  it("ZPL manda o bitmap como ^GF com os bytes por linha certos", () => {
    const z = zplDaEtiqueta(modelo, DADOS_DE_EXEMPLO);
    expect(z).toContain(`^GFA,64,64,4,${"F".repeat(128)}^FS`);
  });
  it("SVG desenha <image> com a data-URL", () => {
    expect(svgDaEtiqueta(modelo, DADOS_DE_EXEMPLO)).toContain(`<image x="2.00" y="2.00" width="4.00" height="2.00"`);
  });
  it("PDF embute a imagem uma vez (o documento tem um XObject de imagem)", async () => {
    const bytes = await pdfDoLote(modelo, [{ dados: DADOS_DE_EXEMPLO, quantidade: 3 }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Subtype /Image");
  });
  it("imagem sem bitmap não vai para a Zebra (o navegador rasteriza ao salvar)", () => {
    const z = zplDaEtiqueta({ ...modelo, elementos: [{ tipo: "imagem", x: 2, y: 2, w: 4, h: 2, src: PNG_1PX }] }, DADOS_DE_EXEMPLO);
    expect(z).not.toContain("^GF");
  });
});

describe("rasterizar (a parte pura)", () => {
  it("empacota bits em fileiras de bytes, 1 = preto, com o sobra da última fileira zerada", () => {
    const pretos = [true, false, false, false, false, false, false, false, true, true];
    expect(empacotarBits(pretos, 10, 1)).toBe("80C0");
  });
  it("escuro e opaco é preto; claro ou transparente é branco", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 10, 100, 100, 100, 255]);
    expect(pretosDoRgba(rgba, 4, 1)).toEqual([true, false, false, true]);
  });
});

describe("composição e remetente", () => {
  it("a peça herda a composição da categoria e só sobrescreve quando tem a dela", () => {
    const cat = new Map([["Regata", "8% elastano, 92% poliamida"]]);
    expect(composicaoEfetiva(null, cat, "Regata")).toBe("8% elastano, 92% poliamida");
    expect(composicaoEfetiva("  ", cat, "Regata")).toBe("8% elastano, 92% poliamida");
    expect(composicaoEfetiva("100% algodão", cat, "Regata")).toBe("100% algodão");
    expect(composicaoEfetiva(null, cat, "Calça")).toBe("");
  });
  it("remetente = loja e WhatsApp formatado (sem WhatsApp, só a loja)", () => {
    expect(remetenteDaLoja({ name: "Toque Leve", whatsapp: "5585988880000" })).toMatch(/^Toque Leve · /);
    expect(remetenteDaLoja({ name: "Toque Leve", whatsapp: null })).toBe("Toque Leve");
  });
});

describe("a área Etiquetas no menu", () => {
  it("só aparece com o módulo ligado, para toda a equipe", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain('href: "/etiquetas"');
    const item = { href: "/etiquetas", etiquetasOnly: true };
    expect(itemVisivel(item, { role: "SELLER", etiquetasEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "SUPPORT", etiquetasEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "ADMIN", etiquetasEnabled: false })).toBe(false);
  });
  it("o cartão saiu de Configurações: o módulo tem área própria", () => {
    const config = readFileSync(join(process.cwd(), "src/app/(app)/configuracoes/page.tsx"), "utf8");
    expect(config).not.toContain("EtiquetasSettings");
  });
});
