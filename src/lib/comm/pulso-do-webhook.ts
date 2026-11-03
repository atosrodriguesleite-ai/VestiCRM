import { db } from "../db";
import { HORAS_ENTRE_CURAS, MINUTOS_SEM_ECO, MS_FOLGA_DO_RELOGIO, MS_REGRAVAR_SINAL } from "./pulso-regra";
import { reiniciarConexaoDaLoja, type ResultadoDoReinicio } from "./reiniciar-conexao";
import { evoState } from "./evolution";
import { reinicioEmCurso } from "./conexao-fechada";

/**
 * O PULSO DO WHATSAPP (RN-106) — as escritas. A régua pura mora em
 * `pulso-regra.ts`; aqui ficam os dois carimbos (o sinal do webhook e o envio
 * que espera o eco) e a cura automática.
 *
 * Os dois carimbos são UMA instrução SQL cada, condicionada no próprio banco:
 * o envio e o eco chegam por funções diferentes, quase no mesmo instante, e a
 * ordem entre eles não é garantida (o eco pode chegar ANTES de a resposta do
 * envio voltar). Ler e depois gravar abriria a corrida em que o envio
 * carimba "sem eco" por cima do eco que já chegou — e o alarme tocaria com o
 * WhatsApp funcionando.
 */

/**
 * Chegou mensagem pelo webhook (`agora` = a hora em que ela CHEGOU): o
 * caminho está vivo. Apaga o "envio sem eco" e anota a hora do sinal —
 * regravando no máximo a cada `MS_REGRAVAR_SINAL` quando não há envio
 * esperando. Só apaga o envio que pode ter sido coberto por esta chegada (o
 * envio que começou DEPOIS dela não tem o eco aqui — a gravação pode correr
 * depois da resposta do webhook). Nunca lança: o pulso não pode derrubar a
 * mensagem da cliente.
 */
export async function marcarSinalDoWebhook(companyId: string, agora = new Date()): Promise<void> {
  const corte = new Date(agora.getTime() - MS_REGRAVAR_SINAL);
  const cobreAte = new Date(agora.getTime() + MS_FOLGA_DO_RELOGIO);
  await db
    .$executeRaw`
      UPDATE "CommSettings"
      SET "webhookUltimoSinalEm" = GREATEST(COALESCE("webhookUltimoSinalEm", ${agora}), ${agora}),
          "envioSemEcoDesde" = CASE
            WHEN "envioSemEcoDesde" IS NOT NULL AND "envioSemEcoDesde" > ${cobreAte} THEN "envioSemEcoDesde"
            ELSE NULL
          END
      WHERE "companyId" = ${companyId}
        AND ("webhookUltimoSinalEm" IS NULL
          OR "webhookUltimoSinalEm" < ${corte}
          OR "envioSemEcoDesde" IS NOT NULL)`
    .catch(() => {});
}

/**
 * Um envio pelo WhatsApp da loja SAIU (o servidor aceitou): fica esperando o
 * eco. `inicio` é o instante ANTES de o pedido sair — o eco só pode chegar
 * depois dele. Só o PRIMEIRO envio sem eco fica carimbado (o mais antigo é o
 * que decide o alarme) — salvo quando o carimbado é de ANTES do último
 * reinício: aí este envio é a prova nova (RN-106, `provaAntesDoReinicio`). E
 * não carimba quando já chegou sinal depois do começo do envio (o eco chegou
 * antes da resposta — a corrida comum).
 */
export async function marcarEnvioSemEco(companyId: string, inicio: Date): Promise<void> {
  const cobertoDesde = new Date(inicio.getTime() - MS_FOLGA_DO_RELOGIO);
  await db
    .$executeRaw`
      UPDATE "CommSettings"
      SET "envioSemEcoDesde" = ${inicio}
      WHERE "companyId" = ${companyId}
        AND ("envioSemEcoDesde" IS NULL
          OR ("ultimoReinicioEm" IS NOT NULL AND "envioSemEcoDesde" <= "ultimoReinicioEm" AND "ultimoReinicioEm" < ${inicio}))
        AND ("webhookUltimoSinalEm" IS NULL OR "webhookUltimoSinalEm" < ${cobertoDesde})`
    .catch(() => {});
}

export type MotivoDaCura = "queda" | "webhook-calado";

export type ResultadoDaCura =
  /**
   * "sem-vez": a cura já rodou nesta loja nas últimas `HORAS_ENTRE_CURAS`
   * (ou outra rodada a tomou agora); "sem-necessidade": a queda não pede
   * reinício AGORA — a conexão reabriu, está religando sozinha, alguém lê o
   * QR, ou um reinício já está em curso (`estado` diz o que o servidor leu)
   */
  | { feita: false; motivo: "sem-vez" | "sem-necessidade"; estado?: string | null }
  | {
      feita: true;
      /** "voltou": aberta e a sonda não bateu no muro; "pendente": reconectando; "falhou": o resto */
      desfecho: "voltou" | "pendente" | "falhou";
      reinicio: ResultadoDoReinicio | null;
    };

/** O nome que fica no rastro de quem pediu o reinício. */
export const NOME_DA_CURA = "Vigia (automático)";

