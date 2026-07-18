import { describe, it, expect } from "vitest";
import { parseNuvemshopCsv } from "../nuvemshop-simulacao";

// planilha no formato oficial da Nuvemshop (Produtos → Exportar):
// separador ";", uma linha por variação, nome só na 1ª linha do produto
const CSV_OFICIAL = [
  "Identificador de URL;Nome;Categorias;Nome da propriedade 1;Valor da propriedade 1;Nome da propriedade 2;Valor da propriedade 2;Preço;Estoque;SKU",
  "baby-look;Baby Look;Camisetas;Cor;Branco;Tamanho;P;59,90;30;NS-BABY-BRANCO-P",
  "baby-look;;;Cor;Branco;Tamanho;M;59,90;31;NS-BABY-BRANCO-M",
  "baby-look;;;Cor;Preto;Tamanho;P;59,90;32;NS-BABY-PRETO-P",
  "body-canelado;Body Canelado;Bodys;Cor;Off White;Tamanho;Único;89,90;5;NS-BODY-OW",
].join("\n");

describe("parseNuvemshopCsv (relatório pré-conexão)", () => {
  it("lê o export oficial: agrupa variações por produto", () => {
    const prods = parseNuvemshopCsv(CSV_OFICIAL);
    expect(prods).toHaveLength(2);
    expect(prods[0].name).toBe("Baby Look");
    expect(prods[0].variants).toHaveLength(3);
    expect(prods[0].variants[0]).toEqual({
      color: "Branco",
      size: "P",
      sku: "NS-BABY-BRANCO-P",
      stock: 30,
    });
    expect(prods[1].name).toBe("Body Canelado");
    expect(prods[1].variants[0].color).toBe("Off White");
  });

  it("carrega o nome do produto pras linhas de variação sem nome", () => {
    const prods = parseNuvemshopCsv(CSV_OFICIAL);
    expect(prods[0].variants.map((v) => v.size)).toEqual(["P", "M", "P"]);
  });

  it("aceita células com aspas e separador dentro do texto", () => {
    const csv = [
      "Identificador de URL;Nome;Nome da propriedade 1;Valor da propriedade 1;Estoque;SKU",
      'vestido;"Vestido; Festa";Cor;Vinho;10;VF-01',
    ].join("\n");
    const prods = parseNuvemshopCsv(csv);
    expect(prods[0].name).toBe("Vestido; Festa");
    expect(prods[0].variants[0].sku).toBe("VF-01");
  });

  it("aceita planilha simples com colunas diretas (Nome/Cor/Tamanho)", () => {
    const csv = [
      "Nome,Cor,Tamanho,SKU,Estoque",
      "Cropped,Rosa,P,CR-ROSA-P,7",
      "Cropped,Rosa,M,CR-ROSA-M,8",
    ].join("\n");
    const prods = parseNuvemshopCsv(csv);
    expect(prods).toHaveLength(1);
    expect(prods[0].variants).toHaveLength(2);
    expect(prods[0].variants[1]).toEqual({
      color: "Rosa",
      size: "M",
      sku: "CR-ROSA-M",
      stock: 8,
    });
  });

  it("ignora BOM do Excel e linhas vazias", () => {
    const csv = "﻿Nome;Cor;Tamanho;SKU;Estoque\nBlusa;Azul;M;BL-1;3\n\n";
    const prods = parseNuvemshopCsv(csv);
    expect(prods).toHaveLength(1);
    expect(prods[0].variants[0].stock).toBe(3);
  });

  it("devolve vazio pra arquivo que não é uma planilha de produtos", () => {
    expect(parseNuvemshopCsv("qualquer texto solto")).toEqual([]);
    expect(parseNuvemshopCsv("")).toEqual([]);
  });
});
