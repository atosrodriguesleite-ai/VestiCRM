/**
 * O PULSO DO WHATSAPP (RN-106) — a régua pura, sem banco.
 *
 * O incidente de 02/11/2026: lojas "conectadas", envios saindo e NENHUMA
 * mensagem de cliente entrando, porque o servidor Evolution parou de avisar
 * o sistema (webhook). O alarme de loja muda (RN-105) só tocava depois de um
 * dia inteiro de atendimento — um dia de clientes sem resposta.
 *
 * O TESTE DO ECO: toda mensagem que a loja envia PELO SISTEMA é avisada de
 * volta pelo servidor em segundos — o aviso `send.message`. Então o envio
 * que saiu e cujo aviso não voltou é a prova de que o caminho servidor →
 * sistema quebrou — sem mandar nada a mais ao WhatsApp. O carimbo
 * `envioSemEcoDesde` guarda o PRIMEIRO envio ainda sem eco; qualquer aviso
 * de mensagem que chega pelo webhook (o eco ou a mensagem de uma cliente) o
 * apaga.
 *
 * O ERRO DE 03/11 a 18/11/2026: a primeira versão esperava o eco como
 * `messages.upsert` com fromMe. O servidor Evolution NÃO manda isso para o
 * que sai pela API (`emitOwnEvents: false`; conferido no código-fonte, versão
 * 2.3.7) — só para o que a loja manda pelo CELULAR. O eco nunca vinha: toda
 * mensagem enviada pelo sistema sem uma cliente escrever nos 12 min seguintes
 * virava "WhatsApp parou de entregar", com a conexão boa sendo reiniciada à
 * toa (a cura automática). Duas lições que viraram régua: o eco é o aviso
 * que o servidor DE FATO manda, e o teste só ARMA na loja em que esse aviso
 * já foi visto (`ecoArmado`) — suposição sobre servidor de terceiro não
 * dispara alarme nem reinício sem prova.
 */

/** Envio sem eco há este tanto = o webhook parou (o eco leva segundos). */
export const MINUTOS_SEM_ECO = 12;
/** A cura automática (reiniciar a conexão) roda no máximo uma vez neste intervalo. */
export const HORAS_ENTRE_CURAS = 6;
/** O alarme do webhook calado reavisa, enquanto durar, a cada este tanto. */
export const HORAS_REAVISO_CALADO = 6;
/**
 * Folga de relógio entre as duas pontas (o envio e o webhook podem rodar em
 * máquinas diferentes): o sinal que chegou até este tanto ANTES do envio não
 * cobre o envio — só pode ser de antes dele. Sem a folga, o eco que chegasse
 * antes da resposta do envio, numa máquina de relógio um pouco atrás,
 * deixava o envio "sem eco" para sempre e acordava um alarme falso.
 */
export const MS_FOLGA_DO_RELOGIO = 5_000;
/**
 * O sinal do webhook não é regravado a cada aviso (o webhook recebe dezenas
 * por minuto): no máximo uma vez neste intervalo quando não há envio
 * esperando. TEM que ser MENOR que a folga do relógio — o eco que chega
 * antes da resposta do envio e cai nesta janela não regrava o sinal, e é a
 * folga que impede o envio de se carimbar "sem eco" por cima dele (com um
 * minuto aqui, o eco engolido virava alarme falso, achado da revisão). A
 * diferença entre as duas (3 s) é o que sobra para os relógios das duas
 * máquinas discordarem: iguais, não sobrava nada (achado da revisão de
 * 18/11/2026, quando o eco passou a existir de verdade).
 */
export const MS_REGRAVAR_SINAL = 2_000;
/** O sinal mais velho que isto não diz que o eco "está voltando" — só que há tempo não chega nada. */
export const HORAS_SINAL_FRESCO = 6;

const MS_MIN = 60_000;
const MS_HORA = 60 * MS_MIN;

/**
 * O TESTE SÓ VALE ONDE FOI PROVADO: a loja está armada quando o servidor dela
 * já mandou, alguma vez, o aviso de um envio (`ecoDoEnvioVistoEm`). Sem essa
 * prova o envio nem é carimbado — e o carimbo que já existir (gravado pelo
 * código antigo na janela do deploy) não conta.
 */
