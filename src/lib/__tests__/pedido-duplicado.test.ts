import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAVE_ULTIMO_ENVIO,
  assinaturaDoPedido,
  protocoloDaSacola,
} from "../catalogo/envio-pedido";

/**
 * PEDIDO DUPLICADO — incidente Toque Leve, 31/07/2026 (cliente Sibelle).
 *
 * O MESMO pedido apareceu duas vezes na conversa. Não foi falha de
 * recebimento: a cliente apertou "Enviar pedido" duas vezes — e era fácil,
 * porque a sacola NÃO é limpa depois de enviar, há três botões de enviar na
 * tela e o WhatsApp abre em outra aba. Ela volta, vê a sacola cheia (parece
 * que não foi) e aperta de novo.
 *
 * Cada toque sorteava um protocolo NOVO, e protocolo novo é PEDIDO NOVO: a
 * loja ficava com dois pedidos iguais e o estoque reservado em dobro.
 */

function memoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
    dados,
  };
}

const SACOLA = {
  items: [
    { productId: "p1", color: "Branco", size: "M", quantity: 2 },
    { productId: "p2", color: "Vinho", size: "M", quantity: 1 },
  ],
  customer: { name: "Sibelle freitas", phone: "33988300596" },
};

describe("apertar duas vezes não cria dois pedidos", () => {
  it("mesma sacola devolve o MESMO protocolo", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, { ...SACOLA });
    expect(protocoloDaSacola(s, { ...SACOLA })).toBe(um);
  });

  it("a ordem das peças na sacola não muda nada", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, SACOLA);
    const invertida = { ...SACOLA, items: [...SACOLA.items].reverse() };
    expect(protocoloDaSacola(s, invertida)).toBe(um);
  });

  it("sobrevive a fechar e abrir de novo (fica guardado no aparelho)", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, SACOLA);
    expect(s.dados.get(CHAVE_ULTIMO_ENVIO)).toContain(um);
    expect(protocoloDaSacola(s, SACOLA)).toBe(um);
  });
});

describe("sacola diferente É pedido diferente", () => {
  it.each([
    ["mudou a quantidade", { items: [{ productId: "p1", color: "Branco", size: "M", quantity: 3 }] }],
    ["mudou o tamanho", { items: [{ productId: "p1", color: "Branco", size: "G", quantity: 2 }] }],
    ["mudou a cor", { items: [{ productId: "p1", color: "Preto", size: "M", quantity: 2 }] }],
    ["tirou uma peça", { items: [SACOLA.items[0]] }],
  ])("%s → protocolo novo", (_nome, mudanca) => {
    const s = memoria();
    const um = protocoloDaSacola(s, SACOLA);
    expect(protocoloDaSacola(s, { ...SACOLA, ...mudanca })).not.toBe(um);
  });

  it("mesma sacola mas OUTRA cliente é outro pedido", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, SACOLA);
    expect(
      protocoloDaSacola(s, { ...SACOLA, customer: { name: "Outra", phone: "31999999999" } })
    ).not.toBe(um);
  });

  it("vendedora do link diferente é outro pedido (a comissão muda)", () => {
    const s = memoria();
    const um = protocoloDaSacola(s, { ...SACOLA, ref: "lara" });
    expect(protocoloDaSacola(s, { ...SACOLA, ref: "juliana" })).not.toBe(um);
  });
});

describe("a assinatura não quebra com sacola torta", () => {
  it.each([
    ["sem itens", {}],
    ["itens vazios", { items: [] }],
    ["item nulo", { items: [null] }],
    ["items não é lista", { items: "oi" }],
  ])("%s não lança", (_nome, payload) => {
    expect(() => assinaturaDoPedido(payload as Record<string, unknown>)).not.toThrow();
  });

  it("registro ilegível no aparelho não impede o pedido de sair", () => {
    const s = memoria();
    s.setItem(CHAVE_ULTIMO_ENVIO, "{{{lixo");
    expect(protocoloDaSacola(s, SACOLA)).toMatch(/^cat-/);
  });
});

describe("o catálogo usa a trava", () => {
  const cat = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("o protocolo vem da sacola, não é sorteado a cada toque", () => {
    expect(cat).toContain("protocoloDaSacola(window.localStorage, pendente.payload)");
    expect(cat).not.toContain("clientRef: protocolo(),");
  });
});
