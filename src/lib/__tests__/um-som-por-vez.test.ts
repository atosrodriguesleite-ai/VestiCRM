import { describe, it, expect } from "vitest";
import { pausarOsOutros, type MidiaTocavel } from "../um-som-por-vez";

/**
 * Guarda o "um som de cada vez" do chat: abrir um áudio novo cala o que
 * estava tocando (relato do dono, 21/08/2026 — dois áudios saíam juntos).
 */
function player(tocando: boolean): MidiaTocavel & { pausas: number } {
  return {
    paused: !tocando,
    pausas: 0,
    pause() {
      this.pausas++;
      this.paused = true;
    },
  };
}

describe("um som de cada vez", () => {
  it("o áudio que começa cala o que estava tocando", () => {
    const antigo = player(true);
    const novo = player(true);
    pausarOsOutros(novo, [antigo, novo]);
    expect(antigo.paused).toBe(true);
    expect(novo.paused).toBe(false); // quem começou continua tocando
  });

  it("cala TODOS os outros, não só o primeiro (conversa cheia de áudios)", () => {
    const a = player(true);
    const b = player(true);
    const c = player(true);
    const novo = player(true);
    pausarOsOutros(novo, [a, b, c, novo]);
    expect([a.paused, b.paused, c.paused]).toEqual([true, true, true]);
  });

  it("não mexe em quem já estava parado (o controle não pisca à toa)", () => {
    const parado = player(false);
    const novo = player(true);
    pausarOsOutros(novo, [parado, novo]);
    expect(parado.pausas).toBe(0);
  });

  it("vídeo também entra na regra: som é som", () => {
    const video = player(true);
    const audio = player(true);
    pausarOsOutros(audio, [video, audio]);
    expect(video.paused).toBe(true);
  });
});
