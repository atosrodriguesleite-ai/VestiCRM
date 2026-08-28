import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O MICROFONE NÃO PODE SUMIR COM A ÁREA DE ESCREVER (incidente 28/08/2026).
 *
 * Ao ganhar a barra da fila de fotos, a área do compositor virou uma cadeia
 * de decisões. Uma versão dela começava com `recording || preparando ? null`
 * — e `null` ENCERRA a cadeia: as barras "Preparando o microfone…" e
 * "Gravando…" (com parar e enviar) ficavam inalcançáveis. Quem tocava no
 * microfone via a área inteira ficar em branco, sem jeito de enviar nem de
 * cancelar: NINGUÉM conseguia mandar áudio.
 *
 * A regra: gravação tem prioridade sobre a fila de fotos — microfone aberto
 * precisa de botão para fechar.
 */
const inbox = readFileSync(
  join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"),
  "utf8"
);

describe("a área de escrever nunca fica em branco gravando", () => {
  it("gravar/preparar NUNCA leva a cadeia para `null`", () => {
    expect(inbox).not.toContain("recording || preparando ? null");
    expect(inbox).not.toContain("preparando || recording ? null");
    expect(inbox).not.toContain("preparando || recording\n                  ? null");
  });

  it("a barra da fila de fotos cede a vez para a gravação", () => {
    expect(inbox).toContain("!recording &&");
    expect(inbox).toContain("!preparando ? (");
  });

  it("as barras de preparar e gravar continuam na cadeia (com parar e enviar)", () => {
    expect(inbox).toContain("Preparando o microfone…");
    expect(inbox).toContain(") : preparando ? (");
    expect(inbox).toContain(") : recording ? (");
    expect(inbox).toContain("Gravando…");
  });

  it("o botão do microfone existe e chama a gravação", () => {
    expect(inbox).toContain("startRecording");
    expect(inbox).toContain("stopRecording");
  });
});
