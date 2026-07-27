import { db } from "./db";
import { evolutionEnv, evoState } from "./comm/evolution";
import { sendToCompany } from "./push";

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
  source: "server" | "watchdog" | "client";
  path?: string | null;
  message: string;
  detail?: string | null;
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
async function bellForAdmins(companyId: string, title: string, body: string) {
  const admins = await db.user.findMany({
    where: { companyId, active: true, role: { in: ["ADMIN", "MANAGER", "SUPERADMIN"] } },
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

  // O DONO DA PLATAFORMA também precisa saber. WhatsApp caído é atendimento
  // parado na loja do cliente: ele vai parar de usar o sistema, e loja que
  // para de usar é loja que cancela. Avisar na hora é o que dá tempo de
  // ligar antes — em vez de descobrir na renovação.
  try {
    const platform = await platformCompanyId();
    if (platform && platform !== companyId) {
      const loja = await db.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      });
      const nome = loja?.name ?? "Uma loja";
      const tituloPlataforma = `⚠️ WhatsApp caiu: ${nome}`;
      const corpoPlataforma = `A conexão de WhatsApp da ${nome} caiu. A loja já foi avisada para reconectar pelo QR Code.`;
      await bellForAdmins(platform, tituloPlataforma, corpoPlataforma);
      await sendToCompany(platform, {
        title: tituloPlataforma,
        body: corpoPlataforma,
        url: "/gestao",
        // tag por loja: duas lojas caídas geram dois avisos, não um só
        tag: `wa-down-${companyId}`,
      });
    }
  } catch {
    // avisar a plataforma é um extra: nunca pode atrapalhar o aviso à loja
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
      select: { companyId: true, evolutionInstance: true },
    });
    for (const s of stores) {
      const st = await evoState(s.evolutionInstance!);
      if (st.status === 0) continue; // rede oscilou — não conclui nada
      const state = st.data?.instance?.state;
      if (st.ok && state === "open") {
        // conectada — limpa marca de queda, se havia
        await db.commSettings.updateMany({
          where: { companyId: s.companyId, evolutionDownSince: { not: null } },
          data: { evolutionDownSince: null, evolutionAlertAt: null },
        });
        continue;
      }
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
  } catch (e) {
    await logServerError({
      source: "watchdog",
      message: "Falha interna do vigia",
      detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
    }).catch(() => {});
  }
}
