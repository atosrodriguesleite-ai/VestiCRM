import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { garantirEventosDoWebhook } from "@/lib/comm/garantir-webhook";
import { veredictoDoOpen } from "@/lib/comm/sessao-viva";
import {
  evolutionEnv,
  evoCreateInstance,
  evoConnect,
  evoLogout,
  evoState,
  jidToPhone,
  TERMO_WA_VERSAO,
} from "@/lib/comm/evolution";

/**
 * Inicia a conexão do WhatsApp sem API oficial: garante a instância da loja
 * no servidor Evolution (webhook já apontado pra cá) e devolve o QR Code.
 * Pré-requisito inegociável: termo aceito e registrado.
 */
// a recriação da sessão morta encadeia várias chamadas ao servidor: cada uma
// ganha teto curto (`TETO_DA_RECRIACAO_MS`) e a rota, folga para o pior caso
export const maxDuration = 300;
const TETO_DA_RECRIACAO_MS = 15_000;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // "recriar" vem da tela quando a pessoa confirmou derrubar uma sessão que o
    // servidor diz "conectada" mas que a sonda não conseguiu provar viva
    const corpo = (await req.json().catch(() => null)) as { recriar?: unknown } | null;
    const recriar = corpo?.recriar === true;
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (!evolutionEnv().configured) {
      return NextResponse.json(
        { error: "O servidor de conexão ainda não foi configurado pela plataforma." },
        { status: 503 }
      );
    }
    const consent = await db.whatsappConsent.findFirst({
      where: { companyId: user.companyId, termVersion: TERMO_WA_VERSAO },
    });
    if (!consent) {
      return NextResponse.json(
        { error: "Aceite o termo de uso antes de conectar." },
        { status: 403 }
      );
    }

    let settings = await db.commSettings.upsert({
      where: { companyId: user.companyId },
      update: {},
      create: { companyId: user.companyId },
    });

    if (!settings.evolutionInstance || !settings.evolutionWebhookToken) {
      const instance = `ap_${user.companyId.slice(-8)}_${crypto.randomBytes(3).toString("hex")}`;
      const token = crypto.randomBytes(24).toString("hex");
      settings = await db.commSettings.update({
        where: { companyId: user.companyId },
        data: { evolutionInstance: instance, evolutionWebhookToken: token },
      });
    }

    const created = await evoCreateInstance(
      settings.evolutionInstance!,
      settings.evolutionWebhookToken!
    );
    // 403/409 = instância já existe no servidor — seguimos para o QR
    if (!created.ok && ![403, 409].includes(created.status)) {
      return NextResponse.json(
        { error: "Não foi possível preparar a conexão. Tente novamente." },
        { status: 502 }
      );
    }
    // instância que JÁ existia no servidor pode estar assinada na lista velha
    // de eventos; a criada agora nasce com a atual — os dois casos carimbam
    await garantirEventosDoWebhook(settings, { sempre: true }).catch(() => {});

    let qr = await evoConnect(settings.evolutionInstance!);
    if (!qr.ok || !qr.data?.base64) {
      // RN-105: o servidor não dá QR Code para a sessão que ele acha "open".
      // Quando essa sessão está MORTA por trás (a sonda bate na conexão
      // fechada), sem isto o botão virava beco: a tela dizia desconectado e o
      // Conectar respondia "não foi possível gerar o QR Code" para sempre.
      // Então a sessão morta é derrubada e recriada — é o mesmo Desconectar +
      // Conectar que a loja faria à mão, sem perder o histórico (RN-049).
      const st = await evoState(settings.evolutionInstance!);
      if (st.ok && st.data?.instance?.state === "open") {
        // o número do aparelho vem do PRÓPRIO servidor (o gravado aqui pode
        // estar vazio — sem número a sonda não decide nada)
        const numero = jidToPhone(st.data?.instance?.ownerJid ?? "") ?? settings.evolutionPhone;
        const sonda = await veredictoDoOpen(
          settings.evolutionInstance,
          st.data?.instance?.ownerJid,
          settings.evolutionPhone
        );
        if (sonda === "viva") {
          // conectada de verdade: a tela volta ao ramo "Conectado"
          await db.commSettings.update({
            where: { companyId: user.companyId },
            data: {
              evolutionStatus: "CONECTADO",
              evolutionPhone: numero,
              activeProvider: "EVOLUTION",
              evolutionDownSince: null,
            },
          });
          return NextResponse.json(
            { error: "O WhatsApp da loja já está conectado e funcionando. A tela vai atualizar.", jaConectado: true },
            { status: 409 }
          );
        }
        if (sonda === "sem-resposta" && !recriar) {
          // sem prova nenhuma: quem decide derrubar a sessão é a pessoa,
          // avisada do que vai acontecer — nunca o sistema no escuro
          return NextResponse.json(
            {
              error:
                'O servidor diz que o WhatsApp está conectado, mas não deu para confirmar. Se as mensagens não entram nem saem, recrie a conexão: vai pedir o QR Code de novo (as conversas não somem).',
              perguntarRecriar: true,
            },
            { status: 409 }
          );
        }
        // ANTES de derrubar, a loja passa a desconectada: se a função for
        // cortada no meio (servidor lento), a tela mostra o Conectar — nunca
        // "Conectado" apontando para uma sessão que já foi apagada lá
        await db.commSettings.update({
          where: { companyId: user.companyId },
          data: { evolutionStatus: "DESCONECTADO" },
        });
        // tetos curtos: a cadeia inteira cabe no tempo da rota
        await evoLogout(settings.evolutionInstance!, TETO_DA_RECRIACAO_MS).catch(() => {});
        // o servidor pode levar um instante para terminar de apagar a sessão
        // antiga: recusa passageira na recriação ganha uma segunda tentativa
        // (403/409 = a instância já existe, a mesma régua da criação acima)
        let recriada = await evoCreateInstance(
          settings.evolutionInstance!,
          settings.evolutionWebhookToken!,
          TETO_DA_RECRIACAO_MS
        );
        if (!recriada.ok && ![403, 409].includes(recriada.status)) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          recriada = await evoCreateInstance(
            settings.evolutionInstance!,
            settings.evolutionWebhookToken!,
            TETO_DA_RECRIACAO_MS
          );
        }
        await garantirEventosDoWebhook(settings, { sempre: true }).catch(() => {});
        qr = await evoConnect(settings.evolutionInstance!, TETO_DA_RECRIACAO_MS);
        await db.commEvent
          .create({
            data: {
              companyId: user.companyId,
              channel: "WHATSAPP",
              direction: "OUT",
              type: "wa.conexao.recriada",
              status: qr.ok && qr.data?.base64 ? "OK" : "ERRO",
              error:
                qr.ok && qr.data?.base64
                  ? null
                  : `A sessão foi derrubada, mas o QR Code não veio (recriar: HTTP ${recriada.status}).`,
              payload: JSON.stringify({ quem: user.name, instance: settings.evolutionInstance, sonda, recriar }),
            },
          })
          .catch(() => {});
      }
    }
    if (!qr.ok || !qr.data?.base64) {
      return NextResponse.json(
        { error: "Não foi possível gerar o QR Code. Tente novamente; se repetir, o caminho é reiniciar o projeto do Evolution na Hostinger." },
        { status: 502 }
      );
    }

    await db.commSettings.update({
      where: { companyId: user.companyId },
      data: { evolutionStatus: "AGUARDANDO_QR" },
    });

    return NextResponse.json({ qr: qr.data.base64 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
