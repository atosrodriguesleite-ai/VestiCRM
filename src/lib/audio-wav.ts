/**
 * Conversão da gravação de voz do navegador para WAV (PCM 16 bits, mono).
 *
 * POR QUE ISSO EXISTE: o navegador grava em webm e NÃO escreve a duração
 * dentro do arquivo (limitação conhecida do MediaRecorder — o cabeçalho é
 * fechado antes de a gravação terminar). O servidor de conexão converte um
 * arquivo "sem etiqueta de tempo" e o WhatsApp mostra o áudio marcando
 * 0:00 — a cliente vê uma bolha que parece quebrada, mesmo tocando normal.
 *
 * O WAV carrega a duração no próprio cabeçalho (taxa + tamanho dos dados),
 * então a conversão no servidor sai com o tempo certo.
 *
 * A TAXA MANDA NO BRILHO DA VOZ. Gravar a 16 kHz joga fora tudo acima de
 * 8 kHz (metade da taxa — regra de Nyquist), e é justamente ali que moram o
 * "s", o "ch" e o "f": a voz chega abafada, com cara de telefone. Medido no
 * Chromium com um tom de 8 kHz: a 16 kHz ele sai ZERADO; a 24 kHz volta
 * inteiro. Por isso a taxa agora é a MAIOR que couber no teto de envio —
 * áudio curto (a maioria) sai em 32 kHz, e o longo cai para 16 kHz em vez de
 * não ir (WAV é sem compressão: 16 kHz ≈ 32 KB/s, 32 kHz ≈ 64 KB/s).
 */

/**
 * Da melhor para a pior — a primeira que couber no teto vence.
 *
 * O teto é 24 kHz, não mais: ele já leva o corte para 12 kHz, acima de tudo
 * que a voz usa, e a medição não viu diferença para 32 kHz. O que 32 kHz
 * traria de verdade era PESO — WAV não comprime, e mídia aqui vive como
 * data-URL no banco (a dívida técnica nº 1 do projeto): dobrar o tamanho de
 * todo áudio de voz custa caro e ainda encosta no tempo limite do envio.
 */
export const TAXAS_WAV = [24_000, 16_000] as const;

/** Teto padrão do envio (o servidor corta em ~4,5 MB; base64 infla 1/3). */
export const TETO_AUDIO_BYTES = 3 * 1024 * 1024;

/** A taxa é limitada pelo teto de tamanho E pela taxa da própria gravação. */
export function melhorTaxa(
  duracaoSegundos: number,
  taxaDaGravacao: number,
  tetoBytes: number = TETO_AUDIO_BYTES
): number {
  const cabe = (taxa: number) => 44 + Math.ceil(duracaoSegundos * taxa) * 2 <= tetoBytes;
  const possiveis = TAXAS_WAV.filter((t) => t <= taxaDaGravacao);
  // gravação em taxa baixa (microfone simples): não inventa qualidade
  if (possiveis.length === 0) return Math.min(taxaDaGravacao, TAXAS_WAV[TAXAS_WAV.length - 1]);
  // nenhuma cabe: vai na menor mesmo assim — quem chama decide o que fazer
  return possiveis.find(cabe) ?? possiveis[possiveis.length - 1];
}

/**
 * VOLUME ALVO DA VOZ (RMS, não pico).
 *
 * Medir por PICO era o erro: um estalo de 200 ms decidia o volume do áudio
 * inteiro. O que o ouvido chama de "volume" é a energia média da fala — é
 * assim que os aplicativos deixam todos os áudios parelhos. 0,16 é o RMS
 * típico de uma mensagem de voz bem gravada.
 */
export const ALVO_RMS = 0.16;

/**
 * Teto de quanto dá para AUMENTAR um áudio baixinho. Sem teto, uma gravação
 * quase muda seria multiplicada por 50 e o que se ouviria era o chiado da
 * loja, não a voz.
 */
export const GANHO_MAXIMO = 4;

/** Subida e descida suaves (ms): tiram o "toc" de quando o microfone abre. */
export const MS_SUAVIZA = 25;

