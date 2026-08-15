import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LOTE 3 — ESTOQUE E INTEGRAÇÕES (auditoria 07/08/2026). Guardas de arquivo:
 * Jueri desconta o que foi segurado, edição devolve pelo livro, pedido da
 * Nuvemshop não baixa estoque aqui, token criptografado, estoque "infinito"
 * e SKU duplicado.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("pedido do catálogo → Jueri desconta o que foi SEGURADO", () => {
  const rota = ler("src/app/api/catalog/order/route.ts");
  it("a lista segurada sai da transação e alimenta o push", () => {
    expect(rota).toContain("seguradas = reserva.seguradas");
    expect(rota).toContain(
      "seguradas.map((s) => ({ variantId: s.variantId, delta: -s.quantity }))"
    );
  });
  it("a quantidade PEDIDA não vai mais para a Jueri", () => {
    expect(rota).not.toContain(".map((i) => ({ variantId: i.variantId!, delta: -i.quantity }))");
  });
});

describe("edição de pedido devolve pelo LIVRO DE MOVIMENTOS", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");
  it("lê o que o pedido segurou de verdade antes de devolver", () => {
    expect(rota).toContain("baixasLiquidasDoPedido(tx, order.id)");
    expect(rota).toContain("segurado + baixar - agora");
  });
  it("as integrações espelham o delta EFETIVO da edição", () => {
    expect(rota).toContain("efetivos.map((e) => ({ variantId: e.variantId, delta: -e.delta }))");
  });
});

describe("pedido da Nuvemshop NÃO mexe em estoque no CRM", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");
  it("transição de status ignora estoque quando a dona é a Nuvemshop", () => {
    expect(rota).toContain("const estoqueDaqui = !order.nuvemshopId");
    expect(rota).toContain("&& estoqueDaqui");
  });
  it("edição de itens também fica de fora", () => {
    expect(rota).toContain("order.stockDeducted && !order.nuvemshopId");
  });
});

describe("token da Jueri criptografado em repouso", () => {
  it("conectar grava com encryptSecret", () => {
    expect(ler("src/app/api/jueri/conectar/route.ts")).toContain("encryptSecret(token)");
  });
  it("as leituras passam por decryptSecret (legado em texto puro segue ok)", () => {
    expect(ler("src/lib/jueri.ts")).toContain("decryptSecret(conn.token)");
    expect(ler("src/lib/jueri-sync.ts")).toContain("decryptSecret(conn.token)");
  });
});

describe("estoque 'infinito' da Nuvemshop (stock null)", () => {
  const ns = ler("src/lib/nuvemshop.ts");
  it("null vira o espelho 9999 (disponível), nunca zero", () => {
    expect(ns).toContain("ESTOQUE_INFINITO = 9999");
    expect(ns).toContain("v.stock == null ? ESTOQUE_INFINITO");
    expect(ns).not.toContain("Math.max(0, v.stock ?? 0)");
  });
  it("o push NUNCA devolve a zona do infinito para a loja online", () => {
    expect(ns).toContain("v.stock >= ZONA_INFINITO) continue");
  });
});

describe("SKU duplicado não casa sozinho (incidente Toque Leve)", () => {
  it("só SKU único no catálogo entra no casamento automático", () => {
    const ns = ler("src/lib/nuvemshop.ts");
    expect(ns).toContain('vezesPorSku.get(norm(v.sku)) === 1');
  });
});

describe("sync da Jueri respeita o trabalho manual e não morre no meio", () => {
  const sync = ler("src/lib/jueri-sync.ts");
  it("produto existente NÃO tem nome/categoria sobrescritos", () => {
    // "name: nome" e "category: categoria" só podem aparecer na CRIAÇÃO
    expect(sync.match(/name: nome,/g)?.length ?? 0).toBe(1);
    expect(sync.match(/category: categoria,/g)?.length ?? 0).toBe(1);
    expect(sync).toContain("nome e categoria NÃO são sobrescritos");
  });
  it("página que falha ganha nova tentativa e o erro diz a página", () => {
    expect(sync).toContain("parou na página");
  });
  it("o cron prioriza a loja que ficou para trás", () => {
    const cron = ler("src/app/api/cron/jueri-sync/route.ts");
    expect(cron).toContain('nulls: "first"');
  });
});
