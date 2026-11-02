import { db } from "../db";
import { evoSondarSessao, evoState, evolutionEnv, jidToPhone } from "./evolution";
import { lerSonda, reinicioEmCurso, veredictoDasSondas, type ResultadoDaSonda } from "./conexao-fechada";

/**
 * A SESSÃO ESTÁ VIVA DE VERDADE? (RN-105, 02/11/2026)
 *
 * A leitura do estado do servidor pode dizer "open" com a conexão com o
 * celular morta (o "Reiniciar conexão" disse "reiniciada" e o envio seguinte
 * voltou "Connection Closed"). A sonda é a prova: uma chamada que só passa
 * com a conexão viva (`evoSondarSessao`). Sem número da loja ou sem servidor
 * configurado não há o que sondar — "sem-resposta", que não decide nada.
 */
export async function sondarSessao(s: {
  evolutionInstance: string | null;
  evolutionPhone: string | null;
}): Promise<ResultadoDaSonda> {
  if (!s.evolutionInstance || !s.evolutionPhone || !evolutionEnv().configured) return "sem-resposta";
  const r = await evoSondarSessao(s.evolutionInstance, s.evolutionPhone).catch(() => null);
  return lerSonda(r);
}

/**
 * O VEREDITO, com tentativas espaçadas (`veredictoDasSondas`): uma sonda só
 * pode pegar o soluço de quando o servidor se reconecta sozinho. Só "morta"
 * repete — "viva" e "sem-resposta" decidem na hora. UMA função para as quatro
 * portas (envio, reinício, tela de conexão, Conectar e o vigia): a mesma
 * resposta do servidor nunca vira desfechos diferentes por botão (achado da
 * revisão).
 */
export async function veredictoDaSessao(
  s: { evolutionInstance: string | null; evolutionPhone: string | null },
  opts: { tentativas?: number; esperaMs?: number } = {}
): Promise<ResultadoDaSonda> {
  const tentativas = Math.max(1, opts.tentativas ?? 2);
  const resultados: ResultadoDaSonda[] = [];
  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, opts.esperaMs ?? 4000));
    const r = await sondarSessao(s);
    resultados.push(r);
    if (r !== "morta") break;
  }
  return veredictoDasSondas(resultados);
}

/**
 * O VEREDITO DE UMA LEITURA "OPEN": o número do aparelho vem do PRÓPRIO
 * servidor (`ownerJid`), com o gravado aqui de reserva — sem número a sonda
 * não decide nada, e o reinício chegou a sondar só pelo gravado (vazio em
 * loja antiga) e dizer "reiniciada" sem prova (achado da revisão). Uma regra
 * para as portas (tela, Conectar, reinício e vigia).
 */
export async function veredictoDoOpen(
  instance: string | null,
  ownerJid: string | null | undefined,
  telefoneGravado: string | null,
  opts: { tentativas?: number; esperaMs?: number } = {}
): Promise<ResultadoDaSonda> {
  const numero = jidToPhone(ownerJid ?? "") ?? telefoneGravado;
  return veredictoDaSessao({ evolutionInstance: instance, evolutionPhone: numero }, opts);
}

/**
 * MARCA A LOJA DESCONECTADA PELA SONDA (uma escrita para as portas): só se
 * ainda não estava desconectada (não reescreve o "desde quando" de uma queda
 * já marcada; duas conferências cruzadas não avisam em dobro), com registro na
 * Central e, quando pedido, o aviso de queda de sempre (`alertWhatsappDown`,
 * com o anti-spam dele). O provedor NÃO muda: trocar para o simulado faria os
 * envios "darem certo" sem sair. Quem volta a loja para conectada é o "open"
 * de verdade pelo webhook, o vigia (que sonda as lojas marcadas assim) ou a
 * tela de conexão.
 */
export async function marcarSessaoMorta(
  companyId: string,
  info: { instance: string | null; origem: string; alarme: boolean },
  agora = new Date()
): Promise<boolean> {
  const marcado = await db.commSettings.updateMany({
    where: { companyId, evolutionStatus: { not: "DESCONECTADO" } },
    data: { evolutionStatus: "DESCONECTADO", evolutionDownSince: agora },
  });
  if (marcado.count === 0) return false;
  await db.commEvent
    .create({
      data: {
        companyId,
        channel: "WHATSAPP",
        direction: "OUT",
        type: "wa.conexao.fechada",
        status: "ERRO",
        error:
          'O servidor dizia "conectado", mas a sonda bateu na conexão fechada: a conexão com o celular caiu. Reconecte em Comunicação (QR Code).',
        payload: JSON.stringify({ instance: info.instance, origem: info.origem }),
      },
    })
    .catch(() => {});
  if (info.alarme) {
    // importação tardia: o vigia (health) também usa este arquivo
    const { alertWhatsappDown } = await import("../health");
    await alertWhatsappDown(companyId).catch(() => {});
  }
  return true;
}

/** Uma conferência por loja a cada 2 min nesta instância: dez envios falhando juntos sondam uma vez. */
const MS_FREIO = 2 * 60_000;
const ultimaConferencia = new Map<string, number>();

/**
 * O ENVIO VOLTOU "CONEXÃO FECHADA": confere e, se for verdade, a loja passa a
 * aparecer DESCONECTADA e é avisada (RN-105). Um "Connection Closed" sozinho
 * não basta — o veredito repete a sonda. Sem isto a loja seguia "Conectado"
 * no painel com nada entrando e nada saindo, a tela de conexão sem o botão do
 * QR Code e ninguém avisado. O reinício pedido há pouco não é queda. Nunca
 * lança: é diagnóstico pendurado num envio que já falhou.
 */
export async function confirmarConexaoFechada(companyId: string, agora = new Date()): Promise<boolean> {
  try {
    const ultima = ultimaConferencia.get(companyId);
    if (ultima && agora.getTime() - ultima < MS_FREIO) return false;
    ultimaConferencia.set(companyId, agora.getTime());

    const s = await db.commSettings.findUnique({
      where: { companyId },
      select: {
        evolutionStatus: true,
        evolutionInstance: true,
        evolutionPhone: true,
        reinicioPedidoEm: true,
      },
    });
    if (!s || s.evolutionStatus !== "CONECTADO" || !s.evolutionInstance) return false;
    if (reinicioEmCurso(s.reinicioPedidoEm, agora)) return false;
    // o número do aparelho vem do PRÓPRIO servidor (`veredictoDoOpen`): o
    // gravado aqui pode estar vazio em loja antiga, e aí a sonda não decidia
    // nada e a loja seguia "Conectado" com todo envio falhando (achado da
    // revisão). Lido "close" de verdade, também é queda.
    const st = await evoState(s.evolutionInstance, 8_000);
    const lido = st.ok ? st.data?.instance?.state : undefined;
    const veredicto =
      lido === "close"
        ? "morta"
        : lido === "open"
          ? await veredictoDoOpen(s.evolutionInstance, st.data?.instance?.ownerJid, s.evolutionPhone)
          : "sem-resposta";
    if (veredicto !== "morta") return false;
    return await marcarSessaoMorta(
      companyId,
      { instance: s.evolutionInstance, origem: "envio", alarme: true },
      agora
    );
  } catch {
    return false;
  }
}
