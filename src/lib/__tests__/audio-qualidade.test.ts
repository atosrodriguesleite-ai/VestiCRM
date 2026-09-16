import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  melhorTaxa,
  encodeWav,
  normalizarVoz,
  freioSuave,
  portaoDeRuido,
  limitarPicos,
  reduzirChiado,
  PISO_CHIADO,
  GANHO_MAXIMO,
  PISO_PORTAO,
  TAXAS_WAV,
  TETO_AUDIO_BYTES,
  ALVO_RMS,
  LIMIAR_FREIO,
  TETO_FREIO,
  MS_SUAVIZA,
} from "../audio-wav";
import { MS_ASSENTAR_MICROFONE } from "../microfone";

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

/**
 * "No primeiro segundo tá estourado, depois fica bom" (26/08/2026).
 *
 * Duas causas somadas: o ganho automático do microfone COMEÇA ALTO e vai se
 * ajustando (esse instante ia inteiro para dentro do arquivo), e o conversor
 * simplesmente CORTAVA o que passava do máximo — corte quadrado é o barulho
 * de "estourado".
 */
describe("a voz sai no mesmo volume, sem estourar", () => {
  const TAXA = 24_000;
  const pico = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const rms = (a: Float32Array, i0 = 0, i1 = a.length) => {
    let s = 0;
    for (let i = i0; i < i1; i++) s += a[i] * a[i];
    return Math.sqrt(s / (i1 - i0));
  };
  /** desenha um trecho de "fala" (tom) dentro do sinal */
  const falar = (a: Float32Array, deSeg: number, ateSeg: number, amp: number, hz = 300) => {
    for (let i = Math.floor(deSeg * TAXA); i < Math.floor(ateSeg * TAXA); i++)
      a[i] += amp * Math.sin((2 * Math.PI * hz * i) / TAXA);
  };
  const chiado = (a: Float32Array, amp: number) => {
    for (let i = 0; i < a.length; i++) a[i] += amp * ((Math.sin(i * 12.9898) * 43758.5453) % 1);
  };
  /** o miolo, sem os 25 ms de subida/descida das pontas */
  const miolo = (a: Float32Array) => {
    const m = Math.ceil((MS_SUAVIZA / 1000) * TAXA) + 2;
    return a.slice(m, a.length - m);
  };
  /** maior sequência de amostras IGUAIS — é a assinatura do corte quadrado */
  const maiorPlato = (a: Float32Array) => {
    let maior = 0, atual = 1;
    for (let i = 1; i < a.length; i++) {
      atual = Math.abs(a[i] - a[i - 1]) < 1e-7 ? atual + 1 : 1;
      if (atual > maior) maior = atual;
    }
    return maior;
  };

  it("gravação ACIMA do máximo sai alta, mas NUNCA achatada", () => {
    // era o defeito: passar de 1.0 virava degrau (dezenas de amostras iguais)
    const a = new Float32Array(TAXA * 4);
    falar(a, 0, 4, 1.8);
    const r = normalizarVoz(a, TAXA);
    expect(pico(r)).toBeLessThan(1);
    expect(maiorPlato(miolo(r))).toBeLessThan(4);
  });

  it("fala baixinha (longe do microfone) é levantada, com teto", () => {
    const a = new Float32Array(TAXA * 6);
    chiado(a, 0.002);
    // fala de verdade tem pausas e muda de altura: um tom CONTÍNUO por 5 s
    // seria lido pelo redutor de chiado como fundo (limite aceito e documentado)
    for (let t = 0.5; t < 5.5; t += 0.3) falar(a, t, t + 0.2, 0.05, 180 + ((t * 37) % 120));
    const r = normalizarVoz(a, TAXA);
    expect(rms(r, 2 * TAXA, 2.2 * TAXA)).toBeGreaterThan(0.1);
    // o teto de ganho é o que impede o chiado de virar o assunto
    expect(rms(r, 0, 0.2 * TAXA)).toBeLessThan(0.02);
  });

  it("SILÊNCIO NÃO CONTA no volume — 2s de fala em 20s não vira chiado alto", () => {
    // achado da revisão: medindo o arquivo inteiro, o nível era o chiado da
    // sala e o ganho ia para o teto, subindo o chiado em vez da voz
    const curto = new Float32Array(TAXA * 8);
    chiado(curto, 0.004);
    falar(curto, 0.5, 2, 0.3);
    falar(curto, 3, 4.5, 0.3);
    const longo = new Float32Array(TAXA * 20);
    chiado(longo, 0.004);
    falar(longo, 2, 4, 0.3);
    const vozCurto = rms(normalizarVoz(curto, TAXA), TAXA, 1.5 * TAXA);
    const vozLongo = rms(normalizarVoz(longo, TAXA), 2.5 * TAXA, 3 * TAXA);
    // a MESMA voz sai no MESMO volume, tenha o áudio 8s ou 20s de silêncio
    expect(vozLongo).toBeCloseTo(vozCurto, 2);
  });

  it("UM ESTALO não derruba o volume da voz inteira", () => {
    // porta batendo, "toc" do headset, tosse da colega
    const semEstalo = new Float32Array(TAXA * 5);
    chiado(semEstalo, 0.004);
    falar(semEstalo, 0.3, 4.8, 0.3);
    const comEstalo = Float32Array.from(semEstalo);
    falar(comEstalo, 2, 2.2, 4, 1200);
    const vozSem = rms(normalizarVoz(semEstalo, TAXA), TAXA, 1.5 * TAXA);
    const vozCom = rms(normalizarVoz(comEstalo, TAXA), TAXA, 1.5 * TAXA);
    expect(vozCom).toBeCloseTo(vozSem, 2);
    expect(pico(normalizarVoz(comEstalo, TAXA))).toBeLessThan(1);
  });

  it("o volume final fica perto do alvo (é o que deixa os áudios parelhos)", () => {
    const a = new Float32Array(TAXA * 6);
    chiado(a, 0.004);
    falar(a, 0.5, 2, 0.3);
    falar(a, 3, 5.5, 0.3);
    const r = normalizarVoz(a, TAXA);
    expect(rms(r, TAXA, 1.5 * TAXA)).toBeCloseTo(ALVO_RMS, 1);
  });

  it("o 'toc' do microfone abrindo some (começo e fim suaves)", () => {
    const a = new Float32Array(TAXA * 2);
    falar(a, 0, 2, 0.3);
    const r = normalizarVoz(a, TAXA);
    expect(Math.abs(r[0])).toBeLessThan(0.01);
    expect(Math.abs(r[r.length - 1])).toBeLessThan(0.01);
    expect(rms(miolo(r))).toBeGreaterThan(0.1);
  });

  it("silêncio continua silêncio (não vira chiado nem quebra a conta)", () => {
    expect(pico(normalizarVoz(new Float32Array(1000), TAXA))).toBe(0);
  });

  it("áudio curtíssimo não quebra a suavização", () => {
    const a = new Float32Array(3);
    a[1] = 0.5;
    expect(() => normalizarVoz(a, TAXA)).not.toThrow();
  });

  it("o freio encosta no teto sem NUNCA formar degrau", () => {
    expect(freioSuave(0.5)).toBe(0.5); // abaixo do limiar, passa igual
    expect(freioSuave(LIMIAR_FREIO)).toBeCloseTo(LIMIAR_FREIO, 6);
    expect(freioSuave(-5)).toBeLessThan(0); // não inverte o sinal
    for (const v of [1, 1.5, 2, 3, 5]) expect(Math.abs(freioSuave(v))).toBeLessThan(TETO_FREIO);
    // CRESCENTE em toda a faixa: som mais alto continua saindo mais alto, e é
    // isso que impede o platô (achado da revisão: um `Math.min` grudava tudo
    // acima de ~1,42 no mesmo valor)
    for (const v of [0.8, 1.0, 1.42, 1.5, 2, 3])
      expect(freioSuave(v + 0.01)).toBeGreaterThan(freioSuave(v));
  });
});

