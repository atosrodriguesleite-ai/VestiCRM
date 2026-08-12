import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  marcarRegistrado,
  protocoloDaSacola,
  sacolaJaEnviada,
  VALIDADE_TRAVA_MS,
} from "../catalogo/envio-pedido";

/**
 * MENSAGEM DUPLICADA NA CONVERSA — reincidência Toque Leve (cliente Paula).
 *
 * A trava do protocolo já impedia o PEDIDO duplicado, e havia um aviso
 * "você já enviou este pedido" antes de reabrir o WhatsApp. Mas o aviso
 * vivia na memória da aba (useRef): no celular, voltar do WhatsApp costuma
 * RECARREGAR o catálogo — memória zerada, aviso mudo, e a mesma mensagem
 * saía de novo. A loja via o pedido em dobro na conversa.
 *
 * `sacolaJaEnviada` lê do MESMO registro persistido da trava: o aviso passa
 * a sobreviver a recarregar, fechar e voltar.
 */

function memoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  } as unknown as Storage;
}

const payload = {
  company: "toque-leve",
  items: [{ productId: "p1", color: "Vinho", size: "GG", quantity: 1 }],
  customer: { name: "Paula Martins", phone: "64984052031" },
};

describe("o aviso de reenvio sobrevive ao recarregamento da página", () => {
  it("antes do primeiro envio, não avisa", () => {
    expect(sacolaJaEnviada(memoria(), payload)).toBe(false);
  });

  it("tentativa SEM confirmação do servidor não avisa (senão o aviso mentia)", () => {
    const storage = memoria();
    // primeiro toque grava a trava — mas o servidor ainda não confirmou
    protocoloDaSacola(storage, payload);
    // dizer "a loja já recebeu" aqui perderia o pedido se a cliente recusasse
    expect(sacolaJaEnviada(storage, payload)).toBe(false);
  });

  it("com o registro CONFIRMADO, avisa MESMO com a memória da aba zerada", () => {
    const storage = memoria();
    const ref = protocoloDaSacola(storage, payload);
    marcarRegistrado(storage, ref); // o servidor disse ok
    // "recarregou a página": só o storage sobrevive — e o aviso também
    expect(sacolaJaEnviada(storage, payload)).toBe(true);
  });

  it("reaproveitar o protocolo NÃO apaga a confirmação", () => {
    const storage = memoria();
    const ref = protocoloDaSacola(storage, payload);
    marcarRegistrado(storage, ref);
    // segundo toque, mesma sacola: protocolo reaproveitado
    expect(protocoloDaSacola(storage, payload)).toBe(ref);
    expect(sacolaJaEnviada(storage, payload)).toBe(true);
  });

  it("marcarRegistrado de protocolo velho não marca a sacola nova", () => {
    const storage = memoria();
    const ref1 = protocoloDaSacola(storage, payload);
    const outra = {
      ...payload,
      items: [{ productId: "p9", color: "Azul", size: "P", quantity: 3 }],
    };
    protocoloDaSacola(storage, outra); // sacola mudou: registro novo
    marcarRegistrado(storage, ref1); // confirmação atrasada do envio antigo
    expect(sacolaJaEnviada(storage, outra)).toBe(false);
  });

  it("sacola DIFERENTE não dispara o aviso (reposição/edição é pedido novo)", () => {
    const storage = memoria();
    const ref = protocoloDaSacola(storage, payload);
    marcarRegistrado(storage, ref);
    const outra = {
      ...payload,
      items: [{ productId: "p1", color: "Preto", size: "M", quantity: 2 }],
    };
    expect(sacolaJaEnviada(storage, outra)).toBe(false);
  });

  it("aviso respeita a validade da trava (24h): sacola igual semanas depois é reposição", () => {
    const storage = memoria();
    const ontem = Date.now();
    const ref = protocoloDaSacola(storage, payload, ontem);
    marcarRegistrado(storage, ref, ontem);
    expect(sacolaJaEnviada(storage, payload, ontem + VALIDADE_TRAVA_MS + 1)).toBe(false);
  });

  it("registro ilegível não trava o envio (só silencia o aviso)", () => {
    const storage = memoria();
    storage.setItem("ap-ultimo-envio", "{{{lixo");
    expect(sacolaJaEnviada(storage, payload)).toBe(false);
  });

  it("o catálogo consulta o aviso ANTES de gravar o protocolo (senão avisaria sempre)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
      "utf8"
    );
    const posAviso = src.indexOf("sacolaJaEnviada(window.localStorage");
    const posProtocolo = src.indexOf("protocoloDaSacola(window.localStorage");
    expect(posAviso).toBeGreaterThan(-1);
    expect(posProtocolo).toBeGreaterThan(-1);
    expect(posAviso).toBeLessThan(posProtocolo);
  });
});
