/**
 * TEMPO DE RESPOSTA À CLIENTE (RN-080) — regra pura, sem banco.
 *
 * A pergunta do BI é "quanto a cliente esperou por uma PESSOA da loja?".
 * A régua:
 * - Uma ESPERA começa na primeira mensagem da cliente sem resposta. As
 *   mensagens seguintes dela (a cliente que manda cinco de uma vez) não
 *   zeram o cronômetro — vale a primeira.
 * - A espera FECHA na primeira mensagem humana da loja depois dela: texto
 *   (nota interna não chega à cliente) e NÃO automática. O eco da mensagem
 *   mandada pelo celular da loja chega sem autor e é humana — conta.
 * - A mensagem de ROBÔ (`Message.automatica`, recuperação automática) nunca
 *   fecha a espera: a cliente perguntou e o robô não respondeu a ela.
 * - Os minutos são DE ATENDIMENTO (RN-079): só com a loja aberta.
 * - A espera ainda sem resposta é contada até AGORA e diz se o prazo já
 *   estourou (`noPrazo: false`) ou se ainda dá tempo (`null`).
 *
 * É a mesma ideia do monitor da IA de Vendas (`lib/ia.ts`), que segue com a
 * régua dele (relógio de parede, teto de 24h, atribuição à dona da
 * conversa) — ali é um termômetro de equipe; aqui é a conta do BI.
 */
import { minutosDeAtendimentoEntre, type HorarioComercial } from "./horario-comercial";

export type MensagemLeve = {
  conversationId: string;
  direction: "IN" | "OUT";
  kind: "TEXT" | "NOTE";
  createdAt: Date;
  authorId: string | null;
  automatica: boolean;
};

export type Espera = {
  conversationId: string;
  /** a primeira mensagem da cliente sem resposta */
  chegadaEm: Date;
  /** a primeira resposta humana depois dela; nula = ainda esperando */
  respostaEm: Date | null;
  /** quem respondeu (nulo: eco do celular da loja, sem autor) */
  autoraId: string | null;
  /** minutos de atendimento até a resposta — ou até agora, se aberta */
  minutos: number;
  /** true/false decidido; null = aberta e ainda dentro do prazo, ou encerrada */
  noPrazo: boolean | null;
  /** aberta numa conversa que a loja ENCERROU: não é cliente esperando */
  encerrada: boolean;
};

export type Regua = {
  horario: HorarioComercial | null;
  prazoMin: number;
  agora: Date;
  /**
   * Conversas ENCERRADAS pela loja. A espera aberta numa delas não é
   * "cliente sem resposta": o "obrigada!" do fim da conversa é a última
   * mensagem, e a loja decidiu que acabou — sem isto, cada venda fechada
   * virava uma espera eterna fora do prazo (achado da revisão).
   */
  encerradas?: Set<string>;
};

/**
 * A MESMA RÉGUA EM DOIS LUGARES, escrita uma vez: a mensagem que entra na
 * conta é TEXTO (nota interna não chega à cliente) e NÃO É DE ROBÔ. O BI
 * usa `respostaHumana` (isto + direção OUT) sobre as linhas em memória; o
 * monitor da IA espalha este fragmento no `where` do Prisma. O teste prova
 * que os dois concordam em toda combinação.
 */
export const ONDE_MENSAGEM_CONTA = { kind: "TEXT", automatica: false } as const;

/** A mensagem entra na conta (texto, não robô), em qualquer direção? */
export function mensagemConta(m: Pick<MensagemLeve, "kind" | "automatica">): boolean {
  return m.kind === ONDE_MENSAGEM_CONTA.kind && m.automatica === ONDE_MENSAGEM_CONTA.automatica;
}

/** A mensagem fecha uma espera? Só texto humano da loja. */
export function respostaHumana(m: Pick<MensagemLeve, "direction" | "kind" | "automatica">): boolean {
  return m.direction === "OUT" && mensagemConta(m);
}

/**
 * Pareia cada espera da cliente com a resposta humana que a fechou. As
 * mensagens podem vir em qualquer ordem (são ordenadas aqui, por data); as
 * de várias conversas podem vir juntas — cada conversa tem a própria fila.
 */