export function ecoArmado(ecoDoEnvioVistoEm: Date | null | undefined): boolean {
  return !!ecoDoEnvioVistoEm;
}

/**
 * QUAIS AVISOS DO SERVIDOR CONTAM COMO SINAL: a mensagem de uma cliente (ou a
 * que a loja mandou pelo celular) e o eco de um envio feito pelo sistema.
 * Recibo, contato e conexão não contam — um caminho que ainda entrega recibos
 * mas perdeu as mensagens não pode passar por vivo. Só o eco ARMA o teste.
 */
export function sinalDoPulso(evento: string): { conta: boolean; ecoDeEnvio: boolean } {
  if (evento === "send.message") return { conta: true, ecoDeEnvio: true };
  if (evento === "messages.upsert") return { conta: true, ecoDeEnvio: false };
  return { conta: false, ecoDeEnvio: false };
}

/** O envio sem eco que CONTA: só o da loja armada. */
export function envioQueConta(
  envioSemEcoDesde: Date | null | undefined,
  ecoDoEnvioVistoEm: Date | null | undefined
): Date | null {
  return ecoArmado(ecoDoEnvioVistoEm) ? (envioSemEcoDesde ?? null) : null;
}

/** O webhook está calado? Envio sem eco há `MINUTOS_SEM_ECO` ou mais. */
export function webhookCalado(envioSemEcoDesde: Date | null | undefined, agora = new Date()): boolean {
  if (!envioSemEcoDesde) return false;
  return agora.getTime() - envioSemEcoDesde.getTime() >= MINUTOS_SEM_ECO * MS_MIN;
}

/** A cura automática pode rodar agora (uma a cada `HORAS_ENTRE_CURAS`)? */
export function podeCurar(curaEm: Date | null | undefined, agora = new Date()): boolean {
  return !curaEm || agora.getTime() - curaEm.getTime() >= HORAS_ENTRE_CURAS * MS_HORA;
}

export type DecisaoDoPulso = "ok" | "esperando" | "aguardando-prova" | "curar" | "avisar" | "ja-avisado";

/**
 * O envio sem eco é de ANTES do último reinício (a cura automática ou o
 * botão)? Então ele não prova nada sobre a conexão de agora: espera-se o
 * próximo envio — que se carimba por cima (`marcarEnvioSemEco`). A prova
 * NÃO é apagada no reinício: o painel segue dizendo a verdade ("reiniciou,
 * esperando a próxima mensagem para confirmar") em vez de pintar verde.
 */
export function provaAntesDoReinicio(envioSemEcoDesde: Date, reiniciadoEm: Date | null | undefined): boolean {
  return !!reiniciadoEm && reiniciadoEm.getTime() >= envioSemEcoDesde.getTime();
}

/**
 * Sem vez para a cura nesta rodada (o tempo da rodada acabou, ou a rodada
 * não pode curar), o eco calado há este tanto alarma mesmo assim — a cura é
 * ganho, nunca motivo para o alarme não sair (achado da revisão).
 */
export const MINUTOS_SEM_CURA_ALARMA = 30;

/**
 * O que o vigia faz com a loja CONECTADA nesta rodada:
 *  - sem envio esperando eco → "ok";
 *  - esperando há menos de `MINUTOS_SEM_ECO` → "esperando" (o eco leva segundos);
 *  - o envio sem eco é de antes do último reinício → "aguardando-prova" (o
 *    próximo envio decide, e se carimba por cima);
 *  - calado e a cura ainda não rodou nas últimas horas → "curar" (reinicia a
 *    conexão e reaplica os avisos);
 *  - calado DE NOVO depois da cura (envio novo, sem eco) → "avisar", uma vez
 *    por episódio (o envio sem eco mais novo que o último aviso é episódio
 *    novo), com reaviso a cada `HORAS_REAVISO_CALADO`.
 */
