import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TETO_DESTINOS } from "../encaminhar";

/**
 * ENCAMINHAR MENSAGEM (pedido do dono, 26/08/2026) — dos dois lados: o que a
 * cliente mandou e o que a loja mandou.
 *
 * Quatro coisas quebram em silêncio se alguém mexer aqui, e as quatro saíram
 * da revisão:
 *
 *  1. mandar os destinos em paralelo mata o RITMO HUMANO anti-bloqueio
 *     (RN-017) — é o que faz o WhatsApp desconfiar da conta;
 *  2. esperar os envios dentro do pedido estoura o tempo da função: a tela
 *     diz "não foi possível" com metade JÁ entregue, a vendedora manda de
 *     novo e a cliente recebe duas vezes;
 *  3. sem teto, encaminhar vira disparo em massa pela porta dos fundos;
 *  4. a legenda da foto não viaja junto com o arquivo — some sem ninguém ver.
 */
const rota = readFileSync(
  join(process.cwd(), "src/app/api/messages/[id]/encaminhar/route.ts"),
  "utf8"
);

describe("os envios saem em fila, depois da resposta", () => {
  it("um atrás do outro, dentro de after()", () => {
    expect(rota).toContain("after(async () => {");
    expect(rota).toContain("for (const d of destinos) {");
    // nada de "cada um por conta própria" (que sai tudo ao mesmo tempo)
    expect(rota).not.toContain("background:");
  });

  it("a resposta promete 'saindo', não 'entregue'", () => {
    // cada bolha conta a própria história no destino (⏱️ → ✓ ou ⚠️)
    expect(rota).toContain("saindo: destinos.length");
    expect(rota).not.toContain("enviadas:");
  });
});

describe("o teto é o que separa encaminhar de disparo em massa", () => {
  it("poucos destinos por vez", () => {
    expect(TETO_DESTINOS).toBeGreaterThan(1);
    expect(TETO_DESTINOS).toBeLessThanOrEqual(5);
  });

  it("o servidor recusa mais que o teto (a tela não é o guarda)", () => {
    expect(rota).toContain("max(TETO_DESTINOS)");
  });
});

describe("nada sai do lugar sem permissão", () => {
  it("a mensagem de origem e CADA destino passam pelo escopo", () => {
    expect(rota).toContain("conversation: { is: conversationScope(user) }");
    expect(rota).toContain("...conversationScope(user)");
  });

  it("nota interna e mensagem apagada não se encaminham", () => {
    expect(rota).toContain('origem.kind === "NOTE"');
    expect(rota).toContain("origem.revoked");
  });
});

describe("a legenda da mídia não some no caminho", () => {
  it("vai como mensagem própria depois do arquivo", () => {
    // o envio de mídia manda só o arquivo: sem isto a loja via o texto
    // embaixo da foto e a cliente recebia só a foto
    expect(rota).toContain("const legenda =");
    expect(rota).toContain("body: legenda,");
  });

  it("rótulo automático ('📷 Foto', '[foto]') NÃO vira mensagem", () => {
    expect(rota).toContain('!legenda.startsWith("[")');
    expect(rota).toContain("📷🎬🎤📎");
  });
});
