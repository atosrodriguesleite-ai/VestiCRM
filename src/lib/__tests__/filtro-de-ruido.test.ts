import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATRASO_DO_FILTRO,
  PARTE_DO_ORIGINAL,
  QUADRO_DO_FILTRO,
  TAXA_DO_FILTRO,
  avisoDoFiltro,
  comPrazo,
  criarCarregadorDoFiltro,
  filtrarRuido,
  filtroDeRuidoLigado,
  reduzirTaxa,
  tentarFiltro,
  type ModuloDoFiltro,
} from "../filtro-de-ruido";
import { normalizarVoz } from "../audio-wav";
import { descricaoDaCaptura } from "../microfone";

// Guarda RN-112
//
// O FILTRO DE RUÍDO POR IA DO ÁUDIO DE VOZ. Relato do dono (17/11/2026): "meu
// áudio não bloqueia o ruído; no Google Meet funciona". O filtro do navegador
// só tira ruído CONSTANTE; o que varia (máquina, teclado, rua) passava
// inteiro. Entrou o RNNoise, rodando no navegador depois da gravação.
//
// Estes testes rodam o filtro DE VERDADE (o mesmo arquivo que o navegador
// baixa) sobre uma voz de amostra com ruídos gerados aqui, e prendem o
// comportamento: o ruído das pausas cai, a voz fica, o áudio não muda de
// tamanho nem de lugar, e a falha do filtro nunca vira áudio estragado.

const raiz = process.cwd();
const pasta = join(raiz, "public", "filtro-de-ruido");

function lerWav(arquivo: string): Float32Array {
  const b = readFileSync(arquivo);
  let p = 12;
  while (p < b.length) {
    const id = b.toString("ascii", p, p + 4);
    const tamanho = b.readUInt32LE(p + 4);
    if (id === "data") {
      const s = new Float32Array(tamanho / 2);
      for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return s;
    }
    p += 8 + tamanho + (tamanho % 2);
  }
  throw new Error("WAV sem dados");
}

/** sorteio com semente: o mesmo ruído em toda rodada */
function sorteio(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** sem pausa de fôlego: o teste não precisa devolver a vez ao navegador */
const sem = { ceder: () => Promise.resolve() };
const rms = (s: Float32Array, a: number, b: number) => {
  let t = 0;
  for (let i = a; i < b; i++) t += s[i] * s[i];
  return Math.sqrt(t / Math.max(1, b - a));
};
const db = (v: number) => 20 * Math.log10(v || 1e-9);

let modulo: ModuloDoFiltro;
let voz: Float32Array;
/** começo dos quadros (20 ms) em que a voz de amostra FALA e em que está CALADA */
const fala: number[] = [];
const pausa: number[] = [];
const QUADRO = 960;

/** nível médio, em dB, nos quadros dados */
const nivel = (s: Float32Array, onde: number[]) =>
  db(Math.sqrt(onde.reduce((t, i) => t + rms(s, i, i + QUADRO) ** 2, 0) / onde.length));

/** quanto do que saiu, nos trechos de fala, é a voz limpa (correlação, 0..1) */
function parecidoComAVoz(y: Float32Array): number {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const i of fala)
    for (let k = 0; k < QUADRO; k++) {
      a += voz[i + k] * y[i + k];
      b += voz[i + k] ** 2;
      c += y[i + k] ** 2;
    }
  return a / Math.sqrt(b * c);
}

/** máquina de costura: rajadas de zumbido com chiado (0,35 s ligada, 0,25 s parada) */
function maquina(n: number): Float32Array {
  const r = sorteio(11);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / TAXA_DO_FILTRO;
    const fase = t % 0.6;
    if (fase > 0.35) continue;
    const env = Math.min(1, fase / 0.02) * Math.min(1, (0.35 - fase) / 0.02);
    let zumbido = 0;
    for (let k = 1; k < 10; k++) zumbido += Math.sin(2 * Math.PI * 110 * k * t) / k;
    s[i] = env * (zumbido * 0.05 + (r() * 2 - 1) * 0.06);
  }
  return s;
}

