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
 * loja, não a voz. Subiu de 4 para 8 quando o ganho automático do navegador
 * foi desligado (14/09/2026): agora quem levanta a voz de quem fala longe
 * somos nós — e o portão de ruído segura o fundo que sobe junto.
 */
export const GANHO_MAXIMO = 8;

/**
 * PORTÃO DE RUÍDO: o que fica MUITO abaixo da voz é abaixado, não passa.
 *
 * Abaixo de -18 dB da voz (1/8) o trecho começa a ser atenuado, na proporção
 * (quanto mais baixo, mais atenuado), até o piso de -20 dB (×0,1). Abre em
 * 5 ms (e um quadro ANTES da palavra, por antevisão) e fecha em 150 ms — é o
 * que impede a fala de sair picotada.
 */
export const LIMIAR_PORTAO = 1 / 8;
export const PISO_PORTAO = 0.1;
export const MS_ABRE_PORTAO = 5;
export const MS_FECHA_PORTAO = 150;

/**
 * FREIO DE PICO com antevisão: olha 5 ms à frente, abaixa o ganho ANTES de o
 * pico chegar (em 1 ms) e solta em 80 ms. É como os limitadores de estúdio
 * trabalham — o som alto sai um pouco mais baixo, não deformado.
 */
export const MS_ANTEVE_FREIO = 5;
export const MS_ATACA_FREIO = 1;
export const MS_SOLTA_FREIO = 80;

/**
 * REDUÇÃO DE CHIADO por espectro (relato do dono, 14/09/2026: "os áudios saem
 * com chiado no fundo — não pode"). O chiado é ruído espalhado por TODAS as
 * frequências, presente também DURANTE a fala; o portão só cala o que fica
 * entre as palavras. Aqui a gravação é fatiada em quadros de 512 amostras
 * (21 ms a 24 kHz), cada quadro vira espectro, e o PERFIL do chiado é
 * aprendido da própria gravação: em cada frequência, o nível que fica abaixo
 * de 20% do tempo é o piso de ruído (a voz não ocupa a mesma frequência o
 * tempo todo; o chiado, sim). Depois cada frequência de cada quadro é
 * abaixada na proporção do quanto ela está perto desse piso — até o teto de
 * redução —, com suavização no tempo e entre frequências vizinhas (sem isso
 * sobra o "borbulhado" típico de redutor barato).
 */
export const N_FFT = 512;
/**
 * 20% do tempo: o que fica abaixo disso numa frequência é chiado, não voz.
 * A voz muda de altura o tempo todo — nenhuma frequência fica ocupada por
 * ela em mais de 80% de uma mensagem; o chiado ocupa todas, o tempo inteiro.
 */
export const PERCENTIL_RUIDO = 0.2;
/**
 * Quanto do perfil de ruído é subtraído (acima de 1 = com folga). Medido com
 * ruído branco: o percentil 20 fica em ~0,53 do nível médio do chiado, e o
 * chiado oscila muito de quadro para quadro — com ×2 só 60% dos quadros
 * caíam ao piso e sobrava um "borbulhado" de −7 dB; com ×3, 86% caem e a
 * redução medida chega a −12 dB. A voz que passa do perfil por 10 dB ou
 * mais fica praticamente intocada (regra em potência, abaixo).
 */
export const FORCA_SUBTRACAO = 3;
/** Redução máxima: -16 dB (×0,16). Mais que isso soa "debaixo d'água". */
export const PISO_CHIADO = 0.16;
/** Abaixo disto é zumbido de rede e tremor de mesa, nunca voz: vai embora. */
export const HZ_CORTE_GRAVE = 70;

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

/** FFT complexa no lugar (radix-2). `re`/`im` com tamanho potência de 2. */
function fft(re: Float64Array, im: Float64Array, inversa = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inversa ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const meio = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < meio; k++) {
        const a = i + k, b = a + meio;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inversa) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * TIRA O CHIADO da gravação inteira (ver as constantes acima). Função pura:
 * entra e sai o mesmo número de amostras, e o que não é chiado sai igual —
 * a janela é raiz de Hann nas duas pontas com metade de sobreposição, que
 * reconstrói o sinal exatamente quando o ganho é 1.
 */