export function parearEsperas(mensagens: MensagemLeve[], regua: Regua): Espera[] {
  const ordenadas = [...mensagens].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const pendente = new Map<string, Date>(); // conversa → chegada da espera aberta
  const esperas: Espera[] = [];
  for (const m of ordenadas) {
    if (m.direction === "IN") {
      if (!mensagemConta(m)) continue;
      if (!pendente.has(m.conversationId)) pendente.set(m.conversationId, m.createdAt);
      continue;
    }
    if (!respostaHumana(m)) continue;
    const chegada = pendente.get(m.conversationId);
    if (!chegada) continue;
    pendente.delete(m.conversationId);
    const minutos = minutosDeAtendimentoEntre(chegada, m.createdAt, regua.horario);
    esperas.push({
      conversationId: m.conversationId,
      chegadaEm: chegada,
      respostaEm: m.createdAt,
      autoraId: m.authorId,
      minutos,
      noPrazo: minutos <= regua.prazoMin,
      encerrada: false,
    });
  }
  // o que ficou sem resposta: conta até agora e diz se o prazo já estourou —
  // salvo na conversa que a loja encerrou, que não está esperando ninguém
  for (const [conversationId, chegada] of pendente) {
    const encerrada = regua.encerradas?.has(conversationId) ?? false;
    const minutos = minutosDeAtendimentoEntre(chegada, regua.agora, regua.horario);
    esperas.push({
      conversationId,
      chegadaEm: chegada,
      respostaEm: null,
      autoraId: null,
      minutos,
      noPrazo: !encerrada && minutos > regua.prazoMin ? false : null,
      encerrada,
    });
  }
  return esperas.sort((a, b) => a.chegadaEm.getTime() - b.chegadaEm.getTime());
}

export type ResumoDasEsperas = {
  total: number;
  respondidas: number;
  /** abertas em conversa aberta: cliente esperando AGORA */
  semResposta: number;
  /** abertas em conversa que a loja encerrou (o "obrigada" do fim) */
  encerradasSemResposta: number;
  /** respondidas dentro do prazo */
  noPrazo: number;
  /** respondidas fora do prazo + abertas que já estouraram */
  foraDoPrazo: number;
  /** % das esperas decididas que ficaram no prazo (nulo sem nenhuma decidida) */
  pctNoPrazo: number | null;
  /** só das respondidas; nulo sem nenhuma */
  medianaMin: number | null;
  mediaMin: number | null;
  /** 90% das respondidas foram respondidas em até isto */
  p90Min: number | null;
};

/** Os números do painel, a partir das esperas pareadas. */
export function resumirEsperas(esperas: Espera[]): ResumoDasEsperas {
  const respondidas = esperas.filter((e) => e.respostaEm !== null);
  const encerradas = esperas.filter((e) => e.respostaEm === null && e.encerrada).length;
  const abertas = esperas.length - respondidas.length - encerradas;
  const noPrazo = respondidas.filter((e) => e.noPrazo === true).length;
  const foraDoPrazo = esperas.filter((e) => e.noPrazo === false).length;
  const decididas = noPrazo + foraDoPrazo;
  const tempos = respondidas.map((e) => e.minutos).sort((a, b) => a - b);
  return {
    total: esperas.length,
    respondidas: respondidas.length,
    semResposta: abertas,
    encerradasSemResposta: encerradas,
    noPrazo,
    foraDoPrazo,
    pctNoPrazo: decididas ? Math.round((noPrazo / decididas) * 100) : null,
    medianaMin: tempos.length ? arredondar(mediana(tempos)) : null,
    mediaMin: tempos.length ? arredondar(tempos.reduce((s, t) => s + t, 0) / tempos.length) : null,
    p90Min: tempos.length ? arredondar(percentil(tempos, 0.9)) : null,
  };
}

function mediana(ordenados: number[]): number {
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/** percentil por posição (nearest-rank): o valor que 90% não ultrapassam */
function percentil(ordenados: number[], p: number): number {
  const posicao = Math.max(1, Math.ceil(p * ordenados.length));
  return ordenados[posicao - 1];
}

/** uma casa: "4,5 min" lê-se; "4,4999" não */
function arredondar(n: number): number {
  return Math.round(n * 10) / 10;
}
