import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { melhorTaxa, encodeWav, TAXAS_WAV, TETO_AUDIO_BYTES } from "../audio-wav";

/**
 * QUALIDADE DO ÁUDIO DE VOZ enviado pela Central de WhatsApp.
 *
 * A taxa de amostragem manda no brilho da voz: a 16 kHz tudo acima de 8 kHz
 * é jogado fora (Nyquist), e é ali que moram o "s", o "ch" e o "f" — a voz
 * chega abafada, "de telefone". Medido no Chromium com a função real: um tom
 * de 8 kHz sai ZERADO a 16 kHz e volta inteiro a 24 kHz.
 *
 * O limite é o TAMANHO: WAV não comprime, então áudio longo precisa de taxa
 * menor para caber no envio. Daí a taxa ser escolhida por áudio.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const bytesDoWav = (segundos: number, taxa: number) => 44 + Math.ceil(segundos * taxa) * 2;

describe("melhorTaxa — a maior que couber", () => {
  it("áudio curto sai na MELHOR taxa (o caso da maioria)", () => {
    expect(melhorTaxa(10, 48_000)).toBe(24_000);
    expect(melhorTaxa(30, 48_000)).toBe(24_000);
  });

  it("áudio longo desce de taxa em vez de não caber", () => {
    const taxa = melhorTaxa(90, 48_000);
    expect(taxa).toBeLessThan(24_000);
    expect(bytesDoWav(90, taxa)).toBeLessThanOrEqual(TETO_AUDIO_BYTES);
  });

  it("NUNCA devolve algo que estoure o teto enquanto houver opção que cabe", () => {
    for (const segundos of [1, 5, 15, 30, 45, 60, 75, 90, 97]) {
      const taxa = melhorTaxa(segundos, 48_000);
      expect(bytesDoWav(segundos, taxa), `${segundos}s`).toBeLessThanOrEqual(TETO_AUDIO_BYTES);
    }
  });

  it("áudio longo demais para qualquer taxa fica na menor (quem chama avisa)", () => {
    // 5 minutos não cabe nem a 16 kHz — o envio recusa, mas a conta não quebra
    expect(melhorTaxa(300, 48_000)).toBe(16_000);
  });

  it("não inventa qualidade que a gravação não tem", () => {
    // microfone simples gravando a 16 kHz não vira 32 kHz
    expect(melhorTaxa(5, 16_000)).toBe(16_000);
    expect(melhorTaxa(5, 8_000)).toBe(8_000);
  });

  it("a pior taxa da lista ainda é a de antes (não piorou para ninguém)", () => {
    expect(TAXAS_WAV[TAXAS_WAV.length - 1]).toBe(16_000);
  });

  it("o teto é 24 kHz: mídia vive no banco, peso não pode dobrar à toa", () => {
    expect(TAXAS_WAV[0]).toBe(24_000);
  });
});

describe("o WAV sai com a taxa que foi pedida", () => {
  it("o cabeçalho declara a taxa e o tamanho certos", () => {
    const amostras = new Float32Array(24_000); // 1 segundo a 24 kHz
    const wav = new DataView(encodeWav(amostras, 24_000));
    expect(wav.getUint32(24, true), "taxa no cabeçalho").toBe(24_000);
    expect(wav.getUint32(28, true), "bytes por segundo").toBe(48_000);
    expect(wav.getUint16(22, true), "mono").toBe(1);
    expect(wav.getUint32(40, true), "tamanho dos dados").toBe(48_000);
  });
});

describe("a gravação captura em qualidade de gravação", () => {
  it("o microfone não usa o modo chamada (que come parte da voz)", () => {
    // a regra saiu da tela para `lib/microfone.ts` em 26/08/2026, junto com a
    // escolha de QUAL microfone grava — o teste dela vive em microfone.test.ts
    const regra = ler("src/lib/microfone.ts");
    expect(regra).toContain("echoCancellation: false");
    // ruído e ganho FICAM: loja é barulhenta e nem todo mundo fala perto
    expect(regra).toContain("noiseSuppression: true");
    expect(regra).toContain("autoGainControl: true");
    // e a tela usa ESSA regra, não uma cópia paralela
    expect(ler("src/app/(app)/whatsapp/inbox.tsx")).toContain(
      "audio: restricoesDeAudio(micId)"
    );
  });

  it("o teto do envio é a fonte única (tela e conversão falam o mesmo)", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(tela).toContain("TETO_AUDIO_BYTES");
    expect(tela).toContain("gravacaoParaWav(original, TETO)");
  });

  it("o bitrate fica no padrão: subir engorda o webm que vai quando o WAV não cabe", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(tela).not.toContain("audioBitsPerSecond");
  });

  it("falha ao gravar DESLIGA o microfone (a luzinha não fica acesa)", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(tela).toContain("microfoneAberto?.getTracks().forEach((t) => t.stop())");
  });

  it("a decisão de taxa não depende do fone bluetooth", () => {
    // decodeAudioData devolve na taxa do CONTEXTO (aparelho de saída): com
    // fone em viva-voz ela cai para 16 kHz e tudo sairia abafado
    expect(ler("src/lib/audio-wav.ts")).toContain("new AudioCtx({ sampleRate: 48_000 })");
  });
});
