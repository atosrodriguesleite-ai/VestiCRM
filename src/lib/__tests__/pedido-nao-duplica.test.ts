import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { protocoloDaSacola, assinaturaDoPedido } from "../catalogo/envio-pedido";

/**
 * O MESMO PEDIDO NÃO PODE VIRAR DOIS.
 *
 * Incidente real (Toque Leve): o registro estava lento, a cliente mandou pelo
 * WhatsApp, voltou ao catálogo, viu a tela ainda "enviando" e CLICOU DE NOVO.
 * O protocolo era sorteado a cada clique — o servidor não reconhecia o
 * repetido e criava um SEGUNDO pedido, com a mesma peça reservada duas vezes
 * no estoque e a vendedora recebendo a mensagem duplicada.
 *
 * O sorteio protegia a reinsistência automática (que reusa o mesmo protocolo)
 * e não protegia o dedo da cliente. Agora o protocolo vem do CONTEÚDO.
 */

const DIA = 24 * 60 * 60 * 1000;
const sacola = (itens: { productId: string; color: string; size: string; quantity: number }[]) => ({
  company: "toque-leve",
  items: itens,
  customer: { name: "Alaute", phone: "33988215434" },
});

const item = (productId: string, size = "M", quantity = 1) => ({
  productId,
  color: "Terracota",
  size,
  quantity,
});

describe("protocolo da sacola", () => {
  it("dois cliques na MESMA sacola geram o mesmo protocolo", () => {
    const p = sacola([item("a"), item("b")]);
    const agora = Date.UTC(2026, 6, 31, 14, 0);
    expect(protocoloDaSacola(p, agora)).toBe(protocoloDaSacola(p, agora));
  });

  it("o mesmo protocolo vale mesmo com alguns minutos de diferença", () => {
    // é exatamente o caso do incidente: ela clica, espera, clica de novo
    const p = sacola([item("a")]);
    const t = Date.UTC(2026, 6, 31, 14, 0);
    expect(protocoloDaSacola(p, t)).toBe(protocoloDaSacola(p, t + 3 * 60 * 1000));
  });

  it("a ordem em que as peças entraram na sacola não muda o protocolo", () => {
    const t = Date.UTC(2026, 6, 31, 14, 0);
    const a = sacola([item("a"), item("b")]);
    const b = sacola([item("b"), item("a")]);
    expect(protocoloDaSacola(a, t)).toBe(protocoloDaSacola(b, t));
  });

  it("mudou a sacola, mudou o protocolo — é pedido novo de verdade", () => {
    const t = Date.UTC(2026, 6, 31, 14, 0);
    expect(protocoloDaSacola(sacola([item("a")]), t)).not.toBe(
      protocoloDaSacola(sacola([item("a"), item("b")]), t)
    );
    // mudou só a quantidade também conta
    expect(protocoloDaSacola(sacola([item("a", "M", 1)]), t)).not.toBe(
      protocoloDaSacola(sacola([item("a", "M", 2)]), t)
    );
  });

  it("cliente diferente, protocolo diferente (nunca colide entre pessoas)", () => {
    const t = Date.UTC(2026, 6, 31, 14, 0);
    const p1 = { ...sacola([item("a")]), customer: { name: "Ana", phone: "11999999999" } };
    const p2 = { ...sacola([item("a")]), customer: { name: "Bia", phone: "11888888888" } };
    expect(protocoloDaSacola(p1, t)).not.toBe(protocoloDaSacola(p2, t));
  });

  it("a MESMA sacola AMANHÃ é pedido novo — repor é legítimo", () => {
    const p = sacola([item("a")]);
    const hoje = Date.UTC(2026, 6, 31, 14, 0);
    expect(protocoloDaSacola(p, hoje)).not.toBe(protocoloDaSacola(p, hoje + DIA));
  });

  it("a assinatura é curta e sem caractere estranho (vira chave no banco)", () => {
    const a = assinaturaDoPedido(sacola([item("a")]), Date.UTC(2026, 6, 31));
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a.length).toBeLessThanOrEqual(18);
  });
});

describe("o catálogo não sorteia mais o protocolo", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("usa o protocolo derivado da sacola", () => {
    expect(
      /protocoloDaSacola\(/.test(fonte),
      "Protocolo sorteado a cada clique = pedido duplicado quando a cliente " +
        "clica duas vezes. Tem que vir do conteúdo da sacola."
    ).toBe(true);
  });

  it("avisa antes de reenviar a mesma sacola", () => {
    expect(
      /jaEnviado/.test(fonte),
      "Sem esse aviso, o segundo clique não cria pedido duplicado (o protocolo " +
        "resolve) mas ainda manda a MESMA mensagem de novo para a vendedora — " +
        "que foi o que fez a loja achar que eram dois pedidos."
    ).toBe(true);
  });
});
