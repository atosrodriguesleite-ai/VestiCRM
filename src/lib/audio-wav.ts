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

    return new Blob([encodeWav(rendido.getChannelData(0), alvo)], { type: "audio/wav" });
  } catch {
    return null;
  }
}
