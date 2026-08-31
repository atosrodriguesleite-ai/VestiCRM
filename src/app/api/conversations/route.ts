import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { buscarConversas, loadInboxConversations } from "@/lib/inbox-data";
import { runWatchdogIfDue } from "@/lib/health";
import { atualizarRastreiosSeDevido } from "@/lib/rastreio";
import { varrerCarrinhosSeDeuAHora } from "@/lib/recuperacao";
import { sincronizarFotosSeDevido } from "@/lib/comm/fotos";
import { repescarMidiasPendentes } from "@/lib/comm/midia-pendente";
import { runAutomationsIfDue } from "@/lib/automations-run";

/**
 * Sync incremental da inbox: a tela consulta a cada poucos segundos com
 * `?since=<ISO>` e recebe SÓ as conversas alteradas desde então (mensagem
 * nova, recibo ✓✓, transferência, status...). `now` volta para ancorar a
 * próxima consulta no relógio do servidor (imune a relógio errado no cliente).
 */
/**
 * A rota mais movimentada do app é também a que dá CARONA para o trabalho
 * periódico (vigia, rastreio, fotos, automações e a repesca de arquivos da
 * RN-028). Tudo isso roda DEPOIS da resposta (`after`) — a inbox nunca
 * espera —, mas ainda dentro da vida da função: sem um teto declarado, uma
 * rodada de repesca podia ser cortada no meio e perder o minuto inteiro
 * (a trava é tomada antes do trabalho). Achado da revisão de 31/08/2026.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // vigia do sistema pega carona aqui (rota mais movimentada do app), mas
    // DEPOIS da resposta (after): a checagem externa (até 5s) não segura
    // mais o sync — a inbox responde na hora, sempre
    after(() => runWatchdogIfDue());
    // recuperação de carrinhos: mesma carona (sem cron novo — Vercel Hobby)
    after(() => varrerCarrinhosSeDeuAHora());
    // rastreio dos envios: postado → Enviado, chegou → Entregue. Mesma
    // carona, mesma trava global (uma rodada a cada 20 min, no máximo)
    after(() => atualizarRastreiosSeDevido());
    // fotos das clientes: pega carona aqui, DEPOIS da resposta, e com freio
    // (uma varredura a cada 30 min por loja). A tela nunca espera por foto.
    after(() => sincronizarFotosSeDevido(user.companyId));
    // ARQUIVO QUE NÃO CHEGOU (RN-028): a fila é varrida aqui, na rota mais
    // movimentada do app, no máximo uma vez por minuto no sistema inteiro.
    // Sem cron novo — um 3º cron bloqueia TODOS os deploys (ADR-002).
    after(() => repescarMidiasPendentes());
    // AUTOMAÇÕES COMERCIAIS também pegam carona (uma rodada por dia por loja,
    // travada no banco). É o que faz o motor rodar sozinho SEM gastar uma das
    // 2 vagas de cron da Vercel — que já estão ocupadas, e um 3º cron bloqueia
    // todos os deploys.
    after(() => runAutomationsIfDue(user.companyId));
    // BUSCA: varre a loja INTEIRA, não só o que coube na carga inicial.
    //
    // A tela abre com as 200 conversas mais recentes. Sem esta porta, quem
    // procurasse uma cliente mais antiga não achava NADA — a lupa parecia
    // quebrada de novo, e a conversa existia o tempo todo.
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q) {
      const achadas = await buscarConversas(user, q);
      return NextResponse.json({ conversations: achadas, busca: true });
    }

    const sinceRaw = req.nextUrl.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : undefined;

    // ÂNCORA ANTES DA CONSULTA — e não depois.
    //
    // Com `now` marcado depois, uma mensagem gravada DURANTE a consulta caía
    // num vão: não entrava neste resultado (a consulta já tinha lido o banco)
    // e ficava para trás do `since` da próxima busca. A bolha só aparecia
    // quando algo mexesse na conversa de novo — ou seja, mensagem sumindo do
    // chat sem motivo aparente.
    //
    // Marcando antes, a próxima busca REPETE essa fatia de tempo. Repetir é
    // inofensivo (a tela recebe a conversa inteira e substitui); perder não.
    const agora = new Date().toISOString();
    const conversations = await loadInboxConversations(
      user,
      since && !isNaN(since.getTime()) ? since : undefined
    );
    return NextResponse.json({ now: agora, conversations });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const abrirSchema = z.object({ customerId: z.string().min(1) });

/**
 * ABRIR CONVERSA COM UMA CLIENTE — pelo sistema, não pelo celular.
 *
 * É o caminho que faltava: a lojista achava a cliente no cadastro, mandava
 * mensagem pelo aplicativo do WhatsApp e a conversa aparecia aqui como se
 * fosse gente na fila esperando atendimento. Agora ela começa a conversa
 * DENTRO da Central: o atendimento já nasce no nome de quem abriu, cada
 * mensagem fica com o nome de quem escreveu e nada cai na fila.
 *
 * Não cria conversa repetida: se já existe uma aberta, devolve ela; se só
 * existe encerrada, reabre a mais recente (o histórico é sagrado).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = abrirSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Cliente não informado" }, { status: 400 });
    }
    const customer = await db.customer.findFirst({
      where: { id: parsed.data.customerId, companyId: user.companyId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Cliente não encontrada" }, { status: 404 });
    }

    const aberta = await db.conversation.findFirst({
      where: { companyId: user.companyId, customerId: customer.id, status: { not: "CLOSED" } },
      orderBy: { lastMessageAt: "desc" },
    });
    if (aberta) {
      // sem dona ainda? quem abriu assume — ninguém fica esperando na fila
      if (!aberta.assigneeId) {
        await db.conversation.update({
          where: { id: aberta.id },
          data: { assigneeId: user.id },
        });
      }
      return NextResponse.json({ id: aberta.id });
    }

    const encerrada = await db.conversation.findFirst({
      where: { companyId: user.companyId, customerId: customer.id, status: "CLOSED" },
      orderBy: { lastMessageAt: "desc" },
    });
    if (encerrada) {
      await db.conversation.update({
        where: { id: encerrada.id },
        data: { status: "OPEN", assigneeId: encerrada.assigneeId ?? user.id },
      });
      return NextResponse.json({ id: encerrada.id });
    }

    const nova = await db.conversation.create({
      data: {
        companyId: user.companyId,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: "OPEN",
        assigneeId: user.id,
      },
    });
    return NextResponse.json({ id: nova.id }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
