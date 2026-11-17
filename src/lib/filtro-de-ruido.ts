/**
 * FILTRO DE RUÍDO POR IA NO ÁUDIO DE VOZ (RN-112).
 *
 * Relato do dono (17/11/2026): "meu áudio não bloqueia o ruído; no Google
 * Meet o anti-ruído funciona". Medido no Chromium com a captura do sistema:
 * o filtro do navegador (`noiseSuppression`) ESTÁ ligado e tira bem o ruído
 * CONSTANTE (chiado, ventilador: −19 dB) — mas quase nada do ruído que VARIA
 * (máquina ligando e parando, teclado: −1 dB; gente falando: −0,6 dB). O Meet
 * limpa porque tem um filtro por inteligência artificial dele; o headset não
 * tinha nada a ver.
 *
 * Aqui entra um filtro do mesmo tipo: o RNNoise (Xiph/Mozilla, o que o Jitsi
 * Meet usa), uma rede pequena que separa voz de barulho. Roda no NAVEGADOR,
 * depois que a pessoa solta o botão de gravar e antes de o áudio sair — nada
 * vai para servidor nenhum.
 *
 * Medido na cadeia inteira (filtro → `normalizarVoz`), em quantos dB o ruído
 * das pausas fica abaixo da voz: máquina + teclado 13 → 26; rua com buzina
 * 24 → 39; teclado 16 → 24; música 13 → 18; várias pessoas falando 21 → 24;
 * UMA pessoa falando perto 28 → 28 (fala é fala: o filtro não tira). A versão
 * leve do modelo (112 KB) empatou com a de 1,9 MB na cadeia inteira — é a
 * leve que está aqui.
 *
 * Três réguas:
 *
 * 1. NUNCA ATRAPALHA O ENVIO. O filtro que não carregou, demorou ou falhou
 *    vira "sem filtro": o áudio sai pela cadeia de sempre. Áudio sem o filtro
 *    é melhor que áudio nenhum. Isso vale para a CARGA (prazo próprio), para
 *    a ESPERA de cada áudio (4 s, e só uma vez por tentativa de carga) e para
 *    o TRABALHO do filtro (orçamento de tempo).
 * 2. A VOZ NÃO FICA "DEBAIXO D'ÁGUA". Sai 90% do sinal filtrado + 10% do
 *    original (`PARTE_DO_ORIGINAL`): o ruído nunca cai mais que 20 dB por
 *    conta do filtro, e o que sobra soa como sala, não como robô. Medido: a
 *    mistura não piorou nenhum cenário.
 * 3. A TELA NÃO CONGELA. O filtro trabalha em fatias e devolve o fôlego ao
 *    navegador a cada 2 s de áudio — um áudio de um minuto num celular
 *    simples levaria segundos com a tela travada.
 */

/** O módulo do RNNoise (WebAssembly), como o pacote o entrega. */
export type ModuloDoFiltro = {
  _rnnoise_create(): number;
  _rnnoise_destroy(estado: number): void;
  _rnnoise_process_frame(estado: number, saida: number, entrada: number): number;
  _malloc(bytes: number): number;
  _free(ponteiro: number): void;
  HEAPF32: Float32Array;
};

/**
 * O que aconteceu com o filtro NESTE áudio — a tela diz quando não entrou:
 *  • "entrou": o áudio saiu filtrado;
 *  • "sem-filtro": não havia filtro (desligado, ou não carregou a tempo);
 *  • "nao-coube": o áudio não passa pelo filtro (longo demais para virar WAV,
 *    ou gravado numa taxa de que o filtro não desce);
 *  • "falhou": o filtro quebrou no meio — o áudio saiu pela cadeia de sempre.
 */
export type ResultadoDoFiltro = "entrou" | "sem-filtro" | "nao-coube" | "falhou";

