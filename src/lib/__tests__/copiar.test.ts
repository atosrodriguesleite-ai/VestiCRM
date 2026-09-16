import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copiarTexto, legendaDaMidia, textoDaMensagem,
  textoParaCopiar,
  selecaoDentroDe,
  menuDoNavegador,
} from "../copiar";

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

  /**
   * MARCAR UM TRECHO NO CELULAR (relato do dono, 16/09/2026).
   *
   * O toque longo abre o NOSSO menu e o arrasto responde a mensagem: os dois
   * gestos comem justamente o toque longo que o celular usa para marcar
   * texto. O modo tira os gestos do caminho — e precisa de VOLTA: o menu já
   * fechou, então sem a barra de confirmação o dedo marca o trecho e não há
   * onde tocar. As três frases são o que a vendedora VÊ; se alguma sumir, o
   * caminho quebrou no meio.
   */
  it("no celular dá para marcar um trecho e copiar só ele", () => {
    expect(inbox).toContain("Selecionar texto");
    expect(inbox).toContain("Copiar trecho");
    expect(inbox).toContain("Trecho copiado");
  });
});

describe("legenda da foto (Toque Leve, 31/07/2026)", () => {
  /**
   * A cliente mandou uma foto com texto embaixo e a loja SÓ VIU A FOTO. A
   * legenda estava gravada — o sistema leu certo do WhatsApp —, mas a tela só
   * desenhava texto quando a mensagem era de texto puro.
   *
   * Numa negociação isso é caro: "essa no P, 3 unidades" some, e a vendedora
   * responde como se a cliente não tivesse pedido nada.
   */
  it("a legenda que a cliente escreveu aparece", () => {
    expect(
      legendaDaMidia({ body: "essa no P, 3 unidades", mediaType: "IMAGE" })
    ).toBe("essa no P, 3 unidades");
  });

  it.each([
    ["[foto]", "IMAGE"],
    ["[vídeo]", "VIDEO"],
    ["[áudio]", "AUDIO"],
    ["[figurinha]", "IMAGE"],
    ["[arquivo] tabela-precos.pdf", "DOCUMENT"],
  ])("o rótulo %s NÃO vira legenda (foto sem texto fica limpa)", (body, mediaType) => {
    expect(legendaDaMidia({ body, mediaType })).toBe("");
  });

  it("legenda vazia ou nula não desenha nada", () => {
    expect(legendaDaMidia({ body: "   ", mediaType: "IMAGE" })).toBe("");
    expect(legendaDaMidia({ body: null, mediaType: "IMAGE" })).toBe("");
  });

  it("legenda que POR ACASO fala de foto continua aparecendo", () => {
    // "[foto]" sozinho é rótulo; texto de gente que menciona foto, não
    expect(legendaDaMidia({ body: "manda a [foto] do vinho", mediaType: "IMAGE" })).toBe(
      "manda a [foto] do vinho"
    );
  });
});

describe("a tela desenha a legenda", () => {
  const tela = readFileSync(
    join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"),
    "utf8"
  );

  it("mídia usa a legenda; texto puro segue usando o corpo", () => {
    expect(tela).toContain("legendaDaMidia(m)");
    // a condição antiga escondia o texto de qualquer mídia
    expect(tela).not.toContain(
      '{(m.mediaType === "TEXT" || m.mediaType === "TEMPLATE") && (\n                            <p'
    );
  });
});

describe("copiar SÓ o trecho marcado (relato do dono, 16/09/2026)", () => {
  const MSG = "Oi! O Pix é 33999887766 e o endereço é Rua A, 100 — Centro";

  it("com trecho marcado DENTRO da bolha, copia só ele", () => {
    expect(
      textoParaCopiar(MSG, { texto: "33999887766", dentroDaBolha: true })
    ).toBe("33999887766");
  });

  it("sem marcação nenhuma, copia a mensagem inteira (como sempre)", () => {
    expect(textoParaCopiar(MSG, null)).toBe(MSG);
  });

  it("marcação em OUTRA bolha não vale — copiaria o pedaço errado", () => {
    // o que sai daqui vai para o WhatsApp da cliente: um Pix pela metade, ou
    // o endereço de outra pessoa
    expect(
      textoParaCopiar(MSG, { texto: "Rua B, 200", dentroDaBolha: false })
    ).toBe(MSG);
  });

  it("marcação VAZIA não conta (clicar sem arrastar)", () => {
    // copiar "" faria o botão piscar "copiado" e o colar vir vazio
    expect(textoParaCopiar(MSG, { texto: "   ", dentroDaBolha: true })).toBe(MSG);
    expect(textoParaCopiar(MSG, { texto: "", dentroDaBolha: true })).toBe(MSG);
  });

  it("o trecho vem sem sobra nas pontas", () => {
    expect(
      textoParaCopiar(MSG, { texto: "  33999887766 \n", dentroDaBolha: true })
    ).toBe("33999887766");
  });
});

