import { db } from "./db";
import { computeAutomations } from "./automations";
import type { SessionUser } from "./auth";

/**
 * AS AUTOMAÇÕES PASSAM A RODAR SOZINHAS.
 *
 * Até aqui o motor de `automations.ts` era excelente e inútil ao mesmo tempo:
 * ele só existia enquanto alguém abria a tela `/automacoes`. Ninguém abre. As
 * seis regras (follow-up, catálogo parado, recompra, reativação, primeiro
 * contato, pós-venda) nunca viravam ação.
 *
 * SEM CRON NOVO — e isso é obrigatório, não elegância: o plano Hobby da Vercel
 * aceita no máximo 2 crons e as duas vagas já estão ocupadas pelo jueri-sync.
 * Um terceiro cron bloqueia TODOS os deploys silenciosamente (já causou
 * incidente). Então usamos o mesmo padrão do vigia de saúde: a rodada pega
 * carona no tráfego normal, com uma trava atômica no banco garantindo no
 * máximo uma execução por dia por loja.
 *
 * O que a rodada faz:
 *  1. calcula as sugestões da loja inteira;
 *  2. cria as tarefas de prioridade ALTA (as que não podem esperar);
 *  3. manda UM aviso por pessoa, com a conta do dia — o empurrão que faltava.
 */

/** Uma rodada por dia por loja. */
const INTERVALO_MS = 20 * 60 * 60 * 1000;
/** Teto por rodada: automação que enche a tela de tarefa é automação que
 *  a lojista desliga na primeira semana. */
const MAX_TAREFAS = 15;

/** Fim do dia no fuso de São Paulo (o servidor roda em UTC). */
function fimDoDiaSP(): Date {
  const SP_OFFSET = 3 * 60 * 60 * 1000;
  const sp = new Date(Date.now() - SP_OFFSET);
  sp.setUTCHours(23, 59, 0, 0);
  return new Date(sp.getTime() + SP_OFFSET);
}

/** Usuário "de serviço": enxerga a loja inteira, sem sessão de verdade. */
function usuarioDaLoja(companyId: string, userId: string): SessionUser {
  return {
    id: userId,
    companyId,
    role: "ADMIN",
    name: "Automações",
    email: "",
  } as unknown as SessionUser;
}

/**
 * Roda as automações da loja SE já passou o intervalo. Seguro para chamar de
 * qualquer rota: retorna na hora quando não é o momento e nunca lança.
 */
export async function runAutomationsIfDue(companyId: string): Promise<void> {
  try {
    const agora = new Date();
    // TRAVA ATÔMICA: só uma requisição por dia executa a rodada. Duas
    // chegando juntas — o `updateMany` condicional garante que só uma leva.
    const pegou = await db.company.updateMany({
      where: {
        id: companyId,
        suspended: false,
        OR: [
          { automationsRunAt: null },
          { automationsRunAt: { lt: new Date(agora.getTime() - INTERVALO_MS) } },
        ],
      },
      data: { automationsRunAt: agora },
    });
    if (pegou.count === 0) return;

    // alguém para figurar como autor das tarefas (a loja precisa ter dono)
    const dono = await db.user.findFirst({
      where: { companyId, active: true, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true },
    });
    if (!dono) return;

    const sugestoes = await computeAutomations(usuarioDaLoja(companyId, dono.id));
    if (sugestoes.length === 0) return;

    // 1) vira tarefa o que é URGENTE. O resto continua na tela do dia, à
    //    disposição — sem transformar a lista de tarefas em depósito.
    const urgentes = sugestoes.filter((s) => s.priority === "ALTA").slice(0, MAX_TAREFAS);
    for (const s of urgentes) {
      const cliente = await db.customer.findFirst({
        where: { id: s.customerId, companyId },
        select: { ownerId: true },
      });
      await db.task
        .create({
          data: {
            companyId,
            title: s.title,
            type: s.taskType,
            priority: s.priority,
            // vence no fim do dia (fuso de São Paulo): tarefa do dia é para
            // hoje, não para "agora" — senão nasce atrasada na mesma hora
            dueAt: fimDoDiaSP(),
            customerId: s.customerId,
            opportunityId: s.opportunityId,
            // cai para a DONA da cliente; sem dona, para quem administra
            assigneeId: cliente?.ownerId ?? dono.id,
            autoRule: s.key,
          },
        })
        // `autoRule` é a chave idempotente: se já existe, não duplica
        .catch(() => {});
    }

    // 2) UM aviso por pessoa, com a conta do dia. Sem isso a lojista não
    //    descobre que existe trabalho esperando por ela.
    const porDono = new Map<string, number>();
    const clientes = await db.customer.findMany({
      where: { companyId, id: { in: sugestoes.map((s) => s.customerId) } },
      select: { id: true, ownerId: true },
    });
    const donoDoCliente = new Map(clientes.map((c) => [c.id, c.ownerId]));
    for (const s of sugestoes) {
      const uid = donoDoCliente.get(s.customerId) ?? dono.id;
      porDono.set(uid, (porDono.get(uid) ?? 0) + 1);
    }

    for (const [userId, quantas] of porDono) {
      await db.notification
        .create({
          data: {
            companyId,
            userId,
            type: "AGENDA",
            title:
              quantas === 1
                ? "Você tem 1 cliente para chamar hoje"
                : `Você tem ${quantas} clientes para chamar hoje`,
            body: "Aniversário, recompra atrasada e conversa parada. Abra o painel para ver a lista.",
          },
        })
        .catch(() => {});
    }
  } catch {
    // automação NUNCA pode derrubar a requisição que a carregou
  }
}
