import { db } from "../db";
import { evolutionEnv, evoRestart, evoState } from "./evolution";
import { MS_JANELA_DO_REINICIO, reinicioEmCurso, type ResultadoDaSonda } from "./conexao-fechada";
import { marcarSessaoMorta, veredictoDoOpen } from "./sessao-viva";

// a régua da janela mora na regra pura; reexportada para quem já a importa daqui
export { MS_JANELA_DO_REINICIO, reinicioEmCurso };
import {
  descreverRecusa,
  garantirEventosDoWebhook,
  type ResultadoDaAssinatura,
} from "./garantir-webhook";

/**
 * REINICIAR A CONEXÃO DA LOJA, SEM DEPENDER DA HOSTINGER (RN-105).
 *
 * O incidente de 02/11/2026: lojas "conectadas" no painel, envios saindo, e
 * NENHUMA mensagem de cliente entrando — o servidor Evolution parou de avisar
 * o sistema. O remédio era reiniciar o projeto Docker inteiro na Hostinger,
 * que só o dono alcança. O servidor tem um reinício POR INSTÂNCIA
 * (`POST /instance/restart/{instância}`): a sessão salva é reaproveitada,
 * então normalmente não pede QR, e só a loja afetada é tocada.
 *
 * O que o botão faz, nesta ordem: registra o PEDIDO (é por ele que o webhook
 * sabe que o "fechou" dos próximos minutos é deste reinício, não uma queda);
 * reinicia a instância; reaplica o webhook (a lista de avisos atual,
 * `garantirEventosDoWebhook` com `sempre`); espera um instante e lê o estado
 * para DIZER o que aconteceu. Tudo fica na Central de Comunicação da loja
 * (`wa.conexao.reinicio-pedido` e `wa.conexao.reiniciada`, OK ou ERRO), com
 * quem pediu — reiniciar conexão é ato que precisa de rastro.
 */

export const TIPO_REINICIO_PEDIDO = "wa.conexao.reinicio-pedido";
/** Depois de a sessão voltar "open", quanto da janela ainda vale (eventos atrasados). */
const MS_SOBRA_DEPOIS_DE_ABRIR = 15_000;
export const TIPO_REINICIO_FEITO = "wa.conexao.reiniciada";

/** Quantas leituras do estado depois do reinício, e o intervalo entre elas. */
const LEITURAS_DO_ESTADO = 3;

export type ResultadoDoReinicio = {
  ok: boolean;
  /** frase em português para a tela */
  mensagem: string;
  /** estado lido do servidor depois do reinício: open | connecting | close | null */
  estado: string | null;
  avisos: ResultadoDaAssinatura | null;
  /** a sonda da sessão depois do reinício (RN-105): "morta" = o "open" mentia */
  sonda?: ResultadoDaSonda;
};

/** O pedaço puro: o que dizer à pessoa pelo estado que o servidor devolveu. */
export function fraseDoReinicio(
  estado: string | null,
  avisos: ResultadoDaAssinatura | null,
  opts: { demorou?: boolean; sessaoMorta?: boolean } = {}
): string {
  // o reinício que só DEMOROU a responder (RN-048: incerto não é recusa)
  // provavelmente aconteceu — a pessoa confere o estado em vez de ir à Hostinger
  const prefixo = opts.demorou
    ? "O servidor demorou a responder ao reinício, mas ele provavelmente aconteceu. "
    : "";
  const avisosTxt =
    avisos === "falhou"
      ? " Os avisos (webhook) NÃO foram reaplicados — veja o motivo na Central de Comunicação."
      : "";
  // "avisos reaplicados" só quando o servidor CONFIRMOU (senão a frase se contradizia)
  const reaplicados = avisos === "reassinada" || avisos === "em-dia";
  // o servidor diz "open", mas a sonda bateu na conexão fechada: o reinício
  // NÃO resolveu, e dizer "reiniciada" foi o erro do incidente de 02/11/2026
  if (opts.sessaoMorta)
    return (
      prefixo +
      'O servidor diz "conectado", mas a conexão com o celular continua fechada: o reinício não resolveu. Toque em "Conectar WhatsApp (QR Code)" em Comunicação e leia o código com o celular da loja. Se o QR Code não aparecer, o caminho é reiniciar o projeto do Evolution na Hostinger.'
    );
  if (estado === "open")
    return (
      prefixo +
      `Conexão reiniciada${reaplicados ? " e avisos reaplicados" : ""}. Mande um "teste" de outro celular: tem que cair na Central em segundos.` +
      avisosTxt
    );
  if (estado === "connecting")
    return (
      prefixo +
      'O servidor está reconectando a sessão. Em até 1 minuto a conexão volta; se aparecer "Aguardando QR", leia o QR Code de novo.' +
      avisosTxt
    );
  if (estado === "close")
    return (
      prefixo +
      "A conexão não voltou sozinha: a sessão salva não serviu. Leia o QR Code de novo para reconectar." +
      avisosTxt
    );
  return (
    prefixo + "Reinício pedido ao servidor. Confira o estado da conexão em instantes." + avisosTxt
  );
}

