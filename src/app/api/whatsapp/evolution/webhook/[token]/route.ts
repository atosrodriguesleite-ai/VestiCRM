import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receiveMessage, updateDeliveryStatus } from "@/lib/comm/engine";
import { jidToPhone, evoGetMediaBase64 } from "@/lib/comm/evolution";
import { findCustomerByPhone, nomeProvisorio } from "@/lib/intake";
import { alertWhatsappDown, logServerError } from "@/lib/health";
import { adCode, campanhaDoAnuncio } from "@/lib/ad-match";
import { formatPhone } from "@/lib/format";
import { lerMensagemWA, soRecadoDoProtocolo } from "@/lib/comm/wa-message";
import { buscarTextoAtual, lerEdicao, textosAtuaisDaConversa } from "@/lib/comm/edicao";
import { lerContatos, nomeDeQuemMandou } from "@/lib/comm/nome-do-contato";
import { concluirTarefasDeContato } from "@/lib/contato-feito";

/**
 * Webhook do WhatsApp sem API oficial (Evolution → plataforma).
 * O token da URL identifica e autentica a loja (único por conexão).
 *
 * Eventos tratados:
 *  - connection.update  → estado da conexão (conectado/caiu) na hora
 *  - messages.upsert    → mensagem RECEBIDA vira lead/conversa no funil
 *                         (Lead Intake: deduplicação, vendedor, tarefa, SLA);
 *                         mensagem enviada PELO CELULAR também entra no
 *                         histórico da conversa (visão completa do cliente)
 *  - messages.update    → recibos de entrega/leitura nas mensagens enviadas
 *  - contacts.upsert    → o servidor descobriu o nome da cliente (às vezes
 *    contacts.update      só depois da primeira mensagem): troca o crachá
 *                         provisório pelo nome de verdade
 *
 * Sempre responde 200 (evita tempestade de retentativas do servidor).
 */

export const maxDuration = 30;

/**
 * Aplica uma edição na mensagem gravada — e ACORDA O SYNC.
 *
 * O sync da inbox (3 em 3s) só entrega conversas cujo `updatedAt` mudou.
 * Corrigir só a mensagem deixava o texto novo gravado no banco e INVISÍVEL
 * na tela até alguém recarregar a página — era um dos motivos de "editou e
 * não atualizou". Tocar a conversa é o que faz a correção chegar na hora.
 */
async function aplicarEdicao(
  companyId: string,
  alvoId: string,
  texto: string | null
): Promise<number> {
  const r = await db.message.updateMany({
    where: {
      externalId: alvoId,
      conversation: { companyId },
      // reentrega do mesmo conteúdo (reconexão) não vira "editada"
      ...(texto ? { NOT: { body: texto } } : {}),
    },
    data: {
      ...(texto ? { body: texto } : {}),
      editedAt: new Date(),
    },
  });
  if (r.count > 0) {
    await db.conversation.updateMany({
      where: { companyId, messages: { some: { externalId: alvoId } } },
      data: { updatedAt: new Date() },
    });
    return r.count;
  }
  // ZERO linhas com texto em mãos pode ser REENTREGA do mesmo aviso (o guarda
  // NOT body faz "já corrigida" parecer "não achada"). Sem distinguir, a
  // segunda entrega do aviso caía no fluxo normal e virava bolha enigmática
  // na conversa (achado da revisão de 17/08/2026). Já em dia = sucesso.
  if (texto) {
    const jaAplicada = await db.message.findFirst({
      where: { externalId: alvoId, conversation: { companyId }, body: texto },
      select: { id: true },
    });
    if (jaAplicada) return 1;
  }
  return 0;
}

// senderPn: quando o WhatsApp manda o contato com a identidade nova (@lid),
// o número de telefone REAL vem neste campo — sem ele a mensagem se perderia
type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string; senderPn?: string };
// Prévia do ANÚNCIO (Click-to-WhatsApp do Instagram/Facebook): quando o
// cliente chega clicando num anúncio, a primeira mensagem traz junto o
// título, o texto e o link do anúncio — informação de ouro pra atribuição.
type AdReply = {
  title?: string;
  body?: string;
  sourceUrl?: string;
  sourceId?: string;
  sourceType?: string;
};
type CtxInfo = { contextInfo?: { externalAdReply?: AdReply } };

