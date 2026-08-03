import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerMensagemWA, soRecadoDoProtocolo } from "../wa-message";

/**
 * ÁLBUM DE FOTOS — incidente Toque Leve, 31/07/2026 (conversa da Cassia).
 *
 * Quando a cliente manda VÁRIAS FOTOS de uma vez, o WhatsApp avisa antes com
 * um `albumMessage`: um bilhete dizendo "vêm 3 fotos aí", sem foto nenhuma
 * dentro. As fotos chegam logo depois, cada uma como mensagem própria.
 *
 * O bilhete virava uma bolha "[mensagem não exibida aqui] (albumMessage)"
 * logo acima das fotos — aviso falso de coisa perdida, no meio de uma
 * negociação de pedido. A vendedora abria o WhatsApp atrás de nada.
 */

const ALBUM = {
  key: { id: "A" },
  message: { albumMessage: { expectedImageCount: 2, expectedVideoCount: 0 } },
};

describe("o aviso de álbum é recado do protocolo, não mensagem", () => {
  it("é reconhecido como recado (não vira bolha)", () => {
    expect(soRecadoDoProtocolo(ALBUM)).toBe(true);
  });

  it("mesmo junto com outros recados do protocolo", () => {
    expect(
      soRecadoDoProtocolo({
        message: { albumMessage: {}, messageContextInfo: { deviceListMetadata: {} } },
      })
    ).toBe(true);
  });

  it("não sobra nome de tipo para a bolha de aviso", () => {
    // antes saía "[mensagem não exibida aqui] (albumMessage)"
    expect(lerMensagemWA(ALBUM).text).not.toContain("albumMessage");
  });
});

describe("as fotos do álbum continuam entrando", () => {
  it("cada foto é mensagem de verdade", () => {
    const foto = { key: { id: "F1" }, message: { imageMessage: { mimetype: "image/jpeg" } } };
    expect(soRecadoDoProtocolo(foto)).toBe(false);
    expect(lerMensagemWA(foto).mediaType).toBe("IMAGE");
  });

  it("foto com legenda mantém a legenda", () => {
    const foto = {
      message: { imageMessage: { caption: "essa aqui, tem no P?", mimetype: "image/jpeg" } },
    };
    expect(lerMensagemWA(foto).text).toBe("essa aqui, tem no P?");
  });
});

describe("nada de mensagem de gente vira recado por engano", () => {
  it.each([
    ["texto", { message: { conversation: "Oii" } }],
    ["áudio", { message: { audioMessage: {} } }],
    ["localização", { message: { locationMessage: { degreesLatitude: 1 } } }],
    ["contato", { message: { contactMessage: { displayName: "Ana" } } }],
  ])("%s NÃO é recado do protocolo", (_nome, evento) => {
    expect(soRecadoDoProtocolo(evento)).toBe(false);
  });

  it("evento realmente vazio é recado (nada a mostrar)", () => {
    expect(soRecadoDoProtocolo({})).toBe(true);
    expect(soRecadoDoProtocolo(undefined)).toBe(true);
  });
});

describe("o webhook ignora o recado sem deixar bolha", () => {
  const hook = readFileSync(
    join(process.cwd(), "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"),
    "utf8"
  );

  it("usa a regra explícita, não “message vazio”", () => {
    expect(hook).toContain("if (soRecadoDoProtocolo(m)) continue;");
    // a checagem antiga deixava o álbum passar (ele TEM chave em message)
    expect(hook).not.toContain("Object.keys(m.message).length === 0");
  });
});