describe("o FUNDO entre as palavras não passa (portão de ruído)", () => {
  const TAXA = 24_000;
  const rms = (a: Float32Array, i0 = 0, i1 = a.length) => {
    let s = 0;
    for (let i = i0; i < i1; i++) s += a[i] * a[i];
    return Math.sqrt(s / (i1 - i0));
  };
  const falar = (a: Float32Array, deSeg: number, ateSeg: number, amp: number, hz = 300) => {
    for (let i = Math.floor(deSeg * TAXA); i < Math.floor(ateSeg * TAXA); i++)
      a[i] += amp * Math.sin((2 * Math.PI * hz * i) / TAXA);
  };
  const chiado = (a: Float32Array, amp: number) => {
    for (let i = 0; i < a.length; i++) a[i] += amp * ((Math.sin(i * 12.9898) * 43758.5453) % 1);
  };

  it("o som do fundo entre duas frases sai pelo menos 14 dB mais baixo que a voz manda", () => {
    // relato do dono (14/09/2026): "captura sons no fundo" — o anti-ruído do
    // microfone abaixa o fundo, e o tratamento levantava de volta
    const a = new Float32Array(TAXA * 6);
    chiado(a, 0.01);
    falar(a, 0.5, 2, 0.3);
    falar(a, 3, 4.5, 0.3);
    const r = normalizarVoz(a, TAXA);
    const voz = rms(r, TAXA, 1.5 * TAXA);
    const fundo = rms(r, 2.4 * TAXA, 2.8 * TAXA);
    // sem portão o fundo sairia 0,01 × ganho (~0,005); com ele, ×0,1
    expect(fundo).toBeLessThan((0.01 * (voz / 0.212)) / 5);
    expect(voz).toBeCloseTo(ALVO_RMS, 1);
  });

  it("a palavra NÃO começa cortada (o portão abre antes dela)", () => {
    const a = new Float32Array(TAXA * 4);
    chiado(a, 0.004);
    falar(a, 1, 3, 0.3);
    const r = portaoDeRuido(a, TAXA, 0.212);
    // os primeiros 20 ms da palavra contra o miolo dela: nada de "picote"
    const comeco = rms(r, TAXA, TAXA + 0.02 * TAXA);
    const meio = rms(r, 2 * TAXA, 2.5 * TAXA);
    expect(comeco / meio).toBeGreaterThan(0.85);
  });

  it("o portão fecha DEVAGAR (a pausa curta entre duas sílabas não some)", () => {
    const a = new Float32Array(TAXA * 3);
    falar(a, 0.5, 1.0, 0.3);
    falar(a, 1.05, 1.5, 0.3); // 50 ms de pausa
    const r = portaoDeRuido(a, TAXA, 0.212);
    // a segunda sílaba entra inteira: o ganho não caiu ao piso na pausa de 50 ms
    expect(rms(r, 1.06 * TAXA, 1.1 * TAXA) / rms(r, 0.7 * TAXA, 0.9 * TAXA)).toBeGreaterThan(0.9);
  });

  it("a atenuação tem piso: o fundo é abaixado, não apagado (silêncio absoluto soa 'cortado')", () => {
    const a = new Float32Array(TAXA * 2);
    chiado(a, 0.002);
    const r = portaoDeRuido(a, TAXA, 0.2);
    expect(rms(r, TAXA, 2 * TAXA) / rms(a, TAXA, 2 * TAXA)).toBeCloseTo(PISO_PORTAO, 1);
  });

  it("voz baixinha sobe até o novo teto (o ganho automático do navegador saiu)", () => {
    expect(GANHO_MAXIMO).toBe(8);
  });
});

