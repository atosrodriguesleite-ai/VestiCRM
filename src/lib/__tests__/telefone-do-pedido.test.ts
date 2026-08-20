import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { telefoneDoPedido } from "../catalogo/telefone-do-pedido";

// Guarda RN-021 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * O CASO REAL (Toque Leve, 20/08/2026): a cliente Patrícia fala pelo WhatsApp
 * (75) 9128-9574 e, ao preencher o pedido no catálogo, digitou
 * (75) 99128-9575 — um dígito errado. Nasceu um segundo cadastro, uma segunda
 * conversa, e o que a Letícia respondia no cadastro errado nunca chegava.
 */
const WHATSAPP_DELA = "557591289574";
const DIGITADO_ERRADO = "75991289575";

describe("o caso real da Toque Leve", () => {
  it("o pedido fica no WhatsApp dela, não no número digitado errado", () => {
    const r = telefoneDoPedido({
      digitado: DIGITADO_ERRADO,
      doLink: WHATSAPP_DELA,
    });
    expect(r.telefone).toBe(WHATSAPP_DELA);
  });

  it("a diferença é avisada — a loja precisa conferir qual está certo", () => {
    expect(
      telefoneDoPedido({ digitado: DIGITADO_ERRADO, doLink: WHATSAPP_DELA })
        .divergente
    ).toBe(true);
  });
});

describe("sem link pessoal, o digitado é a única informação que existe", () => {
  it("link geral da loja: vale o que a cliente digitou", () => {
    const r = telefoneDoPedido({ digitado: "75991289575", doLink: null });
    expect(r.telefone).toBe("75991289575");
    expect(r.divergente).toBe(false);
  });

  it("link pessoal e formulário em branco: vale o do link", () => {
    const r = telefoneDoPedido({ digitado: "", doLink: WHATSAPP_DELA });
    expect(r.telefone).toBe(WHATSAPP_DELA);
    expect(r.divergente).toBe(false);
  });
});

/**
 * Achado da revisão: link pessoal chega por WhatsApp, e WhatsApp se
 * ENCAMINHA. Sobrepor QUALQUER diferença jogaria o pedido da amiga no
 * cadastro, na conversa e na carteira da primeira cliente.
 */
describe("link encaminhado para outra pessoa", () => {
  it("telefone completamente diferente é OUTRA pessoa: vale o digitado", () => {
    const r = telefoneDoPedido({ digitado: "11987654321", doLink: WHATSAPP_DELA });
    expect(r.telefone).toBe("11987654321");
    expect(r.divergente).toBe(false);
  });

  it("mesmo DDD mas número de outra pessoa: vale o digitado", () => {
    const r = telefoneDoPedido({ digitado: "75988887777", doLink: WHATSAPP_DELA });
    expect(r.telefone).toBe("75988887777");
  });
});

describe("cadastro do link com telefone ruim não vence celular válido", () => {
  it("telefone incompleto no cadastro: vale o digitado", () => {
    const r = telefoneDoPedido({ digitado: "75991289575", doLink: "9574" });
    expect(r.telefone).toBe("75991289575");
  });

  it("cadastro sem telefone: vale o digitado", () => {
    expect(
      telefoneDoPedido({ digitado: "75991289575", doLink: "-" }).telefone
    ).toBe("75991289575");
  });
});

describe("mesmo número escrito de outro jeito NÃO é divergência", () => {
  it("com e sem o 9º dígito", () => {
    const r = telefoneDoPedido({ digitado: "7591289574", doLink: WHATSAPP_DELA });
    expect(r.divergente).toBe(false);
    expect(r.telefone).toBe(WHATSAPP_DELA);
  });

  it("com e sem o DDI 55", () => {
    expect(
      telefoneDoPedido({ digitado: "5575991289574", doLink: WHATSAPP_DELA })
        .divergente
    ).toBe(false);
  });

  it("escrito com formatação", () => {
    expect(
      telefoneDoPedido({ digitado: "(75) 9128-9574", doLink: WHATSAPP_DELA })
        .divergente
    ).toBe(false);
  });
});

describe("a rota do catálogo usa a regra", () => {
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/catalog/order/route.ts"),
    "utf8"
  );

  it("o pedido é criado com o telefone que a regra escolheu", () => {
    expect(rota).toContain("telefoneDoPedido({");
    expect(rota).toContain("normalizePhone(escolha.telefone)");
  });

  it("a divergência fica ESCRITA no pedido, para a loja conferir", () => {
    expect(rota).toContain("telefoneDivergente");
    expect(rota).toContain("digitou um telefone diferente do WhatsApp");
  });
});