export function reduzirChiado(samples: Float32Array, taxa: number): Float32Array {
  const N = N_FFT, H = N >> 1, bins = H + 1;
  // gravação curta demais não tem de onde aprender o chiado: sai como veio
  if (samples.length < N * 8) return samples;
  const janela = new Float64Array(N);
  for (let i = 0; i < N; i++) janela[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

  const acolchoado = new Float64Array(H + samples.length + N);
  for (let i = 0; i < samples.length; i++) acolchoado[H + i] = samples[i];
  const quadros = Math.floor((acolchoado.length - N) / H) + 1;

  // passo 1: espectro de cada quadro (guardado para não recalcular)
  const espRe = new Float32Array(quadros * bins);
  const espIm = new Float32Array(quadros * bins);
  const mag = new Float32Array(quadros * bins);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let q = 0; q < quadros; q++) {
    const base = q * H;
    for (let i = 0; i < N; i++) { re[i] = acolchoado[base + i] * janela[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const p = q * bins + k;
      espRe[p] = re[k]; espIm[p] = im[k];
      mag[p] = Math.hypot(re[k], im[k]);
    }
  }

  // passo 2: o perfil do chiado — por frequência, o nível do percentil baixo
  const perfil = new Float64Array(bins);
  const coluna = new Float32Array(quadros);
  const pos = Math.min(quadros - 1, Math.floor(quadros * PERCENTIL_RUIDO));
  for (let k = 0; k < bins; k++) {
    for (let q = 0; q < quadros; q++) coluna[q] = mag[q * bins + k];
    coluna.sort();
    perfil[k] = coluna[pos] * FORCA_SUBTRACAO;
  }

  // passo 3: ganho por frequência e quadro, suavizado, e volta ao tempo
  const saida = new Float64Array(acolchoado.length);
  const gAnt = new Float64Array(bins).fill(1);
  const potAnt = new Float64Array(bins);
  const gBruto = new Float64Array(bins);
  const gLiso = new Float64Array(bins);
  const corteGrave = Math.ceil((HZ_CORTE_GRAVE * N) / taxa);
  for (let q = 0; q < quadros; q++) {
    for (let k = 0; k < bins; k++) {
      // o nível é medido em potência suavizada com o quadro anterior: o
      // chiado oscila de quadro para quadro, e sem a média os quadros em que
      // ele "sobe" escapavam do piso e viravam borbulhado
      const mq = mag[q * bins + k];
      const pot = 0.5 * mq * mq + 0.5 * potAnt[k];
      potAnt[k] = mq * mq;
      const m = Math.sqrt(pot);
      // quanto a frequência está acima do piso de ruído decide o ganho — em
      // POTÊNCIA (raiz de 1 − (perfil/nível)²): o que está bem acima do piso
      // (a voz) quase não é tocado, o que está no piso cai ao teto de redução
      const razao = m > 0 ? perfil[k] / m : 2;
      const g = razao >= 1 ? PISO_CHIADO : Math.max(PISO_CHIADO, Math.sqrt(1 - razao * razao));
      // no tempo: metade do quadro anterior (tira o "borbulhado")
      gBruto[k] = 0.5 * g + 0.5 * gAnt[k];
    }
    for (let k = 0; k < bins; k++) {
      // entre vizinhas: média de três frequências
      const a = gBruto[Math.max(0, k - 1)], b = gBruto[k], c = gBruto[Math.min(bins - 1, k + 1)];
      gLiso[k] = k < corteGrave ? PISO_CHIADO : (a + b + c) / 3;
      gAnt[k] = gBruto[k];
    }
    for (let k = 0; k < bins; k++) {
      const p = q * bins + k;
      re[k] = espRe[p] * gLiso[k]; im[k] = espIm[p] * gLiso[k];
      if (k > 0 && k < H) { re[N - k] = re[k]; im[N - k] = -im[k]; } // simetria do sinal real
    }
    fft(re, im, true);
    const base = q * H;
    for (let i = 0; i < N; i++) saida[base + i] += re[i] * janela[i];
  }

  const resultado = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) resultado[i] = saida[H + i];
  return resultado;
}