/** O filtro foi treinado em 48 kHz: é a única taxa em que ele trabalha. */
export const TAXA_DO_FILTRO = 48_000;
/** Um quadro do filtro: 10 ms. */
export const QUADRO_DO_FILTRO = 480;
/**
 * O filtro devolve o som ATRASADO (ele olha um quadro à frente). Medido pela
 * correlação com a voz de teste; o teste confere. Sem descontar, a mistura
 * com o original somaria o som com ele mesmo deslocado.
 */
export const ATRASO_DO_FILTRO = 480;
/** Quanto do som original volta para a mistura (régua 2). */
export const PARTE_DO_ORIGINAL = 0.1;
/**
 * AQUECIMENTO: o filtro começa sem saber qual é o ruído da sala e leva um
 * instante para aprender — medido, o chiado do primeiro meio segundo caía só
 * 6 dB, contra 16 dB no resto. Então ele OUVE o primeiro segundo da gravação
 * antes de começar (a saída desse ensaio é jogada fora) e entra no áudio já
 * conhecendo o fundo.
 */
export const QUADROS_DE_AQUECIMENTO = 100;
/** A cada quantos quadros o filtro devolve o fôlego ao navegador (2 s de áudio). */
const QUADROS_POR_FOLEGO = 200;
/**
 * Quanto o filtro pode TRABALHAR num áudio antes de desistir (régua 1). Um
 * minuto de áudio custa ~1 s num computador comum; passou de 8 s, o aparelho
 * é fraco demais para este áudio, e ele sai pela cadeia de sempre.
 */
export const MS_ORCAMENTO_DO_FILTRO = 8_000;
/** Quanto esperar o filtro carregar depois que a gravação parou. */
export const MS_ESPERA_DO_FILTRO = 4_000;
/** Quanto UMA tentativa de carga pode durar antes de ser largada. */
export const MS_PRAZO_DA_CARGA = 20_000;

/** Onde o filtro mora (arquivos estáticos, copiados do pacote — o teste confere). */
export const PASTA_DO_FILTRO = "/filtro-de-ruido";

/** Preferência do aparelho: o filtro nasce LIGADO; "0" desliga. */
export const CHAVE_FILTRO_DE_RUIDO = "vesti:filtro-de-ruido";

export function filtroDeRuidoLigado(guardado: string | null | undefined): boolean {
  return guardado !== "0";
}

/**
 * Devolve o fôlego ao navegador SEM relógio: `setTimeout` é segurado em 1 s
 * por chamada quando a aba está escondida — a vendedora que solta o botão e
 * troca de aba esperaria meio minuto a mais por um áudio de um minuto
 * (achado da revisão). O canal de mensagens não sofre esse freio.
 */
function folego(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolver) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = () => {
      canal.port1.close();
      resolver();
    };
    canal.port2.postMessage(0);
  });
}

export type OpcoesDoFiltro = {
  /** como devolver o fôlego (o teste troca por um contador) */
  ceder?: () => Promise<void>;
  /** o relógio (o teste troca por um de mentira) */
  agora?: () => number;
  /** teto de trabalho, em ms */
  orcamentoMs?: number;
};

/**
 * Passa o áudio (mono, 48 kHz, −1..1) pelo filtro e devolve o mesmo tamanho,
 * já alinhado com a entrada e misturado com 10% do original.
 *
 * LANÇA se o módulo falhar, devolver número que não é número ou estourar o
 * orçamento de tempo — quem chama cai na cadeia sem filtro (régua 1).
 */
