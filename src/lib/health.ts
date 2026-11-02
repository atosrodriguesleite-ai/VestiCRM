import { db } from "./db";
import { evolutionEnv, evoState } from "./comm/evolution";
import { garantirEventosDoWebhook } from "./comm/garantir-webhook";
import { reinicioEmCurso } from "./comm/reiniciar-conexao";
import { sendToCompany, sendToUser } from "./push";
import {
  deveAvisarSilencio,
  fraseDaLojaMuda,
  horasDesde,
  silencioLabel,
  HORAS_REAVISO_SILENCIO,
} from "./health-wa";
import { lerHorarioComercial, type HorarioComercial } from "./bi/horario-comercial";

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
 * Roda o vigia SE já passou o intervalo (senão retorna na hora, custo de uma
 * consulta). Seguro para chamar de qualquer rota: nunca lança.
 */
export async function runWatchdogIfDue(): Promise<void> {
  try {
    const now = new Date();
    await db.systemHealth
      .createMany({ data: [{ id: "main" }], skipDuplicates: true })
      .catch(() => {});
    // trava atômica: só uma requisição por intervalo executa a rodada
    const claimed = await db.systemHealth.updateMany({
      where: {
        id: "main",
        OR: [
          { watchdogRunAt: null },
          { watchdogRunAt: { lt: new Date(now.getTime() - WATCHDOG_INTERVAL_MS) } },
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
      },
    });
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
      await alertWhatsappDown(s.companyId);
    }
    // 3) conectada, mas MUDA (RN-105): a conexão de pé e nada entrando é a
    // falha mais perigosa — a loja acha que está tudo bem
    await avisarLojasMudas(conectadas, now);
  } catch (e) {
    await logServerError({
      source: "watchdog",
      message: "Falha interna do vigia",
      detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
    }).catch(() => {});
  }
}
