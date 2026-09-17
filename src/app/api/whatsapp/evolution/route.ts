import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registrarPrimeiraConexao } from "@/lib/comm/primeira-conexao";
import { garantirEventosDoWebhook, motivoDaUltimaFalha } from "@/lib/comm/garantir-webhook";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import {
  evolutionEnv,
  evoState,
  evoVersao,
  jidToPhone,
  TERMO_WA_TEXTO,
  TERMO_WA_VERSAO,
  WA_JANELA_HORAS,
  WA_GAP_MIN_SEG,
  WA_GAP_MAX_SEG,
} from "@/lib/comm/evolution";

/** Estado da conexão do WhatsApp sem API oficial (para a tela Comunicação). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const [settings, consent] = await Promise.all([
      db.commSettings.findUnique({ where: { companyId: user.companyId } }),
      db.whatsappConsent.findFirst({
        where: { companyId: user.companyId, termVersion: TERMO_WA_VERSAO },
        orderBy: { acceptedAt: "desc" },
      }),
    ]);

    // com instância criada, confere o estado real no servidor e sincroniza
    let status = settings?.evolutionStatus ?? "DESCONECTADO";
    let phone = settings?.evolutionPhone ?? null;
    // a tela de conexão DIZ se o servidor aceitou a lista atual de eventos
    // (edição/apagar de mensagem dependem disso) e qual versão está instalada
    let eventos: { emDia: boolean; erro: string | null } | null = null;
    let servidorVersao: string | null = null;
    if (settings?.evolutionInstance && evolutionEnv().configured) {
      const [st, versao] = await Promise.all([evoState(settings.evolutionInstance), evoVersao()]);
      servidorVersao = versao;
      const state = st.data?.instance?.state;
      if (state === "open") {
        status = "CONECTADO";
        phone = jidToPhone(st.data?.instance?.ownerJid ?? "") ?? phone;
        // auto-cura: garante que a instância escuta todos os eventos atuais
        // (ex.: "cliente apagou", "editou") mesmo tendo sido criada antes —
        // best-effort, SEMPRE (a tela de conexão é o lugar de conferir de
        // verdade), e carimba a lista confirmada
        const assinatura = await garantirEventosDoWebhook(settings, { sempre: true }).catch(
          () => "falhou" as const
        );
        eventos = {
          emDia: assinatura === "reassinada" || assinatura === "em-dia",
          erro: assinatura === "falhou" ? motivoDaUltimaFalha(settings.evolutionInstance) : null,
        };
      } else if (state === "connecting") status = "AGUARDANDO_QR";
      else if (state === "close") status = "DESCONECTADO";
      // auto-correção: conectado de verdade ⇒ provedor ativo é o Evolution
      const provider =
        status === "CONECTADO"
          ? "EVOLUTION"
          : settings.activeProvider === "EVOLUTION" && status === "DESCONECTADO"
            ? "MOCK"
            : settings.activeProvider;
      if (
        status !== settings.evolutionStatus ||
        phone !== settings.evolutionPhone ||
        provider !== settings.activeProvider
      ) {
        await db.commSettings.update({
          where: { companyId: user.companyId },
          data: { evolutionStatus: status, evolutionPhone: phone, activeProvider: provider },
        });
      }
      // a loja passou a TER WhatsApp: fica carimbado para sempre (RN-049)
      if (status === "CONECTADO") await registrarPrimeiraConexao(user.companyId);
    }

    const hoje = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      serverConfigured: evolutionEnv().configured,
      consent: consent
        ? { userName: consent.userName, acceptedAt: consent.acceptedAt }
        : null,
      termo: consent ? null : { texto: TERMO_WA_TEXTO, versao: TERMO_WA_VERSAO },
      status,
      phone,
      eventos,
      servidorVersao,
      activeProvider: settings?.activeProvider ?? "MOCK",
      limites: {
        janelaHoras: WA_JANELA_HORAS,
        ritmoMinSeg: WA_GAP_MIN_SEG,
        ritmoMaxSeg: WA_GAP_MAX_SEG,
        enviadosHoje: settings?.waSentDate === hoje ? settings.waSentToday : 0,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
