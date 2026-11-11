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
  evoConnect,
  evoState,
  evoVersao,
  jidToPhone,
  TERMO_WA_TEXTO,
  TERMO_WA_VERSAO,
  WA_JANELA_HORAS,
  WA_GAP_MIN_SEG,
  WA_GAP_MAX_SEG,
} from "@/lib/comm/evolution";

/** Teto da busca do QR Code de agora: é consulta de tela, a cada poucos segundos. */
const MS_BUSCA_DO_QR = 8_000;

/**
 * Estado da conexão do WhatsApp sem API oficial (para a tela Comunicação).
 * Com `?qr=1` (a tela, enquanto o QR está nela) devolve também o QR Code de
 * AGORA — o WhatsApp troca o código a cada ~20 s (RN-110).
 */
export async function GET(req: Request) {
  try {
    const querQr = new URL(req.url).searchParams.get("qr") === "1";
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
    // RN-110: o QR Code de agora, só para a tela que está esperando a leitura
    let qr: string | null = null;
    if (settings?.evolutionInstance && evolutionEnv().configured) {
      const [st, versao] = await Promise.all([evoState(settings.evolutionInstance), evoVersao()]);
      servidorVersao = versao;
      const state = st.data?.instance?.state;
      if (state === "open") {
        status = "CONECTADO";
        phone = jidToPhone(st.data?.instance?.ownerJid ?? "") ?? phone;
        // "open" na leitura não é prova (RN-105): o servidor guarda o estado
        // na memória e o mantém "open" com a conexão com o celular morta.
        //  - vinda do "aguardando QR": pode ser a sessão recém-pareada que
        //    ainda sincroniza OU o servidor tentando religar uma sessão que
        //    está morrendo (o webhook grava "aguardando" em todo
        //    "connecting") — a sonda roda com calma (três tentativas) e, se
        //    morta, marca SEM alarme (a pessoa está na tela), em vez de pular
        //    a sonda e gravar um "Conectado" falso (achado da revisão);
        //  - durante um reinício pedido, ou sem prova (sem-resposta): a loja
        //    que o SISTEMA tinha marcado desconectada CONTINUA desconectada —
        //    ler "open" e gravar conectada desfazia o veredito do reinício na
        //    própria recarga da tela (achado da revisão) —, mas SEM o aviso de
        //    "caiu", que sem prova seria afirmação; quem a devolve é a sonda
        //    viva (aqui ou no vigia) ou o "open" do webhook;
        //  - morta: marca, avisa (a plataforma também precisa saber — o envio
        //    só confere loja CONECTADA, então marcada aqui sem aviso a queda
        //    ficava calada) e mostra o botão do QR Code.
        const vindaDoQr = settings.evolutionStatus === "AGUARDANDO_QR";
        const marcadaPeloSistema =
          settings.evolutionStatus === "DESCONECTADO" && settings.evolutionDownSince != null;
        const sonda = reinicioEmCurso(settings.reinicioPedidoEm)
          ? "sem-resposta"
          : await veredictoDoOpen(
              settings.evolutionInstance,
              st.data?.instance?.ownerJid,
              phone,
              vindaDoQr ? { tentativas: 3, esperaMs: 3000 } : {}
            );
        if (sonda === "morta") {
          status = "DESCONECTADO";
          sessaoCaida = true;
          await marcarSessaoMorta(user.companyId, {
            instance: settings.evolutionInstance,
            origem: "tela",
            alarme: !vindaDoQr,
          });
        } else if (sonda === "sem-resposta" && marcadaPeloSistema) {
          status = "DESCONECTADO";
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
      } else if (state === "connecting") {
        status = "AGUARDANDO_QR";
        // RN-110: SÓ com o servidor esperando a leitura ("connecting") — ali a
        // chamada devolve o código que ele já tem, sem iniciar nada (conferido
        // no código do Evolution). Com a conexão fechada ela ABRIRIA uma
        // tentativa nova: a tela aberta e esquecida manteria um pareamento
        // vivo para sempre. Quem abre tentativa é o clique em Conectar.
        if (querQr) {
          const r = await evoConnect(settings.evolutionInstance, MS_BUSCA_DO_QR).catch(() => null);
          if (r?.ok && typeof r.data?.base64 === "string" && r.data.base64) qr = r.data.base64;
        }
      } else if (state === "close") status = "DESCONECTADO";
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
      qr,
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