/** Constante de suavização de um filtro de um polo para o tempo dado (ms). */
const coeficiente = (ms: number, taxa: number) => Math.exp(-1 / Math.max(1, (ms / 1000) * taxa));

/**
 * O PORTÃO DE RUÍDO — o que faltava (relato do dono, 14/09/2026: "captura sons
 * no fundo"). A porteira de `nivelDaVoz` só decidia a MEDIÇÃO; o fundo entre
 * as palavras passava inteiro para o arquivo, e ainda multiplicado pelo mesmo
 * ganho da voz. Aqui ele é abaixado de verdade, com curva (não é liga/desliga,
 * que picota) e antevisão de um quadro (a palavra nunca começa cortada).
 */
export function portaoDeRuido(
  samples: Float32Array,
  taxa: number,
  nivelVoz: number
): Float32Array {
  if (nivelVoz <= 0) return samples;
  const porQuadro = Math.max(1, Math.floor((MS_QUADRO / 1000) * taxa));
  const limiar = nivelVoz * LIMIAR_PORTAO;
  const quadros = Math.ceil(samples.length / porQuadro);
  const alvo = new Float32Array(quadros);
  for (let q = 0; q < quadros; q++) {
    const ini = q * porQuadro;
    const fim = Math.min(samples.length, ini + porQuadro);
    let soma = 0;
    for (let i = ini; i < fim; i++) soma += samples[i] * samples[i];
    const rms = Math.sqrt(soma / Math.max(1, fim - ini));
    alvo[q] = rms >= limiar ? 1 : Math.max(PISO_PORTAO, rms / limiar);
  }
  const cAbre = coeficiente(MS_ABRE_PORTAO, taxa);
  const cFecha = coeficiente(MS_FECHA_PORTAO, taxa);
  const saida = new Float32Array(samples.length);
  let g = Math.max(alvo[0] ?? 1, alvo[1] ?? 0);
  for (let i = 0; i < samples.length; i++) {
    const q = Math.floor(i / porQuadro);
    // antevisão: se o PRÓXIMO quadro tem voz, já vai abrindo
    const t = Math.max(alvo[q], alvo[q + 1] ?? alvo[q]);
    g = t > g ? t + (g - t) * cAbre : t + (g - t) * cFecha;
    saida[i] = samples[i] * g;
  }
  return saida;
}

/**
 * FREIO DE PICO COM ANTEVISÃO — o "estourando" de som que nem era alto
 * (14/09/2026). O freio por curva (`freioSuave`) espreme cada amostra que
 * passa do limiar: um estalo médio virava uma onda deformada, que o ouvido
 * chama de estouro. Um limitador de verdade abaixa o GANHO do trecho todo,
 * um pouco antes do pico (antevisão) e devolve devagar depois: o estalo sai
 * mais baixo, com a forma original. A curva fica só como rede de segurança.
 */