export async function filtrarRuido(
  amostras: Float32Array,
  modulo: ModuloDoFiltro,
  opcoes: OpcoesDoFiltro = {}
): Promise<Float32Array> {
  const ceder = opcoes.ceder ?? folego;
  const agora = opcoes.agora ?? Date.now;
  const orcamento = opcoes.orcamentoMs ?? MS_ORCAMENTO_DO_FILTRO;
  const n = amostras.length;
  const saida = new Float32Array(n);
  if (n === 0) return saida;

  const comeco = agora();
  const estado = modulo._rnnoise_create();
  const ponteiro = modulo._malloc(QUADRO_DO_FILTRO * 4);
  if (!estado || !ponteiro) {
    if (ponteiro) modulo._free(ponteiro);
    if (estado) modulo._rnnoise_destroy(estado);
    throw new Error("o filtro de ruído não conseguiu memória");
  }
  try {
    const base = ponteiro >> 2;
    const ensaio = Math.min(QUADROS_DE_AQUECIMENTO, Math.floor(n / QUADRO_DO_FILTRO));
    // DE TRÁS PARA A FRENTE: o último quadro do ensaio é o PRIMEIRO do áudio.
    // O filtro guarda um pouco do que acabou de ouvir; ensaiando na ordem
    // normal, a "lembrança" era a fala de 1 s depois, que vazava baixinho
    // para o silêncio do começo (medido: +19 dB na primeira pausa).
    for (let q = ensaio - 1; q >= 0; q--) {
      const entrada = modulo.HEAPF32;
      const inicio = q * QUADRO_DO_FILTRO;
      for (let k = 0; k < QUADRO_DO_FILTRO; k++) entrada[base + k] = amostras[inicio + k] * 32768;
      modulo._rnnoise_process_frame(estado, ponteiro, ponteiro);
    }
    // o fim ganha zeros: é o que empurra para fora o último pedaço atrasado
    const quadros = Math.ceil((n + ATRASO_DO_FILTRO) / QUADRO_DO_FILTRO);
    for (let q = 0; q < quadros; q++) {
      const inicio = q * QUADRO_DO_FILTRO;
      // a memória do módulo pode ter crescido: relê a cada quadro
      const entrada = modulo.HEAPF32;
      for (let k = 0; k < QUADRO_DO_FILTRO; k++) {
        const i = inicio + k;
        // o filtro pensa em PCM de 16 bits
        entrada[base + k] = i < n ? amostras[i] * 32768 : 0;
      }
      modulo._rnnoise_process_frame(estado, ponteiro, ponteiro);
      const filtrado = modulo.HEAPF32;
      for (let k = 0; k < QUADRO_DO_FILTRO; k++) {
        const destino = inicio + k - ATRASO_DO_FILTRO;
        if (destino < 0 || destino >= n) continue;
        const v = filtrado[base + k] / 32768;
        if (!Number.isFinite(v)) throw new Error("o filtro de ruído devolveu um valor inválido");
        saida[destino] = v * (1 - PARTE_DO_ORIGINAL) + amostras[destino] * PARTE_DO_ORIGINAL;
      }
      if ((q + 1) % QUADROS_POR_FOLEGO === 0) {
        if (agora() - comeco > orcamento)
          throw new Error("o filtro de ruído demorou demais neste aparelho");
        await ceder();
      }
    }
  } finally {
    modulo._free(ponteiro);
    modulo._rnnoise_destroy(estado);
  }
  return saida;
}

/**
 * Desce a taxa do som por um fator INTEIRO (48 → 24 ou 16 kHz), em ponto
 * flutuante, com filtro passa-baixa de verdade antes de pular amostras.
 *
 * Por que não reaproveitar o decodificador do navegador (embrulhando num
 * WAV): o WAV de 16 bits CORTA o que passa de 1,0 e arredonda o som antes do
 * `normalizarVoz`, que existe justamente para o corte quadrado não acontecer
 * e que amplifica a voz baixa até 8× — levando o arredondamento junto
 * (achado da revisão). Aqui nada é cortado nem arredondado.
 *
 * Sem o passa-baixa, o que está acima da metade da taxa nova (chiado, o "s"
 * agudo) DOBRA para dentro da faixa audível como ruído áspero.
 *
 * Devolve `null` quando o fator não é inteiro (gravação em 44,1 kHz…).
 */
