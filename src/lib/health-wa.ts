/**
 * DIAGNÓSTICO DO WHATSAPP — a régua que transforma números em veredito.
 *
 * "Conectado" não prova que está funcionando. A falha mais perigosa é a
 * silenciosa: o painel todo verde, a conexão de pé, e nenhuma mensagem
 * entrando porque o webhook parou de chegar. Ninguém percebe — até uma
 * cliente reclamar que mandou mensagem e não foi respondida.
 *
 * Por isso o sinal mais forte de saúde não é o status da conexão: é
 * MENSAGEM CHEGANDO. Estas regras olham o tráfego real.
 */

import { minutoDaHora, minutosDeAtendimentoEntre, type HorarioComercial } from "./bi/horario-comercial";

export type NivelSaude = "OK" | "ATENCAO" | "CRITICO";

/** Silêncio a partir daqui merece um olhar (pode ser só um dia parado). */
export const HORAS_SILENCIO_ATENCAO = 6;
/** Silêncio a partir daqui é quase certamente defeito, não movimento fraco. */
export const HORAS_SILENCIO_CRITICO = 24;
/** Mensagem "enviando" há mais que isso está presa, não a caminho. */
export const MINUTOS_PRESA = 10;

export type EstadoLoja = {
  conectado: boolean;
  /** null = nunca chegou nenhuma mensagem nesta loja */
  ultimaRecebida: Date | null;
  /** mensagens paradas em "enviando" há mais de MINUTOS_PRESA */
  presas: number;
  /** envios que falharam nas últimas 24h */
  falhas24: number;
  /** já teve tráfego algum dia? (loja recém-conectada não é problema) */
  jaTeveTrafego: boolean;
};

export type Diagnostico = { nivel: NivelSaude; problemas: string[] };

export const horasDesde = (d: Date, agora: Date) => (agora.getTime() - d.getTime()) / 3_600_000;

