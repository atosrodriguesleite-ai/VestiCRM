import { describe, it, expect } from "vitest";
import {
  CAMPOS_DO_PEDIDO,
  dadosAceitos,
  lerCamposDaLoja,
  type ConfigCampo,
} from "../catalogo/campos-do-pedido";

// Guarda RN-027
//
// Campos extras do pedido do catálogo, escolhidos POR LOJA: cardápio fechado
// (cada campo cai numa coluna da ficha), recorte por lista no servidor, e a
// loja que não configura nada não muda em NADA.

describe("RN-027 — campos do pedido do catálogo escolhidos por loja", () => {
  it("loja sem configuração não muda em NADA: nada digitado entra na ficha", () => {
    // é a garantia de que a novidade não mexe com quem não pediu por ela
    expect(dadosAceitos([], { CEP: "57000-000", BAIRRO: "Centro" })).toEqual({});
    expect(lerCamposDaLoja("")).toEqual([]);
    expect(lerCamposDaLoja(null)).toEqual([]);
  });

  it("recorte por lista: só entra o que a LOJA configurou, o resto é descartado", () => {
    const config: ConfigCampo[] = [{ campo: "CEP", obrigatorio: true }];
    const aceito = dadosAceitos(config, {
      CEP: "57000-000",
      BAIRRO: "Centro", // não configurado: o navegador não decide o que entra
      CIDADE: "Maceió",
    });
    expect(aceito).toEqual({ zip: "57000-000" });
  });

  it("campo em branco não apaga nada (não sai no recorte), e espaço não vira dado", () => {
    const config: ConfigCampo[] = [
      { campo: "CEP", obrigatorio: false },
      { campo: "BAIRRO", obrigatorio: false },
    ];
    expect(dadosAceitos(config, { CEP: "   ", BAIRRO: undefined })).toEqual({});
  });

  it("obrigatório NÃO trava o servidor: pedido sem o campo segue valendo (RN-010)", () => {
    // o reenvio automático guarda payload antigo — recusar perderia a venda
    const config: ConfigCampo[] = [{ campo: "CEP", obrigatorio: true }];
    expect(dadosAceitos(config, {})).toEqual({});
  });

  it("cada campo cai na coluna certa da ficha, com limpeza e UF traduzida", () => {
    const config: ConfigCampo[] = (Object.keys(CAMPOS_DO_PEDIDO) as (keyof typeof CAMPOS_DO_PEDIDO)[]).map(
      (campo) => ({ campo, obrigatorio: false })
    );
    const aceito = dadosAceitos(config, {
      CEP: " 57000-000 ",
      ENDERECO: "Rua  das   Flores, 123",
      BAIRRO: "Centro",
      CIDADE: "Maceió",
      ESTADO: "al",
    });
    expect(aceito).toEqual({
      zip: "57000-000",
      // rua e número SEPARADOS: a régua da etiqueta exige os dois, e tudo
      // numa coluna só deixava a ficha eternamente "incompleta"
      street: "Rua das Flores",
      streetNumber: "123",
      district: "Centro",
      city: "Maceió",
      state: "AL", // uf minúscula sai certa nos documentos e no mapa
    });
  });

  it("UF por extenso vira sigla; o que não é UF fica como veio", () => {
    const config: ConfigCampo[] = [{ campo: "ESTADO", obrigatorio: false }];
    expect(dadosAceitos(config, { ESTADO: "alagoas" })).toEqual({ state: "AL" });
    expect(dadosAceitos(config, { ESTADO: "São Paulo" })).toEqual({ state: "SP" });
    // texto que não é estado NÃO é adivinhado — segue como veio, e etiqueta
    // e NF-e reclamam com motivo em vez de sair com UF inventada
    expect(dadosAceitos(config, { ESTADO: "Reino da Lua" })).toEqual({ state: "Reino da Lua" });
  });

  it("endereço separa a rua do número nos formatos comuns; sem número, tudo é rua", () => {
    const config: ConfigCampo[] = [{ campo: "ENDERECO", obrigatorio: false }];
    expect(dadosAceitos(config, { ENDERECO: "Av. Central, s/n" })).toEqual({
      street: "Av. Central",
      streetNumber: "s/n",
    });
    expect(dadosAceitos(config, { ENDERECO: "Rua A 45" })).toEqual({
      street: "Rua A",
      streetNumber: "45",
    });
    expect(dadosAceitos(config, { ENDERECO: "Rua das Flores, 123B" })).toEqual({
      street: "Rua das Flores",
      streetNumber: "123B",
    });
    // sem número reconhecível: a compra da etiqueta segue pedindo o número,
    // como sempre pediu — melhor faltar do que inventar
    expect(dadosAceitos(config, { ENDERECO: "Sítio Boa Esperança" })).toEqual({
      street: "Sítio Boa Esperança",
    });
  });

  it("valor comprido é cortado no teto do campo (nada estoura a ficha)", () => {
    const config: ConfigCampo[] = [{ campo: "BAIRRO", obrigatorio: false }];
    const aceito = dadosAceitos(config, { BAIRRO: "x".repeat(500) });
    expect(aceito.district).toHaveLength(CAMPOS_DO_PEDIDO.BAIRRO.max);
  });

  it("a configuração gravada é lida com tolerância: lixo não derruba o catálogo", () => {
    // campo desconhecido e repetido somem; formato quebrado = lista vazia
    expect(
      lerCamposDaLoja(
        JSON.stringify([
          { campo: "CEP", obrigatorio: true },
          { campo: "CEP", obrigatorio: false }, // repetido: vale o primeiro
          { campo: "CPF", obrigatorio: true }, // fora do cardápio: descartado
          { campo: 42 },
          null,
        ])
      )
    ).toEqual([{ campo: "CEP", obrigatorio: true }]);
    expect(lerCamposDaLoja("não é json")).toEqual([]);
    expect(lerCamposDaLoja('{"campo":"CEP"}')).toEqual([]); // objeto solto ≠ lista
  });
});