/**
 * CLIQUE DIREITO COM TEXTO MARCADO (relato do dono, 16/09/2026): *"quando
 * clico com botão direito abre essas opções, e não aquela tradicional de
 * copiar"*. O gesto de marcar e apertar o botão direito é o que todo mundo
 * já tem nos dedos — sequestrá-lo obriga a vendedora a aprender o nosso menu
 * no lugar do que ela conhece.
 */
describe("quem abre no clique direito", () => {
  it("com trecho marcado na bolha, o menu é o do NAVEGADOR", () => {
    expect(menuDoNavegador({ texto: "Rua B, 200", dentroDaBolha: true })).toBe(true);
  });

  it("sem marcação nenhuma, o menu é o NOSSO (responder, encaminhar, reagir)", () => {
    expect(menuDoNavegador(null)).toBe(false);
  });

  it("clicar sem arrastar não conta como marcação", () => {
    // deixaria a bolha sem menu nenhum no clique direito
    expect(menuDoNavegador({ texto: "  ", dentroDaBolha: true })).toBe(false);
  });

  it("marcação em OUTRA bolha não tira o nosso menu daqui", () => {
    expect(menuDoNavegador({ texto: "chave Pix", dentroDaBolha: false })).toBe(false);
  });
});

describe("de onde veio a marcação", () => {
  /** `ancora` é onde o dedo encostou; `foco` é onde ele soltou. */
  const selecaoFalsa = (texto: string, no: unknown, foco: unknown = no) => ({
    getSelection: () =>
      ({
        rangeCount: texto ? 1 : 0,
        toString: () => texto,
        anchorNode: no,
        focusNode: foco,
      }) as unknown as Selection,
  });

  it("reconhece a marcação feita dentro do elemento", () => {
    const filho = {};
    const bolha = { contains: (n: unknown) => n === filho } as unknown as Element;
    expect(selecaoDentroDe(bolha, selecaoFalsa("Pix", filho))).toEqual({
      texto: "Pix",
      dentroDaBolha: true,
    });
  });

  it("marcação de fora é reconhecida como de fora", () => {
    const bolha = { contains: () => false } as unknown as Element;
    expect(selecaoDentroDe(bolha, selecaoFalsa("outra coisa", {}))?.dentroDaBolha).toBe(
      false
    );
  });

  it("marcada de baixo para cima também vale", () => {
    // a âncora fica no FIM do trecho; olhando só ela, a marcação legítima
    // era recusada e o botão copiava a mensagem inteira
    const inicio = {};
    const fim = {};
    const bolha = {
      contains: (n: unknown) => n === inicio || n === fim,
    } as unknown as Element;
    expect(
      selecaoDentroDe(bolha, selecaoFalsa("chave Pix", fim, inicio))?.dentroDaBolha
    ).toBe(true);
  });

  it("marcação que ESCORREGA para fora da bolha não vale", () => {
    // arrastar passando da borda leva junto o texto da mensagem vizinha —
    // e o que sai daqui vai para o WhatsApp da cliente
    const dentro = {};
    const bolha = { contains: (n: unknown) => n === dentro } as unknown as Element;
    expect(
      selecaoDentroDe(bolha, selecaoFalsa("Pix… e mais", dentro, {}))?.dentroDaBolha
    ).toBe(false);
  });

  it("sem marcação devolve nulo", () => {
    const bolha = { contains: () => true } as unknown as Element;
    expect(selecaoDentroDe(bolha, selecaoFalsa("", null))).toBeNull();
    expect(selecaoDentroDe(bolha, selecaoFalsa("   ", {}))).toBeNull();
    expect(selecaoDentroDe(bolha, {})).toBeNull();
  });
});
