import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  horarioComercialSP,
  sacolaDaFoto,
  itensDoCheckoutNS,
  lerItens,
  mensagemDeRecuperacao,
  resumoDaSacola,
  sacolaDosEventos,
} from "../recuperacao";

/**
 * RECUPERAÇÃO DE CARRINHOS — pedido do dono (01/08/2026): campanha "mais
 * dinâmica e interativa" para carrinho abandonado, do catálogo e da
 * Nuvemshop, com 1ª mensagem automática + esteira para a vendedora.
 */

describe("sacola remontada dos eventos de navegação", () => {
  it("soma adds e desconta removes por produto/cor/tamanho", () => {
    const itens = sacolaDosEventos([
      { type: "cart_add", productId: "p1", productName: "Vestido Midi", color: "Rosa", size: "P", qty: 2, value: 189.9 },
      { type: "cart_add", productId: "p1", productName: "Vestido Midi", color: "Rosa", size: "P", qty: 1 },
      { type: "cart_remove", productId: "p1", productName: "Vestido Midi", color: "Rosa", size: "P", qty: 1 },
      { type: "cart_add", productId: "p2", productName: "Blusa", color: "Preto", size: "M", qty: 1 },
      { type: "product_view", productId: "p3", productName: "Short" },
    ]);
    expect(itens).toEqual([
      { productId: "p1", name: "Vestido Midi", color: "Rosa", size: "P", qty: 2, price: 189.9 },
      { productId: "p2", name: "Blusa", color: "Preto", size: "M", qty: 1, price: null },
    ]);
  });

  it("item que foi todo removido NÃO volta na sacola", () => {
    const itens = sacolaDosEventos([
      { type: "cart_add", productId: "p1", productName: "Blusa", qty: 2 },
      { type: "cart_remove", productId: "p1", productName: "Blusa", qty: 2 },
    ]);
    expect(itens).toEqual([]);
  });

  it("evento torto não quebra", () => {
    expect(sacolaDosEventos([{ type: "cart_add", productName: "" }])).toEqual([]);
    expect(sacolaDosEventos([])).toEqual([]);
  });
});

describe("checkout da Nuvemshop vira itens nossos", () => {
  it("lê produto, variantes, quantidade e preço", () => {
    expect(
      itensDoCheckoutNS({
        id: 123,
        products: [
          { name: "Vestido Aurora", quantity: "2", price: "159.90", variant_values: ["Rosa", "M"] },
          { name: "Blusa", quantity: 1, price: 89.9 },
        ],
      })
    ).toEqual([
      { name: "Vestido Aurora", color: "Rosa", size: "M", qty: 2, price: 159.9 },
      { name: "Blusa", color: null, size: null, qty: 1, price: 89.9 },
    ]);
  });

  it("payload vazio ou torto vira lista vazia", () => {
    expect(itensDoCheckoutNS({})).toEqual([]);
    expect(itensDoCheckoutNS({ products: [{ name: "" }] })).toEqual([]);
  });
});

describe("a mensagem de recuperação", () => {
  const cart = {
    id: "cart123",
    source: "CATALOGO",
    items: JSON.stringify([
      { name: "Vestido Midi", color: "Rosa", size: "P", qty: 2 },
    ]),
    checkoutUrl: null,
  };

  it("chama pelo primeiro nome, lista as peças e leva o LINK MÁGICO", () => {
    const msg = mensagemDeRecuperacao(cart, "bella-moda", "Sibelle Freitas");
    expect(msg).toContain("Oi Sibelle!");
    expect(msg).toContain("2× Vestido Midi · Rosa · P");
    expect(msg).toContain("?sacola=cart123");
  });

  it("carrinho da Nuvemshop usa o link de retomada DELES", () => {
    const msg = mensagemDeRecuperacao(
      { ...cart, source: "NUVEMSHOP", checkoutUrl: "https://loja.com/checkout/abc" },
      "bella-moda",
      "Ana"
    );
    expect(msg).toContain("https://loja.com/checkout/abc");
    expect(msg).not.toContain("?sacola=");
  });

  it("sem link nenhum, convida a fechar pela conversa (nunca fica sem saída)", () => {
    const msg = mensagemDeRecuperacao(
      { ...cart, source: "NUVEMSHOP", checkoutUrl: null },
      "bella-moda",
      null
    );
    expect(msg).toContain("finalize seu pedido por aqui");
  });

  it("resumo corta em 4 e avisa quantos ficaram de fora", () => {
    const itens = Array.from({ length: 6 }, (_, i) => ({ name: `Peça ${i + 1}`, qty: 1 }));
    expect(resumoDaSacola(itens)).toContain("e mais 2 itens…");
  });

  it("lerItens aguenta JSON torto", () => {
    expect(lerItens("não é json")).toEqual([]);
    expect(lerItens("{}")).toEqual([]);
  });
});

