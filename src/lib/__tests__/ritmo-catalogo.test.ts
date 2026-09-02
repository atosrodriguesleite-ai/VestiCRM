import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  chavesDoPedidoCatalogo,
  chavesDoDemo,
  LIMITE_CATALOGO_POR_PAR,
  LIMITE_CATALOGO_POR_IP,
  LIMITE_DEMO_POR_IP,
} from "../rate-limit";
import { ehArquivoEstatico } from "../porteiro";

// Guarda RN-043
//
// As portas públicas de ESCRITA têm ritmo: sem teto, um script criava
// pedidos falsos de graça, cada um reservando estoque sem prazo (RN-003) —
// o ataque mais barato contra uma loja. E a trava convive com a RN-010:
// pedido legítimo nunca se perde.

describe("RN-043 — ritmo nas portas públicas de escrita", () => {
  it("pedido do catálogo conta por IP+loja E por IP sozinho", () => {
    const chaves = chavesDoPedidoCatalogo("loja1", "1.2.3.4");
    expect(chaves).toEqual(["cat:loja1|1.2.3.4", "catip:1.2.3.4"]);
  });

  it("sem IP identificável, NÃO trava (melhor aceitar que agrupar o mundo)", () => {
    expect(chavesDoPedidoCatalogo("loja1", null)).toEqual([]);
    expect(chavesDoDemo(null)).toEqual([]);
  });

  it("os tetos são folgados para gente e apertados para robô", () => {
    // 20 pedidos DIFERENTES em 15 min na mesma loja não é cliente (e ainda
    // cabe promoção ao vivo atrás do mesmo IP de operadora); o teto por IP
    // sozinho é maior por causa do CGNAT (bairros no mesmo IP)
    expect(LIMITE_CATALOGO_POR_PAR).toBe(20);
    expect(LIMITE_CATALOGO_POR_IP).toBeGreaterThan(LIMITE_CATALOGO_POR_PAR);
    expect(LIMITE_DEMO_POR_IP).toBeGreaterThanOrEqual(3);
  });

  it("a trava do pedido vem DEPOIS da idempotência do protocolo (varredura)", () => {
    // é a convivência com a RN-010: o reenvio do MESMO pedido (clientRef)
    // retorna antes de qualquer trava — reenvio legítimo nunca é barrado, e
    // bloqueado insistindo não estica o próprio bloqueio
    const rota = readFileSync("src/app/api/catalog/order/route.ts", "utf8");
    const idempotencia = rota.indexOf("jaRegistrado");
    const trava = rota.indexOf("chavesDoPedidoCatalogo(");
    expect(idempotencia, "a rota perdeu o retorno idempotente do clientRef").toBeGreaterThan(0);
    expect(trava, "a rota perdeu a trava de ritmo da RN-043").toBeGreaterThan(0);
    expect(
      trava,
      "a trava de ritmo passou para ANTES do retorno idempotente — reenvio legítimo seria barrado (RN-010)"
    ).toBeGreaterThan(idempotencia);
    // e quem já está bloqueado não conta de novo: conferir antes de contar
    expect(rota.indexOf("segundosDeBloqueio(")).toBeLessThan(rota.indexOf("registrarTentativa("));
  });

  it("o formulário de demonstração também tem ritmo (varredura)", () => {
    const rota = readFileSync("src/app/api/demo/route.ts", "utf8");
    expect(rota).toMatch(/chavesDoDemo\(/);
  });
});

describe("porteiro global — o alçapão do ponto fechou", () => {
  it("arquivo estático de verdade passa (sw.js, manifest, ícone)", () => {
    expect(ehArquivoEstatico("/sw.js")).toBe(true);
    expect(ehArquivoEstatico("/manifest.webmanifest")).toBe(true);
    expect(ehArquivoEstatico("/icons/icone-192.png")).toBe(true);
  });

  it("caminho de /api NUNCA passa como arquivo — nem com ponto", () => {
    expect(ehArquivoEstatico("/api/qualquer/coisa.json")).toBe(false);
    expect(ehArquivoEstatico("/api/customers/x.y")).toBe(false);
  });

  it("ponto no MEIO do caminho não é arquivo (era o alçapão)", () => {
    expect(ehArquivoEstatico("/pedidos/x.y/detalhe")).toBe(false);
    expect(ehArquivoEstatico("/dashboard")).toBe(false);
  });
});
