import { describe, it, expect } from "vitest";
import { nomeDoArquivo, linkParaSalvar } from "../midia-arquivo";

/**
 * "Não estou conseguindo salvar as fotos e vídeos enviados e recebidos nas
 * conversas" (26/08/2026).
 *
 * Duas causas: a mídia era servida sempre para MOSTRAR (o navegador abria a
 * foto em vez de guardar), e foto/vídeo/áudio não têm nome de arquivo — sem
 * nome e sem extensão o que era salvo não abria em programa nenhum.
 */
describe("nome do arquivo ao salvar", () => {
  it("documento guarda o nome que veio", () => {
    expect(nomeDoArquivo("Pedido 1234.pdf", "DOCUMENT", "application/pdf")).toBe(
      "Pedido 1234.pdf"
    );
  });

  it("foto sem nome vira foto.jpg (com extensão, senão não abre)", () => {
    expect(nomeDoArquivo(null, "IMAGE", "image/jpeg")).toBe("foto.jpg");
    expect(nomeDoArquivo("", "IMAGE", "image/png")).toBe("foto.png");
  });

  it("vídeo e áudio também saem nomeados", () => {
    expect(nomeDoArquivo(null, "VIDEO", "video/mp4")).toBe("video.mp4");
    expect(nomeDoArquivo(null, "VIDEO", "video/quicktime")).toBe("video.mov");
    expect(nomeDoArquivo(null, "AUDIO", "audio/mpeg")).toBe("audio.mp3");
    expect(nomeDoArquivo(null, "AUDIO", "audio/wav")).toBe("audio.wav");
  });

  it("tipo desconhecido não fica sem extensão", () => {
    expect(nomeDoArquivo(null, null, "")).toBe("arquivo.bin");
  });

  it("vídeo não vira mp3 por causa do 'mpeg' no meio do tipo", () => {
    // achado da revisão: a troca era por PEDAÇO e `video/mpeg` virava
    // `video.mp3` — um vídeo salvo como música não abre
    expect(nomeDoArquivo(null, "VIDEO", "video/mpeg")).toBe("video.mpeg");
    expect(nomeDoArquivo(null, "AUDIO", "audio/mpeg")).toBe("audio.mp3");
  });

  it("planilha sem nome não vira um nome gigante e ilegível", () => {
    // "arquivo.vnd.openxmlformats-officedocument…" não abre em programa nenhum
    const n = nomeDoArquivo(
      null,
      "DOCUMENT",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(n).toBe("arquivo.bin");
  });

  it("caractere que o Windows recusa sai do nome", () => {
    // com uma barra no meio, o Windows recusa o arquivo INTEIRO
    expect(nomeDoArquivo('Pedido 12/2026 "final".pdf', "DOCUMENT", "application/pdf")).toBe(
      "Pedido 12-2026 -final-.pdf"
    );
  });
});

describe("link para salvar", () => {
  it("mídia nossa ganha a chave que manda entregar como arquivo", () => {
    expect(linkParaSalvar("/api/messages/abc/media")).toBe(
      "/api/messages/abc/media?baixar=1"
    );
  });

  it("link que já tem pergunta continua válido", () => {
    expect(linkParaSalvar("/api/messages/abc/media?v=2")).toBe(
      "/api/messages/abc/media?v=2&baixar=1"
    );
  });

  it("endereço de fora passa igual (não é nossa porta)", () => {
    const fora = "https://pps.whatsapp.net/foto.jpg";
    expect(linkParaSalvar(fora)).toBe(fora);
  });
});