/** Tamanho do quadro usado para medir a energia da fala (ms). */
export const MS_QUADRO = 20;

/** A partir daqui o volume é comprimido em vez de cortado (freio suave). */
export const LIMIAR_FREIO = 0.7;

/** Onde a curva do freio encosta — sem NUNCA chegar (não existe degrau). */
export const TETO_FREIO = 0.995;

/**
 * ONDE A VOZ ESTÁ, ignorando o silêncio e os estalos.
 *
 * Três armadilhas, todas medidas com sinal de teste (`normalizarVoz` é pura,
 * dá para conferir sem navegador):
 *
 *  1. medir o arquivo inteiro conta o SILÊNCIO. Um áudio de 20s com 2s de
 *     fala dava um nível de 0,004 — o chiado da sala — e o ganho ia para o
 *     teto: o que subia era o chiado, não a voz. Por isso a "porteira": só
 *     entram na conta os pedaços que têm som de verdade (20 dB abaixo dos
 *     mais altos para baixo, fica de fora);
 *  2. medir pelo PICO deixa um estalo de 200 ms — porta batendo, o "toc" do
 *     headset — mandar no volume do áudio todo, e a voz sai sussurrada;
 *  3. medir pela MÉDIA dos pedaços ainda sofre com o estalo (ele puxa a
 *     média). A MEDIANA não: medido, com um estalo de 200 ms sobre 4,5s de
 *     fala, a média deixava a voz em 0,103 e a mediana em 0,160 — o mesmo
 *     volume de uma gravação sem estalo nenhum.
 */
function nivelDaVoz(samples: Float32Array, taxa: number): number {
  const porQuadro = Math.max(1, Math.floor((MS_QUADRO / 1000) * taxa));
  const quadros: number[] = [];
  for (let i = 0; i + porQuadro <= samples.length; i += porQuadro) {
    let soma = 0;
    for (let j = i; j < i + porQuadro; j++) soma += samples[j] * samples[j];
    quadros.push(Math.sqrt(soma / porQuadro));
  }
  if (quadros.length === 0) return 0;

  const ordenados = [...quadros].sort((a, b) => a - b);
  const referencia = ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * 0.9))];
  if (referencia === 0) return 0;

  const porteira = referencia / 10; // -20 dB abaixo dos trechos mais altos
  const comSom = ordenados.filter((v) => v >= porteira);
  if (comSom.length === 0) return referencia;
  return comSom[Math.floor(comSom.length / 2)]; // mediana
}

/**
 * FREIO SUAVE em vez de corte seco.
 *
 * Passar de 1.0 e cortar reto (`Math.min(1, v)`) é literalmente o barulho de
 * "estourado": o topo da onda vira um degrau, e dezenas de amostras seguidas
 * ficam grudadas no MESMO valor. Aqui o que passa do limiar é comprimido numa
 * curva que se aproxima do teto sem nunca alcançá-lo — som mais alto continua
 * saindo mais alto, e nada vira platô.
 */
export function freioSuave(v: number): number {
  const a = Math.abs(v);
  if (a <= LIMIAR_FREIO) return v;
  const espaco = TETO_FREIO - LIMIAR_FREIO;
  return Math.sign(v) * (LIMIAR_FREIO + espaco * Math.tanh((a - LIMIAR_FREIO) / espaco));
}

/**
 * DEIXA A VOZ NO MESMO VOLUME, SEM ESTOURAR.
 *
 * Reclamação de 26/08/2026: "no primeiro segundo tá estourado, depois fica
 * bom". O ganho automático do microfone COMEÇA ALTO e vai se ajustando — esse
 * começo saía acima do máximo e o conversor simplesmente CORTAVA o que
 * passava. (A subida do ganho agora fica fora do arquivo, pela espera em
 * `MS_ASSENTAR_MICROFONE`; o que ainda passar encontra o freio, não a tesoura.)
 *
 * E o pedido junto: "que fique bom igual o aplicativo do WhatsApp". O que
 * deixa aqueles áudios parelhos é isto — nível medido pela energia da FALA e
 * um freio suave em cima, não um corte.
 *
 * O "toc" do microfone abrindo some com a subida suave nos primeiros 25 ms.
 */