describe("mensagem automática só em horário decente", () => {
  it("8h–20h de São Paulo pode; madrugada não", () => {
    // 15h UTC = 12h em SP → pode
    expect(horarioComercialSP(new Date("2026-08-01T15:00:00Z"))).toBe(true);
    // 06h UTC = 03h em SP → não
    expect(horarioComercialSP(new Date("2026-08-01T06:00:00Z"))).toBe(false);
  });
});

describe("o sistema está amarrado", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("a varredura pega carona no sync da inbox (SEM cron novo — Vercel Hobby)", () => {
    const rota = ler("src/app/api/conversations/route.ts");
    expect(rota).toContain("varrerCarrinhosSeDeuAHora());");
  });

  it("a 1ª mensagem automática NASCE DESLIGADA (decisão da loja)", () => {
    expect(ler("prisma/schema.prisma")).toContain("recoveryAuto      Boolean  @default(false)");
  });

  it("marca o envio ANTES de enviar (corrida nunca manda duas vezes)", () => {
    const lib = ler("src/lib/recuperacao.ts");
    expect(lib).toContain("where: { id: cart.id, autoSentAt: null }");
    expect(lib.indexOf("autoSentAt: new Date()")).toBeLessThan(lib.indexOf("await sendMessage"));
  });

  it("o link mágico só devolve ITENS e confere a loja do slug", () => {
    const rota = ler("src/app/api/catalogo/sacola/route.ts");
    expect(rota).toContain("company: { slug }");
    expect(rota).not.toContain("phone");
    expect(rota).not.toContain("customer");
  });

  it("o catálogo remonta a sacola do ?sacola= e abre a sacola", () => {
    const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(cat).toContain('get("sacola")');
    expect(cat).toContain("setBagOpen(true)");
  });

  it("o placar soma o pedido pago amarrado (netTotal), não achismo — e é função ÚNICA", () => {
    // a conta mora em placarDeRecuperacao, compartilhada com o Painel de
    // Recompra: duas contas separadas um dia discordariam
    const lib = ler("src/lib/recuperacao.ts");
    expect(lib).toContain("export async function placarDeRecuperacao");
    expect(lib).toContain("netTotal");
    expect(ler("src/app/api/recuperacao/route.ts")).toContain("placarDeRecuperacao(");
  });
});


describe("auditoria 01/08: a sacola vem da FOTO, não da reconstrução", () => {
  it("lê a foto gravada no evento (meta.sacola)", () => {
    expect(
      sacolaDaFoto(
        JSON.stringify({
          sacola: [
            { productId: "p1", name: "Vestido", color: "Rosa", size: "M", qty: 2, price: 189.9 },
            { name: "", qty: 3 }, // lixo é filtrado
          ],
        })
      )
    ).toEqual([
      { productId: "p1", name: "Vestido", color: "Rosa", size: "M", qty: 2, price: 189.9 },
    ]);
  });

  it("meta torta ou sem sacola devolve null (cai na reconstrução)", () => {
    for (const v of [null, undefined, "", "lixo", "{}", JSON.stringify({ sacola: [] })]) {
      expect(sacolaDaFoto(v)).toBeNull();
    }
  });

  it("a reconstrução (plano B) peneira tamanho composto — 'P,M' não é variante", () => {
    const lib = readFileSync(join(process.cwd(), "src/lib/recuperacao.ts"), "utf8");
    expect(lib).toContain('!i.size?.includes(",")');
    expect(lib).toContain("sacolaDaFoto(e.meta)");
  });

  it("o catálogo grava a foto nos DOIS emissores (ficha e lixinho)", () => {
    const cat = readFileSync(
      join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
      "utf8"
    );
    expect(cat.split("meta: { sacola: fotoDaSacola(").length).toBe(3);
  });
});

describe("auditoria 01/08: cintos do motor", () => {
  const lib = readFileSync(join(process.cwd(), "src/lib/recuperacao.ts"), "utf8");

  it("mensagem automática SÓ com o WhatsApp conectado (senão queimava o carrinho sem mensagem)", () => {
    expect(lib).toContain('evolutionStatus !== "CONECTADO"');
  });

  it("UM pedido fecha UM carrinho (o placar não pode dobrar)", () => {
    expect(lib).toContain("id: { notIn: [...jaUsados] }");
    expect(lib).toContain("vistos.has(c.recoveredOrderId)");
  });

  it("a Nuvemshop lenta não segura a varredura (timeout de 5s)", () => {
    expect(lib).toContain("AbortSignal.timeout(5_000)");
  });

  it("o mês do placar é no calendário de São Paulo (mesma régua do Painel)", () => {
    const rota = readFileSync(join(process.cwd(), "src/app/api/recuperacao/route.ts"), "utf8");
    expect(rota).toContain("inicioDoMesSP()");
  });

  it("a sacola restaurada respeita estoque e mescla POR TAMANHO", () => {
    const cat = readFileSync(
      join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
      "utf8"
    );
    expect(cat).toContain("sz.size === item.size && sz.available");
    expect(cat).toContain("...(proximo[key] ?? {}), ...sizes");
  });
});
