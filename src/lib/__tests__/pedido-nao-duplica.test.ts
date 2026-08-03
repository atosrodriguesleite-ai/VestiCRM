import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  protocoloDaSacola,
  assinaturaDoPedido,
  VALIDADE_TRAVA_MS,
} from "../catalogo/envio-pedido";

/**
 * O MESMO PEDIDO NÃO PODE VIRAR DOIS.
 *
 * Incidente real (Toque Leve, cliente Alaute): a vendedora recebeu o MESMO
 * pedido duas vezes no WhatsApp e o pedido demorou a chegar no sistema.
 *
 * O protocolo era SORTEADO a cada clique. Ele protegia a reinsistência
 * automática (que reusa o mesmo) e não protegia o dedo da cliente: com o
 * registro lento, ela mandava pelo WhatsApp, voltava ao catálogo, via a
 * sacola ainda cheia e apertava de novo — protocolo novo, SEGUNDO pedido,
 * mesma peça reservada duas vezes no estoque.
 *
 * Agora o protocolo é preso à SACOLA e guardado no aparelho.
 */

/** Memória de navegador de mentirinha (o teste não tem localStorage). */
function memoria(inicial: Record<string, string> = {}) {
  const dados = { ...inicial };
  return {
    getItem: (k: string) => dados[k] ?? null,
    setItem: (k: string, v: string) => {
      dados[k] = v;
    },
    removeItem: (k: string) => {
      delete dados[k];
    },
  };
}

const item = (productId: string, size = "M", quantity = 1) => ({
  productId,
  color: "Terracota",
  size,
  quantity,
});

const sacola = (
  itens: ReturnType<typeof item>[],
  phone = "33988215434"
) => ({
  company: "toque-leve",
  items: itens,
  customer: { name: "Alaute", phone },
});

describe("protocolo preso à sacola", () => {
  it("dois cliques na MESMA sacola devolvem o mesmo protocolo", () => {
    const s = memoria();
    const p = sacola([item("a"), item("b")]);
    const primeiro = protocoloDaSacola(s, p);
    const segundo = protocoloDaSacola(s, p);
    expect(segundo).toBe(primeiro);
  });

  it("vale mesmo com minutos de diferença — é o caso do incidente", () => {
    const s = memoria();
    const p = sacola([item("a")]);
    const t = Date.UTC(2026, 6, 31, 14, 0);
    expect(protocoloDaSacola(s, p, t + 3 * 60_000)).toBe(protocoloDaSacola(s, p, t));
  });

  it("a ordem em que as peças entraram não muda nada", () => {
    const s = memoria();
    const a = protocoloDaSacola(s, sacola([item("a"), item("b")]));
    const b = protocoloDaSacola(s, sacola([item("b"), item("a")]));
    expect(b).toBe(a);
  });

  it("mudou a sacola, protocolo novo — é pedido de verdade", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, sacola([item("a")]));
    const dois = protocoloDaSacola(s, sacola([item("a"), item("b")]));
    expect(dois).not.toBe(um);
  });

  it("mudou só a quantidade também é pedido novo", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, sacola([item("a", "M", 1)]));
    const dois = protocoloDaSacola(s, sacola([item("a", "M", 2)]));
    expect(dois).not.toBe(um);
  });

  it("REPOSIÇÃO depois da validade vira pedido novo", () => {
    // no atacado, repor exatamente as mesmas peças semanas depois é o normal.
    // Se a trava não vencesse, a reposição nunca viraria pedido.
    const s = memoria();
    const p = sacola([item("a")]);
    const t = Date.UTC(2026, 6, 31, 10, 0);
    const hoje = protocoloDaSacola(s, p, t);
    const depois = protocoloDaSacola(s, p, t + VALIDADE_TRAVA_MS + 1000);
    expect(depois).not.toBe(hoje);
  });

  it("memória do navegador ilegível não impede o pedido de sair", () => {
    const s = memoria({ "ap-ultimo-envio": "{{{ lixo" });
    expect(protocoloDaSacola(s, sacola([item("a")])).length).toBeGreaterThan(0);
  });

  it("clientes diferentes nunca colidem", () => {
    const a = assinaturaDoPedido(sacola([item("a")], "11999999999"));
    const b = assinaturaDoPedido(sacola([item("a")], "11888888888"));
    expect(a).not.toBe(b);
  });
});

describe("o catálogo avisa antes de reenviar a mesma sacola", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("usa o protocolo preso à sacola, não um sorteio", () => {
    expect(/protocoloDaSacola\(/.test(fonte)).toBe(true);
  });

  it("pergunta antes de abrir o WhatsApp pela segunda vez", () => {
    expect(
      /jaEnviado/.test(fonte),
      "O protocolo já impede o PEDIDO duplicado. Sem este aviso, a vendedora " +
        "ainda recebe a MESMA MENSAGEM de novo — que foi o que fez a loja " +
        "achar que eram dois pedidos."
    ).toBe(true);
  });
});
