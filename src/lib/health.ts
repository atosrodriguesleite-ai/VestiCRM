import { db } from "./db";
import { evolutionEnv, evoState } from "./comm/evolution";
import { veredictoDoOpen } from "./comm/sessao-viva";
import { garantirEventosDoWebhook } from "./comm/garantir-webhook";
import { reinicioEmCurso } from "./comm/conexao-fechada";
import { sendToCompany, sendToUser } from "./push";
import {
  deveAvisarSilencio,
  fraseDaLojaMuda,
  horasDesde,
  silencioLabel,
  HORAS_REAVISO_SILENCIO,
} from "./health-wa";
import { lerHorarioComercial, type HorarioComercial } from "./bi/horario-comercial";
import { registrarQueda, tentarCuraAutomatica, type MotivoDaCura } from "./comm/pulso-do-webhook";
import {
  decidirPulso,
  fraseDoWebhookCalado,
  HORAS_ENTRE_CURAS,
  HORAS_REAVISO_CALADO,
  MINUTOS_SEM_CURA_ALARMA,
  MINUTOS_SEM_ECO,
  minutosSemEco,
  podeCurar,
} from "./comm/pulso-regra";

/**
 * Vigia do sistema (monitoramento sem serviço externo e SEM cron novo —
 * Vercel Hobby só permite 2 crons diários, regra que já bloqueou deploys).
 *
 * Como funciona:
 *  - `runWatchdogIfDue()` roda "de carona" em rotas movimentadas (o sync da
 *    inbox bate a cada 4s) e no cron diário existente. Uma trava atômica no
 *    banco garante no MÁXIMO uma rodada a cada poucos minutos, sem corrida.
 *  - Checa o servidor Evolution e a conexão de WhatsApp de cada loja.
 *    Caiu → sino + push para a loja (e para a plataforma), com anti-spam.
 *  - `logServerError()` registra qualquer erro de produção (painel /saude)
 *    e avisa o Super Admin por push, também com anti-spam.
 */

const WATCHDOG_INTERVAL_MS = 5 * 60_000; // vigia roda no máx. a cada 5 min
const STORE_ALERT_COOLDOWN_MS = 6 * 60 * 60_000; // reavisa a loja a cada 6h
const ERROR_ALERT_COOLDOWN_MS = 15 * 60_000; // push de erro no máx. a cada 15min

/** Cooldown genérico: já passou tempo suficiente desde o último aviso? */
export function cooldownPassed(
  last: Date | null | undefined,
  now: Date,
  ms: number
): boolean {
  return !last || now.getTime() - last.getTime() >= ms;
}

/** Empresa da plataforma = onde vive o SUPERADMIN (recebe alertas globais). */
async function platformCompanyId(): Promise<string | null> {
  const admin = await db.user.findFirst({
    where: { role: "SUPERADMIN" },
    select: { companyId: true },
  });
  return admin?.companyId ?? null;
}

/**
 * Registra um erro de produção e avisa o Super Admin (com anti-spam).
 * NUNCA lança — o vigia jamais pode piorar o problema que está reportando.
 */
export async function logServerError(input: {
  // wa.webhook: falha ao gravar mensagem que chegou do WhatsApp — a mais
  // grave de todas, porque significa conversa que a loja não vai ver
  // client / tela.versao: tela que quebrou no NAVEGADOR (RN-066)
  // tela.abertura: a página que NÃO terminou de chegar (RN-095) — é a
  // conexão da pessoa, não o código: fora da conta de erros, em bloco próprio
  // catalogo.recusa: pedido do catálogo RECUSADO pela rota (RN-010) — fora
  // da lista e da conta de erros da Saúde, como a tela.versao
  source:
    | "server"
    | "watchdog"
    | "client"
    | "tela.versao"
    | "tela.abertura"
    | "wa.webhook"
    | "catalogo.recusa";
  path?: string | null;
  message: string;
  detail?: string | null;
  /**
   * `false` = grava no painel sem tocar o "🚨 Erro em produção". É o caso da
   * tela quebrada no navegador (RN-066): o alarme é o canal ÚNICO das
   * emergências do servidor e do WhatsApp, com um intervalo de 15 min
   * compartilhado — um relato de tela ganharia esse intervalo e calaria o
   * alarme de uma mensagem de cliente perdida; e o texto vem do aparelho,
   * digitável por quem estiver logado em qualquer loja (achados da revisão).
   */
  alarme?: false;
}) {
  try {
    await db.errorLog.create({
      data: {
        source: input.source,
        path: input.path?.slice(0, 300) ?? null,
        message: (input.message || "Erro sem mensagem").slice(0, 500),
        detail: input.detail?.slice(0, 4000) ?? null,
      },
    });
    if (input.alarme === false) return;
    // anti-spam atômico: só quem "ganhar" o update manda o push
    const now = new Date();
    const claimed = await db.systemHealth.updateMany({
      where: {
        id: "main",
        OR: [
          { errorAlertAt: null },
          { errorAlertAt: { lt: new Date(now.getTime() - ERROR_ALERT_COOLDOWN_MS) } },
        ],
      },
      data: { errorAlertAt: now },
    });
    if (claimed.count > 0) {
      const platform = await platformCompanyId();
      if (platform) {
        await sendToCompany(platform, {
          title: "🚨 Erro em produção no AtacadoPro",
          body: input.message.slice(0, 140),
          url: "/saude",
          tag: "erro-producao",
        });
      }
    }
  } catch {
    // sem rede/banco não há o que fazer — silêncio é melhor que loop de erro
  }
}