type EvoMessage = {
  key?: EvoKey;
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string } & CtxInfo;
    imageMessage?: ({ caption?: string; mimetype?: string } & CtxInfo);
    videoMessage?: ({ caption?: string; mimetype?: string } & CtxInfo);
    documentMessage?: { fileName?: string; mimetype?: string };
    audioMessage?: { mimetype?: string };
    stickerMessage?: { mimetype?: string };
    // apagar "para todos" chega como protocolMessage tipo REVOKE
    protocolMessage?: { type?: string; key?: { id?: string } };
    // texto editado chega como editedMessage
    editedMessage?: {
      message?: { conversation?: string; extendedTextMessage?: { text?: string } };
    };
  };
  status?: string;
};

/**
 * Prévia do anúncio (se a mensagem veio de um clique em anúncio).
 *
 * O lugar do `externalAdReply` MUDA conforme o tipo de mensagem e a versão do
 * servidor: pode estar no texto, na foto, no vídeo, no botão, ou solto na
 * raiz. Em vez de adivinhar o caminho, procura em qualquer profundidade —
 * era por procurar em só três lugares que a prévia não aparecia.
 */
function extractAdReferral(m: EvoMessage): AdReply | null {
  let achado: AdReply | null = null;
  const visitados = new Set<unknown>();
  const procurar = (no: unknown, nivel: number) => {
    if (achado || !no || typeof no !== "object" || nivel > 6) return;
    if (visitados.has(no)) return;
    visitados.add(no);
    for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
      if (achado) return;
      if (chave === "externalAdReply" && valor && typeof valor === "object") {
        const ad = valor as AdReply;
        if (ad.title || ad.body || ad.sourceUrl || ad.sourceId) achado = ad;
        return;
      }
      if (valor && typeof valor === "object") procurar(valor, nivel + 1);
    }
  };
  procurar(m as unknown, 0);
  return achado;
}

/**
 * MENSAGEM QUE NÃO ENTROU FICA REGISTRADA.
 *
 * Incidente real: chegou mensagem no celular da loja e ela não apareceu no
 * sistema. Não deu para investigar porque o descarte era um `continue` mudo —
 * nenhum log, nenhum vestígio, nada para olhar depois.
 *
 * Aqui o conteúdo bruto vai para a Central de Comunicação (e para o painel de
 * Saúde). É o que permite descobrir QUAL formato o WhatsApp mandou e ensinar
 * o leitor a entendê-lo.
 */
async function registrarDescarte(
  companyId: string,
  motivo: string,
  m: EvoMessage,
  tipo = "message.nao-lida-pelo-sistema"
): Promise<void> {
  await db.commEvent.create({
    data: {
      companyId,
      channel: "WHATSAPP",
      direction: "IN",
      type: tipo,
      status: "ERRO",
      error: `Mensagem recebida que o sistema não conseguiu interpretar (${motivo}).`,
      // o conteúdo bruto é a única pista para corrigir o leitor depois
      payload: JSON.stringify(m).slice(0, 8000),
    },
  });
}

// teto de segurança do arquivo salvo na conversa (~12 MB em base64)
const MEDIA_BASE64_MAX = 12 * 1024 * 1024;