export function limitarPicos(samples: Float32Array, taxa: number): Float32Array {
  const bloco = Math.max(1, Math.floor((MS_ANTEVE_FREIO / 1000) * taxa));
  const blocos = Math.ceil(samples.length / bloco);
  const pico = new Float32Array(blocos);
  for (let b = 0; b < blocos; b++) {
    let m = 0;
    const fim = Math.min(samples.length, (b + 1) * bloco);
    for (let i = b * bloco; i < fim; i++) m = Math.max(m, Math.abs(samples[i]));
    pico[b] = m;
  }
  const cAtaca = coeficiente(MS_ATACA_FREIO, taxa);
  const cSolta = coeficiente(MS_SOLTA_FREIO, taxa);
  const saida = new Float32Array(samples.length);
  let g = 1;
  for (let i = 0; i < samples.length; i++) {
    const b = Math.floor(i / bloco);
    // olha este bloco e os DOIS seguintes (10 ms): o ganho de ataque em 1 ms
    // já assentou por completo quando o pico chega — com um bloco só, sobrava
    // um resto de 0,7% e o pico passava um fio do teto
    const p = Math.max(pico[b], pico[b + 1] ?? 0, pico[b + 2] ?? 0);
    const t = p > TETO_FREIO ? TETO_FREIO / p : 1;
    g = t < g ? t + (g - t) * cAtaca : t + (g - t) * cSolta;
    saida[i] = samples[i] * g;
  }
  return saida;
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
  // o chiado sai PRIMEIRO: o nível da voz e o portão são medidos no sinal
  // já limpo, senão o próprio chiado entrava na conta do que é "som"
  const semChiado = reduzirChiado(samples, taxa);
  const nivel = nivelDaVoz(semChiado, taxa);
  // silêncio absoluto: não há o que ajustar (e evita dividir por zero)
  if (nivel === 0) return samples;

  const ganho = Math.min(ALVO_RMS / nivel, GANHO_MAXIMO);
  const suaviza = Math.min(
    Math.floor((MS_SUAVIZA / 1000) * taxa),
    Math.floor(samples.length / 2)
  );

  // A ORDEM É REGRA: chiado → portão (mede contra a voz limpa) → ganho →
  // freio de pico → curva de segurança. Ganho antes do portão faria o limiar valer
  // sobre um sinal já multiplicado; freio antes do ganho deixaria o ganho
  // recriar o pico que o freio acabou de abaixar.
  const limpo = portaoDeRuido(semChiado, taxa, nivel);
  const comGanho = new Float32Array(limpo.length);
  for (let i = 0; i < limpo.length; i++) comGanho[i] = limpo[i] * ganho;
  const freado = limitarPicos(comGanho, taxa);

  const saida = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = freioSuave(freado[i]);
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

    // usa a MAIOR taxa que cabe no envio — quanto maior, menos abafada a voz
    const alvo = melhorTaxa(decodificado.duration, decodificado.sampleRate, tetoBytes);
    const total = Math.ceil(decodificado.duration * alvo);
    if (!total) return null;

    // A MUDANÇA DE TAXA É FEITA PELO DECODIFICADOR, NÃO PELO TOCADOR
    // (14/09/2026). Tocar um buffer de 48 kHz num contexto de 24 kHz faz o
    // navegador reamostrar por interpolação linear — sem filtro, o que está
    // acima de 12 kHz (chiado, estalos, o "s" agudo) DOBRA para dentro da
    // faixa audível como um ruído áspero, que soa como estouro. Decodificar
    // de novo num contexto JÁ na taxa alvo usa o reamostrador de verdade do
    // decodificador (com filtro). Se não der, o caminho antigo continua.
    const mono = await decodificarNaTaxa(bytes, alvo).catch(() => null);
    const amostras = mono ?? (await reamostrarTocando(decodificado, alvo, total));

    // o volume é acertado ANTES de virar PCM: passar de 1.0 aqui vira corte
    // quadrado, que é o barulho de "estourado"
    const voz = normalizarVoz(amostras, alvo);
    return new Blob([encodeWav(voz, alvo)], { type: "audio/wav" });
  } catch {
    return null;
  }
}

/** Decodifica o arquivo já na taxa pedida e junta os canais em um (média). */
async function decodificarNaTaxa(bytes: ArrayBuffer, taxa: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: taxa });
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  const canais = buf.numberOfChannels;
  if (canais === 1) return buf.getChannelData(0);
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < canais; c++) {
    const dados = buf.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += dados[i] / canais;
  }
  return mono;
}

/** O caminho antigo (tocar o buffer num contexto na taxa alvo), como reserva. */
async function reamostrarTocando(
  decodificado: AudioBuffer,
  taxa: number,
  total: number
): Promise<Float32Array> {
  const offline = new OfflineAudioContext(1, total, taxa);
  const fonte = offline.createBufferSource();
  fonte.buffer = decodificado;
  fonte.connect(offline.destination);
  fonte.start();
  const rendido = await offline.startRendering();
  return rendido.getChannelData(0);
}