export function reduzirTaxa(amostras: Float32Array, de: number, para: number): Float32Array | null {
  if (para <= 0 || de % para !== 0) return null;
  const fator = de / para;
  if (fator === 1) return amostras;
  // janela de Blackman: a faixa de transição mede ~5,5/N; o corte fica meia
  // transição abaixo da metade da taxa nova, para a rejeição já estar inteira
  // onde o som começaria a dobrar
  const N = 48 * fator + 1;
  const meio = (N - 1) / 2;
  const transicao = 5.5 / N;
  const corte = 0.5 / fator - transicao / 2;
  const h = new Float32Array(N);
  let soma = 0;
  for (let k = 0; k < N; k++) {
    const x = k - meio;
    const sinc = x === 0 ? 2 * corte : Math.sin(2 * Math.PI * corte * x) / (Math.PI * x);
    const janela =
      0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (N - 1));
    h[k] = sinc * janela;
    soma += h[k];
  }
  for (let k = 0; k < N; k++) h[k] /= soma;
  const n = amostras.length;
  const saida = new Float32Array(Math.ceil(n / fator));
  for (let j = 0; j < saida.length; j++) {
    const centro = j * fator;
    const de0 = Math.max(0, centro - meio);
    const ate = Math.min(n - 1, centro + meio);
    let v = 0;
    for (let i = de0; i <= ate; i++) v += amostras[i] * h[i - centro + meio];
    saida[j] = v;
  }
  return saida;
}

/**
 * A DECISÃO INTEIRA do filtro para um áudio, sem navegador no meio (é o que o
 * teste exercita): entra ou não entra, e por quê. Nunca lança — a falha do
 * filtro, em qualquer ponto, vira `amostras: null` e a cadeia de sempre.
 *
 * `em48` só é chamado se o filtro for mesmo entrar (decodificar em 48 kHz um
 * áudio que não vai ser filtrado é trabalho jogado fora).
 */
export async function tentarFiltro(entrada: {
  filtro: ModuloDoFiltro | null | undefined;
  /** a taxa em que o áudio vai sair */
  alvo: number;
  /** o WAV nessa taxa cabe no envio? (se não cabe, sai o arquivo original) */
  cabe: boolean;
  /** o áudio em mono, 48 kHz */
  em48: () => Promise<Float32Array>;
  opcoes?: OpcoesDoFiltro;
}): Promise<{ amostras: Float32Array | null; resultado: ResultadoDoFiltro }> {
  if (!entrada.filtro) return { amostras: null, resultado: "sem-filtro" };
  if (!entrada.cabe || entrada.alvo <= 0 || TAXA_DO_FILTRO % entrada.alvo !== 0)
    return { amostras: null, resultado: "nao-coube" };
  try {
    const limpo = await filtrarRuido(await entrada.em48(), entrada.filtro, entrada.opcoes);
    const naTaxa = reduzirTaxa(limpo, TAXA_DO_FILTRO, entrada.alvo);
    if (!naTaxa) return { amostras: null, resultado: "nao-coube" };
    return { amostras: naTaxa, resultado: "entrou" };
  } catch {
    return { amostras: null, resultado: "falhou" };
  }
}

/** Espera a promessa até o prazo; passou (ou falhou), devolve `null`. */
export function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolver) => {
    const relogio = setTimeout(() => resolver(null), ms);
    promessa.then(
      (v) => {
        clearTimeout(relogio);
        resolver(v);
      },
      () => {
        clearTimeout(relogio);
        resolver(null);
      }
    );
  });
}

/**
 * QUEM CARREGA O FILTRO, e as três situações em que a carga não pode
 * atrapalhar (achados da revisão):
 *
 *  • a carga que FALHA não fica guardada: a próxima gravação tenta de novo —
 *    com outro endereço (`tentativa`), porque o navegador guarda a falha de
 *    um `import()` e devolveria o mesmo erro sem ir à rede;
 *  • a carga PENDURADA (conexão que engasga no meio do arquivo) tem prazo
 *    próprio, e cada tentativa só faz UM áudio esperar: o segundo áudio
 *    enviado enquanto a mesma tentativa segue pendente sai na hora, sem
 *    filtro — senão todo áudio ficaria 4 s sem bolha na tela e a vendedora
 *    gravaria de novo;
 *  • o módulo que QUEBROU num áudio (`descartar`) é largado: o seguinte
 *    carrega um novo, em vez de falhar de novo calado.
 */