/** Busca o arquivo da mensagem no servidor Evolution e monta a data URL. */
async function fetchMediaDataUrl(
  instance: string | null,
  messageId: string | undefined,
  mimeFallback: string | null
): Promise<string | null> {
  if (!instance || !messageId) return null;
  const res = await evoGetMediaBase64(instance, messageId);
  const b64 = res.data?.base64;
  if (!res.ok || !b64 || b64.length > MEDIA_BASE64_MAX) return null;
  const mime = res.data?.mimetype || mimeFallback || "application/octet-stream";
  return `data:${mime.split(";")[0]};base64,${b64}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const settings = await db.commSettings.findUnique({
    where: { evolutionWebhookToken: token },
  });
  if (!settings) return NextResponse.json({ ok: true }); // token desconhecido: ignora em silêncio
  // loja SUSPENSA não ingere: as portas de dinheiro e vitrine já fecham, mas
  // as mensagens continuavam entrando e consumindo recurso (auditoria
  // 07/08/2026). 200 mudo de propósito — erro faria o provedor reenviar.
  const loja = await db.company.findUnique({
    where: { id: settings.companyId },
    select: { suspended: true },
  });
  if (loja?.suspended) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    data?: unknown;
  } | null;
  if (!body?.event) return NextResponse.json({ ok: true });

  const companyId = settings.companyId;
  const event = body.event.toLowerCase().replace(/_/g, ".");

  try {
    if (event === "connection.update") {
      const d = body.data as { state?: string; wuid?: string } | undefined;
      const state = d?.state;
      if (state === "open" || state === "close" || state === "connecting") {
        await db.commSettings.update({
          where: { companyId },
          data: {
            evolutionStatus:
              state === "open"
                ? "CONECTADO"
                : state === "connecting"
                  ? "AGUARDANDO_QR"
                  : "DESCONECTADO",
            ...(state === "open"
              ? {
                  activeProvider: "EVOLUTION",
                  evolutionDownSince: null,
                  evolutionAlertAt: null,
                  ...(d?.wuid ? { evolutionPhone: jidToPhone(d.wuid) } : {}),
                }
              : {}),
          },
        });
        // ESTAVA conectado e caiu → avisa a loja NA HORA (sino + push).
        // "close" durante a leitura do QR não conta (não estava conectado).
        if (state === "close" && settings.evolutionStatus === "CONECTADO") {
          await db.commSettings.update({
            where: { companyId },
            data: { evolutionDownSince: new Date() },
          });
          await alertWhatsappDown(companyId).catch(() => {});
        }
      }
    }

    if (event === "messages.upsert") {
      const raw = body.data as EvoMessage | EvoMessage[] | { messages?: EvoMessage[] };
      const list: EvoMessage[] = Array.isArray(raw)
        ? raw
        : (raw as { messages?: EvoMessage[] })?.messages ?? [raw as EvoMessage];

      // UMA MENSAGEM COM PROBLEMA NÃO PODE DERRUBAR O LOTE.
      // O servidor entrega várias mensagens de uma vez. Com um único try em
      // volta do laço, um erro na 3ª fazia as outras 7 nunca serem gravadas —
      // e ninguém ficava sabendo. Agora cada uma é isolada e o erro fica
      // registrado no painel de Saúde com o id da mensagem.
      for (const m of list) {
        try {
        const jid = m.key?.remoteJid ?? "";
        // grupos/status ficam de fora; contato @lid usa o número do senderPn
        let phone = jidToPhone(jid);
        if (!phone && jid.endsWith("@lid")) {
          const pn = (m.key?.senderPn ?? "").split("@")[0].replace(/\D/g, "");
          if (/^\d{8,15}$/.test(pn)) phone = pn;
        }
        if (!phone) {
          // grupo/status/broadcast é descarte legítimo e silencioso. Mensagem
          // de gente com telefone que não deu para ler, NÃO: fica registrada
          // no painel de Saúde para alguém investigar.
          const ehGrupoOuStatus =
            jid.endsWith("@g.us") || jid.startsWith("status@");
          if (!ehGrupoOuStatus) {
            await registrarDescarte(companyId, "telefone-ilegivel", m).catch(() => {});
          }
          continue;
        }

        // o cliente apagou uma mensagem (REVOKE): marca a mensagem alvo como
        // "apagada pelo cliente" mas MANTÉM o conteúdo (a loja ainda lê)
        const proto = m.message?.protocolMessage;
        if (proto?.type === "REVOKE" && proto.key?.id) {
          await db.message.updateMany({
            where: { externalId: proto.key.id, conversation: { companyId } },
            data: { revoked: true, revokedBy: "CUSTOMER" },
          });
          continue;
        }

        // O cliente editou uma mensagem. A edição chega em vários formatos e o
        // id da mensagem a corrigir vem DENTRO do aviso — a leitura de todos
        // eles mora em lib/comm/edicao.ts.
        const edicao = lerEdicao(m);
        // quando a edição não puder ser mostrada, a bolha vira um aviso
        // honesto em português — nunca o código cru "(secretEncryptedMessage)".
        // `textoEditado` guarda o texto novo recuperado quando a original não
        // está no banco: a bolha nova nasce com ele (a leitura crua de um
        // aviso cifrado não mostra o texto).
        let avisoEdicaoSemTexto = false;
        let textoEditado: string | null = null;
        if (edicao?.alvoId) {
          // EDIÇÃO CIFRADA: o aviso não traz o texto novo, mas o SERVIDOR já
          // tem a mensagem atualizada — então o sistema pergunta, em vez de
          // mandar a vendedora "conferir no WhatsApp". Nem toda vendedora tem
          // o celular do WhatsApp na mão; mandar ela olhar lá não é resposta.
          const texto =
            edicao.texto ||
            (await buscarTextoAtual(
              settings.evolutionInstance,
              edicao.alvoId,
              m.key?.remoteJid
            ));
          // EDIÇÃO SEM TEXTO FICA REGISTRADA (mesma lição da mensagem que não
          // entrava): sem o conteúdo bruto não dá para descobrir QUAL formato
          // o WhatsApp mandou desta vez, e a gente fica adivinhando. Isto é o
          // que permite ensinar o leitor a entender o formato novo.
          if (!texto) {
            await registrarDescarte(
              companyId,
              "edição sem texto legível",
              m,
              "wa.edicao.sem-texto"
            ).catch(() => {});
          }
          // sem texto nem pelo servidor, ao menos marca "editada"
          const corrigidas = await aplicarEdicao(companyId, edicao.alvoId, texto || null);
          // Achou e corrigiu (ou já estava em dia): acabou aqui.
          if (corrigidas > 0) continue;
          // Não achou a original (chegou antes da conexão, ou se perdeu) e a
          // edição trouxe o texto: segue o fluxo e entra como mensagem NOVA,
          // já com o texto certo. Editar não pode apagar do sistema.
          // Sem texto (edição criptografada) também segue como aviso honesto,
          // porque perder o rastro seria pior.
          if (texto) textoEditado = texto;
          else avisoEdicaoSemTexto = true;
        }

        if (edicao && !edicao.alvoId) {
          if (edicao.texto) {
            // O aviso trouxe o texto mas não a chave da original: não tem o
            // que corrigir, então o texto novo entra como mensagem nova.
            textoEditado = edicao.texto;
          } else {
            // EDIÇÃO CIFRADA SEM ALVO (incidente Giovana, 13/08/2026): o
            // aviso não diz nem o texto novo nem QUAL mensagem mudou. Plano
            // de resgate: pega o texto atual das últimas mensagens da
            // conversa no servidor e corrige as que estão diferentes do
            // gravado. Só mensagens de TEXTO entram (dos dois lados — a loja
            // também edita pelo celular); corpo derivado de mídia ("[foto]")
            // fica de fora pelo mediaType, e mensagem apagada não volta.
            let corrigidas = 0;
            let conferidas = 0;
            const atuais = await textosAtuaisDaConversa(
              settings.evolutionInstance,
              m.key?.remoteJid
            );
            if (atuais.size > 0) {
              const nossas = await db.message.findMany({
                where: {
                  conversation: { companyId },
                  externalId: { in: [...atuais.keys()] },
                  mediaType: "TEXT",
                  revoked: false,
                },
                select: { externalId: true, body: true },
              });
              for (const nossa of nossas) {
                const novo = atuais.get(nossa.externalId ?? "") ?? "";
                if (!novo) continue;
                conferidas += 1;
                if (novo !== nossa.body) {
                  corrigidas += await aplicarEdicao(companyId, nossa.externalId!, novo);
                }
              }
            }
            // Corrigiu: acabou aqui — a conversa já mostra o texto novo.
            if (corrigidas > 0) continue;
            // Nada divergente mas a conversa FOI conferida no servidor: é
            // reentrega do aviso (a correção já foi aplicada) ou edição de
            // algo fora do alcance do texto puro. Sem isso, a reentrega
            // virava um alarme falso de "texto não chegou".
            if (conferidas > 0) continue;
            // Não deu nem para conferir (servidor sem histórico): registra o
            // payload cru no painel de Saúde — é o que permite ensinar o
            // leitor quando o WhatsApp inventar mais um formato — e a bolha
            // vira um aviso honesto em português, não um código.
            await registrarDescarte(
              companyId,
              "edição sem texto legível",
              m,
              "wa.edicao.sem-texto"
            ).catch(() => {});
            avisoEdicaoSemTexto = true;
          }
        }

        const lida = lerMensagemWA(m);
        let { text } = lida;
        if (textoEditado) text = textoEditado;
        if (avisoEdicaoSemTexto) {
          // quem editou define o aviso: culpar "a cliente" por uma edição
          // feita pela loja no celular seria informação errada na conversa
          text = m.key?.fromMe
            ? "✏️ Uma mensagem enviada pela loja foi editada no celular e o texto novo não chegou — confira no WhatsApp."
            : "✏️ A cliente editou uma mensagem e o texto novo não chegou — confira no WhatsApp.";
        }
        const { mediaType, mimeFallback, fileName } = lida;

        // NENHUMA MENSAGEM DE CLIENTE PODE SUMIR.
        //
        // Antes, quando o sistema não conseguia nem NOMEAR o tipo, a mensagem
        // era descartada com um `continue` — sem bolha, sem log, sem rastro.
        // A loja via a mensagem no celular e não via no sistema, e não havia
        // como investigar depois porque nada tinha sido gravado.
        //
        // Agora: evento de controle do protocolo (que não é mensagem de
        // ninguém) segue sendo ignorado; qualquer outra coisa vira uma bolha
        // de aviso E fica registrada no painel de Saúde com o conteúdo bruto,
        // que é o que permite ensinar o sistema a ler aquele formato.
        if (!text) {
          // recado do protocolo (inclusive o aviso de álbum, cujas fotos
          // chegam em seguida): ignora de propósito, sem bolha e sem registro
          if (soRecadoDoProtocolo(m)) continue;
          await registrarDescarte(companyId, "formato-desconhecido", m).catch(() => {});
          text = "[mensagem recebida que o sistema não conseguiu ler — abra o WhatsApp para ver]";
        }

        // NÃO DUPLICAR: o servidor pode reentregar a mesma mensagem (retentativa,
        // reconexão, sincronização). O id da mensagem é único no WhatsApp —
        // se ele já está gravado nesta loja, não entra de novo.
        if (m.key?.id) {
          const jaGravada = await db.message.findFirst({
            where: { externalId: m.key.id, conversation: { companyId } },
            select: { id: true },
          });
          if (jaGravada) continue;
        }

        // foto/áudio/vídeo/arquivo: baixa o conteúdo para exibir na conversa
        const mediaUrl =
          mediaType === "TEXT"
            ? null
            : await fetchMediaDataUrl(settings.evolutionInstance, m.key?.id, mimeFallback);
        // arquivo não veio (grande demais, expirado no servidor): a mensagem
        // entra assim mesmo, dizendo que existe um anexo — sem isso a bolha
        // aparecia como texto seco e ninguém sabia que faltava algo
        const textoFinal =
          mediaType !== "TEXT" && !mediaUrl
            ? `${text} (não foi possível baixar o arquivo — veja no WhatsApp)`
            : text;

        if (!m.key?.fromMe) {
          // mensagem do CLIENTE → central de leads (funil, vendedor, tarefa)
          const result = await receiveMessage(companyId, {
            channel: "WHATSAPP",
            phone,
            // o nome vem em campos diferentes conforme a versão do servidor
            // e o tipo de conta (empresa manda em `verifiedBizName`) — ler só
            // `m.pushName` foi o que fez nascer a conversa "Lead 9621"
            name: nomeDeQuemMandou(m, body.data) || undefined,
            text: textoFinal,
            ...(mediaType !== "TEXT" && mediaUrl
              ? { mediaType, mediaUrl, fileName: fileName ?? undefined }
              : {}),
            externalId: m.key?.id,
          });

          // 📢 veio de um ANÚNCIO (Click-to-WhatsApp): registra a prévia como
          // nota no chat — a equipe vê de qual anúncio o cliente chegou e
          // consegue atribuir a conversa à campanha certa. Sem duplicar: a
          // mesma prévia só entra uma vez por conversa.
          const ad = extractAdReferral(m);
          if (ad && result?.conversation) {
            const marcador = ad.sourceUrl || ad.title || ad.sourceId || "";
            const jaTem = marcador
              ? await db.message.findFirst({
                  where: {
                    conversationId: result.conversation.id,
                    kind: "NOTE",
                    body: { contains: marcador },
                  },
                  select: { id: true },
                })
              : null;
            if (!jaTem) {
              await db.message.create({
                data: {
                  conversationId: result.conversation.id,
                  direction: "IN",
                  kind: "NOTE",
                  body: [
                    "📢 Cliente veio de um ANÚNCIO",
                    ad.title ? `“${ad.title}”` : null,
                    ad.body ? ad.body.slice(0, 200) : null,
                    ad.sourceUrl ?? null,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              });
              await db.conversation.update({
                where: { id: result.conversation.id },
                data: { lastMessageAt: new Date() },
              });
            }

            // 🎯 ATRIBUIÇÃO: guarda o código do anúncio no cliente e, se ele
            // pertence a uma campanha cadastrada, amarra a campanha sozinha.
            // Vale a regra do "primeiro contato": não sobrescreve atribuição
            // que já existe (quem trouxe a cliente foi quem trouxe).
            const codigo = adCode(ad);
            if (codigo) {
              // GUARDA O CRIATIVO. Até aqui só o código curto sobrevivia, e
              // ele não abre nada nem diz que anúncio é — a lojista via
              // "dbn-u8qsqk4" na tela e não fazia ideia. O link vem com as
              // maiúsculas certas (o código vai para minúsculas e o Instagram
              // diferencia), então tem que ser guardado como veio.
              await db.adCreative
                .upsert({
                  where: { companyId_adRef: { companyId, adRef: codigo } },
                  create: {
                    companyId,
                    adRef: codigo,
                    sourceUrl: ad.sourceUrl ?? null,
                    sourceId: ad.sourceId ?? null,
                    title: ad.title ?? null,
                    body: ad.body?.slice(0, 300) ?? null,
                  },
                  update: {
                    lastSeenAt: new Date(),
                    // completa o que faltava sem apagar o que já tinha
                    ...(ad.sourceUrl ? { sourceUrl: ad.sourceUrl } : {}),
                    ...(ad.title ? { title: ad.title } : {}),
                  },
                })
                .catch(() => {});
              const cliente = await db.customer.findUnique({
                where: { id: result.customer.id },
                select: { adRef: true, campaignId: true },
              });
              const campanhas = cliente?.campaignId
                ? []
                : await db.marketingCampaign.findMany({
                    where: { companyId, active: true },
                    select: { id: true, adRefs: true, active: true },
                    // RN-015: o PATCH de campanhas hoje recusa duas donas do
                    // mesmo anúncio, mas dados antigos podem ter a duplicata.
                    // Sem ordem estável, QUAL campanha levava a cliente era a
                    // ordem física do banco (loteria); com ela, vale sempre a
                    // campanha mais antiga — determinístico e auditável.
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                  });
              const campanha = campanhaDoAnuncio(codigo, campanhas);
              const patch = {
                ...(cliente?.adRef ? {} : { adRef: codigo }),
                ...(campanha ? { campaignId: campanha.id } : {}),
              };
              if (Object.keys(patch).length) {
                await db.customer
                  .update({ where: { id: result.customer.id }, data: patch })
                  .catch(() => {});
              }
            }
          }
        } else {
          // mensagem enviada PELO CELULAR da loja → registra na conversa do
          // cliente (histórico completo), sem reenviar nada. Casamento
          // tolerante a 9º dígito, DDI e formatação (mesma regra do intake).
          let customer = await findCustomerByPhone(companyId, phone);
          if (!customer) {
            // A vendedora puxou assunto pelo APP com um número que ainda não
            // está no CRM (follow-up, indicação, contato de feira). Antes a
            // mensagem era jogada fora e a conversa nunca aparecia no sistema
            // — a loja perdia o atendimento de vista.
            //
            // Cria o contato mínimo. NÃO passa pelo Lead Intake: aqui quem
            // puxou assunto foi a LOJA, então não é lead novo entrando — não
            // cabe distribuir vendedor, abrir oportunidade nem criar tarefa.
            //
            // O nome NÃO pode vir de `pushName`: em mensagem enviada por nós,
            // esse campo é o nome da PRÓPRIA LOJA, não o de quem recebeu.
            customer = await db.customer.create({
              data: {
                companyId,
                name: `Contato ${formatPhone(phone)}`,
                phone,
                origin: "WHATSAPP",
              },
            });
            await db.customerEvent
              .create({
                data: {
                  companyId,
                  customerId: customer.id,
                  type: "LEAD_CRIADO",
                  channel: "WHATSAPP",
                  description:
                    "Contato criado automaticamente: a loja iniciou a conversa pelo aplicativo do WhatsApp.",
                },
              })
              .catch(() => {});
          }
          let conv = await db.conversation.findFirst({
            where: { companyId, customerId: customer.id, status: { not: "CLOSED" } },
            orderBy: { lastMessageAt: "desc" },
          });
          // conversa aberta que ainda não tem dona: a loja falou com a
          // cliente, então o atendimento passa a ser da responsável por ela
          // (mesma régua da carteira). Sem responsável cadastrada, segue sem
          // dona — e a regra da fila já mantém isso fora da fila.
          if (conv && !conv.assigneeId && customer.ownerId) {
            conv = await db.conversation.update({
              where: { id: conv.id },
              data: { assigneeId: customer.ownerId },
            });
          }
          if (!conv) {
            // histórico é sagrado: reabre a conversa encerrada mais recente
            // (mantém todo o histórico) em vez de nascer um chat vazio
            const encerrada = await db.conversation.findFirst({
              where: { companyId, customerId: customer.id, status: "CLOSED" },
              orderBy: { lastMessageAt: "desc" },
            });
            // QUEM FALOU FOI A LOJA — a conversa NÃO nasce na fila.
            //
            // Fila é cliente esperando atendimento. Aqui foi a loja que puxou
            // assunto pelo celular, então o atendimento já está acontecendo:
            // ele vai para a responsável pela cliente (a dona da carteira, a
            // mesma régua da comissão). Sem responsável cadastrada, a conversa
            // fica em Chats sem dona — e qualquer uma pode assumir.
            conv = encerrada
              ? await db.conversation.update({
                  where: { id: encerrada.id },
                  data: {
                    status: "OPEN",
                    ...(encerrada.assigneeId ? {} : { assigneeId: customer.ownerId }),
                  },
                })
              : await db.conversation.create({
                  data: {
                    companyId,
                    customerId: customer.id,
                    status: "OPEN",
                    assigneeId: customer.ownerId,
                  },
                });
          }
          const exists = m.key?.id
            ? await db.message.findFirst({
                where: { conversationId: conv.id, externalId: m.key.id },
              })
            : null;
          // RESGATE: o eco pode ser uma mensagem que o painel acabou de
          // enviar mas cuja resposta se perdeu (conversão de mídia lenta →
          // timeout → "erro" na tela com o áudio JÁ entregue). Adota a
          // pendente/falhada em vez de criar uma bolha duplicada.
          if (!exists) {
            const pendente = await db.message.findFirst({
              where: {
                conversationId: conv.id,
                direction: "OUT",
                kind: "TEXT",
                externalId: null,
                status: { in: ["ENVIANDO", "FALHOU"] },
                createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
                ...(mediaType !== "TEXT" ? { mediaType } : { mediaType: "TEXT", body: textoFinal }),
              },
              // MAIS ANTIGA primeiro: os ecos chegam na ordem em que foram
              // enviados. Adotando a mais nova, duas mensagens iguais mandadas
              // em seguida ("ok", "ok") trocavam de identidade entre si.
              orderBy: { createdAt: "asc" },
            });
            if (pendente) {
              await db.message.update({
                where: { id: pendente.id },
                data: {
                  externalId: m.key?.id ?? undefined,
                  status: "ENVIADA",
                  error: null,
                },
              });
              await db.conversation.update({
                where: { id: conv.id },
                data: {
                  lastMessageAt: new Date(),
                  lastOutboundAt: new Date(),
                  unreadCount: 0,
                },
              });
              await concluirTarefasDeContato(companyId, customer.id).catch(() => 0);
              continue;
            }
          }
          if (!exists) {
            // P2002 = o índice único pegou uma entrega repetida do mesmo aviso
            // (duas execuções em paralelo passaram pela checagem acima). Não é
            // erro: a mensagem já está gravada, seguimos em frente.
            try {
              await db.message.create({
                data: {
                  conversationId: conv.id,
                  channel: "WHATSAPP",
                  direction: "OUT",
                  body: textoFinal,
                  ...(mediaType !== "TEXT" && mediaUrl
                    ? { mediaType, mediaUrl, fileName }
                    : {}),
                  externalId: m.key?.id,
                  status: "ENVIADA",
                },
              });
            } catch (e) {
              if ((e as { code?: string })?.code !== "P2002") throw e;
              continue;
            }
            // CONTATO FEITO: a loja chamou a cliente pelo celular — as
            // tarefas de contato dela se concluem e a sugestão sai das listas
            await concluirTarefasDeContato(companyId, customer.id).catch(() => 0);
            // respondeu pelo CELULAR = leu a conversa. Sem zerar aqui, o
            // sistema seguia mostrando "3 não lidas" numa conversa já
            // atendida, e o time perdia a confiança no contador.
            await db.conversation.update({
              where: { id: conv.id },
              data: {
                lastMessageAt: new Date(),
                lastOutboundAt: new Date(),
                unreadCount: 0,
              },
            });
          }
        }
        } catch (e) {
          await logServerError({
            source: "wa.webhook",
            path: `/api/whatsapp/evolution/webhook (${event})`,
            message: `Falha ao gravar uma mensagem do WhatsApp: ${e instanceof Error ? e.message : String(e)}`,
            detail: JSON.stringify({ id: m.key?.id, de: m.key?.remoteJid, minha: m.key?.fromMe }),
          }).catch(() => {});
        }
      }
    }

    /**
     * O SERVIDOR DESCOBRIU O NOME DA CLIENTE.
     *
     * O WhatsApp nem sempre manda o nome junto da primeira mensagem — às
     * vezes ele chega segundos depois, neste aviso separado. A gente jogava
     * esse aviso no lixo, e o contato ficava "Lead 9621" para sempre, mesmo
     * com o nome disponível.
     *
     * Regra de ouro: só troca CRACHÁ PROVISÓRIO (o apelido que o próprio
     * sistema inventou com o telefone). Nome escrito por gente — a vendedora
     * corrigiu, a cliente digitou no catálogo — NUNCA é sobrescrito.
     */
    if (event === "contacts.upsert" || event === "contacts.update") {
      // RECONEXÃO pode despejar a agenda INTEIRA num evento só (milhares).
      // Processar tudo em série estouraria o tempo da função e pesaria no
      // banco. Teto por evento: os crachás provisórios restantes são trocados
      // quando a cliente falar (o caminho da mensagem também corrige o nome).
      for (const c of lerContatos(body.data).slice(0, 50)) {
        const phone = jidToPhone(c.jid);
        if (!phone) continue;
        const cliente = await findCustomerByPhone(companyId, phone);
        if (!cliente || !nomeProvisorio(cliente.name)) continue;
        await db.customer.update({
          where: { id: cliente.id },
          data: { name: c.nome },
        });
        await db.customerEvent
          .create({
            data: {
              companyId,
              customerId: cliente.id,
              type: "NOVA_INTERACAO",
              channel: "WHATSAPP",
              description: `Nome atualizado para “${c.nome}” (veio do perfil do WhatsApp).`,
            },
          })
          .catch(() => {});
      }
    }

    // o cliente apagou uma mensagem (evento dedicado do servidor)
    if (event === "messages.delete") {
      const raw = body.data as
        | { id?: string; keyId?: string; key?: { id?: string } }
        | { id?: string; keyId?: string; key?: { id?: string } }[];
      const list = Array.isArray(raw) ? raw : [raw];
      let matched = 0;
      for (const d of list) {
        const msgId = d?.key?.id ?? d?.id ?? d?.keyId;
        if (!msgId) continue;
        const r = await db.message.updateMany({
          where: { externalId: msgId, conversation: { companyId } },
          data: { revoked: true, revokedBy: "CUSTOMER" },
        });
        matched += r.count;
      }
      // diagnóstico (aparece na Central de Comunicação): confirma que o evento
      // chegou e se casou com alguma mensagem
      await db.commEvent
        .create({
          data: {
            companyId,
            channel: "WHATSAPP",
            direction: "IN",
            type: "wa.cliente.apagou",
            // não achar a mensagem não é defeito: pode ser de grupo, ou
            // anterior à conexão. Marcar ERRO enchia o painel da lojista de
            // falha vermelha por algo normal.
            status: "OK",
            payload: JSON.stringify(body.data).slice(0, 500),
            response: JSON.stringify({ marcadas: matched }),
          },
        })
        .catch(() => {});
    }

    if (event === "messages.update") {
      type Update = {
        keyId?: string;
        status?: string;
        key?: { id?: string };
        message?: Record<string, unknown>;
      };
      const raw = body.data as Update | Update[];
      const list = Array.isArray(raw) ? raw : [raw];
      for (const u of list) {
        // EDIÇÃO QUE CHEGA POR AQUI: conforme a versão, o servidor entrega o
        // TEXTO NOVO da mensagem editada neste evento (e não no upsert). Era
        // um dos buracos do "editou e não atualizou": o texto batia na porta
        // e a gente só olhava o recibo.
        //
        // SÓ formato de edição RECONHECIDO (lerEdicao) entra: recibo de
        // status que ecoe o conteúdo cru da mensagem NÃO é edição — aplicar
        // esse eco sobrescreveria corpo derivado (ex.: o aviso de "não foi
        // possível baixar o arquivo") e carimbaria "editada" à toa.
        if (u?.message) {
          const idAlvo = u.keyId ?? u.key?.id ?? null;
          const edicao = lerEdicao({ key: { id: idAlvo }, message: u.message });
          if (edicao?.alvoId && edicao.texto && !edicao.texto.startsWith("[")) {
            await aplicarEdicao(companyId, edicao.alvoId, edicao.texto);
          }
        }
        if (!u?.keyId || !u.status) continue;
        // PLAYED = ouviu o áudio (implica ter lido).
        // ERROR/FAILED = a mensagem NÃO chegou. Sem tratar isso, a bolha
        // seguia mostrando "enviada" para sempre e a vendedora achava que a
        // cliente tinha recebido — a pior informação errada possível aqui.
        const map: Record<string, "ENTREGUE" | "LIDA" | "FALHOU"> = {
          DELIVERY_ACK: "ENTREGUE",
          READ: "LIDA",
          PLAYED: "LIDA",
          ERROR: "FALHOU",
          FAILED: "FALHOU",
        };
        const status = map[u.status.toUpperCase()];
        if (!status) continue;
        await updateDeliveryStatus(
          companyId,
          u.keyId,
          status,
          status === "FALHOU"
            ? "O WhatsApp não conseguiu entregar esta mensagem."
            : undefined
        );
      }
    }
  } catch (e) {
    // O webhook nunca devolve erro (senão o servidor entra em tempestade de
    // retentativas), MAS o problema não pode sumir: fica registrado no painel
    // de Saúde. Antes era engolido em silêncio — mensagem perdida sem rastro.
    await logServerError({
      source: "wa.webhook",
      path: `/api/whatsapp/evolution/webhook (${event})`,
      message: `Falha no webhook do WhatsApp: ${e instanceof Error ? e.message : String(e)}`,
      detail: e instanceof Error ? (e.stack ?? null) : null,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