/**
 * A CURA AUTOMÁTICA (RN-106): antes de chamar alguém, o sistema reinicia a
 * conexão SOZINHO, UMA vez — pela MESMA porta do botão "Reiniciar conexão"
 * (RN-105: reinicia a instância, reaplica os avisos do webhook, lê o estado
 * até assentar e confere com a sonda). No máximo uma vez a cada
 * `HORAS_ENTRE_CURAS` por loja, com a vez tomada de forma atômica (duas
 * rodadas que se cruzem não reiniciam duas vezes): reiniciar em laço uma
 * conexão que não volta só esconderia o problema, e o alarme tem que chegar.
 * Nunca lança.
 */
export async function tentarCuraAutomatica(
  companyId: string,
  motivo: MotivoDaCura,
  agora = new Date()
): Promise<ResultadoDaCura> {
  // AS CONDIÇÕES DA QUEDA moram AQUI, junto da vez — uma régua para o aviso
  // do webhook e para o vigia (achado da revisão): só a loja DESCONECTADA
  // ("aguardando QR" pode ser alguém lendo o QR agora, e reiniciar
  // invalidaria o código na mão dela), sem reinício em curso, e com o
  // servidor dizendo que a conexão segue fechada — "open" (reabriu; o vigia
  // a devolve com a sonda) e "connecting" (o WhatsApp religando sozinho) não
  // se reiniciam por cima. Leitura só, antes de tomar a vez.
  if (motivo === "queda") {
    const s = await db.commSettings
      .findUnique({
        where: { companyId },
        select: { evolutionStatus: true, evolutionInstance: true, reinicioPedidoEm: true },
      })
      .catch(() => null);
    if (!s?.evolutionInstance || s.evolutionStatus !== "DESCONECTADO" || reinicioEmCurso(s.reinicioPedidoEm, agora))
      return { feita: false, motivo: "sem-necessidade", estado: null };
    const st = await evoState(s.evolutionInstance, 8_000).catch(() => null);
    const estado = st?.ok ? (st.data?.instance?.state ?? null) : null;
    if (estado === "open" || estado === "connecting") return { feita: false, motivo: "sem-necessidade", estado };
  }
  const corte = new Date(agora.getTime() - HORAS_ENTRE_CURAS * 60 * 60_000);
  const vez = await db.commSettings
    .updateMany({
      where: {
        companyId,
        OR: [{ autoCuraEm: null }, { autoCuraEm: { lt: corte } }],
        // o eco calado é conferido NA HORA de tomar a vez, não pela foto do
        // começo da rodada: o eco que chegou no meio dela (cada leitura de
        // loja pode levar 15 s) não pode reiniciar uma conexão que voltou a
        // entregar (achado da revisão)
        ...(motivo === "webhook-calado"
          ? { envioSemEcoDesde: { lte: new Date(agora.getTime() - MINUTOS_SEM_ECO * 60_000) } }
          : {}),
      },
      // a prova de antes da cura NÃO é apagada: ela passa a ser "de antes do
      // reinício" (`provaAntesDoReinicio`), o próximo envio se carimba por
      // cima, e o painel não pinta verde enquanto ninguém provou nada
      data: { autoCuraEm: agora },
    })
    .catch(() => ({ count: 0 }));
  if (vez.count === 0) return { feita: false, motivo: "sem-vez" };

  let reinicio: ResultadoDoReinicio | null = null;
  let desfecho: "voltou" | "pendente" | "falhou" = "falhou";
  let erro: string | null = null;
  try {
    // as esperas do botão, sem encurtar: a mesma opção espaça as sondas, e
    // sondas apressadas numa sessão que ainda assenta a dariam por morta
    // (achado da revisão)
    reinicio = await reiniciarConexaoDaLoja(companyId, { nome: NOME_DA_CURA });
    desfecho =
      reinicio.estado === "open" && reinicio.sonda !== "morta"
        ? "voltou"
        : reinicio.estado === "connecting"
          ? "pendente"
          : "falhou";
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  await db.commEvent
    .create({
      data: {
        companyId,
        channel: "WHATSAPP",
        direction: "OUT",
        type: "wa.conexao.cura-automatica",
        status: desfecho === "falhou" ? "ERRO" : "OK",
        error: erro ?? (desfecho === "falhou" ? (reinicio?.mensagem ?? "A conexão não voltou.") : null),
        payload: JSON.stringify({
          motivo,
          desfecho,
          estado: reinicio?.estado ?? null,
          sonda: reinicio?.sonda ?? null,
          avisos: reinicio?.avisos ?? null,
        }),
      },
    })
    .catch(() => {});
  return { feita: true, desfecho, reinicio };
}

/**
 * O RASTRO DE UMA QUEDA (RN-106): uma linha `wa.conexao.queda` na Central de
 * Comunicação com o motivo em português — o webhook traz o código do
 * WhatsApp; o vigia, que não o recebe, diz o que leu no servidor. É dela que
 * sai o cartão "Quedas e consertos" do painel de Saúde. Nunca lança.
 */
export async function registrarQueda(
  companyId: string,
  motivo: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db.commEvent
    .create({
      data: {
        companyId,
        channel: "WHATSAPP",
        direction: "IN",
        type: "wa.conexao.queda",
        status: "ERRO",
        error: motivo,
        payload: JSON.stringify(payload),
      },
    })
    .catch(() => {});
}