describe("o CHIADO do fundo sai — também durante a fala (redução por espectro)", () => {
  const TAXA = 24_000;
  const rms = (a: Float32Array, i0 = 0, i1 = a.length) => {
    let s = 0;
    for (let i = i0; i < i1; i++) s += a[i] * a[i];
    return Math.sqrt(s / (i1 - i0));
  };
  const falar = (a: Float32Array, deSeg: number, ateSeg: number, amp: number, hz = 300) => {
    for (let i = Math.floor(deSeg * TAXA); i < Math.floor(ateSeg * TAXA); i++)
      a[i] += amp * Math.sin((2 * Math.PI * hz * i) / TAXA);
  };
  /** chiado de verdade: ruído branco (uniforme), não um tom */
  const chiado = (a: Float32Array, amp: number, semente = 1) => {
    let x = semente;
    for (let i = 0; i < a.length; i++) {
      x = (x * 1664525 + 1013904223) % 4294967296;
      a[i] += amp * (x / 4294967296 - 0.5) * 2;
    }
  };

  it("no silêncio o chiado cai pelo menos 12 dB", () => {
    const a = new Float32Array(TAXA * 6);
    chiado(a, 0.02);
    falar(a, 1, 3, 0.3);
    const r = reduzirChiado(a, TAXA);
    const antes = rms(a, 4 * TAXA, 5.5 * TAXA);
    const depois = rms(r, 4 * TAXA, 5.5 * TAXA);
    expect(depois / antes).toBeLessThan(0.25);
  });

  /** fala "de verdade" para o teste: sílabas de 200 ms, pausa de 100 ms, altura variando */
  const silabas = (a: Float32Array) => {
    for (let t = 1; t < 5; t += 0.3) {
      const hz = 180 + ((t * 37) % 120);
      falar(a, t, t + 0.2, 0.3, hz);
      falar(a, t, t + 0.2, 0.15, hz * 2);
      falar(a, t, t + 0.2, 0.08, hz * 3);
    }
  };
  /** energia numa frequência só (Goertzel) — para medir o chiado nos agudos, onde não há voz */
  const energiaEm = (x: Float32Array, hz: number, i0: number, i1: number) => {
    const w = (2 * Math.PI * hz) / TAXA;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = i0; i < i1; i++) {
      const s0 = x[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
  };

  it("DURANTE a fala o chiado dos agudos cai pelo menos 6 dB, e a voz fica inteira", () => {
    // medido: 3 kHz ×0,33, 5 kHz ×0,23, 8 kHz ×0,16 — a voz (até 1 kHz aqui) em 97%
    const limpo = new Float32Array(TAXA * 6);
    silabas(limpo);
    const sujo = Float32Array.from(limpo);
    chiado(sujo, 0.02);
    const r = reduzirChiado(sujo, TAXA);
    for (const hz of [3000, 5000, 8000]) {
      const razao = energiaEm(r, hz, 2 * TAXA, 4 * TAXA) / energiaEm(sujo, hz, 2 * TAXA, 4 * TAXA);
      expect(razao, `${hz} Hz`).toBeLessThan(0.5);
    }
    expect(rms(r, 2 * TAXA, 4 * TAXA) / rms(limpo, 2 * TAXA, 4 * TAXA)).toBeGreaterThan(0.94);
  });

  it("gravação LIMPA sai igual (o perfil aprendido é ~zero e o ganho fica em 1)", () => {
    const a = new Float32Array(TAXA * 6);
    silabas(a);
    const r = reduzirChiado(a, TAXA);
    expect(rms(r, 2 * TAXA, 4 * TAXA) / rms(a, 2 * TAXA, 4 * TAXA)).toBeGreaterThan(0.95);
  });

  it("a redução tem teto: o fundo é abaixado, não zerado (som 'debaixo d'água')", () => {
    const a = new Float32Array(TAXA * 6);
    chiado(a, 0.02);
    const r = reduzirChiado(a, TAXA);
    expect(rms(r, TAXA, 5 * TAXA) / rms(a, TAXA, 5 * TAXA)).toBeGreaterThan(PISO_CHIADO * 0.8);
  });

  it("gravação curtíssima não quebra (sai como veio)", () => {
    const a = new Float32Array(1000);
    a[10] = 0.5;
    expect(reduzirChiado(a, TAXA)).toBe(a);
  });

  it("o chiado sai ANTES de medir a voz e de abrir o portão (normalizarVoz)", () => {
    const a = new Float32Array(TAXA * 6);
    chiado(a, 0.02);
    falar(a, 1, 3, 0.3);
    const r = normalizarVoz(a, TAXA);
    // fundo (4–5,5 s) contra a voz (1,5–2,5 s): mais de 30 dB de distância
    expect(rms(r, 4 * TAXA, 5.5 * TAXA) / rms(r, 1.5 * TAXA, 2.5 * TAXA)).toBeLessThan(0.03);
  });
});

describe("o ESTALO sai mais baixo, não deformado (freio de pico)", () => {
  const TAXA = 24_000;
  const pico = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const rms = (a: Float32Array, i0 = 0, i1 = a.length) => {
    let s = 0;
    for (let i = i0; i < i1; i++) s += a[i] * a[i];
    return Math.sqrt(s / (i1 - i0));
  };
  const falar = (a: Float32Array, deSeg: number, ateSeg: number, amp: number, hz = 300) => {
    for (let i = Math.floor(deSeg * TAXA); i < Math.floor(ateSeg * TAXA); i++)
      a[i] += amp * Math.sin((2 * Math.PI * hz * i) / TAXA);
  };

  it("o pico nunca passa do teto, e a FORMA da onda é preservada", () => {
    // um estalo de 3× o teto no meio da fala (14/09/2026: "sons que nem são
    // altos chegam estourando" — a curva antiga espremia a onda)
    const a = new Float32Array(TAXA * 3);
    falar(a, 0, 3, 0.4);
    falar(a, 1.5, 1.55, 3, 1200);
    const r = limitarPicos(a, TAXA);
    expect(pico(r)).toBeLessThanOrEqual(1);
    // no estalo, a saída é o estalo ×ganho (mesma forma): a razão entre
    // amostras vizinhas de entrada e saída é quase constante (sem "achatar")
    const i0 = Math.floor(1.52 * TAXA);
    const razoes = [];
    for (let i = i0; i < i0 + 40; i++) if (Math.abs(a[i]) > 0.5) razoes.push(r[i] / a[i]);
    const min = Math.min(...razoes), max = Math.max(...razoes);
    expect(max / min).toBeLessThan(1.05);
  });

  it("o ganho abaixa ANTES de o pico chegar (antevisão), e volta em menos de 300 ms", () => {
    const a = new Float32Array(TAXA * 3);
    falar(a, 0, 3, 0.4);
    falar(a, 1.5, 1.52, 2.5, 1200);
    const r = limitarPicos(a, TAXA);
    // 300 ms depois do estalo a fala já está de volta ao volume normal
    expect(rms(r, 1.85 * TAXA, 2.2 * TAXA) / rms(a, 1.85 * TAXA, 2.2 * TAXA)).toBeGreaterThan(0.95);
    // e a fala ANTES do estalo não foi mexida (só os 5 ms de antevisão)
    expect(rms(r, 1.0 * TAXA, 1.45 * TAXA) / rms(a, 1.0 * TAXA, 1.45 * TAXA)).toBeGreaterThan(0.99);
  });

  it("sinal que nunca passa do teto sai IGUAL", () => {
    const a = new Float32Array(TAXA);
    falar(a, 0, 1, 0.6);
    const r = limitarPicos(a, TAXA);
    for (let i = 0; i < a.length; i += 997) expect(r[i]).toBeCloseTo(a[i], 6);
  });

  it("a mudança de taxa é feita pelo DECODIFICADOR, não tocando o buffer (evita o ruído áspero)", () => {
    const src = ler("src/lib/audio-wav.ts");
    const f = src.slice(src.indexOf("export async function gravacaoParaWav"));
    expect(f).toContain("decodificarNaTaxa(bytes, alvo)");
    expect(src).toMatch(/new OfflineAudioContext\(\{ numberOfChannels: 1, length: 1, sampleRate: taxa \}\)/);
  });
});

describe("o começo da gravação não pega a subida do ganho", () => {
  it("existe uma espera antes de gravar de verdade", () => {
    // meio segundo: é o tempo que o ganho automático leva para achar a voz
    expect(MS_ASSENTAR_MICROFONE).toBeGreaterThanOrEqual(300);
    expect(MS_ASSENTAR_MICROFONE).toBeLessThanOrEqual(1000);
  });

  it("a tela espera ANTES de ligar o gravador, e avisa enquanto espera", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(tela).toContain("await new Promise((r) => setTimeout(r, MS_ASSENTAR_MICROFONE));");
    expect(tela).toContain("Preparando o microfone…");
    // a espera vem ANTES de o gravador começar
    expect(tela.indexOf("MS_ASSENTAR_MICROFONE)")).toBeLessThan(tela.indexOf("rec.start()"));
  });

  it("desistir durante a espera não estoura nem prende a barra", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    // stop() em gravador já parado estoura InvalidStateError
    expect(tela).toContain('if (recRef.current?.state === "recording") recRef.current.stop();');
    // e o gravador antigo não pode ficar para trás
    expect(tela).toContain("recRef.current = null;");
  });

  it("o volume é acertado ANTES de virar PCM (senão o corte já aconteceu)", () => {
    const conv = ler("src/lib/audio-wav.ts");
    expect(conv).toContain("const voz = normalizarVoz(amostras, alvo);");
    expect(conv).toContain("encodeWav(voz, alvo)");
  });
});

describe("a gravação captura em qualidade de gravação", () => {
  it("o microfone não usa o modo chamada (que come parte da voz)", () => {
    // a regra saiu da tela para `lib/microfone.ts` em 26/08/2026, junto com a
    // escolha de QUAL microfone grava — o teste dela vive em microfone.test.ts
    const regra = ler("src/lib/microfone.ts");
    expect(regra).toContain("echoCancellation: false");
    // ruído FICA (loja é barulhenta); o ganho automático SAIU (14/09/2026):
    // levantava o fundo nas pausas e saturava som médio antes do nosso freio
    expect(regra).toContain("noiseSuppression: true");
    expect(regra).toContain("autoGainControl: false");
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