export function decidirPulso(
  s: {
    envioSemEcoDesde: Date | null;
    /** a última cura AUTOMÁTICA (a vez de 6 h) */
    curaEm: Date | null;
    /** o último reinício que o servidor ACEITOU — o do botão ou o da cura */
    reiniciadoEm?: Date | null;
    avisadoEm: Date | null;
  },
  agora = new Date()
): DecisaoDoPulso {
  if (!s.envioSemEcoDesde) return "ok";
  if (!webhookCalado(s.envioSemEcoDesde, agora)) return "esperando";
  if (provaAntesDoReinicio(s.envioSemEcoDesde, s.reiniciadoEm)) return "aguardando-prova";
  if (podeCurar(s.curaEm, agora)) return "curar";
  if (!s.avisadoEm) return "avisar";
  if (s.avisadoEm < s.envioSemEcoDesde) return "avisar";
  if (agora.getTime() - s.avisadoEm.getTime() >= HORAS_REAVISO_CALADO * MS_HORA) return "avisar";
  return "ja-avisado";
}

/** Minutos inteiros desde o envio sem eco (para as frases). */
export function minutosSemEco(desde: Date, agora = new Date()): number {
  return Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / MS_MIN));
}

/** A frase do alarme para a loja — diz o que houve e o que fazer. */
export function fraseDoWebhookCalado(desde: Date, agora = new Date(), tentouReiniciar = true): string {
  // só diz que reiniciou quando reiniciou: a frase errada mandava pular o
  // botão "Reiniciar conexão" e ir direto ao QR (achado da revisão)
  const oQueFez = tentouReiniciar
    ? "O sistema já tentou reiniciar a conexão sozinho nas últimas horas e o eco não voltou. Abra Comunicação: se pedir, leia o QR Code com o celular da loja."
    : 'Abra Comunicação e toque em "Reiniciar conexão"; se pedir, leia o QR Code com o celular da loja.';
  return (
    `A loja enviou mensagem pelo sistema há ${minutosSemEco(desde, agora)} min e o WhatsApp não devolveu a confirmação — ` +
    `as mensagens das clientes provavelmente não estão entrando na Central. ${oQueFez} ` +
    `Enquanto isso, responda as clientes pelo celular.`
  );
}

/**
 * POR QUE A CONEXÃO CAIU (RN-106) — o código que o WhatsApp manda junto do
 * "fechou" (`statusReason` do aviso de conexão do Evolution; são os códigos
 * do `DisconnectReason` da biblioteca Baileys). Guardado em cada queda para,
 * em poucas semanas, saber se a causa é o celular, o servidor ou o WhatsApp —
 * e atacar a causa em vez do sintoma.
 */
export function motivoDaQueda(codigo: unknown): string {
  const n = typeof codigo === "number" ? codigo : typeof codigo === "string" ? Number(codigo) : NaN;
  switch (n) {
    case 401:
      return "a sessão foi desconectada pelo celular ou pelo WhatsApp (precisa ler o QR Code de novo)";
    case 403:
      return "o WhatsApp recusou esta conexão (bloqueio ou restrição do número)";
    case 408:
      return "a conexão com o WhatsApp caiu por tempo esgotado (internet do servidor ou do celular)";
    case 411:
      return "versão do WhatsApp incompatível entre o celular e o servidor";
    case 428:
      return "a conexão foi fechada (queda de rede ou o servidor se reconectando)";
    case 440:
      return "outra conexão abriu com o mesmo número e tomou o lugar desta";
    case 500:
      return "a sessão salva no servidor ficou corrompida (precisa ler o QR Code de novo)";
    case 503:
      return "o serviço do WhatsApp estava indisponível";
    case 515:
      return "o WhatsApp pediu para reiniciar a conexão (costuma voltar sozinha)";
    default:
      return Number.isFinite(n) ? `motivo não informado pelo WhatsApp (código ${n})` : "motivo não informado pelo WhatsApp";
  }
}

export type LeituraDoPulso = { tom: "ok" | "esperando" | "atencao" | "calado" | "sem-dado"; texto: string };

/**
 * O pulso em uma frase, para o painel de Saúde: "o eco está voltando" é a
 * resposta a "está FUNCIONANDO?", que o "Conectado" sozinho não dá.
 */
