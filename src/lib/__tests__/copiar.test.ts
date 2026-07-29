import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copiarTexto, textoDaMensagem } from "../copiar";

/**
 * COPIAR MENSAGEM no chat.
 *
 * O que a loja mais copia é a mensagem da CLIENTE: o pedido escrito na
 * conversa, a chave Pix, o endereço de entrega. Copiar não pode falhar
 * calado — se o navegador não deixar, a vendedora precisa saber.
 */

/** Área de transferência de mentira (o jeito moderno). */
function janelaModerna() {
  const escrito: string[] = [];
  return {
    escrito,
    janela: {
      navigator: {
        clipboard: {
          async writeText(t: string) {
            escrito.push(t);
          },
        },
      },
    },
  };
}

/** Navegador antigo / página não segura: só o comando velho funciona. */
function janelaAntiga(comandoFunciona = true) {
  const criados: { value: string; selecionado: boolean }[] = [];
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  };
  const doc = {
    body,
    createElement: () => {
      const el = {
        value: "",
        selecionado: false,
        setAttribute() {},
        style: {} as Record<string, string>,
        select() {
          this.selecionado = true;
        },
      };
      criados.push(el as never);
      return el;
    },
    execCommand: () => comandoFunciona,
  };
  return { criados, janela: { document: doc as unknown as Document } };
}

describe("copiar texto", () => {
  it("usa a área de transferência do navegador quando existe", async () => {
    const { escrito, janela } = janelaModerna();
    expect(await copiarTexto("Pix: 31997441595", janela)).toBe(true);
    expect(escrito).toEqual(["Pix: 31997441595"]);
  });

  it("navegador antigo: cai no plano B e ainda copia", async () => {
    const { criados, janela } = janelaAntiga(true);
    expect(await copiarTexto("Rua das Flores, 120", janela)).toBe(true);
    expect(criados[0].value).toBe("Rua das Flores, 120");
    expect(criados[0].selecionado).toBe(true);
  });

  it("a área moderna recusando (página não segura) cai no plano B", async () => {
    const { janela } = janelaAntiga(true);
    const comErro = {
      ...janela,
      navigator: {
        clipboard: {
          async writeText() {
            throw new Error("sem permissão");
          },
        },
      },
    };
    expect(await copiarTexto("texto", comErro)).toBe(true);
  });

  it("não deu de jeito nenhum → devolve FALSO (a tela avisa)", async () => {
    const { janela } = janelaAntiga(false);
    expect(await copiarTexto("texto", janela)).toBe(false);
    // sem nada para copiar também é falso — o botão nem aparece
    expect(await copiarTexto("", janela)).toBe(false);
  });

  it("no servidor (sem navegador) não quebra", async () => {
    expect(await copiarTexto("texto", {})).toBe(false);
  });
});

describe("o que se copia de uma mensagem", () => {
  it("o texto da mensagem, sem sobra de espaço", () => {
    expect(textoDaMensagem({ body: "  Quero 3 vestidos M  " })).toBe("Quero 3 vestidos M");
  });

  it("áudio/foto sem legenda não têm o que copiar (a opção some)", () => {
    expect(textoDaMensagem({ body: "", mediaType: "AUDIO" })).toBe("");
    expect(textoDaMensagem({ body: null, mediaType: "IMAGE" })).toBe("");
  });

  it("mensagem apagada não se copia", () => {
    expect(textoDaMensagem({ body: "era um segredo", revoked: true })).toBe("");
  });
});

describe("a opção no chat", () => {
  const inbox = readFileSync(
    join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"),
    "utf8"
  );

  it("copiar vale para a mensagem da CLIENTE também", () => {
    // o menu ⋯ deixou de ser exclusivo das mensagens da loja
    expect(inbox).not.toContain("{mine && !isTemp && !editando && (");
    expect(inbox).toContain("Copiar mensagem");
  });

  it("a tela responde se copiou ou não", () => {
    expect(inbox).toContain("Mensagem copiada");
    expect(inbox).toContain("Não consegui copiar nesse navegador");
  });

  it("no celular o caminho é segurar a bolha (já existia)", () => {
    expect(inbox).toContain("startLongPress");
  });
});
