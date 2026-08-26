import { describe, it, expect } from "vitest";
import {
  restricoesDeAudio,
  microfoneAindaExiste,
  microfoneSumiu,
  nomeCurtoDoMicrofone,
} from "../microfone";

/**
 * "Estou usando o headset, mas o som sai do microfone do computador"
 * (26/08/2026). O sistema pedia o microfone sem dizer qual, então quem
 * mandava era o dispositivo padrão do Windows — e a barra de gravação nunca
 * disse de onde vinha o som.
 */
describe("qual microfone grava", () => {
  it("sem escolha, o navegador decide (nenhuma trava de aparelho)", () => {
    expect(restricoesDeAudio(null).deviceId).toBeUndefined();
    expect(restricoesDeAudio(undefined).deviceId).toBeUndefined();
  });

  it("com escolha, o aparelho é EXIGIDO", () => {
    // sem o `exact` o navegador aceita o pedido e entrega outro microfone em
    // silêncio — o próprio defeito que esta entrega veio consertar
    expect(restricoesDeAudio("abc123").deviceId).toEqual({ exact: "abc123" });
  });

  it("continua sendo qualidade de gravação, não de chamada", () => {
    // o cancelamento de eco come parte da voz e aqui não existe eco
    const r = restricoesDeAudio("abc123");
    expect(r.echoCancellation).toBe(false);
    expect(r.noiseSuppression).toBe(true);
    expect(r.autoGainControl).toBe(true);
  });
});

describe("headset que saiu da tomada", () => {
  const lista = [{ deviceId: "fone" }, { deviceId: "webcam" }];

  it("o escolhido ainda está na lista", () => {
    expect(microfoneAindaExiste("fone", lista)).toBe(true);
  });

  it("sumiu da lista → volta para o padrão", () => {
    expect(microfoneAindaExiste("velho", lista)).toBe(false);
  });

  it("sem escolha nenhuma não é 'sumiu'", () => {
    expect(microfoneAindaExiste(null, lista)).toBe(false);
  });
});

describe("quando vale voltar para o microfone padrão", () => {
  const comHeadset = [{ deviceId: "fone" }, { deviceId: "webcam" }];
  const semHeadset = [{ deviceId: "webcam" }];
  // permissão negada: o navegador esconde os ids de propósito
  const semPermissao = [{ deviceId: "" }, { deviceId: "" }];

  it("aparelho fora da tomada → volta ao padrão", () => {
    expect(microfoneSumiu("OverconstrainedError", "fone", semHeadset)).toBe(true);
    expect(microfoneSumiu("NotFoundError", "fone", semHeadset)).toBe(true);
  });

  it("PERMISSÃO NEGADA não apaga a escolha da vendedora", () => {
    // era o achado da revisão: a escolha sumia e, depois de reautorizar, ela
    // voltava a gravar pelo padrão do Windows sem saber
    expect(microfoneSumiu("NotAllowedError", "fone", semPermissao)).toBe(false);
    // e mesmo com o erro "certo", lista sem id legível = não dá para concluir
    expect(microfoneSumiu("OverconstrainedError", "fone", semPermissao)).toBe(false);
  });

  it("o aparelho continua lá → o erro é outro, não engole", () => {
    expect(microfoneSumiu("OverconstrainedError", "fone", comHeadset)).toBe(false);
  });

  it("microfone ocupado por outro programa não vira 'sumiu'", () => {
    expect(microfoneSumiu("NotReadableError", "fone", semHeadset)).toBe(false);
  });

  it("sem escolha nenhuma não há o que desfazer", () => {
    expect(microfoneSumiu("OverconstrainedError", null, semHeadset)).toBe(false);
  });
});

describe("nome do microfone na barra de gravação", () => {
  it("tira o prefixo em inglês do navegador", () => {
    expect(nomeCurtoDoMicrofone("Default - Headset JBL")).toBe("Headset JBL");
    expect(nomeCurtoDoMicrofone("Communications - Fone de ouvido")).toBe(
      "Fone de ouvido"
    );
  });

  it("NÃO corta o que vem entre parênteses — é o que diferencia os dois", () => {
    // no Windows em português os dois se chamam "Microfone"; a diferença
    // mora no parêntese. Cortando ali, a barra ficava ambígua justamente no
    // caso que esta entrega veio resolver (achado da revisão).
    const computador = nomeCurtoDoMicrofone("Microfone (Realtek(R) Audio)");
    const headset = nomeCurtoDoMicrofone("Microfone (2- USB Audio Device)");
    expect(computador).not.toBe(headset);
    expect(computador).toContain("Realtek");
    expect(headset).toContain("USB");
  });

  it("sem nome (antes de a pessoa autorizar o microfone)", () => {
    expect(nomeCurtoDoMicrofone("")).toBe("Microfone padrão");
    expect(nomeCurtoDoMicrofone(null)).toBe("Microfone padrão");
  });

  it("nome comprido não estoura a barra", () => {
    const n = nomeCurtoDoMicrofone("A".repeat(60));
    expect(n.length).toBeLessThanOrEqual(34);
    expect(n.endsWith("…")).toBe(true);
  });
});
