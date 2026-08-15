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

const horasDesde = (d: Date, agora: Date) => (agora.getTime() - d.getTime()) / 3_600_000;

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