export function leituraDoPulso(
  s: {
    conectado: boolean;
    envioSemEcoDesde: Date | null;
    ultimoSinal: Date | null;
    reiniciadoEm?: Date | null;
    /** o servidor desta loja já mandou o aviso de um envio? (`ecoArmado`) */
    armado: boolean;
    /**
     * loja DESARMADA com a assinatura do aviso de envio confirmada: desde
     * quando um envio espera a PRIMEIRA confirmação do servidor
     */
    envioSemProvaDesde?: Date | null;
  },
  agora = new Date()
): LeituraDoPulso {
  if (!s.conectado) return { tom: "sem-dado", texto: "Pulso: sem conexão." };
  // sem a prova de que o servidor avisa os envios, o teste não diz nada —
  // nem "calado", nem "voltando" (dizer verde aqui seria afirmar sem medir)
  if (!s.armado) {
    // desarmado NÃO pode ser sinônimo de calado para sempre: a loja que
    // envia pelo sistema, com a assinatura do aviso confirmada, e nunca
    // recebe a confirmação aparece em ATENÇÃO aqui — sem alarme e sem
    // reinício (não há prova de que este servidor avisa), mas à vista
    // (achado da revisão: webhook quebrado desde o começo ficava invisível)
    if (s.envioSemProvaDesde && webhookCalado(s.envioSemProvaDesde, agora))
      return {
        tom: "atencao",
        texto: `Pulso: a loja enviou pelo sistema há ${minutosSemEco(s.envioSemProvaDesde, agora)} min e o servidor nunca confirmou um envio desta loja — se as mensagens das clientes também não entram, toque em "Reiniciar conexão" (reaplica os avisos).`,
      };
    return {
      tom: "sem-dado",
      texto:
        "Pulso: teste do eco ainda desarmado — o servidor ainda não confirmou nenhum envio feito pelo sistema nesta loja (arma sozinho no primeiro).",
    };
  }
  if (s.envioSemEcoDesde && provaAntesDoReinicio(s.envioSemEcoDesde, s.reiniciadoEm))
    return {
      tom: "esperando",
      texto: "Pulso: o eco tinha parado e a conexão foi reiniciada — a próxima mensagem enviada pelo sistema confirma se voltou.",
    };
  if (s.envioSemEcoDesde) {
    const min = minutosSemEco(s.envioSemEcoDesde, agora);
    return webhookCalado(s.envioSemEcoDesde, agora)
      ? { tom: "calado", texto: `Pulso: a loja enviou há ${min} min e o eco NÃO voltou — o webhook parou.` }
      : { tom: "esperando", texto: `Pulso: envio de ${min} min atrás esperando o eco (normal até ${MINUTOS_SEM_ECO} min).` };
  }
  if (!s.ultimoSinal) return { tom: "sem-dado", texto: "Pulso: ainda sem medida (aparece depois do primeiro envio ou mensagem)." };
  // sinal velho não é "funcionando": a loja que só responde pelo celular não
  // tem envio para provar o caminho, e o verde ao lado do alarme de loja muda
  // diria o contrário do que acontece (achado da revisão)
  const horas = (agora.getTime() - s.ultimoSinal.getTime()) / MS_HORA;
  if (horas >= HORAS_SINAL_FRESCO)
    return {
      tom: "sem-dado",
      texto: `Pulso: nenhum aviso de mensagem chega do servidor há ${Math.floor(horas)} h e não houve envio pelo sistema para conferir o eco.`,
    };
  // diz o que PROVA: os avisos do servidor chegam ao sistema. Não prova que
  // o servidor está recebendo do WhatsApp — isso é o alarme de loja muda
  return { tom: "ok", texto: "Pulso: os avisos do servidor estão chegando ao sistema." };
}

/**
 * A QUEDA QUE O REINÍCIO NÃO CONSERTA (RN-106): sessão desconectada pelo
 * celular (401), recusada pelo WhatsApp (403), versão incompatível (411),
 * tomada por outra conexão (440 — reiniciar a roubaria de volta) ou sessão
 * corrompida (500) só voltam lendo o QR Code. Reiniciar aí gastaria a vez da
 * cura das próximas 6 h e atrasaria o alarme (achado da revisão). Sem
 * código, ou com os de rede e reinício, vale tentar.
 */
export function quedaTemCura(codigo: unknown): boolean {
  const n = typeof codigo === "number" ? codigo : typeof codigo === "string" ? Number(codigo) : NaN;
  return ![401, 403, 411, 440, 500].includes(n);
}
