import { describe, it, expect } from "vitest";
import { encodeWav } from "../audio-wav";

/** Lê texto ASCII do cabeçalho (RIFF/WAVE/fmt /data). */
const marca = (v: DataView, off: number, len: number) =>
  Array.from({ length: len }, (_, i) => String.fromCharCode(v.getUint8(off + i))).join("");

describe("encodeWav (áudio de voz com duração correta)", () => {
  it("escreve um cabeçalho WAV válido", () => {
    const v = new DataView(encodeWav(new Float32Array(1600), 16_000));
    expect(marca(v, 0, 4)).toBe("RIFF");
    expect(marca(v, 8, 4)).toBe("WAVE");
    expect(marca(v, 12, 4)).toBe("fmt ");
    expect(marca(v, 36, 4)).toBe("data");
    expect(v.getUint16(20, true)).toBe(1); // PCM sem compressão
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16); // 16 bits por amostra
  });

  it("o tamanho declarado permite calcular a duração (o que faltava no webm)", () => {
    // 2 segundos de voz a 16 kHz
    const buf = encodeWav(new Float32Array(32_000), 16_000);
    const v = new DataView(buf);
    const bytesDados = v.getUint32(40, true);
    const bytesPorSegundo = v.getUint32(28, true);
    expect(bytesDados / bytesPorSegundo).toBe(2);
    expect(buf.byteLength).toBe(44 + 32_000 * 2);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });

  it("converte a amostra para 16 bits e corta estouro de volume", () => {
    const v = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2]), 8_000));
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(32767); // topo positivo
    expect(v.getInt16(48, true)).toBe(-32768); // topo negativo
    expect(v.getInt16(50, true)).toBe(32767); // acima de 1 não estoura
    expect(v.getInt16(52, true)).toBe(-32768);
  });
});