/** Sino para todos os admins/gerentes de uma loja. */
async function bellForAdmins(
  companyId: string,
  title: string,
  body: string,
  // RN-105: o aviso que manda apertar um botão que só o admin vê não toca o
  // sino da gerente — seria beco sem saída (achado da revisão)
  opts: { soAdmin?: boolean } = {}
) {
  const admins = await db.user.findMany({
    where: {
      companyId,
      active: true,
      role: { in: opts.soAdmin ? ["ADMIN", "SUPERADMIN"] : ["ADMIN", "MANAGER", "SUPERADMIN"] },
    },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await db.notification.createMany({
    data: admins.map((u) => ({
      companyId,
      userId: u.id,
      type: "SYSTEM",
      title,
      body,
    })),
  });
  return admins.map((u) => u.id);
}

/** Avisa a loja (sino + push) que o WhatsApp dela caiu — com anti-spam de 6h. */
export async function alertWhatsappDown(companyId: string) {
  const now = new Date();
  const claimed = await db.commSettings.updateMany({
    where: {
      companyId,
      OR: [
        { evolutionAlertAt: null },
        { evolutionAlertAt: { lt: new Date(now.getTime() - STORE_ALERT_COOLDOWN_MS) } },
      ],
    },
    data: { evolutionAlertAt: now },
  });
  if (claimed.count === 0) return; // já avisada há pouco
  const title = "⚠️ WhatsApp desconectou";
  const body =
    "A conexão do WhatsApp da loja caiu. Abra Comunicação e escaneie o QR Code para reconectar.";
  await bellForAdmins(companyId, title, body);
  await sendToCompany(companyId, { title, body, url: "/comunicacao", tag: "wa-down" });

  await avisarPlataforma(companyId, {
    titulo: (nome) => `⚠️ WhatsApp caiu: ${nome}`,
    corpo: (nome) =>
      `A conexão de WhatsApp da ${nome} caiu. A loja já foi avisada para reconectar pelo QR Code.`,
    url: "/gestao",
    tag: "wa-down",
  });
}

/**
 * O DONO DA PLATAFORMA também precisa saber (uma função para os dois avisos
 * do vigia — queda e loja muda): loja com o WhatsApp parado é cliente sem
 * atendimento, e loja que para de usar é loja que cancela. Avisar na hora é o
 * que dá tempo de ligar antes. É um extra: nunca pode atrapalhar o aviso à loja.
 */
async function avisarPlataforma(
  companyId: string,
  aviso: { titulo: (nome: string) => string; corpo: (nome: string) => string; url: string; tag: string }
) {
  try {
    const platform = await platformCompanyId();
    if (!platform || platform === companyId) return;
    const loja = await db.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const nome = loja?.name ?? "Uma loja";
    const title = aviso.titulo(nome);
    const body = aviso.corpo(nome);
    await bellForAdmins(platform, title, body);
    // tag por loja: duas lojas com problema geram dois avisos, não um só
    await sendToCompany(platform, { title, body, url: aviso.url, tag: `${aviso.tag}-${companyId}` });
  } catch {
    // avisar a plataforma é um extra: nunca pode atrapalhar o aviso à loja
  }
}

/**
 * A ÚLTIMA MENSAGEM QUE CHEGOU PELO WEBHOOK, por loja — `Conversation.lastInboundAt`,
 * que SÓ o caminho de receber do motor grava (webhooks e a tela de
 * simulação). A bolha do pedido do catálogo é criada pelo intake sem passar
 * por ele, de propósito: ela entra SEM webhook e, contada, mascararia a loja
 * muda que recebe pedidos do catálogo todo dia (achado da revisão). O painel
 * de Saúde lê a MESMA coluna, para o aviso e o painel dizerem o mesmo
 * número. Agrupado por loja pelo índice de `Conversation` — nada de varrer a
 * tabela de mensagens a cada rodada do vigia.
 */
export async function ultimaRecebidaPorLoja(companyIds: string[]): Promise<Map<string, Date | null>> {
  if (companyIds.length === 0) return new Map();
  const linhas = await db.conversation.groupBy({
    by: ["companyId"],
    where: { companyId: { in: companyIds } },
    _max: { lastInboundAt: true },
  });
  const mapa = new Map(linhas.map((l) => [l.companyId, l._max.lastInboundAt ?? null]));
  // A loja SEM o carimbo em conversa nenhuma pode não ser nova: o histórico
  // importado antes desta regra (e a unificação de conversas) deixava a
  // mensagem recebida pelo WhatsApp sem `lastInboundAt`, e o painel a pinta
  // CRÍTICO ("já teve tráfego") enquanto o vigia a chamava de nova (achado da
  // revisão). Aí vale a última mensagem com id do WhatsApp — a MESMA fonte do
  // "já teve tráfego" do painel. Só para essas lojas, que são poucas.
  // O id da simulação (`wamid.sim.`) e do provedor de mentira (`mock.`) não é
  // tráfego de webhook (a armadilha da RN-049).
  const agora = Date.now();
  for (const companyId of companyIds) {
    if (mapa.get(companyId)) continue;
    const lembrado = reservaLembrada.get(companyId);
    if (lembrado && agora - lembrado.em < MS_LEMBRAR_RESERVA) {
      mapa.set(companyId, lembrado.ultima);
      continue;
    }
    const ultima = await db.message.findFirst({
      where: {
        direction: "IN",
        externalId: { not: null },
        NOT: [{ externalId: { startsWith: "mock." } }, { externalId: { startsWith: "wamid.sim." } }],
        conversation: { companyId },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    reservaLembrada.set(companyId, { em: agora, ultima: ultima?.createdAt ?? null });
    mapa.set(companyId, ultima?.createdAt ?? null);
  }
  return mapa;
}

// lembrada por 1 h nesta instância, achando ou não: a busca ordenada pela
// loja não se repete a cada rodada de 5 min (achado da revisão). A mensagem
// nova pelo webhook carimba `lastInboundAt`, e aí a reserva nem é olhada.
const MS_LEMBRAR_RESERVA = 60 * 60_000;
const reservaLembrada = new Map<string, { em: number; ultima: Date | null }>();

/**
 * A LOJA CONECTADA E MUDA É AVISADA (RN-105): uma vez por episódio, com
 * reaviso a cada 24 h enquanto durar. A régua é pura (`deveAvisarSilencio`,
 * silêncio em horas de atendimento); o carimbo `silencioAvisadoEm` é tomado
 * de forma atômica, então duas rodadas que se cruzem não mandam o aviso em
 * dobro. Avisa o admin da loja (sino + celular) E a plataforma — loja muda é
 * cliente sem resposta e dona achando que está tudo bem.
 */
export async function avisarLojasMudas(
  lojas: { companyId: string; horario: HorarioComercial | null }[],
  now: Date
): Promise<void> {
  if (lojas.length === 0) return;
  const companyIds = lojas.map((l) => l.companyId);
  const [ultimaDe, carimbos] = await Promise.all([
    ultimaRecebidaPorLoja(companyIds),
    db.commSettings.findMany({
      where: { companyId: { in: companyIds } },
      select: { companyId: true, silencioAvisadoEm: true },
    }),
  ]);
  const carimboDe = new Map(carimbos.map((c) => [c.companyId, c.silencioAvisadoEm]));
  for (const { companyId, horario } of lojas) {
    const ultimaRecebida = ultimaDe.get(companyId) ?? null;
    const avisadoEm = carimboDe.get(companyId) ?? null;
    if (!ultimaRecebida) continue;
    if (!deveAvisarSilencio({ conectado: true, ultimaRecebida, avisadoEm, horario }, now)) continue;
    await alertarLojaMuda(companyId, avisadoEm, ultimaRecebida, now);
  }
}

async function alertarLojaMuda(companyId: string, avisadoAntes: Date | null, ultimaRecebida: Date, now: Date) {
  // carimbo atômico: só quem o toma avisa (a mesma régua pura, escrita no banco)
  const reavisoCorte = new Date(now.getTime() - HORAS_REAVISO_SILENCIO * 60 * 60_000);
  const claimed = await db.commSettings.updateMany({
    where: {
      companyId,
      OR: [
        { silencioAvisadoEm: null },
        { silencioAvisadoEm: { lt: ultimaRecebida } },
        { silencioAvisadoEm: { lt: reavisoCorte } },
      ],
    },
    data: { silencioAvisadoEm: now },
  });
  if (claimed.count === 0) return;
  const title = "🔇 WhatsApp conectado, mas sem receber mensagens";
  const body = fraseDaLojaMuda(ultimaRecebida, now);
  let admins: string[] | undefined;
  try {
    admins = await bellForAdmins(companyId, title, body, { soAdmin: true });
  } catch (e) {
    // O SINO é o aviso que conta: sem ele, o carimbo volta (só se ainda é o
    // nosso) para a próxima rodada tentar de novo, e o caso vai à Saúde —
    // carimbo sem aviso calaria a loja muda por 24 h (RN-051/RN-100).
    await db.commSettings
      .updateMany({
        where: { companyId, silencioAvisadoEm: now },
        data: { silencioAvisadoEm: avisadoAntes },
      })
      .catch(() => {});
    await logServerError({
      source: "watchdog",
      message: `Aviso de loja muda não saiu (${companyId})`,
      detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
      alarme: false,
    }).catch(() => {});
    return;
  }
  // celular e plataforma são extras: a falha deles NÃO devolve o carimbo —
  // devolver faria o sino já entregue tocar de novo a cada 5 min. O celular é
  // o do ADMIN, como o sino: o da vendedora inscrita nas vendas receberia a
  // instrução de um botão que ela não tem (achados da revisão).
  for (const userId of admins ?? []) {
    await sendToUser(userId, { title, body, url: "/comunicacao", tag: "wa-mudo" }).catch(() => {});
  }
  try {
    await avisarPlataforma(companyId, {
      titulo: (nome) => `🔇 WhatsApp mudo: ${nome}`,
      corpo: (nome) =>
        `A ${nome} está conectada, mas nenhuma mensagem de cliente entra há ${silencioLabel(horasDesde(ultimaRecebida, now))}. A loja foi avisada; o botão "Reiniciar conexão" está no painel de Saúde.`,
      url: "/saude",
      tag: "wa-mudo",
    });
  } catch {
    // a plataforma é o segundo par de olhos; a loja já foi avisada
  }
}

/**
 * A CURA AUTOMÁTICA DEU CERTO (RN-106): a loja não precisa de aviso nenhum —
 * o atendimento segue —, mas a PLATAFORMA fica sabendo, para registro e para
 * enxergar a loja que cai toda semana. Nunca lança.
 */
export async function avisarCuraAutomatica(companyId: string, motivo: MotivoDaCura): Promise<void> {
  await avisarPlataforma(companyId, {
    titulo: (nome) => `🔧 WhatsApp religado sozinho: ${nome}`,
    corpo: (nome) =>
      motivo === "queda"
        ? `A conexão de WhatsApp da ${nome} caiu e o sistema a reiniciou sozinho — voltou. Nada a fazer; fica no painel de Saúde.`
        : `O WhatsApp da ${nome} parou de entregar as mensagens ao sistema e o sistema reiniciou a conexão sozinho. A confirmação vem com a próxima mensagem enviada pela loja; se não vier, chega outro aviso.`,
    url: "/saude",
    tag: "wa-cura",
  });
}

/**
 * O WEBHOOK CALADO DEPOIS DA CURA (RN-106): a loja envia, o eco não volta e
 * o reinício automático não resolveu — as mensagens das clientes não estão
 * entrando. Sino e celular do ADMIN (quem vê o botão, a régua da RN-105) e a
 * plataforma, uma vez por episódio (o envio sem eco mais novo que o último
 * aviso é episódio novo) e reaviso a cada `HORAS_REAVISO_CALADO`, com o
 * carimbo tomado de forma atômica. Nunca lança.
 */
export async function alertarWebhookCalado(
  companyId: string,
  desde: Date,
  now = new Date(),
  // só diz que reiniciou quando reiniciou (achado da revisão)
  tentouReiniciar = true
): Promise<void> {
  try {
    const reaviso = new Date(now.getTime() - HORAS_REAVISO_CALADO * 60 * 60_000);
    const claimed = await db.commSettings.updateMany({
      where: {
        companyId,
        // o eco ainda calado NA HORA do aviso — não pela foto do começo da
        // rodada: o eco que chegou no meio dela não vira alarme falso
        envioSemEcoDesde: { not: null, lte: new Date(now.getTime() - MINUTOS_SEM_ECO * 60_000) },
        OR: [
          { webhookCaladoAvisadoEm: null },
          { webhookCaladoAvisadoEm: { lt: desde } },
          { webhookCaladoAvisadoEm: { lt: reaviso } },
        ],
      },
      data: { webhookCaladoAvisadoEm: now },
    });
    if (claimed.count === 0) return;
    await db.commEvent
      .create({
        data: {
          companyId,
          channel: "WHATSAPP",
          direction: "IN",
          type: "wa.webhook.calado",
          status: "ERRO",
          error: `Envio sem eco há ${minutosSemEco(desde, now)} min${tentouReiniciar ? ", depois de reiniciar a conexão" : ""}.`,
          payload: JSON.stringify({ desde: desde.toISOString() }),
        },
      })
      .catch(() => {});
    const title = "🔇 WhatsApp parou de entregar as mensagens ao sistema";
    const body = fraseDoWebhookCalado(desde, now, tentouReiniciar);
    const admins = await bellForAdmins(companyId, title, body, { soAdmin: true });
    for (const userId of admins ?? []) {
      await sendToUser(userId, { title, body, url: "/comunicacao", tag: "wa-calado" }).catch(() => {});
    }
    await avisarPlataforma(companyId, {
      titulo: (nome) => `🔇 WhatsApp sem eco: ${nome}`,
      corpo: (nome) =>
        `A ${nome} enviou mensagem há ${minutosSemEco(desde, now)} min e o WhatsApp não devolveu a confirmação${tentouReiniciar ? "; o sistema já tentou reiniciar a conexão sozinho nas últimas horas" : ""}. As mensagens das clientes provavelmente não estão entrando. A loja foi avisada.`,
      url: "/saude",
      tag: "wa-calado",
    });
  } catch (e) {
    await logServerError({
      source: "watchdog",
      message: `Aviso de webhook calado não saiu (${companyId})`,
      detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
      alarme: false,
    }).catch(() => {});
  }
}

/**
 * Loja que caiu e ainda sem alarme há este tanto (RN-106): a queda de rede
 * espera a cura (e o próprio WhatsApp religar), a cura que terminou em
 * "reconectando" não alarma na hora; se não voltou, o alarme sai aqui —
 * nunca fica calada.
 */
const MIN_REDE_DE_SEGURANCA = 10;
/** A queda de rede espera este tanto antes da cura: o WhatsApp costuma religar sozinho em segundos. */
const MIN_ANTES_DA_CURA_DA_QUEDA = 3;

/**
 * A cura automática roda no FIM da rodada, uma por rodada, e só se a rodada
 * ainda não passou deste tempo: cada uma leva de 10 a 25 s no comum (bem
 * mais no pior caso), e os alarmes — loja muda, eco calado, rede de
 * segurança — não podem ficar sem tempo por causa dela (achado da revisão).
 */
const MS_ORCAMENTO_ANTES_DA_CURA = 30_000;

/** Quais destas lojas estão suspensas (uma consulta; lista vazia não vai ao banco). */
async function suspensasEntre(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const linhas = await db.company.findMany({
    where: { id: { in: ids }, suspended: true },
    select: { id: true },
  });
  return new Set(linhas.map((c) => c.id));
}

/** A queda de rede espera este tanto antes de o webhook mexer: o WhatsApp costuma religar sozinho. */
const MS_ESPERA_DA_QUEDA_NO_WEBHOOK = 60_000;

/**
 * A QUEDA DE REDE AVISADA PELO WEBHOOK (RN-106), depois da resposta: espera
 * um minuto (o próprio WhatsApp costuma religar em segundos — reiniciar por
 * cima atrapalharia), e se a conexão segue fora, tenta a cura; não voltou,
 * alarma. Assim a queda da madrugada alarma em ~1–2 min mesmo sem ninguém
 * usando o sistema e sem o despertador externo — esperar a rodada do vigia
 * deixava a loja muda até alguém abrir a Central de manhã (achado da
 * revisão). Duas quedas seguidas não disputam a cura: quem perde a vez e vê
 * uma cura recém-começada sai calado; sem vez nas últimas 6 h, alarma.
 * Nunca lança.
 */
export async function cuidarDaQuedaDeRede(companyId: string, esperaMs = MS_ESPERA_DA_QUEDA_NO_WEBHOOK): Promise<void> {
  const esperar = () => new Promise((r) => setTimeout(r, esperaMs));
  const ler = () =>
    db.commSettings.findUnique({
      where: { companyId },
      select: { evolutionInstance: true, evolutionStatus: true, reinicioPedidoEm: true },
    });
  // voltou, foi desligada, ou alguém já está reiniciando/recriando: nada a fazer
  const resolvida = (s: Awaited<ReturnType<typeof ler>>) =>
    !s?.evolutionInstance || s.evolutionStatus === "CONECTADO" || reinicioEmCurso(s.reinicioPedidoEm);
  try {
    await esperar();
    const s = await ler();
    if (resolvida(s)) return;
    const cura = await tentarCuraAutomatica(companyId, "queda");
    if (cura.feita) {
      if (cura.desfecho === "voltou") await avisarCuraAutomatica(companyId, "queda");
      else await alertWhatsappDown(companyId); // falhou ou segue reconectando: a loja precisa saber
      return;
    }
    if (cura.motivo === "sem-necessidade") {
      // reabriu: o vigia a devolve com a sonda
      if (cura.estado === "open") return;
      // religando sozinha ("connecting"), ou "aguardando QR" (o WhatsApp
      // religando grava esse estado, e pode ser alguém lendo o QR): mais um
      // minuto; não voltou, alarma — nunca reinicia por cima, nunca fica calada
      await esperar();
      if (resolvida(await ler())) return;
      await alertWhatsappDown(companyId);
      return;
    }
    // sem vez: outra cura começou agora há pouco (a outra queda, ou o vigia) e
    // ela decide; a vez gasta há mais tempo deixa o alarme sair
    const atual = await db.commSettings.findUnique({ where: { companyId }, select: { autoCuraEm: true } });
    if (atual?.autoCuraEm && Date.now() - atual.autoCuraEm.getTime() < 5 * 60_000) return;
    await alertWhatsappDown(companyId);
  } catch (e) {
    await logServerError({
      source: "watchdog",
      message: `Cuidado da queda do WhatsApp falhou (${companyId})`,
      detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
      alarme: false,
    }).catch(() => {});
  }
}

/** A volta das lojas marcadas pelo sistema é conferida em rodízio (RN-105). */
const conferidaNaVolta = new Map<string, number>();

/**
 * Roda o vigia SE já passou o intervalo (senão retorna na hora, custo de uma
 * consulta). Seguro para chamar de qualquer rota: nunca lança.
 */
export async function runWatchdogIfDue(
  // RN-106: a cura automática reinicia a conexão de uma loja (10 a 25 s no
  // comum, bem mais no pior caso). Quem chama o vigia no FIM de uma função
  // quase sem tempo (o cron da Jueri chega aqui depois de até 240 s de 300)
  // diz `curar: false`, senão a Vercel mataria a cura no meio (achado da revisão)
  opts: { curar?: boolean } = {}
): Promise<void> {
  const podeCurarNaRodada = opts.curar !== false;
  try {
    const now = new Date();
    const inicioDaRodada = Date.now();
    await db.systemHealth
      .createMany({ data: [{ id: "main" }], skipDuplicates: true })
      .catch(() => {});
    // trava atômica: só uma requisição por intervalo executa a rodada
    const claimed = await db.systemHealth.updateMany({
      where: {
        id: "main",
        OR: [
          { watchdogRunAt: null },
          // folga de 30 s: o despertador externo (ADR-024) também bate a cada
          // 5 min, e com a régua cravada metade das batidas caía 1 s antes da
          // vez e não rodava nada — o vigia passava a rodar a cada 10 min
          // (achado da revisão)
          { watchdogRunAt: { lt: new Date(now.getTime() - WATCHDOG_INTERVAL_MS + 30_000) } },
        ],
      },
      data: { watchdogRunAt: now },
    });
    if (claimed.count === 0) return;

    const { url, configured } = evolutionEnv();
    if (!configured || !url) return;

    // 1) servidor Evolution no ar?
    let serverOk = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      serverOk = res.ok;
    } catch {
      serverOk = false;
    }
    const health = await db.systemHealth.findUnique({ where: { id: "main" } });
    if (!serverOk) {
      // só alerta na TRANSIÇÃO (no ar → fora do ar), não a cada rodada
      if (health?.evolutionOk !== false) {
        await db.systemHealth.update({
          where: { id: "main" },
          data: { evolutionOk: false, evolutionDownSince: now },
        });
        await logServerError({
          source: "watchdog",
          message: "Servidor de WhatsApp (Evolution) fora do ar",
          detail: `Sem resposta em ${url}`,
        });
      }
      return; // servidor fora: não marca lojas (evita falso "loja caiu")
    }
    if (health?.evolutionOk === false) {
      await db.systemHealth.update({
        where: { id: "main" },
        data: { evolutionOk: true, evolutionDownSince: null },
      });
      const platform = await platformCompanyId();
      if (platform)
        await sendToCompany(platform, {
          title: "✅ Servidor de WhatsApp voltou",
          body: "O servidor Evolution está no ar novamente.",
          url: "/saude",
          tag: "wa-server",
        });
    }

    // 2) conexão de cada loja que deveria estar CONECTADA
    const stores = await db.commSettings.findMany({
      where: { evolutionStatus: "CONECTADO", evolutionInstance: { not: null } },
      select: {
        companyId: true,
        evolutionInstance: true,
        evolutionWebhookToken: true,
        evolutionWebhookEventos: true,
        reinicioPedidoEm: true,
        envioSemEcoDesde: true,
        autoCuraEm: true,
        ultimoReinicioEm: true,
        webhookCaladoAvisadoEm: true,
      },
    });
    // RN-106: o eco calado a curar e a queda vista AGORA pelo vigia — no FIM da rodada
    const ecoParaCurar: { companyId: string; desde: Date }[] = [];
    const quedasAgora: string[] = [];
    // loja SUSPENSA continua tendo a CONEXÃO vigiada (é o único caminho que a
    // marca DESCONECTADO — o webhook dela responde 200 mudo), mas fica fora
    // da conta de "muda": nada entra nela de propósito, e ela viraria aviso
    // a cada 24 h para sempre. O horário de atendimento vem junto: o silêncio
    // do alarme conta só as horas abertas (RN-079; achados das revisões).
    const lojas = new Map(
      (
        await db.company.findMany({
          where: { id: { in: stores.map((s) => s.companyId) } },
          select: { id: true, suspended: true, horarioComercial: true },
        })
      ).map((c) => [c.id, c])
    );
    const conectadas: { companyId: string; horario: HorarioComercial | null }[] = [];
    for (const s of stores) {
      const st = await evoState(s.evolutionInstance!);
      if (st.status === 0) continue; // rede oscilou — não conclui nada
      const state = st.data?.instance?.state;
      if (st.ok && state === "open") {
        const loja = lojas.get(s.companyId);
        if (loja && !loja.suspended)
          conectadas.push({ companyId: s.companyId, horario: lerHorarioComercial(loja.horarioComercial) });
        // conectada — limpa marca de queda, se havia
        await db.commSettings.updateMany({
          where: { companyId: s.companyId, evolutionDownSince: { not: null } },
          data: { evolutionDownSince: null, evolutionAlertAt: null },
        });
        // e escuta os eventos ATUAIS (loja parada, sem mensagem chegando,
        // não tem outra batida para ser reassinada)
        await garantirEventosDoWebhook(s).catch(() => {});
        continue;
      }
      // RN-105: o "connecting"/"close" dos segundos seguintes a um reinício
      // pedido pela loja não é queda — o webhook já cala por isso, e o vigia
      // que corre no meio tocava o alarme do mesmo jeito (achado da revisão)
      if (reinicioEmCurso(s.reinicioPedidoEm, now)) continue;
      // a foto da rodada envelhece (cada loja pode levar 15 s): o reinício
      // pedido DEPOIS do começo da rodada só aparece relendo (achado da revisão)
      const agoraMesmo = await db.commSettings.findUnique({
        where: { companyId: s.companyId },
        select: { reinicioPedidoEm: true },
      });
      if (reinicioEmCurso(agoraMesmo?.reinicioPedidoEm, new Date())) continue;
      // caiu de verdade (close/apagada): marca, atualiza status e avisa
      await db.commSettings.update({
        where: { companyId: s.companyId },
        data: {
          evolutionStatus: "DESCONECTADO",
          evolutionDownSince: now,
        },
      });
      // RN-106: o rastro da queda (o vigia não recebe o código do WhatsApp —
      // só sabe o que o servidor respondeu)
      await registrarQueda(
        s.companyId,
        `o vigia leu a conexão como "${st.ok ? (state ?? "sem estado") : `instância não encontrada (${st.status})`}" no servidor`,
        { estado: state ?? null, origem: "vigia" }
      );
      // RN-106: a loja ativa vai para a cura no FIM desta rodada — o vigia
      // não sabe há quanto tempo ela caiu, então não espera; sem cura nesta
      // rodada, alarma nesta mesma rodada (a que o cron da Jueri dispara de
      // madrugada não pode depender de uma rodada seguinte, achado da
      // revisão). A suspensa alarma como sempre (nem ingere, e não gasta a
      // cura de quem paga).
      if (lojas.get(s.companyId)?.suspended) await alertWhatsappDown(s.companyId);
      else quedasAgora.push(s.companyId);
    }
    // 3) conectada, mas MUDA (RN-105): a conexão de pé e nada entrando é a
    // falha mais perigosa — a loja acha que está tudo bem
    await avisarLojasMudas(conectadas, now);
    // 3b) RN-106 · O TESTE DO ECO: a loja enviou pelo sistema e o eco não
    // voltou em 12 min — o caminho das mensagens quebrou (o incidente de
    // 02/11/2026, achado em minutos em vez de um dia). Primeiro a cura
    // automática; calado de novo depois dela, o alarme.
    const porLoja = new Map(stores.map((s) => [s.companyId, s]));
    for (const { companyId } of conectadas) {
      const s = porLoja.get(companyId);
      if (!s?.envioSemEcoDesde) continue;
      if (reinicioEmCurso(s.reinicioPedidoEm, now)) continue;
      const decisao = decidirPulso(
        {
          envioSemEcoDesde: s.envioSemEcoDesde,
          curaEm: s.autoCuraEm,
          reiniciadoEm: s.ultimoReinicioEm,
          avisadoEm: s.webhookCaladoAvisadoEm,
        },
        now
      );
      if (decisao === "curar") ecoParaCurar.push({ companyId, desde: s.envioSemEcoDesde });
      else if (decisao === "avisar")
        await alertarWebhookCalado(
          companyId,
          s.envioSemEcoDesde,
          now,
          // "avisar" vem da vez da cura gasta; só diz que reiniciou se houve
          // reinício ACEITO nas últimas horas (a 401 gasta a vez sem reiniciar)
          !!s.ultimoReinicioEm && now.getTime() - s.ultimoReinicioEm.getTime() < HORAS_ENTRE_CURAS * 60 * 60_000
        );
    }
    // 4) a loja que o SISTEMA marcou desconectada volta sozinha quando a sessão
    // volta (RN-105): ninguém mais olharia por ela — este laço só vê as
    // CONECTADAS, e o "open" do webhook não vem se a sessão nunca mudou de
    // estado no servidor (o soluço que enganou a sonda). Só a marcada pelo
    // sistema (instância de pé; o Desconectar da loja a zera, RN-049), e só
    // com a sonda provando viva — a leitura "open" sozinha já mentiu uma vez.
    const marcadas = await db.commSettings.findMany({
      // DEPOIS do alarme da loja muda (que não pode ficar sem tempo), as mais
      // recentes primeiro, só da última semana e poucas por rodada, com teto
      // curto por leitura: a perdida de vez não come o tempo das outras
      where: {
        evolutionStatus: "DESCONECTADO",
        evolutionInstance: { not: null },
        evolutionDownSince: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000) },
      },
      orderBy: { evolutionDownSince: "desc" },
      select: { companyId: true, evolutionInstance: true, evolutionPhone: true },
      take: 30,
    });
    // RODÍZIO: duas por rodada, puladas as conferidas na última meia hora —
    // senão as mesmas mortas eram sondadas toda rodada e a que voltou, mais
    // antiga na lista, nunca era alcançada (achado da revisão)
    const agoraMs = now.getTime();
    const daVez = marcadas
      .filter((m) => agoraMs - (conferidaNaVolta.get(m.companyId) ?? 0) > 30 * 60_000)
      .slice(0, 2);
    for (const m of daVez) {
      conferidaNaVolta.set(m.companyId, agoraMs);
      const st = await evoState(m.evolutionInstance!, 8_000);
      if (!st.ok || st.data?.instance?.state !== "open") continue;
      // UMA sonda: aqui só "viva" muda alguma coisa, e repetir a morta comia
      // o tempo da rodada (a função do vigia tem 60 s)
      if (
        (await veredictoDoOpen(m.evolutionInstance, st.data?.instance?.ownerJid, m.evolutionPhone, {
          tentativas: 1,
        })) !== "viva"
      )
        continue;
      const voltou = await db.commSettings.updateMany({
        where: { companyId: m.companyId, evolutionStatus: "DESCONECTADO" },
        // RN-106: o envio sem eco de antes da queda não vale para a sessão de agora
        data: { evolutionStatus: "CONECTADO", evolutionDownSince: null, evolutionAlertAt: null, envioSemEcoDesde: null },
      });
      if (voltou.count > 0) {
        // a tela de conexão troca para o simulado quando lê "fechada" de
        // verdade; voltando, os envios têm que sair pelo WhatsApp outra vez
        await db.commSettings.updateMany({
          where: { companyId: m.companyId, activeProvider: "MOCK" },
          data: { activeProvider: "EVOLUTION" },
        });
        await db.commEvent
          .create({
            data: {
              companyId: m.companyId,
              channel: "WHATSAPP",
              direction: "IN",
              type: "wa.conexao.voltou",
              status: "OK",
              payload: JSON.stringify({ instance: m.evolutionInstance }),
            },
          })
          .catch(() => {});
      }
    }
    // 5) RN-106 · A REDE DE SEGURANÇA: a loja marcada desconectada que ainda
    // não recebeu alarme (a cura terminou em "reconectando", ou o reinício e
    // a tela a marcaram sem alarme porque a pessoa estava olhando) e não
    // voltou em 10 min ganha o alarme de sempre — nunca fica calada. Sem
    // rede (o alarme tem o seu anti-spam de 6 h).
    // "Sem alarme" = nenhum alarme DESDE esta queda: o carimbo velho de uma
    // queda anterior não cobre a de agora (o caminho que religa sem limpar o
    // carimbo deixava a loja fora da rede para sempre, achado da revisão).
    // As que já estavam assim no dia da entrega ganharam o carimbo na
    // migração — ponto de partida, sem enxurrada (a lição da RN-100).
    // "Caída" = DESCONECTADA ou "aguardando QR" com a marca da queda: o
    // WhatsApp, religando sozinho, passa por "connecting", que grava
    // "aguardando QR" — fora daqui, a sessão presa religando nunca alarmava
    // (achado da revisão). Quem está no anti-spam de 6 h do alarme fica de
    // fora (só tomaria vaga das outras), e as mais recentes vêm primeiro.
    const reavisoCorte = new Date(now.getTime() - STORE_ALERT_COOLDOWN_MS);
    const semAlarme = await db.$queryRaw<{ companyId: string; reinicioPedidoEm: Date | null }[]>`
      SELECT "companyId", "reinicioPedidoEm" FROM "CommSettings"
      WHERE "evolutionStatus" IN ('DESCONECTADO', 'AGUARDANDO_QR')
        AND "evolutionInstance" IS NOT NULL
        AND "evolutionDownSince" < ${new Date(now.getTime() - MIN_REDE_DE_SEGURANCA * 60_000)}
        AND "evolutionDownSince" >= ${new Date(now.getTime() - 7 * 24 * 60 * 60_000)}
        AND ("evolutionAlertAt" IS NULL
          OR ("evolutionAlertAt" < "evolutionDownSince" AND "evolutionAlertAt" < ${reavisoCorte}))
      ORDER BY "evolutionDownSince" DESC
      LIMIT 20`;
    // loja suspensa não ganha alarme (o webhook dela nem ingere)
    const suspensas = await suspensasEntre(semAlarme.map((m) => m.companyId));
    for (const m of semAlarme) {
      if (suspensas.has(m.companyId)) continue;
      if (reinicioEmCurso(m.reinicioPedidoEm, now)) continue;
      await alertWhatsappDown(m.companyId).catch(() => {});
    }
    // 6) RN-106 · A CURA AUTOMÁTICA, no FIM: os alarmes acima já saíram.
    // Uma por rodada, só com tempo sobrando e só onde a rodada pode curar.
    // Candidatas: a loja que CAIU há 3 min ou mais e segue fora, sem alarme
    // desde a queda (a mais recente primeiro), e o eco calado.
    const candidatas: { companyId: string; motivo: MotivoDaCura; desde: Date | null; agora?: boolean }[] =
      quedasAgora.map((companyId) => ({ companyId, motivo: "queda" as const, desde: null, agora: true }));
    if (podeCurarNaRodada) {
      const caidas = await db.$queryRaw<{ companyId: string; autoCuraEm: Date | null; reinicioPedidoEm: Date | null }[]>`
        SELECT "companyId", "autoCuraEm", "reinicioPedidoEm" FROM "CommSettings"
        -- só a DESCONECTADA: "aguardando QR" pode ser alguém lendo o QR
        -- agora, e reiniciar a instância invalidaria o código na mão dela
        -- (essa fica com a rede de segurança)
        WHERE "evolutionStatus" = 'DESCONECTADO'
          AND "evolutionInstance" IS NOT NULL
          AND "evolutionWebhookToken" IS NOT NULL
          AND "evolutionDownSince" <= ${new Date(now.getTime() - MIN_ANTES_DA_CURA_DA_QUEDA * 60_000)}
          AND "evolutionDownSince" >= ${new Date(now.getTime() - 7 * 24 * 60 * 60_000)}
          AND ("evolutionAlertAt" IS NULL OR "evolutionAlertAt" < "evolutionDownSince")
        ORDER BY "evolutionDownSince" DESC
        LIMIT 10`;
      const suspensasCaidas = await suspensasEntre(caidas.map((c) => c.companyId));
      for (const c of caidas) {
        if (suspensasCaidas.has(c.companyId)) continue;
        if (reinicioEmCurso(c.reinicioPedidoEm, now)) continue;
        if (!podeCurar(c.autoCuraEm, now)) continue; // a rede de segurança alarma
        candidatas.push({ companyId: c.companyId, motivo: "queda", desde: null });
      }
    }
    for (const e of ecoParaCurar) candidatas.push({ companyId: e.companyId, motivo: "webhook-calado", desde: e.desde });
    let curou = false;
    for (const c of candidatas) {
      const comTempo =
        podeCurarNaRodada && !curou && Date.now() - inicioDaRodada < MS_ORCAMENTO_ANTES_DA_CURA;
      const cura = comTempo
        ? await tentarCuraAutomatica(c.companyId, c.motivo, now)
        : ({ feita: false, motivo: "sem-vez" } as const);
      if (cura.feita) {
        curou = true;
        if (cura.desfecho === "voltou") await avisarCuraAutomatica(c.companyId, c.motivo);
        else if (cura.desfecho === "falhou") {
          // a conexão que o reinício deixou fechada (ou morta pela sonda) é
          // queda: o alarme de sempre, que manda ler o QR; aberta e o eco
          // ainda sem prova, o do eco calado (a prova não foi apagada)
          const caiu = cura.reinicio?.estado === "close" || cura.reinicio?.sonda === "morta";
          if (c.motivo === "queda" || caiu || !c.desde) await alertWhatsappDown(c.companyId);
          else await alertarWebhookCalado(c.companyId, c.desde, now, true);
        }
        // "reconectando": a rede de segurança alarma se não abrir em 10 min
        continue;
      }
      // sem cura nesta rodada: a queda vista AGORA alarma agora (salvo a que
      // reabriu ou está religando — a rede de segurança a vigia); a de antes
      // fica com a rede de segurança (10 min); o eco calado há muito alarma
      // mesmo sem cura — a cura é ganho, nunca motivo para o alarme não sair
      if (c.motivo === "queda" && c.agora && cura.motivo !== "sem-necessidade") await alertWhatsappDown(c.companyId);
      if (c.motivo === "webhook-calado" && c.desde && minutosSemEco(c.desde, now) >= MINUTOS_SEM_CURA_ALARMA)
        await alertarWebhookCalado(c.companyId, c.desde, now, false);
    }
  } catch (e) {
    await logServerError({
      source: "watchdog",
      message: "Falha interna do vigia",
      detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
    }).catch(() => {});
  }
}
