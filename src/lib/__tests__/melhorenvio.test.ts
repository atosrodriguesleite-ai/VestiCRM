import { describe, it, expect } from "vitest";
import { pesoDoPedidoKg } from "../melhorenvio";

// Padrões de embalagem da loja usados nos cenários
const conn = {
  defaultWeightGrams: 300,
  categoryWeights: JSON.stringify({ Vestidos: 350, Calças: 600 }),
  boxWidthCm: 30,
  boxHeightCm: 15,
  boxLengthCm: 40,
};

describe("pesoDoPedidoKg (módulo Envios)", () => {
  it("usa o peso do produto quando cadastrado", () => {
    const kg = pesoDoPedidoKg(
      [{ quantity: 10, product: { weightGrams: 250, category: "Blusas" } }],
      conn
    );
    expect(kg).toBe(2.5);
  });

  it("cai para o padrão da categoria e depois para o padrão da loja", () => {
    const kg = pesoDoPedidoKg(
      [
        // sem peso próprio, categoria com padrão (350 g)
        { quantity: 2, product: { weightGrams: null, category: "Vestidos" } },
        // sem peso próprio, categoria sem padrão → padrão da loja (300 g)
        { quantity: 1, product: { weightGrams: 0, category: "Acessórios" } },
        // produto apagado (snapshot) → padrão da loja
        { quantity: 1, product: null },
      ],
      conn
    );
    expect(kg).toBe(1.3); // 700 + 300 + 300 = 1300 g
  });

  it("nunca devolve zero e ignora JSON de categorias quebrado", () => {
    const kg = pesoDoPedidoKg([], conn);
    expect(kg).toBe(0.05);
    const kg2 = pesoDoPedidoKg(
      [{ quantity: 1, product: { weightGrams: null, category: "Vestidos" } }],
      { ...conn, categoryWeights: "{quebrado" }
    );
    expect(kg2).toBe(0.3); // caiu no padrão da loja sem explodir
  });
});

/**
 * MEDIDAS REAIS DO PACOTE + DOCUMENTO NA ETIQUETA (pedido do dono,
 * 17/08/2026). No atacado a caixa muda a cada pedido: a lojista pesa e mede,
 * a cotação usa as medidas dela, e a COMPRA repete exatamente as medidas da
 * cotação aceita — medida diferente da cotada vira ajuste de valor na
 * transportadora.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pessoaME } from "../melhorenvio";

const enderecoBase = {
  name: "Milena",
  cpf: null,
  cnpj: null,
  phone: "33988466229",
  email: null,
  zip: "35280000",
  street: "Rua Francisco Lobo",
  number: "83",
  complement: null,
  district: "Centro",
  city: "Itabirinha",
  state: "MG",
};

describe("documento da etiqueta (pessoaME)", () => {
  it("CNPJ com Inscrição Estadual → state_register vai junto", () => {
    const p = pessoaME({
      ...enderecoBase,
      cnpj: "11.222.333/0001-81",
      stateRegistration: "062.307.904-0084",
    });
    expect(p.company_document).toBe("11222333000181");
    expect(p.state_register).toBe("0623079040084");
  });

  it("IE sem CNPJ NÃO sai (IE órfã confundiria a transportadora)", () => {
    const p = pessoaME({
      ...enderecoBase,
      cpf: "529.982.247-25",
      stateRegistration: "0623079040084",
    });
    expect(p.document).toBe("52998224725");
    expect(p.state_register).toBeUndefined();
  });

  it("CNPJ sem IE segue normal (IE não é obrigatória)", () => {
    const p = pessoaME({ ...enderecoBase, cnpj: "11222333000181" });
    expect(p.company_document).toBe("11222333000181");
    expect(p.state_register).toBeUndefined();
  });
});

describe("medidas da cotação viajam até a compra (varredura por fonte)", () => {
  const lib = readFileSync(join(process.cwd(), "src/lib/melhorenvio.ts"), "utf8");
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/orders/[id]/frete/route.ts"),
    "utf8"
  );
  const tela = readFileSync(
    join(process.cwd(), "src/app/(app)/pedidos/[id]/envio-frete.tsx"),
    "utf8"
  );

  it("a cotação DEVOLVE o pacote que declarou (fonte única, sem re-derivar)", () => {
    expect(lib).toContain("pacote");
    expect(rota).toContain("medidasUsadas: { ...r.pacote");
  });

  it("a compra usa as MESMAS medidas da cotação (dims na compra e no volume)", () => {
    expect(rota).toMatch(/insuranceValue: valorPecas,\s*\/\/[^\n]*\n[^\n]*\n\s*dims,/);
    expect(lib).toContain("input.dims?.widthCm ?? conn.boxWidthCm");
  });

  it("a tela PRENDE as medidas cotadas e recusa comprar com medida editada", () => {
    expect(tela).toContain("setMedCotadas({");
    expect(tela).toContain("Clique em Recotar para atualizar os preços antes de comprar");
  });

  it("a compra exige o cadastro completo (bairro, telefone e CPF ou CNPJ)", () => {
    expect(rota).toContain('"bairro"');
    expect(rota).toContain('"telefone"');
    expect(rota).toContain('"CPF ou CNPJ"');
  });

  it("apagar o CNPJ leva a IE junto (regra no servidor, não só na tela)", () => {
    const clientes = readFileSync(
      join(process.cwd(), "src/app/api/customers/[id]/route.ts"),
      "utf8"
    );
    expect(clientes).toContain("if (!cnpjFinal) data.stateRegistration = null;");
  });
});
