/**
 * RN-110 · O QR CODE DA CONEXÃO SE RENOVA NA TELA, E O ANDAMENTO É REAL
 * (11/11/2026).
 *
 * O WhatsApp troca o QR Code sozinho: o primeiro vale ~60 s e os seguintes
 * ~20 s (conferido no código do Baileys: `qrMs = 60_000`, depois `20_000`).
 * A tela buscava o código UMA vez, no clique, e ficava mostrando a mesma
 * imagem com "a tela atualiza sozinha" — só o status atualizava. Quem
 * demorasse mais que isso lia um código morto, e depois de ~10 min (o teto
 * de códigos do servidor) a tela seguia girando para sempre.
 *
 * Esta é a decisão PURA de cada consulta da tela enquanto a pessoa tenta
 * conectar — e o ANDAMENTO que ela mostra. Cada passo só acende com um sinal
 * que o servidor deu de verdade (pedido do dono: "algo visual que eu saiba
 * que está carregando e chegando no fim, mas tem que ser real"):
 *
 *   1. código gerado      → o servidor devolveu o QR Code;
 *   2. celular leu        → o servidor passou a dizer "conexão aberta" (ela só
 *                           abre depois que o celular lê e o WhatsApp aceita);
 *   3. conexão conferida  → a sonda provou que a sessão está viva (RN-105).
 *
 * Não existe porcentagem inventada nem barra que anda pelo relógio. O
 * navegador importa este arquivo (sem banco, sem servidor).
 */

/** De quanto em quanto a tela consulta enquanto o QR está nela (o código vive ~20 s). */
export const MS_ENTRE_CONSULTAS_DO_QR = 2_000;

/**
 * Quantas consultas SEGUIDAS com a conexão fechada encerram a tentativa. Uma
 * só não basta: logo depois da leitura o WhatsApp fecha e reabre a conexão
 * (o "reinício" do pareamento), e entre um ciclo de códigos e outro o
 * servidor também passa um instante fechado.
 */
export const FECHADAS_PARA_VENCER = 6;

export type ConsultaDaConexao = {
  status: "DESCONECTADO" | "AGUARDANDO_QR" | "CONECTADO";
  /** o QR Code de AGORA, quando o servidor está esperando a leitura */
  qr?: string | null;
  /** qual código da tentativa é este (o servidor conta: 1, 2, 3…) */
  qrNumero?: number | null;
  /** o servidor abriu a conexão; a conferência (sonda) ainda não rodou */
  aberta?: boolean;
  /** RN-105: abriu, mas a sonda bateu na conexão fechada */
  sessaoCaida?: boolean;
};

/** Em que ponto a tentativa está: lendo o código, ou já aberta esperando a conferência. */
export type EtapaDaTentativa = "lendo" | "aberta";

export type TentativaDeConexao = {
  qr: string;
  fechadas: number;
  etapa: EtapaDaTentativa;
  /** número do código na tela, quando o servidor informa */
  numero: number | null;
};

export type PassoDaTentativa =
  | { fim: "conectou" }
  | { fim: "venceu" }
  | { fim: "caiu" }
  | { fim: null; tentativa: TentativaDeConexao };

/** A tentativa que começa quando o Conectar devolve o primeiro código. */
export function novaTentativa(qr: string, numero?: number | null): TentativaDeConexao {
  return { qr, fechadas: 0, etapa: "lendo", numero: numeroValido(numero) };
}

function numeroValido(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** O que a tela faz com a resposta de uma consulta, tendo uma tentativa em curso. */
export function passoDaTentativa(atual: TentativaDeConexao, d: ConsultaDaConexao): PassoDaTentativa {
  // abriu e a sonda provou que está morta: acabou, e a tela diz (RN-105)
  if (d.sessaoCaida) return { fim: "caiu" };
  if (d.status === "CONECTADO") return { fim: "conectou" };
  // o servidor abriu a conexão: o celular leu. Falta a conferência, que a
  // tela pede na consulta seguinte
  if (d.aberta) return { fim: null, tentativa: { ...atual, fechadas: 0, etapa: "aberta" } };
  if (d.status === "DESCONECTADO") {
    const fechadas = atual.fechadas + 1;
    if (fechadas >= FECHADAS_PARA_VENCER) return { fim: "venceu" };
    return { fim: null, tentativa: { ...atual, fechadas, etapa: "lendo" } };
  }
  // esperando a leitura: vale o código de agora (sem código na resposta, fica o da tela)
  const veio = typeof d.qr === "string" && d.qr.length > 0;
  return {
    fim: null,
    tentativa: {
      qr: veio ? (d.qr as string) : atual.qr,
      fechadas: 0,
      etapa: "lendo",
      numero: veio ? (numeroValido(d.qrNumero) ?? atual.numero) : atual.numero,
    },
  };
}

/**
 * O endereço da consulta da tela. Sem tentativa, só o estado. Com tentativa,
 * pede o código de agora (`qr=1`); e, depois que o servidor disse "aberta",
 * pede a conferência (`conferir=1`) — é ela que roda a sonda e grava o estado.
 */
export function enderecoDaConsulta(t: TentativaDeConexao | null): string {
  const base = "/api/whatsapp/evolution";
  if (!t) return base;
  return t.etapa === "aberta" ? `${base}?qr=1&conferir=1` : `${base}?qr=1`;
}

/** As fases que a tela desenha: as duas da tentativa e o fim feliz. */
export type FaseDaConexao = EtapaDaTentativa | "conectou";

export type PassoDoAndamento = {
  rotulo: string;
  estado: "feito" | "andando" | "espera";
};

/**
 * Os três passos do andamento, na fase dada. Um passo só fica "feito" com o
 * sinal real dele; o "andando" é o que a tela está esperando AGORA.
 */
export function passosDoAndamento(fase: FaseDaConexao): PassoDoAndamento[] {
  const leu = fase !== "lendo";
  const conferiu = fase === "conectou";
  return [
    { rotulo: "Código gerado", estado: "feito" },
    {
      rotulo: leu ? "Celular leu o código" : "Esperando o celular ler o código",
      estado: leu ? "feito" : "andando",
    },
    {
      rotulo: conferiu ? "Conexão conferida" : leu ? "Conferindo a conexão" : "Conferência da conexão",
      estado: conferiu ? "feito" : leu ? "andando" : "espera",
    },
  ];
}

/** Quanto da barra está cheio: passos FEITOS sobre o total — nunca tempo. */
export function fracaoDoAndamento(fase: FaseDaConexao): number {
  const passos = passosDoAndamento(fase);
  return passos.filter((p) => p.estado === "feito").length / passos.length;
}

/** A frase de quando a tentativa venceu — diz o que fazer, nunca fica girando. */
export const FRASE_DO_QR_VENCIDO =
  "O código venceu sem a conexão completar. Deixe o celular da loja já aberto em Dispositivos conectados → Conectar dispositivo e gere um código novo.";
