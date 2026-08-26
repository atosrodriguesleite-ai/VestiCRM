import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * COPIAR A PRÓPRIA MENSAGEM (pedido do dono, 26/08/2026): "consigo selecionar
 * as mensagens do cliente e copiar, mas não consigo as que eu mando".
 *
 * A bolha da LOJA era a única com `select-none`. A trava veio junto do
 * "arrastar para responder", para o dedo não começar a marcar texto no meio
 * do arrasto — só que o arrasto é gesto de DEDO. No computador ela não
 * protegia nada e impedia a vendedora de copiar o que ela mesma tinha escrito
 * (o Pix, o endereço, a medida da peça).
 *
 * Duas coisas quebram em silêncio se alguém mexer aqui:
 *  1. voltar o `select-none` fixo → a vendedora perde a cópia de novo;
 *  2. tirar a trava TAMBÉM no celular → o arrasto para responder passa a
 *     brigar com a marcação de texto do dedo.
 */
const inbox = readFileSync(
  join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"),
  "utf8"
);

describe("selecionar e copiar a mensagem que a LOJA mandou", () => {
  it("no computador o texto da própria bolha é selecionável", () => {
    expect(inbox).toContain('noComputador ? "select-text" : "select-none"');
  });

  it("a trava do arrasto continua valendo no celular", () => {
    // o gesto de responder é de dedo; lá a marcação de texto atrapalha
    expect(inbox).toContain('setNoComputador(!window.matchMedia("(pointer: coarse)").matches);');
  });

  it("o mesmo sinal manda no Enter e na seleção (uma detecção só)", () => {
    expect(inbox).toContain("const enterEnvia = noComputador;");
  });

  it("o trecho marcado aparece por cima do fundo colorido da bolha", () => {
    // sem isto, a marcação sumia contra o azul da bolha da loja
    expect(inbox).toContain("selection:bg-white/30 selection:text-white");
  });

  it("no notebook com tela de toque, o arrasto desfaz a marcação", () => {
    // lá o ponteiro principal é o mouse (texto selecionável), mas o dedo
    // continua arrastando para responder — os dois brigavam
    expect(inbox).toContain("window.getSelection?.()?.removeAllRanges();");
    expect(inbox).toContain("touch-pan-y");
  });

  it("a bolha da CLIENTE segue selecionável como sempre foi", () => {
    expect(inbox).toContain('"bg-white text-ink rounded-bl-md"');
  });
});