export function criarCarregadorDoFiltro(
  carregar: (tentativa: number) => Promise<ModuloDoFiltro | null>,
  prazoDaCargaMs: number = MS_PRAZO_DA_CARGA
) {
  let pronto: ModuloDoFiltro | null = null;
  let emCurso: Promise<ModuloDoFiltro | null> | null = null;
  /** a tentativa que já fez um áudio esperar até o fim */
  let jaEsperada: Promise<ModuloDoFiltro | null> | null = null;
  let tentativas = 0;

  function carga(): Promise<ModuloDoFiltro | null> {
    if (pronto) return Promise.resolve(pronto);
    if (!emCurso) {
      const numero = tentativas++;
      const esta: Promise<ModuloDoFiltro | null> = comPrazo(
        Promise.resolve()
          .then(() => carregar(numero))
          .catch(() => null),
        prazoDaCargaMs
      ).then((m) => {
        // descartado no meio da carga? então este resultado não vale mais
        if (emCurso !== esta) return null;
        emCurso = null;
        if (m) pronto = m;
        return m;
      });
      emCurso = esta;
    }
    return emCurso;
  }

  return {
    /** começa a carregar (quando a gravação COMEÇA) */
    aquecer(): void {
      void carga();
    },
    /** o filtro para o áudio que acabou de ser gravado, ou `null` */
    async paraOAudio(esperaMs: number = MS_ESPERA_DO_FILTRO): Promise<ModuloDoFiltro | null> {
      if (pronto) return pronto;
      const esta = carga();
      if (esta === jaEsperada) return null;
      const m = await comPrazo(esta, esperaMs);
      if (!m && emCurso === esta) jaEsperada = esta;
      return m;
    },
    /** o módulo quebrou num áudio: o próximo carrega outro */
    descartar(): void {
      pronto = null;
      emCurso = null;
    },
  };
}

/**
 * O carregador do navegador (um por aba; o navegador guarda os 124 KB).
 *
 * O arquivo é pedido direto da pasta pública, por fora do empacotador: a
 * cola do WebAssembly traz caminhos de Node (`fs`, `path`) que o empacotador
 * tentaria resolver e não acharia.
 */
const doNavegador = criarCarregadorDoFiltro(async (tentativa) => {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") return null;
  const endereco = `${PASTA_DO_FILTRO}/rnnoise.js${tentativa ? `?t=${tentativa}` : ""}`;
  const cola = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ endereco);
  const modulo = (await cola.default({
    locateFile: (arquivo: string) => `${PASTA_DO_FILTRO}/${arquivo}`,
  })) as ModuloDoFiltro;
  return typeof modulo?._rnnoise_process_frame === "function" ? modulo : null;
});

export const aquecerFiltroDeRuido = doNavegador.aquecer;
export const filtroParaOAudio = doNavegador.paraOAudio;
export const descartarFiltroDeRuido = doNavegador.descartar;

/** A frase da tela quando o filtro estava ligado e NÃO entrou no áudio. */
export function avisoDoFiltro(resultado: ResultadoDoFiltro): string | null {
  if (resultado === "entrou") return null;
  if (resultado === "nao-coube")
    return "Áudio longo demais para o filtro de ruído forte — saiu com o filtro comum.";
  if (resultado === "falhou")
    return "O filtro de ruído forte falhou neste áudio — saiu com o filtro comum.";
  return "O filtro de ruído forte não carregou a tempo — este áudio saiu com o filtro comum.";
}