/** teclado: estalos curtos e fortes em instantes sorteados */
function teclado(n: number): Float32Array {
  const r = sorteio(23);
  const s = new Float32Array(n);
  for (let c = 0; c < Math.floor(n / 4800); c++) {
    const inicio = Math.floor(r() * (n - 600));
    for (let k = 0; k < 576; k++) s[inicio + k] += Math.exp(-k / 120) * (r() * 2 - 1) * 0.5;
  }
  return s;
}

/** chiado constante (ventilador, ar) */
function chiado(n: number): Float32Array {
  const r = sorteio(7);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = (r() * 2 - 1) * 0.055;
  return s;
}

const somar = (a: Float32Array, b: Float32Array, ganho = 1) => a.map((v, i) => v + b[i] * ganho);

beforeAll(async () => {
  // o MESMO arquivo que o navegador baixa de /filtro-de-ruido/rnnoise.js
  const cola = await import("../../../public/filtro-de-ruido/rnnoise.js");
  modulo = (await cola.default({
    wasmBinary: readFileSync(join(pasta, "rnnoise.wasm")),
  })) as ModuloDoFiltro;
  voz = lerWav(join(raiz, "src", "lib", "amostras-de-teste", "voz-de-teste.wav"));
  for (let i = 0; i + QUADRO <= voz.length; i += QUADRO) {
    const r = rms(voz, i, i + QUADRO);
    if (r > 0.02) fala.push(i);
    else if (r < 0.002) pausa.push(i);
  }
});

