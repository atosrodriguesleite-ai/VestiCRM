/**
 * O PULSO DO WHATSAPP (RN-106) — a régua pura, sem banco.
 *
 * O incidente de 02/11/2026: lojas "conectadas", envios saindo e NENHUMA
 * mensagem de cliente entrando, porque o servidor Evolution parou de avisar
 * o sistema (webhook). O alarme de loja muda (RN-105) só tocava depois de um
 * dia inteiro de atendimento — um dia de clientes sem resposta.
 *
 * O TESTE DO ECO: toda mensagem que a loja envia PELO SISTEMA volta pelo
 * webhook em segundos, como o "eco" do próprio WhatsApp (`messages.upsert`
 * com fromMe — é dele que vive o resgate da bolha, RN-048, e o eco do robô,
 * RN-080). Então o envio que saiu e cujo eco não voltou é a prova de que o
 * caminho das mensagens quebrou — sem mandar nada a mais ao WhatsApp. O
 * carimbo `envioSemEcoDesde` guarda o PRIMEIRO envio ainda sem eco; qualquer
 * mensagem que chega pelo webhook o apaga.
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
 * esperando. TEM que ser no máximo a folga do relógio — o eco que chega
 * antes da resposta do envio e cai nesta janela não regrava o sinal, e é a
 * folga que impede o envio de se carimbar "sem eco" por cima dele (com um
 * minuto aqui, o eco engolido virava alarme falso, achado da revisão).
 */
export const MS_REGRAVAR_SINAL = MS_FOLGA_DO_RELOGIO;
/** O sinal mais velho que isto não diz que o eco "está voltando" — só que há tempo não chega nada. */
export const HORAS_SINAL_FRESCO = 6;

const MS_MIN = 60_000;
const MS_HORA = 60 * MS_MIN;

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

export type LeituraDoPulso = { tom: "ok" | "esperando" | "calado" | "sem-dado"; texto: string };

/**
 * O pulso em uma frase, para o painel de Saúde: "o eco está voltando" é a
 * resposta a "está FUNCIONANDO?", que o "Conectado" sozinho não dá.
 */
export function leituraDoPulso(
  s: { conectado: boolean; envioSemEcoDesde: Date | null; ultimoSinal: Date | null; reiniciadoEm?: Date | null },
  agora = new Date()
): LeituraDoPulso {
  if (!s.conectado) return { tom: "sem-dado", texto: "Pulso: sem conexão." };
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
      texto: `Pulso: nada chega pelo WhatsApp há ${Math.floor(horas)} h e não houve envio pelo sistema para conferir o eco.`,
    };
  return { tom: "ok", texto: "Pulso: o eco dos envios está voltando." };
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