export async function reiniciarConexaoDaLoja(
  companyId: string,
  quem: { nome: string },
  opts: { esperarMs?: number } = {}
): Promise<ResultadoDoReinicio> {
  const s = await db.commSettings.findUnique({ where: { companyId } });
  if (!s?.evolutionInstance || !s.evolutionWebhookToken) {
    return {
      ok: false,
      mensagem: "Esta loja não tem WhatsApp conectado pelo servidor de conexão.",
      estado: null,
      avisos: null,
    };
  }
  if (!evolutionEnv().configured) {
    return {
      ok: false,
      mensagem: "O servidor de conexão não está configurado.",
      estado: null,
      avisos: null,
    };
  }
  const registrar = (
    type: string,
    status: "OK" | "ERRO",
    error: string | null,
    payload: Record<string, unknown>
  ) =>
    db.commEvent
      .create({
        data: {
          companyId,
          channel: "WHATSAPP",
          direction: "OUT",
          type,
          status,
          error,
          payload: JSON.stringify({ quem: quem.nome, instance: s.evolutionInstance, ...payload }),
        },
      })
      .catch(() => {});

  // O PEDIDO fica carimbado ANTES de reiniciar (`reinicioPedidoEm`): é por
  // ele que o webhook e o vigia sabem que o "fechou" dos próximos minutos é
  // deste reinício, não uma queda. A linha na Central é o rastro de quem pediu.
  const pedidoEm = new Date();
  const pedidoAntes = s.reinicioPedidoEm ?? null;
  await db.commSettings.update({ where: { companyId }, data: { reinicioPedidoEm: pedidoEm } });
  await registrar(TIPO_REINICIO_PEDIDO, "OK", null, { pedido: true });
  const r = await evoRestart(s.evolutionInstance);
  // Recusa de verdade (o servidor RESPONDEU não, ou nem foi alcançado) é
  // erro. Tempo esgotado NÃO é recusa (RN-048): reiniciar uma sessão leva
  // mais que o teto de leitura sob carga, e o reinício provavelmente
  // aconteceu — então os avisos são reaplicados e o estado é lido do mesmo
  // jeito; a frase diz que demorou (achado da revisão).
  if (!r.ok && !r.incerto) {
    // nada reiniciou: o carimbo volta ao que era (só se ainda é o nosso), senão
    // uma queda DE VERDADE nos 3 minutos seguintes seria calada (achado da revisão)
    await db.commSettings
      .updateMany({ where: { companyId, reinicioPedidoEm: pedidoEm }, data: { reinicioPedidoEm: pedidoAntes } })
      .catch(() => {});
    const motivo = descreverRecusa(r);
    await registrar(TIPO_REINICIO_FEITO, "ERRO", `O servidor de conexão recusou o reinício (${motivo}).`, {
      motivo,
    });
    return {
      ok: false,
      mensagem: `O servidor de conexão recusou o reinício (${motivo}). Tente de novo em instantes; se repetir, o caminho é reiniciar o projeto do Evolution na Hostinger.`,
      estado: null,
      avisos: null,
    };
  }
  const demorou = !r.ok && !!r.incerto;
  // o servidor leva um instante para derrubar e reabrir a sessão — reaplicar
  // o webhook NA HORA podia levar uma recusa passageira da instância em
  // reinício (e a frase diria "avisos NÃO reaplicados" sem motivo, achado da
  // revisão), e ler o estado na hora diria "connecting" sempre
  await new Promise((resolve) => setTimeout(resolve, opts.esperarMs ?? 1500));
  // o reinício não sabe de webhook: reaplica a lista de avisos atual por cima
  const avisos = await garantirEventosDoWebhook(s, { sempre: true });
  // O estado é lido até ASSENTAR: a sessão que ainda está voltando responde
  // "close"/"connecting" por alguns segundos, e uma leitura só mandava a
  // pessoa ler o QR de uma conexão que voltaria sozinha (achado da revisão).
  // Para em "open", ou quando a leitura falha (não insiste num servidor mudo).
  let estado: string | null = null;
  let ownerJid: string | null = null;
  for (let i = 0; i < LEITURAS_DO_ESTADO; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, opts.esperarMs ?? 2000));
    const st = await evoState(s.evolutionInstance);
    if (!st.ok) {
      estado = null;
      break;
    }
    estado = st.data?.instance?.state ?? null;
    ownerJid = st.data?.instance?.ownerJid ?? null;
    if (estado === "open") break;
  }
  // O webhook cala o "close"/"connecting" deste reinício (é o que evita o
  // alarme falso), então quem grava o estado FINAL é este caminho — senão a
  // tela recarregava "conectada" sem o botão do QR que a frase manda ler, ou
  // ficava "aguardando QR" (pelo "connecting" irmão) com a sessão aberta e a
  // loja fora do vigia (achados da revisão). Sem alarme: a pessoa está olhando.
  // "open" na leitura não é prova (RN-105): a sonda confere com uma chamada
  // que só passa com a conexão viva. Morta = o reinício não resolveu, e a
  // loja passa a aparecer DESCONECTADA, com o botão do QR Code na tela
  // (três tentativas espaçadas: a sessão recém-reiniciada ainda assenta)
  const sonda: ResultadoDaSonda | undefined =
    estado === "open"
      ? await veredictoDoOpen(s.evolutionInstance, ownerJid, s.evolutionPhone, {
          tentativas: 3,
          esperaMs: opts.esperarMs ?? 3000,
        })
      : undefined;
  if (sonda === "morta") {
    // sem alarme: a pessoa está olhando a frase
    await marcarSessaoMorta(companyId, { instance: s.evolutionInstance, origem: "reinicio", alarme: false });
    await registrar(
      TIPO_REINICIO_FEITO,
      "ERRO",
      'O servidor respondeu "open", mas a sonda bateu na conexão fechada: o reinício não resolveu.',
      { estado, avisos, demorou, sonda }
    );
    return {
      ok: false,
      mensagem: fraseDoReinicio(estado, avisos, { demorou, sessaoMorta: true }),
      estado,
      avisos,
      sonda,
    };
  }
  if (estado === "open") {
    await db.commSettings.updateMany({
      where: { companyId, evolutionStatus: { not: "CONECTADO" } },
      data: { evolutionStatus: "CONECTADO", evolutionDownSince: null, evolutionAlertAt: null },
    });
    // a sessão voltou: a janela de silêncio encolhe para os próximos 15 s (o
    // aviso do "fechou" deste reinício que ainda esteja a caminho segue
    // calado) — 3 minutos inteiros calariam uma queda de VERDADE logo depois
    // (achado da revisão). Só se o carimbo ainda é o nosso.
    await db.commSettings.updateMany({
      where: { companyId, reinicioPedidoEm: pedidoEm },
      data: { reinicioPedidoEm: new Date(Date.now() - MS_JANELA_DO_REINICIO + MS_SOBRA_DEPOIS_DE_ABRIR) },
    });
  } else if (estado === "close") {
    await db.commSettings.updateMany({
      where: { companyId, evolutionStatus: "CONECTADO" },
      data: { evolutionStatus: "DESCONECTADO", evolutionDownSince: new Date() },
    });
  }
  await registrar(TIPO_REINICIO_FEITO, "OK", null, { estado, avisos, demorou, sonda });
  return { ok: true, mensagem: fraseDoReinicio(estado, avisos, { demorou }), estado, avisos, sonda };
}
