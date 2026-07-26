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
 * 16 kHz mono é o padrão de voz: dá ~32 KB por segundo de áudio (1 minuto
 * ≈ 1,9 MB), bem dentro do teto de envio, e o WhatsApp reencoda para opus
 * do lado dele de qualquer forma.
 */

export const WAV_SAMPLE_RATE = 16_000;

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
export async function gravacaoParaWav(blob: Blob): Promise<Blob | null> {
  try {
    const janela = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AudioCtx = janela.AudioContext ?? janela.webkitAudioContext;
    if (!AudioCtx || typeof OfflineAudioContext === "undefined") return null;

    const bytes = await blob.arrayBuffer();
    const ctx = new AudioCtx();
    const decodificado = await ctx.decodeAudioData(bytes.slice(0));
    await ctx.close().catch(() => {});

    // reamostra para 16 kHz e junta os canais em um só (voz não precisa de mais)
    const alvo = Math.min(WAV_SAMPLE_RATE, decodificado.sampleRate);
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
