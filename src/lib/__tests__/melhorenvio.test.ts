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
import { pessoaME, volumesDoEnvio } from "../melhorenvio";
import { pesoDivergente } from "../peso-pacote";
import { numeroBR } from "../numero-br";

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

  it("a cotação DEVOLVE os volumes que declarou (fonte única, sem re-derivar)", () => {
    expect(lib).toContain("pacotes = volumesDoEnvio(");
    expect(rota).toContain("volumesUsados: r.pacotes");
  });

  it("a compra usa os MESMOS volumes da cotação (fonte única volumesDoEnvio)", () => {
    // `volumesEfetivos` = manual → pacote por categoria (RN-019) → caixa
    // padrão, decidido UMA vez e usado na cotação E na compra — etiqueta com
    // medida diferente da cotada vira ajuste de valor na transportadora
    expect(rota).toMatch(/\n\s*volumes: volumesEfetivos,\s*\n\s*orderLabel/);
    expect(rota).toContain("volumes: volumesEfetivos,");
    expect(lib).toContain("volumes: volumesDoEnvio(input.volumes, input.weightKg, conn)");
  });

  it("a tela PRENDE volumes e seguro cotados e recusa comprar com número editado", () => {
    expect(tela).toContain("setVolsCotados(usados)");
    expect(tela).toContain("setSeguroCotado(d.seguroUsado)");
    expect(tela).toContain("Clique em Recotar para atualizar os preços antes de comprar");
  });

  it("o seguro da COMPRA é o da cotação aceita — nunca um recálculo", () => {
    // recalcular na compra debitaria diferente do preço confirmado no botão
    expect(rota).toContain("const seguroCompra = parsed.data.seguroValor ?? valorPecas;");
    expect(rota).toContain("insuranceValue: seguroCompra");
    // com NF-e o seguro TEM de ser o valor das peças: nota que entrou depois
    // da cotação recusa a compra e manda recotar (nada é cobrado)
    expect(rota).toContain("if (chaveNfe && Math.abs(seguroCompra - valorPecas) > 0.009)");
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

describe("volumes do envio (medidos x automático)", () => {
  const caixa = { boxWidthCm: 30, boxHeightCm: 15, boxLengthCm: 40 };

  it("sem medidas: UMA caixa padrão com o peso somado das peças", () => {
    expect(volumesDoEnvio(undefined, 4.95, caixa)).toEqual([
      { pesoKg: 4.95, alturaCm: 15, larguraCm: 30, comprimentoCm: 40 },
    ]);
  });

  it("com medidas: vale exatamente o que a lojista mediu (1 ou N volumes)", () => {
    const medidos = [
      { pesoKg: 8, alturaCm: 20, larguraCm: 40, comprimentoCm: 60 },
      { pesoKg: 5, alturaCm: 10, larguraCm: 30, comprimentoCm: 30 },
    ];
    expect(volumesDoEnvio(medidos, 4.95, caixa)).toEqual(medidos);
  });
});

describe("número do jeito brasileiro (o '1.500' que virava R$ 1,50)", () => {
  it("vírgula é decimal; ponto pode ser milhar", () => {
    expect(numeroBR("4,95")).toBe(4.95);
    expect(numeroBR("1.500")).toBe(1500); // milhar — ERA lido como 1.5
    expect(numeroBR("1.500,50")).toBe(1500.5);
    expect(numeroBR("12.345.678")).toBe(12345678);
  });

  it("decimal com ponto continua funcionando (quem digita '4.95')", () => {
    expect(numeroBR("4.95")).toBe(4.95);
    expect(numeroBR("0.5")).toBe(0.5);
    expect(numeroBR("150")).toBe(150);
  });

  it("lixo vira null, nunca NaN solto", () => {
    expect(numeroBR("")).toBeNull();
    expect(numeroBR("abc")).toBeNull();
    expect(numeroBR("  ")).toBeNull();
  });
});

describe("peso suspeito (balança x cadastro)", () => {
  it("avisa no dobro ou na metade — fora disso, silêncio", () => {
    expect(pesoDivergente(10, 5)).toBe(true); // 2×
    expect(pesoDivergente(2, 4.2)).toBe(true); // < metade
    expect(pesoDivergente(6, 5)).toBe(false); // diferença normal
    expect(pesoDivergente(5, 5)).toBe(false);
  });

  it("sem referência não há aviso (nunca trava o envio)", () => {
    expect(pesoDivergente(0, 5)).toBe(false);
    expect(pesoDivergente(5, 0)).toBe(false);
  });
});