describe("os arquivos do filtro", () => {
  it("as cópias da pasta pública são iguais, byte a byte, às do pacote instalado", () => {
    const pacote = join(raiz, "node_modules", "@jitsi", "rnnoise-wasm", "dist");
    for (const arquivo of ["rnnoise.js", "rnnoise.wasm"])
      expect(
        readFileSync(join(pasta, arquivo)).equals(readFileSync(join(pacote, arquivo))),
        arquivo
      ).toBe(true);
  });

  it("a versão do pacote é fixa (sem ^): atualizar é decisão, não acaso", () => {
    const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
    expect(pkg.dependencies["@jitsi/rnnoise-wasm"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("a licença viaja junto dos arquivos", () => {
    expect(readFileSync(join(pasta, "LICENSE"), "utf8")).toContain("Apache License");
    expect(readFileSync(join(pasta, "LEIA-ME.txt"), "utf8")).toContain("BSD");
    // a BSD do RNNoise pede o aviso, as condições e a isenção junto do binário
    const bsd = readFileSync(join(pasta, "LICENCA-RNNOISE.txt"), "utf8");
    expect(bsd).toContain("Xiph.Org Foundation");
    expect(bsd).toContain("Redistributions in binary form must reproduce");
    expect(bsd).toContain("THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS");
  });

  it("a amostra tem fala e pausa suficientes para medir", () => {
    expect(fala.length).toBeGreaterThan(60);
    expect(pausa.length).toBeGreaterThan(10);
  });
});

describe("o que o filtro faz com o som", () => {
  it("voz limpa passa quase intacta, no mesmo lugar e no mesmo volume", async () => {
    const y = await filtrarRuido(voz, modulo, sem);
    expect(y.length).toBe(voz.length);
    expect(parecidoComAVoz(y)).toBeGreaterThan(0.97);
    expect(Math.abs(nivel(y, fala) - nivel(voz, fala))).toBeLessThan(1);
  });

  it("o atraso do filtro é descontado: a saída está alinhada com a entrada", async () => {
    const y = await filtrarRuido(voz, modulo, sem);
    // procura o deslocamento que mais combina; tem que ser (quase) zero
    let melhor = 0;
    let maior = -Infinity;
    for (let d = -40; d <= 40; d++) {
      let c = 0;
      for (let i = 2000; i < voz.length - 2000; i += 2) c += voz[i] * y[i + d];
      if (c > maior) {
        maior = c;
        melhor = d;
      }
    }
    expect(Math.abs(melhor)).toBeLessThanOrEqual(3);
    expect(ATRASO_DO_FILTRO).toBe(QUADRO_DO_FILTRO);
  });

  it("ruído que VARIA (máquina + teclado) cai nas pausas, e a voz fica", async () => {
    const ruido = somar(maquina(voz.length), teclado(voz.length));
    const mistura = somar(voz, ruido);
    const y = await filtrarRuido(mistura, modulo, sem);
    expect(nivel(mistura, pausa) - nivel(y, pausa)).toBeGreaterThan(3);
    expect(parecidoComAVoz(y)).toBeGreaterThan(0.93);
    // a voz não some junto com o ruído
    expect(nivel(voz, fala) - nivel(y, fala)).toBeLessThan(2);
  });

  it("ruído constante (chiado) cai bastante nas pausas", async () => {
    const mistura = somar(voz, chiado(voz.length));
    const y = await filtrarRuido(mistura, modulo, sem);
    expect(nivel(mistura, pausa) - nivel(y, pausa)).toBeGreaterThan(12);
    expect(parecidoComAVoz(y)).toBeGreaterThan(0.95);
  });

  it("o filtro já entra AQUECIDO: o ruído do primeiro décimo de segundo também cai", async () => {
    // sem o ensaio, o filtro levava um instante para aprender o fundo e o
    // começo do áudio saía com o chiado quase inteiro (medido: só 6 dB)
    const mistura = somar(voz, chiado(voz.length));
    const y = await filtrarRuido(mistura, modulo, sem);
    expect(db(rms(mistura, 0, 4800)) - db(rms(y, 0, 4800))).toBeGreaterThan(12);
  });

  it("o ensaio não deixa 'fantasma': o silêncio do começo de uma voz limpa continua silêncio", async () => {
    // ensaiando na ordem normal, a fala de 1 s depois vazava para a primeira
    // pausa (medido: +19 dB); de trás para a frente, não
    const y = await filtrarRuido(voz, modulo, sem);
    expect(nivel(y, pausa)).toBeLessThan(nivel(voz, pausa) + 3);
    expect(db(rms(y, 0, 4800))).toBeLessThan(db(rms(voz, 0, 4800)) + 3);
  });

  it("a mistura com 10% do original é o piso: o ruído nunca some por inteiro (não soa 'debaixo d'água')", async () => {
    expect(PARTE_DO_ORIGINAL).toBe(0.1);
    const mistura = somar(voz, chiado(voz.length));
    const y = await filtrarRuido(mistura, modulo, sem);
    // 10% do original = no máximo 20 dB de queda por conta do filtro
    expect(nivel(mistura, pausa) - nivel(y, pausa)).toBeLessThan(20.5);
  });

  it("NA CADEIA INTEIRA o áudio com o filtro sai mais limpo que o de hoje", async () => {
    const ruido = somar(maquina(voz.length), teclado(voz.length));
    const mistura = somar(voz, ruido);
    // quantos dB o ruído das pausas fica abaixo da voz, depois de tudo
    const distancia = (s: Float32Array) => nivel(s, fala) - nivel(s, pausa);
    const hoje = normalizarVoz(mistura, TAXA_DO_FILTRO);
    const novo = normalizarVoz(await filtrarRuido(mistura, modulo, sem), TAXA_DO_FILTRO);
    expect(distancia(novo) - distancia(hoje)).toBeGreaterThan(5);
    expect(parecidoComAVoz(novo)).toBeGreaterThanOrEqual(parecidoComAVoz(hoje) - 0.01);
  });

  it("silêncio continua silêncio, e áudio curtinho não quebra", async () => {
    const mudo = await filtrarRuido(new Float32Array(TAXA_DO_FILTRO), modulo, sem);
    expect(Math.max(...mudo.map(Math.abs))).toBeLessThan(1e-4);
    expect((await filtrarRuido(new Float32Array(0), modulo, sem)).length).toBe(0);
    const curto = await filtrarRuido(voz.subarray(20000, 20100), modulo, sem);
    expect(curto.length).toBe(100);
    expect(curto.every(Number.isFinite)).toBe(true);
    // tamanho que não é múltiplo do quadro
    expect((await filtrarRuido(voz.subarray(0, 12345), modulo, sem)).length).toBe(12345);
  });

  it("devolve o fôlego ao navegador a cada 2 s de áudio (a tela não congela)", async () => {
    let vezes = 0;
    const cincoSegundos = new Float32Array(TAXA_DO_FILTRO * 5);
    await filtrarRuido(cincoSegundos, modulo, {
      ceder: async () => {
        vezes++;
      },
    });
    // 501 quadros (5 s + o atraso) → fôlego nos quadros 200 e 400
    expect(vezes).toBe(2);
  });

  it("rodar duas vezes dá o mesmo resultado (cada áudio começa do zero)", async () => {
    const mistura = somar(voz, chiado(voz.length));
    const a = await filtrarRuido(mistura, modulo, sem);
    const b = await filtrarRuido(mistura, modulo, sem);
    expect(Array.from(a.subarray(30000, 30200))).toEqual(Array.from(b.subarray(30000, 30200)));
  });
});

describe("a falha do filtro nunca vira áudio estragado", () => {
  /** módulo de mentira: conta o que foi pedido e devolvido */
  function falso(aoProcessar: (heap: Float32Array, base: number, quadro: number) => void) {
    const heap = new Float32Array(4096);
    const conta = { criados: 0, destruidos: 0, alocados: 0, liberados: 0, quadros: 0 };
    const m: ModuloDoFiltro = {
      HEAPF32: heap,
      _rnnoise_create: () => {
        conta.criados++;
        return 8;
      },
      _rnnoise_destroy: () => {
        conta.destruidos++;
      },
      _malloc: () => {
        conta.alocados++;
        return 64;
      },
      _free: () => {
        conta.liberados++;
      },
      _rnnoise_process_frame: (_e, saida) => {
        aoProcessar(heap, saida >> 2, conta.quadros++);
        return 0;
      },
    };
    return { m, conta };
  }

  it("módulo que estoura no meio: a função LANÇA e a memória é devolvida", async () => {
    const { m, conta } = falso((_h, _b, q) => {
      if (q === 3) throw new Error("quebrou");
    });
    await expect(filtrarRuido(new Float32Array(4800), m, sem)).rejects.toThrow();
    expect(conta).toMatchObject({ criados: 1, destruidos: 1, alocados: 1, liberados: 1 });
  });

  it("módulo que devolve número inválido: LANÇA (não sai áudio com buraco)", async () => {
    const { m, conta } = falso((heap, base) => {
      heap[base + 5] = Number.NaN;
    });
    await expect(filtrarRuido(new Float32Array(4800), m, sem)).rejects.toThrow(/inválido/);
    expect(conta.liberados).toBe(1);
    expect(conta.destruidos).toBe(1);
  });

  it("módulo sem memória: LANÇA sem processar nada", async () => {
    const { m, conta } = falso(() => {});
    m._malloc = () => 0;
    await expect(filtrarRuido(new Float32Array(4800), m, sem)).rejects.toThrow();
    expect(conta.quadros).toBe(0);
    expect(conta.destruidos).toBe(1);
  });

  it("o som entra no filtro em escala de 16 bits e volta para −1..1", async () => {
    let maiorVisto = 0;
    const { m } = falso((heap, base) => {
      for (let k = 0; k < QUADRO_DO_FILTRO; k++) maiorVisto = Math.max(maiorVisto, Math.abs(heap[base + k]));
    });
    const entrada = new Float32Array(4800).fill(0.5);
    const y = await filtrarRuido(entrada, m, sem);
    expect(maiorVisto).toBeCloseTo(16384, 0);
    // o módulo de mentira devolve o que recebeu: a saída é a entrada, atrasada e descontada
    expect(y[2000]).toBeCloseTo(0.5, 3);
  });

  it("o filtro que passa do orçamento de tempo LANÇA (aparelho fraco não segura o envio)", async () => {
    let relogio = 0;
    const { m, conta } = falso(() => {
      relogio += 100; // cada quadro "custa" 100 ms neste aparelho de mentira
    });
    await expect(
      filtrarRuido(new Float32Array(TAXA_DO_FILTRO * 10), m, {
        ...sem,
        agora: () => relogio,
        orcamentoMs: 8000,
      })
    ).rejects.toThrow(/demorou/);
    // parou no primeiro fôlego depois do orçamento, não no fim do áudio
    expect(conta.quadros).toBeLessThan(400);
    expect(conta.liberados).toBe(1);
  });
});

describe("a decisão do filtro para um áudio (o que a conversão chama)", () => {
  const lento = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const em48 = async () => voz;

  it("entrou: devolve o áudio limpo já na taxa do envio", async () => {
    for (const alvo of [24_000, 16_000]) {
      const r = await tentarFiltro({ filtro: modulo, alvo, cabe: true, em48, opcoes: sem });
      expect(r.resultado).toBe("entrou");
      expect(r.amostras?.length).toBe(Math.ceil(voz.length / (TAXA_DO_FILTRO / alvo)));
      expect(r.amostras?.every(Number.isFinite)).toBe(true);
    }
  });

  it("sem filtro (desligado ou não carregou): nada é decodificado à toa", async () => {
    let chamou = 0;
    const r = await tentarFiltro({
      filtro: null,
      alvo: 24_000,
      cabe: true,
      em48: async () => {
        chamou++;
        return voz;
      },
    });
    expect(r).toEqual({ amostras: null, resultado: "sem-filtro" });
    expect(chamou).toBe(0);
  });

  it("áudio que NÃO cabe no envio nem passa pelo filtro (ia ser jogado fora)", async () => {
    let chamou = 0;
    const r = await tentarFiltro({
      filtro: modulo,
      alvo: 16_000,
      cabe: false,
      em48: async () => {
        chamou++;
        return voz;
      },
    });
    expect(r).toEqual({ amostras: null, resultado: "nao-coube" });
    expect(chamou).toBe(0);
  });

  it("taxa de que o filtro não desce (44,1 kHz, 11 kHz): fica sem o filtro, sem quebrar", async () => {
    for (const alvo of [44_100, 22_050, 11_025, 0]) {
      const r = await tentarFiltro({ filtro: modulo, alvo, cabe: true, em48 });
      expect(r, String(alvo)).toEqual({ amostras: null, resultado: "nao-coube" });
    }
  });

  it("o filtro que QUEBRA, em qualquer ponto, vira 'falhou' — nunca uma exceção", async () => {
    const quebrado: ModuloDoFiltro = {
      ...modulo,
      HEAPF32: modulo.HEAPF32,
      _rnnoise_process_frame: () => {
        throw new Error("abortou");
      },
    };
    expect(await tentarFiltro({ filtro: quebrado, alvo: 24_000, cabe: true, em48 })).toEqual({
      amostras: null,
      resultado: "falhou",
    });
    // a decodificação em 48 kHz também pode falhar
    const r = await tentarFiltro({
      filtro: modulo,
      alvo: 24_000,
      cabe: true,
      em48: async () => {
        await lento(1);
        throw new Error("não decodificou");
      },
    });
    expect(r).toEqual({ amostras: null, resultado: "falhou" });
  });

  it("a frase da tela diz POR QUE o filtro ligado não entrou — e cala quando entrou", () => {
    expect(avisoDoFiltro("entrou")).toBeNull();
    expect(avisoDoFiltro("nao-coube")).toContain("longo demais");
    expect(avisoDoFiltro("falhou")).toContain("falhou");
    expect(avisoDoFiltro("sem-filtro")).toContain("não carregou");
  });
});

describe("descer a taxa sem cortar nem dobrar o som", () => {
  const tom = (hz: number, n = 48_000) =>
    Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / TAXA_DO_FILTRO));
  // nível longe das pontas (a borda do filtro não entra na conta)
  const nivelDoMeio = (s: Float32Array) => db(rms(s, Math.floor(s.length * 0.2), Math.floor(s.length * 0.8)));

  it("a voz passa inteira: 1 kHz e 8 kHz saem no mesmo nível", () => {
    for (const [hz, para] of [
      [1000, 24_000],
      [8000, 24_000],
      [1000, 16_000],
      [5000, 16_000],
    ]) {
      const y = reduzirTaxa(tom(hz), TAXA_DO_FILTRO, para)!;
      expect(y.length).toBe(48_000 / (TAXA_DO_FILTRO / para));
      expect(Math.abs(nivelDoMeio(y) - nivelDoMeio(tom(hz))), `${hz} Hz → ${para}`).toBeLessThan(0.3);
    }
  });

  it("o que dobraria para dentro é calado (13 e 15 kHz → 24 kHz; 9 e 12 kHz → 16 kHz)", () => {
    for (const [hz, para] of [
      [13_000, 24_000],
      [15_000, 24_000],
      [20_000, 24_000],
      [9000, 16_000],
      [12_000, 16_000],
    ]) {
      const y = reduzirTaxa(tom(hz), TAXA_DO_FILTRO, para)!;
      expect(nivelDoMeio(tom(hz)) - nivelDoMeio(y), `${hz} Hz → ${para}`).toBeGreaterThan(50);
    }
  });

  it("não corta o que passa de 1,0 (o freio é do normalizarVoz, depois)", () => {
    const alto = tom(1000).map((v) => v * 3); // pico de 1,5
    const y = reduzirTaxa(alto, TAXA_DO_FILTRO, 24_000)!;
    let pico = 0;
    for (let i = 2000; i < y.length - 2000; i++) pico = Math.max(pico, Math.abs(y[i]));
    expect(pico).toBeGreaterThan(1.4);
  });

  it("mesma taxa devolve o som como veio; fator quebrado devolve null", () => {
    const x = tom(1000, 480);
    expect(reduzirTaxa(x, 48_000, 48_000)).toBe(x);
    expect(reduzirTaxa(x, 48_000, 44_100)).toBeNull();
    expect(reduzirTaxa(x, 48_000, 0)).toBeNull();
    expect(reduzirTaxa(new Float32Array(0), 48_000, 24_000)?.length).toBe(0);
  });
});

describe("a carga do filtro nunca atrapalha o envio", () => {
  const modFalso = { _rnnoise_process_frame: () => 0 } as unknown as ModuloDoFiltro;
  const adiada = <T,>() => {
    let resolver!: (v: T) => void;
    let rejeitar!: (e: unknown) => void;
    const promessa = new Promise<T>((a, b) => {
      resolver = a;
      rejeitar = b;
    });
    return { promessa, resolver, rejeitar };
  };

  it("carrega UMA vez e entrega na hora para os áudios seguintes", async () => {
    let cargas = 0;
    const c = criarCarregadorDoFiltro(async () => {
      cargas++;
      return modFalso;
    });
    c.aquecer();
    c.aquecer();
    expect(await c.paraOAudio(50)).toBe(modFalso);
    expect(await c.paraOAudio(50)).toBe(modFalso);
    expect(cargas).toBe(1);
  });

  it("carga que FALHA não fica guardada: a gravação seguinte tenta de novo, com OUTRO endereço", async () => {
    const tentativas: number[] = [];
    let falhar = true;
    const c = criarCarregadorDoFiltro(async (n) => {
      tentativas.push(n);
      if (falhar) throw new Error("rede");
      return modFalso;
    });
    expect(await c.paraOAudio(50)).toBeNull();
    falhar = false;
    expect(await c.paraOAudio(50)).toBe(modFalso);
    // o navegador guarda a falha do import da mesma URL: a 2ª tentativa leva outro número
    expect(tentativas).toEqual([0, 1]);
  });

  it("carga PENDURADA: só o primeiro áudio espera; o segundo sai na hora, sem filtro", async () => {
    const d = adiada<ModuloDoFiltro | null>();
    let cargas = 0;
    const c = criarCarregadorDoFiltro(() => {
      cargas++;
      return d.promessa;
    });
    const t0 = Date.now();
    expect(await c.paraOAudio(60)).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
    const t1 = Date.now();
    expect(await c.paraOAudio(60)).toBeNull();
    expect(Date.now() - t1).toBeLessThan(30);
    expect(cargas).toBe(1);
    // quando enfim chega, os próximos áudios ganham o filtro
    d.resolver(modFalso);
    await new Promise((r) => setTimeout(r, 5));
    expect(await c.paraOAudio(60)).toBe(modFalso);
  });

  it("a carga tem prazo próprio: passou, é largada e a próxima gravação começa outra", async () => {
    let cargas = 0;
    const c = criarCarregadorDoFiltro(() => {
      cargas++;
      return new Promise<ModuloDoFiltro | null>(() => {});
    }, 40);
    expect(await c.paraOAudio(20)).toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(await c.paraOAudio(20)).toBeNull();
    expect(cargas).toBe(2);
  });

  it("o módulo que quebrou num áudio é largado: o seguinte carrega um novo", async () => {
    let cargas = 0;
    const c = criarCarregadorDoFiltro(async () => {
      cargas++;
      return { ...modFalso };
    });
    const primeiro = await c.paraOAudio(50);
    c.descartar();
    const segundo = await c.paraOAudio(50);
    expect(cargas).toBe(2);
    expect(segundo).not.toBe(primeiro);
  });

  it("descartar no meio de uma carga não deixa o resultado velho voltar", async () => {
    const d = adiada<ModuloDoFiltro | null>();
    let cargas = 0;
    const c = criarCarregadorDoFiltro(() => {
      cargas++;
      return cargas === 1 ? d.promessa : Promise.resolve(modFalso);
    });
    c.aquecer();
    c.descartar();
    d.resolver({ ...modFalso });
    expect(await c.paraOAudio(50)).toBe(modFalso);
    expect(cargas).toBe(2);
  });
});

describe("a preferência e a espera", () => {
  it("o filtro nasce LIGADO; só o '0' guardado desliga", () => {
    expect(filtroDeRuidoLigado(null)).toBe(true);
    expect(filtroDeRuidoLigado(undefined)).toBe(true);
    expect(filtroDeRuidoLigado("")).toBe(true);
    expect(filtroDeRuidoLigado("1")).toBe(true);
    expect(filtroDeRuidoLigado("0")).toBe(false);
  });

  it("o que não carregou no prazo não segura o áudio", async () => {
    const nunca = new Promise<string>(() => {});
    expect(await comPrazo(nunca, 20)).toBeNull();
    expect(await comPrazo(Promise.resolve("pronto"), 20)).toBe("pronto");
    expect(await comPrazo(Promise.reject(new Error("rede")), 20)).toBeNull();
  });

  it("a barra de gravação diz se o filtro forte está ligado", () => {
    const captura = { noiseSuppression: true, autoGainControl: false, echoCancellation: false };
    expect(descricaoDaCaptura(captura, true)).toContain("filtro de ruído forte ligado");
    expect(descricaoDaCaptura(captura, false)).toContain("filtro de ruído forte desligado");
    // quem não informa o filtro (chamada antiga) não ganha a frase
    expect(descricaoDaCaptura(captura)).not.toContain("filtro de ruído forte");
  });
});
