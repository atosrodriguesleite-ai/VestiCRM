import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registrarPrimeiraConexao } from "@/lib/comm/primeira-conexao";
import { marcarSessaoMorta, veredictoDoOpen } from "@/lib/comm/sessao-viva";
import { reinicioEmCurso } from "@/lib/comm/conexao-fechada";
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
    // RN-105: o servidor diz "open", mas a sonda bateu na conexão fechada
    let sessaoCaida = false;
    if (settings?.evolutionInstance && evolutionEnv().configured) {
      const [st, versao] = await Promise.all([evoState(settings.evolutionInstance), evoVersao()]);
      servidorVersao = versao;
      const state = st.data?.instance?.state;
      if (state === "open") {
        status = "CONECTADO";
        phone = jidToPhone(st.data?.instance?.ownerJid ?? "") ?? phone;
        // "open" na leitura não é prova (RN-105): o servidor guarda o estado
        // na memória e o mantém "open" com a conexão com o celular morta.
        //  - recém-pareada (vinha do QR): a sessão ainda sincroniza, e um
        //    soluço ali tocaria "WhatsApp caiu" segundos depois de conectar —
        //    vale o "open" (o webhook também o grava);
        //  - durante um reinício pedido, ou sem prova (sem-resposta): a loja
        //    que o SISTEMA tinha marcado desconectada CONTINUA desconectada —
        //    ler "open" e gravar conectada desfazia o veredito do reinício na
        //    própria recarga da tela (achado da revisão); quem a devolve é a
        //    sonda viva (aqui ou no vigia) ou o "open" do webhook;
        //  - morta: marca, avisa e mostra o botão do QR Code.
        const recemPareada = settings.evolutionStatus === "AGUARDANDO_QR";
        const marcadaPeloSistema =
          settings.evolutionStatus === "DESCONECTADO" && settings.evolutionDownSince != null;
        const sonda = recemPareada
          ? "viva"
          : reinicioEmCurso(settings.reinicioPedidoEm)
            ? "sem-resposta"
            : await veredictoDoOpen(settings.evolutionInstance, st.data?.instance?.ownerJid, phone);
        if (sonda === "morta") {
          status = "DESCONECTADO";
          sessaoCaida = true;
          // a mesma escrita das outras portas: "desde quando", registro e o
          // aviso de queda (sem ele, marcada aqui, a queda ficava calada para
          // sempre — o envio só confere loja CONECTADA)
          await marcarSessaoMorta(user.companyId, {
            instance: settings.evolutionInstance,
            origem: "tela",
            alarme: true,
          });
        } else if (sonda === "sem-resposta" && marcadaPeloSistema) {
          status = "DESCONECTADO";
          sessaoCaida = true;
        } else if (sonda === "viva" && marcadaPeloSistema) {
          // provada viva: volta inteira, sem o "desde quando" da queda
          await db.commSettings.updateMany({
            where: { companyId: user.companyId, evolutionStatus: "DESCONECTADO" },
            data: { evolutionDownSince: null, evolutionAlertAt: null },
          });
        }
      }
      if (state === "open" && !sessaoCaida) {
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
      // auto-correção: conectado de verdade ⇒ provedor ativo é o Evolution.
      // A sessão caída por trás de um "open" NÃO troca o provedor: trocar
      // para o simulado faria os envios "darem certo" sem sair (RN-105)
      const provider =
        status === "CONECTADO"
          ? "EVOLUTION"
          : settings.activeProvider === "EVOLUTION" && status === "DESCONECTADO" && !sessaoCaida
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
      sessaoCaida,
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
