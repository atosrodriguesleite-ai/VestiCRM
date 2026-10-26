import { describe, it, expect } from "vitest";
import {
  decidirAdocao,
  nasceuDoPedido,
  notaDoWhatsAppQueVenceu,
  notaDaFusao,
} from "../pedido-de-outro-numero";
import { telefoneDoPedido } from "../../catalogo/telefone-do-pedido";
import { JANELA_DA_BOLHA_MS, textoLimpo, mesmoTexto } from "../bolha-do-pedido";

// Guarda RN-097 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * O CASO REAL (Toque Leve, 26/10/2026): a cliente preenche o pedido do
 * catálogo com o telefone (19) 98839-4961 e aperta "enviar" no wa.me — a
 * mensagem sai do WhatsApp do aparelho dela, +1 781 408-6755. Nasciam dois
 * cadastros, duas conversas (uma "na fila") e a mesma bolha do pedido nas
 * duas. O WhatsApp por onde a mensagem chegou é o número verificado.
 *
 * O que se prova sem banco: a DECISÃO (quem fica com o pedido), a régua do
 * "cadastro nasceu deste pedido" e a escolha do telefone na porta do
 * catálogo. O resto — a trava pelo texto, a fusão, a bolha única — é provado
 * pelas rotas de verdade contra o Postgres local
 * (`scripts/e2e-pedido-de-outro-numero.ts`).
 */

const agora = Date.now();
const nascidoDoPedido = { origin: "CATALOGO_PUBLICO", createdAt: new Date(agora - 60_000) };

describe("decidirAdocao — quem fica com o pedido", () => {
  it("o WhatsApp ainda não é cliente → o cadastro do digitado LEVA o número (nada se apaga)", () => {
    expect(
      decidirAdocao({ whatsappJaEhCliente: false, cadastroNasceuDoPedido: true, pedidoJaExiste: false })
    ).toBe("pedido-leva-o-whatsapp");
    expect(
      decidirAdocao({ whatsappJaEhCliente: false, cadastroNasceuDoPedido: true, pedidoJaExiste: true })
    ).toBe("pedido-leva-o-whatsapp");
  });

  it("o WhatsApp já é cliente e o pedido existe → funde o cadastro do digitado no dele", () => {
    expect(
      decidirAdocao({ whatsappJaEhCliente: true, cadastroNasceuDoPedido: true, pedidoJaExiste: true })
    ).toBe("fundir-no-whatsapp");
  });

  it("o pedido ainda não existe → NÃO funde (apagar o cadastro no meio quebraria a criação dele)", () => {
    expect(
      decidirAdocao({ whatsappJaEhCliente: true, cadastroNasceuDoPedido: true, pedidoJaExiste: false })
    ).toBe("nada");
  });

  it("o cadastro do digitado é de gente de verdade → nada, em qualquer combinação (régua da RN-020)", () => {
    for (const whatsappJaEhCliente of [true, false]) {
      for (const pedidoJaExiste of [true, false]) {
        expect(
          decidirAdocao({ whatsappJaEhCliente, cadastroNasceuDoPedido: false, pedidoJaExiste })
        ).toBe("nada");
      }
    }
  });
});

describe("nasceuDoPedido — o cadastro do telefone digitado é só deste pedido?", () => {
  it("origem catálogo, criado há pouco e sem mensagem do WhatsApp: sim", () => {
    expect(nasceuDoPedido(nascidoDoPedido, false, agora)).toBe(true);
  });

  it("quem já escreveu daquele número é gente de verdade: não", () => {
    expect(nasceuDoPedido(nascidoDoPedido, true, agora)).toBe(false);
  });

  it("cadastro de outra origem (manual, WhatsApp, loja online) nunca é mexido", () => {
    for (const origin of ["WHATSAPP", "MANUAL", "NUVEMSHOP", "INSTAGRAM"]) {
      expect(nasceuDoPedido({ origin, createdAt: new Date(agora - 1000) }, false, agora)).toBe(false);
    }
  });

  it("cadastro mais velho que a janela da bolha não é deste pedido", () => {
    expect(
      nasceuDoPedido(
        { origin: "CATALOGO_PUBLICO", createdAt: new Date(agora - JANELA_DA_BOLHA_MS - 1000) },
        false,
        agora
      )
    ).toBe(false);
    // dentro da janela, inclusive com o relógio um pouco à frente
    expect(
      nasceuDoPedido({ origin: "CATALOGO_PUBLICO", createdAt: new Date(agora + 5_000) }, false, agora)
    ).toBe(true);
  });
});

describe("telefoneDoPedido — o WhatsApp de onde o pedido já chegou vence", () => {
  const digitado = "(19) 98839-4961";
  const whatsapp = "17814086755";

  it("o WhatsApp vence o digitado, por mais diferente que seja, e a diferença é anotada", () => {
    expect(telefoneDoPedido({ digitado, doWhatsApp: whatsapp })).toEqual({
      telefone: whatsapp,
      divergente: true,
      fonte: "whatsapp",
    });
  });

  it("o WhatsApp vence até o link pessoal (é o aparelho que montou o pedido falando)", () => {
    expect(telefoneDoPedido({ digitado, doLink: "5519988394960", doWhatsApp: whatsapp }).telefone).toBe(
      whatsapp
    );
  });

  it("mesmo número escrito de outro jeito não é divergência", () => {
    expect(telefoneDoPedido({ digitado: "(11) 99876-1001", doWhatsApp: "5511998761001" })).toEqual({
      telefone: "5511998761001",
      divergente: false,
      fonte: "whatsapp",
    });
  });

  it("sem mensagem do WhatsApp, a régua do link pessoal (RN-021) segue intacta", () => {
    expect(telefoneDoPedido({ digitado, doLink: null })).toEqual({
      telefone: digitado,
      divergente: false,
      fonte: "digitado",
    });
    expect(telefoneDoPedido({ digitado: "(75) 99128-9575", doLink: "5575991289574" })).toEqual({
      telefone: "5575991289574",
      divergente: true,
      fonte: "link",
    });
  });

  it("WhatsApp sem número de verdade (vazio, curto) não vale", () => {
    expect(telefoneDoPedido({ digitado, doWhatsApp: "" }).fonte).toBe("digitado");
    expect(telefoneDoPedido({ digitado, doWhatsApp: "123" }).fonte).toBe("digitado");
  });
});

describe("o que fica dito na conversa", () => {
  it("quando o digitado perde para o WhatsApp, os dois números aparecem", () => {
    const nota = notaDoWhatsAppQueVenceu("5519988394961", "17814086755");
    expect(nota).toContain("(19) 98839-4961");
    expect(nota).toContain("+1 781 408-6755");
    expect(nota).toContain("confira");
  });

  it("quando o cadastro foi fundido, o pedido é citado pelo número", () => {
    expect(notaDaFusao("5519988394961", "17814086755", 123)).toContain("#0123");
    expect(notaDaFusao("5519988394961", "17814086755", null)).toContain("O pedido do catálogo");
  });
});

describe("a chave da trava é o texto limpo do pedido", () => {
  it("espaço dobrado e quebra de linha a mais não mudam a chave", () => {
    const a = "*Novo pedido — Loja*\n\n• Regata  M ×2\n\nTotal: R$ 68";
    const b = "*Novo pedido — Loja*\r\n• Regata M ×2\r\nTotal: R$ 68  ";
    expect(textoLimpo(a)).toBe(textoLimpo(b));
    expect(mesmoTexto(a, b)).toBe(true);
  });
});
