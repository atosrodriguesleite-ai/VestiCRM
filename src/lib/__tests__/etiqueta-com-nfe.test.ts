import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { limparChaveNfe } from "../bling";
import { opcoesFiscaisME } from "../melhorenvio";

// Guarda RN-016 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * Etiqueta com NF-e (chave de acesso) no lugar da declaração de conteúdo.
 *
 * O que não pode acontecer, e por isso está travado aqui:
 *  - chave torta chegar no Melhor Envio (ele recusa a COMPRA inteira e a loja
 *    fica sem etiqueta por causa de um caractere);
 *  - nota cancelada/rejeitada continuar valendo como nota da etiqueta;
 *  - a tela dizer "com NF-e" numa etiqueta que foi comprada como declaração.
 */

const ler = (p: string) => readFileSync(p, "utf8");

describe("limparChaveNfe", () => {
  const chave = "35240114200166000187550010000000015123456789";

  it("aceita a chave de 44 dígitos, com ou sem pontuação", () => {
    expect(limparChaveNfe(chave)).toBe(chave);
    expect(limparChaveNfe(` ${chave.slice(0, 22)} ${chave.slice(22)} `)).toBe(chave);
    expect(limparChaveNfe(`NFe${chave}`)).toBe(chave);
  });

  it("recusa qualquer coisa que não seja 44 dígitos", () => {
    expect(limparChaveNfe(chave.slice(0, 43))).toBeUndefined(); // curta
    expect(limparChaveNfe(chave + "1")).toBeUndefined(); // longa
    expect(limparChaveNfe("")).toBeUndefined();
    expect(limparChaveNfe(null)).toBeUndefined();
    expect(limparChaveNfe(undefined)).toBeUndefined();
    expect(limparChaveNfe(12345)).toBeUndefined();
    expect(limparChaveNfe({ key: chave })).toBeUndefined();
  });
});

describe("a chave só vale com a nota viva", () => {
  it("Bling só guarda a chave quando a nota está AUTORIZADA", () => {
    const bling = ler("src/lib/bling.ts");
    expect(bling).toContain('nfeKey: c.situacao === "AUTORIZADA" ? (c.chave ?? null) : null');
    // nota morta limpa a chave junto com o id
    expect(bling).toContain('nfeStatus: "REJEITADA", nfeKey: null');
  });

  it("a consulta manual segue a mesma regra", () => {
    const rota = ler("src/app/api/orders/[id]/nfe/route.ts");
    expect(rota).toContain('nfeKey: c.situacao === "AUTORIZADA" ? (c.chave ?? null) : null');
  });
});

describe("o que vai para o Melhor Envio", () => {
  const chave = "35240114200166000187550010000000015123456789";

  it("sem chave: declaração de conteúdo, sem invoice nenhum", () => {
    for (const v of [null, undefined, ""]) {
      const o = opcoesFiscaisME(v);
      expect(o).toEqual({ non_commercial: true });
      expect(o.invoice).toBeUndefined();
    }
  });

  it("com chave: a nota viaja e o non_commercial cai", () => {
    expect(opcoesFiscaisME(chave)).toEqual({
      non_commercial: false,
      invoice: { key: chave },
    });
  });

  it("chave torta vira declaração — a loja não fica sem etiqueta", () => {
    expect(opcoesFiscaisME(chave.slice(0, 40))).toEqual({ non_commercial: true });
    expect(opcoesFiscaisME("sem numero nenhum")).toEqual({ non_commercial: true });
  });
});

describe("compra da etiqueta", () => {
  it("a situação da nota é conferida no Bling ANTES de gastar o saldo", () => {
    const rota = ler("src/app/api/orders/[id]/frete/route.ts");
    const consulta = rota.indexOf("await consultarNfe(user.companyId, order.nfeBlingId!)");
    const compra = rota.indexOf("await meBuyShipment({");
    expect(consulta).toBeGreaterThan(-1);
    expect(consulta).toBeLessThan(compra);
    // nota morta derruba a compra em vez de virar etiqueta errada
    expect(rota).toContain('if (nota.situacao !== "AUTORIZADA")');
    expect(rota).toContain("nfeKey: chaveNfe");
  });

  it("só nota comprovadamente morta rebaixa o pedido", () => {
    const rota = ler("src/app/api/orders/[id]/frete/route.ts");
    // "EMITINDO" é o padrão do mapa do Bling para situação desconhecida —
    // rebaixar por causa dele perderia a chave de uma nota autorizada
    expect(rota).toContain(
      'if (nota.situacao === "CANCELADA" || nota.situacao === "REJEITADA")'
    );
  });

  it("Bling fora do ar não prende a etiqueta: a loja pode seguir sem a nota", () => {
    const rota = ler("src/app/api/orders/[id]/frete/route.ts");
    expect(rota).toContain("podeSemNota: true");
    expect(rota).toContain("semNota: z.boolean().optional()");
    expect(rota).toContain("if (temNota && !parsed.data.semNota)");
    const tela = ler("src/app/(app)/pedidos/[id]/envio-frete.tsx");
    expect(tela).toContain("Comprar mesmo assim, com declaração de conteúdo");
  });

  it("a etiqueta guarda a chave que FOI usada — não o estado atual da nota", () => {
    const rota = ler("src/app/api/orders/[id]/frete/route.ts");
    // grava nos dois lados do upsert (update e create)
    expect(rota.match(/nfeKey: r\.nfeKey/g)?.length).toBe(2);
    // e a tela lê da etiqueta, não do pedido
    const tela = ler("src/app/(app)/pedidos/[id]/envio-frete.tsx");
    expect(tela).toContain("ship?.nfeKey ?");
  });
});