/** Texto humano do tempo em silêncio. */
export function silencioLabel(horas: number): string {
  if (horas < 1) return "menos de 1 hora";
  if (horas < 24) return `${Math.floor(horas)} h`;
  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function diagnosticoLoja(estado: EstadoLoja, agora = new Date()): Diagnostico {
  const problemas: string[] = [];
  let nivel: NivelSaude = "OK";
  const pior = (n: NivelSaude) => {
    if (n === "CRITICO" || (n === "ATENCAO" && nivel === "OK")) nivel = n;
  };

  if (!estado.conectado) {
    problemas.push("WhatsApp desconectado — a loja não recebe nem envia nada.");
    pior("CRITICO");
    // desconectada: silêncio é consequência, não um problema à parte
    if (estado.presas > 0)
      problemas.push(`${estado.presas} mensagem(ns) presa(s) no envio.`);
    return { nivel, problemas };
  }

  if (!estado.ultimaRecebida) {
    // loja que acabou de conectar ainda não recebeu nada: normal
    problemas.push(
      estado.jaTeveTrafego
        ? "Conectado, mas nenhuma mensagem recebida — verifique o webhook."
        : "Conectado. Ainda não chegou nenhuma mensagem (loja nova)."
    );
    if (estado.jaTeveTrafego) pior("CRITICO");
  } else {
    const h = horasDesde(estado.ultimaRecebida, agora);
    if (h >= HORAS_SILENCIO_CRITICO) {
      problemas.push(
        `Conectado, mas NADA chega há ${silencioLabel(h)} — o mais provável é o webhook ter parado.`
      );
      pior("CRITICO");
    } else if (h >= HORAS_SILENCIO_ATENCAO) {
      problemas.push(`Sem mensagens novas há ${silencioLabel(h)}.`);
      pior("ATENCAO");
    }
  }

  if (estado.presas > 0) {
    problemas.push(
      `${estado.presas} mensagem(ns) presa(s) em "enviando" há mais de ${MINUTOS_PRESA} min.`
    );
    pior("ATENCAO");
  }
  if (estado.falhas24 > 0) {
    problemas.push(`${estado.falhas24} envio(s) falharam nas últimas 24h.`);
    pior("ATENCAO");
  }

  return { nivel, problemas };
}

/**
 * Veredito da plataforma inteira. É a frase que responde, de um olhar,
 * "está tudo certo?".
 */
export function vereditoGeral(input: {
  servidorOk: boolean;
  lojas: Diagnostico[];
  errosWebhook24: number;
}): Diagnostico {
  const problemas: string[] = [];
  let nivel: NivelSaude = "OK";
  const pior = (n: NivelSaude) => {
    if (n === "CRITICO" || (n === "ATENCAO" && nivel === "OK")) nivel = n;
  };

  if (!input.servidorOk) {
    problemas.push("Servidor de WhatsApp fora do ar — nenhuma loja envia nem recebe.");
    pior("CRITICO");
  }
  const criticas = input.lojas.filter((l) => l.nivel === "CRITICO").length;
  const atencao = input.lojas.filter((l) => l.nivel === "ATENCAO").length;
  if (criticas > 0) {
    problemas.push(`${criticas} loja(s) com problema grave no WhatsApp.`);
    pior("CRITICO");
  }
  if (atencao > 0) {
    problemas.push(`${atencao} loja(s) pedindo atenção.`);
    pior("ATENCAO");
  }
  if (input.errosWebhook24 > 0) {
    problemas.push(
      `${input.errosWebhook24} mensagem(ns) do WhatsApp falharam ao ser gravadas nas últimas 24h.`
    );
    pior("CRITICO"); // aqui é conversa que a loja não vai ver
  }
  return { nivel, problemas };
}

/** Percentual de entrega dos envios (null quando não houve envio no período). */
export function taxaDeEntrega(enviadas: number, entregues: number): number | null {
  if (enviadas <= 0) return null;
  return Math.round((Math.min(entregues, enviadas) / enviadas) * 100);
}

// ---------------------------------------------------------------------------
// A LOJA MUDA AVISA (RN-105). O diagnóstico acima já dizia "conectado, mas
// NADA chega" no painel de Saúde — e só lá: quatro lojas ficaram dois dias
// mudas até uma vendedora mandar print (02/11/2026). O número do silêncio
// crítico é o MESMO do painel; o ritmo é por episódio.

/** Loja muda: enquanto o silêncio durar, avisa de novo no máximo a cada 24 h. */
export const HORAS_REAVISO_SILENCIO = 24;
/**
 * Um dia cheio de atendimento DA LOJA, em horas: o dia mais longo do horário
 * cadastrado, com o teto de 24 h de relógio do painel. Um número fixo errava
 * nas pontas (achado da revisão): a loja que abre 4 h por dia esperaria dois
 * dias e meio pelo aviso, e a de 24 h ganharia aviso a cada noite quieta.
 */
export function horasDeUmDiaAberto(horario: HorarioComercial | null | undefined): number {
  if (!horario) return HORAS_SILENCIO_CRITICO;
  let maior = 0;
  for (const dia of horario.dias) {
    let min = 0;
    for (const p of dia) {
      const de = minutoDaHora(p.de);
      const ate = minutoDaHora(p.ate);
      if (de !== null && ate !== null && ate > de) min += ate - de;
    }
    maior = Math.max(maior, min);
  }
  if (maior <= 0) return HORAS_SILENCIO_CRITICO;
  return Math.min(HORAS_SILENCIO_CRITICO, maior / 60);
}

export type SituacaoDoSilencio = {
  conectado: boolean;
  /** última mensagem de cliente que entrou pelo webhook (null = nunca) */
  ultimaRecebida: Date | null;
  /** quando o aviso de loja muda saiu pela última vez (null = nunca) */
  avisadoEm: Date | null;
  /**
   * O horário de atendimento da loja (RN-079). O silêncio do ALARME conta só
   * as horas em que a loja está aberta: pelo relógio de parede, toda loja
   * fechada no fim de semana virava "muda" na segunda-feira (achado da
   * revisão). Sem horário cadastrado, conta o relógio de parede — a régua
   * da RN-079. O painel de Saúde segue pintando pelo relógio de parede (é
   * leitura, não alarme).
   */
  horario?: HorarioComercial | null;
};

/** Horas de ATENDIMENTO em silêncio desde a última recebida (RN-079). */
export function horasDeAtendimentoEmSilencio(s: SituacaoDoSilencio, agora = new Date()): number {
  if (!s.ultimaRecebida) return 0;
  return minutosDeAtendimentoEntre(s.ultimaRecebida, agora, s.horario ?? null) / 60;
}

/**
 * A loja conectada e muda deve ganhar o aviso AGORA?
 *  - só com silêncio de um dia cheio DA LOJA (`horasDeUmDiaAberto`): com
 *    horário cadastrado, o dia mais longo dela em horas de ATENDIMENTO (a
 *    loja fechada no fim de semana não vira "muda" na segunda; a de 8h–18h
 *    muda na segunda às 9h é avisada na terça de manhã); sem horário, as 24
 *    h de relógio do painel; loja que nunca recebeu nada não entra — é loja
 *    nova, não defeito;
 *  - uma vez por episódio: entrou mensagem DEPOIS do último aviso, é um
 *    episódio novo; sem mensagem nova, reavisa só depois de 24 h de relógio
 *    E de mais um dia aberto da loja — sem isso a loja que fecha no fim de
 *    semana era reavisada sábado e domingo (achado da revisão).
 */
export function deveAvisarSilencio(s: SituacaoDoSilencio, agora = new Date()): boolean {
  if (!s.conectado || !s.ultimaRecebida) return false;
  const limite = horasDeUmDiaAberto(s.horario);
  if (horasDeAtendimentoEmSilencio(s, agora) < limite) return false;
  if (!s.avisadoEm) return true;
  if (s.avisadoEm < s.ultimaRecebida) return true;
  if (horasDesde(s.avisadoEm, agora) < HORAS_REAVISO_SILENCIO) return false;
  return minutosDeAtendimentoEntre(s.avisadoEm, agora, s.horario ?? null) / 60 >= limite;
}

/** O texto do aviso para a loja — diz o que houve e o que fazer. */
export function fraseDaLojaMuda(ultimaRecebida: Date, agora = new Date()): string {
  const h = horasDesde(ultimaRecebida, agora);
  return (
    `O WhatsApp aparece conectado, mas nenhuma mensagem de cliente entra no sistema há ${silencioLabel(h)}. ` +
    `O mais provável é o servidor de conexão ter parado de avisar. Quem administra a loja abre Comunicação e toca em "Reiniciar conexão"; ` +
    `depois mande um "teste" de outro celular — tem que cair na Central em segundos.`
  );
}
