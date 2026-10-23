import { db } from "../db";
import { dataDoDia, diaSP } from "../dia";
import { sendToUser } from "../push";
import { logServerError } from "../health";
import { DATA_DO_SISTEMA_POR_CHAVE, diaDaData, paraAvisar, textoDoLembrete } from "./datas";
import { carregarCalendario, janelaDoLembrete } from "./dados";

/**
 * O LEMBRETE "É HORA DE COMEÇAR" (RN-092).
 *
 * Quando chega o dia de começar (data − antecedência), a gerência recebe no
 * sino e no celular — UMA vez por data (carimbo `avisadoEm`), em RESUMO por
 * rodada ("3 datas chegando"), a régua do alerta de estoque (RN-051) para
 * não virar barulho. Roda DE CARONA (sync da inbox e abertura do
 * Calendário) com trava atômica por loja (`Company.calendarioAvisoRunAt`, a
 * cada 6 h) — nunca um 3º cron (ADR-002) — e SÓ com o módulo ligado (a
 * chave entra na própria trava, `ondeTomarATrava`).
 *
 * Três réguas da revisão: (1) rodada que FALHA mantém a trava — devolvê-la
 * fazia o sync de 3 s repetir a rodada inteira e encher a Saúde de erro (a
 * lição da RN-082); tenta de novo na janela seguinte; (2) o freio em memória
 * é curto (10 min) e a ABERTURA da tela não passa por ele — ligar a chave e
 * abrir o Calendário tem que avisar na hora, não daqui a 6 h; (3) sem
 * gerência ativa a data NÃO é carimbada: carimbar sem ninguém receber
 * calava o aviso para sempre.
 */
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const FREIO_EM_MEMORIA_MS = 10 * 60 * 1000;
const ultimaTentativa = new Map<string, number>();

/** A condição da trava: loja com a chave E sem rodada nas últimas 6 h. */
export function ondeTomarATrava(companyId: string, agora: Date) {
  return {
    id: companyId,
    calendarioEnabled: true,
    OR: [
      { calendarioAvisoRunAt: null },
      { calendarioAvisoRunAt: { lt: new Date(agora.getTime() - INTERVALO_MS) } },
    ],
  };
}

export async function avisarCalendarioSeDevido(
  companyId: string,
  opcoes: { aoAbrirATela?: boolean } = {}
): Promise<void> {
  const ms = Date.now();
  if (!opcoes.aoAbrirATela && ms - (ultimaTentativa.get(companyId) ?? 0) < FREIO_EM_MEMORIA_MS) return;
  ultimaTentativa.set(companyId, ms);
  try {
    const agora = new Date();
    const claimed = await db.company.updateMany({
      where: ondeTomarATrava(companyId, agora),
      data: { calendarioAvisoRunAt: agora },
    });
    if (claimed.count === 0) return;
    await avisarCalendario(companyId, diaSP(agora));
  } catch (e) {
    // a trava FICA (ver régua 1): a próxima janela tenta de novo
    await logServerError({
      source: "server",
      path: "/calendario/lembrete",
      message: `Calendário: lembrete falhou (loja ${companyId})`,
      detail: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
      alarme: false,
    }).catch(() => null);
  }
}

/** A rodada em si (sem trava — quem chama garante). Devolve quantas avisou. */
export async function avisarCalendario(companyId: string, hoje: string): Promise<number> {
  const { de, ate } = janelaDoLembrete(hoje);
  const { config, ocorrencias } = await carregarCalendario(companyId, de, ate);
  const avisar = paraAvisar(ocorrencias, config.antecedenciaDias, hoje);
  if (avisar.length === 0) return 0;

  const gerencia = await db.user.findMany({
    where: { companyId, role: { in: ["ADMIN", "MANAGER"] }, active: true },
    select: { id: true },
  });
  // ninguém para receber: não carimba (régua 3) — a data avisa quando houver
  if (gerencia.length === 0) return 0;
  const { title, body } = textoDoLembrete(avisar, hoje);
  const agora = new Date();

  // carimbo e aviso na MESMA transação (régua da RN-051: carimbar e o aviso
  // falhar deixava a data muda para sempre). A data do sistema sem anotação
  // ganha a linha agora — é ela que guarda o carimbo daquele ano.
  await db.$transaction(async (tx) => {
    for (const o of avisar) {
      if (o.eventoId) {
        await tx.calendarioEvento.updateMany({
          where: { id: o.eventoId, companyId, avisadoEm: null },
          data: { avisadoEm: agora },
        });
      } else if (o.chaveSistema) {
        const sis = DATA_DO_SISTEMA_POR_CHAVE.get(o.chaveSistema);
        if (!sis) continue;
        await tx.calendarioEvento.upsert({
          where: {
            companyId_chaveSistema_ano: { companyId, chaveSistema: o.chaveSistema, ano: o.ano },
          },
          create: {
            companyId,
            tipo: sis.tipo,
            titulo: sis.data.titulo,
            data: dataDoDia(diaDaData(sis.data, o.ano))!,
            chaveSistema: o.chaveSistema,
            ano: o.ano,
            avisadoEm: agora,
          },
          update: { avisadoEm: agora },
        });
      }
    }
    await tx.notification.createMany({
      data: gerencia.map((u) => ({ companyId, userId: u.id, type: "CALENDARIO", title, body })),
    });
  });
  await Promise.all(
    gerencia.map((u) =>
      sendToUser(u.id, { title, body, url: "/calendario", tag: "calendario" }).catch(() => null)
    )
  );
  return avisar.length;
}