export function normalizarVoz(samples: Float32Array, taxa: number): Float32Array {
  const nivel = nivelDaVoz(samples, taxa);
  // silêncio absoluto: não há o que ajustar (e evita dividir por zero)
  if (nivel === 0) return samples;

  const ganho = Math.min(ALVO_RMS / nivel, GANHO_MAXIMO);
  const suaviza = Math.min(
    Math.floor((MS_SUAVIZA / 1000) * taxa),
    Math.floor(samples.length / 2)
  );

  const saida = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = freioSuave(samples[i] * ganho);
    if (suaviza > 0) {
      if (i < suaviza) v *= i / suaviza;
      else if (i >= samples.length - suaviza) v *= (samples.length - 1 - i) / suaviza;
    }
    saida[i] = v;
  }
  return saida;
}

/** Monta o arquivo WAV (cabeçalho RIFF + amostras PCM de 16 bits). */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPorAmostra = 2; // PCM 16 bits
  const tamanhoDados = samples.length * bytesPorAmostra;
  const buffer = new ArrayBuffer(44 + tamanhoDados);
  const view = new DataView(buffer);

  const texto = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  texto(0, "RIFF");
  view.setUint32(4, 36 + tamanhoDados, true); // tamanho do arquivo - 8
  texto(8, "WAVE");
  texto(12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do bloco "fmt "
  view.setUint16(20, 1, true); // formato: PCM sem compressão
  view.setUint16(22, 1, true); // 1 canal (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPorAmostra, true); // bytes por segundo
  view.setUint16(32, bytesPorAmostra, true); // alinhamento do bloco
  view.setUint16(34, 8 * bytesPorAmostra, true); // bits por amostra
  texto(36, "data");
  view.setUint32(40, tamanhoDados, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i])); // corta estouro
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/**
 * Converte a gravação (webm/mp4 do navegador) em WAV com duração correta.
 * Roda 100% no navegador. Qualquer falha devolve null — quem chama segue
 * com o arquivo original (áudio sem duração é melhor que áudio nenhum).
 */
export async function gravacaoParaWav(
  blob: Blob,
  tetoBytes: number = TETO_AUDIO_BYTES
): Promise<Blob | null> {
  try {
    const janela = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AudioCtx = janela.AudioContext ?? janela.webkitAudioContext;
    if (!AudioCtx || typeof OfflineAudioContext === "undefined") return null;

    const bytes = await blob.arrayBuffer();
    // O decode devolve o áudio NA TAXA DO CONTEXTO, que por padrão é a do
    // aparelho de SAÍDA — com um fone bluetooth em modo viva-voz ela cai para
    // 16 kHz e a gravação sairia abafada mesmo curtinha, sem ninguém entender
    // por quê. Pedimos 48 kHz para a decisão de taxa não depender do fone.
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx({ sampleRate: 48_000 });
    } catch {
      ctx = new AudioCtx(); // aparelho que não aceita: segue com o padrão
    }
    const decodificado = await ctx.decodeAudioData(bytes.slice(0));
    await ctx.close().catch(() => {});

    // junta os canais em um só (voz não precisa de estéreo) e usa a MAIOR
    // taxa que cabe no envio — quanto maior, menos abafada fica a voz
    const alvo = melhorTaxa(decodificado.duration, decodificado.sampleRate, tetoBytes);
    const total = Math.ceil(decodificado.duration * alvo);
    if (!total) return null;

    const offline = new OfflineAudioContext(1, total, alvo);
    const fonte = offline.createBufferSource();
    fonte.buffer = decodificado;
    fonte.connect(offline.destination);
    fonte.start();
    const rendido = await offline.startRendering();

    // o volume é acertado ANTES de virar PCM: passar de 1.0 aqui vira corte
    // quadrado, que é o barulho de "estourado"
    const voz = normalizarVoz(rendido.getChannelData(0), alvo);
    return new Blob([encodeWav(voz, alvo)], { type: "audio/wav" });
  } catch {
    return null;
  }
}
