import { db } from "./db";
import { conversationScope } from "./scope";
import { catalogUrl, trackedCatalogLink, trackedLinkParts } from "./catalog-url";
import type { SessionUser } from "./auth";
import type { InboxConversation } from "@/app/(app)/whatsapp/inbox";

/**
 * Conversas da inbox no formato que a tela consome — compartilhado entre o
 * carregamento inicial (página) e o sync incremental (GET /api/conversations,
 * que passa `since` para trazer só o que mudou desde a última busca).
 */
/** Quanta conversa e quanta mensagem a tela recebe ao abrir. */
const CONVERSAS_NA_ABERTURA = 200;
const MENSAGENS_NA_ABERTURA = 100;

export async function loadInboxConversations(
  user: SessionUser,
  since?: Date
): Promise<InboxConversation[]> {
  const [conversations, company] = await Promise.all([
    db.conversation.findMany({
      where: {
        ...conversationScope(user),
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      include: {
        customer: { include: { tags: { include: { tag: true } } } },
        assignee: true,
        setor: true,
        // O PESO DA TELA MORA AQUI.
        //
        // Antes vinham TODAS as mensagens de TODAS as conversas — e de novo a
        // cada 3 segundos, no sync. Uma cliente com 3.000 mensagens fazia as
        // 3.000 trafegarem só porque chegou um ✓✓. Era o gargalo nº 1.
        //
        //  • SYNC (com `since`): só o que MUDOU desde a última consulta. Como
        //    recibo e edição não mexem em `createdAt`, o filtro é por
        //    `updatedAt` — senão o sync perderia as atualizações de status.
        //    A tela junta com o que já tem e reordena por data.
        //  • CARGA INICIAL: as últimas 100 de cada conversa (busca em ordem
        //    decrescente e devolve na ordem certa). É o que qualquer app de
        //    mensagem faz — ninguém abre o chat para ler o começo de 2023.
        messages: since
          ? {
              where: { updatedAt: { gt: since } },
              orderBy: { createdAt: "asc" },
              include: {
                author: true,
                replyTo: { select: { id: true, body: true, direction: true } },
              },
            }
          : {
              orderBy: { createdAt: "desc" },
              take: MENSAGENS_NA_ABERTURA,
              include: {
                author: true,
                // prévia da mensagem citada (responder mensagem específica)
                replyTo: { select: { id: true, body: true, direction: true } },
              },
            },
      },
      orderBy: { lastMessageAt: "desc" },
      // conversa que não recebe mensagem há muito tempo não precisa estar na
      // memória do navegador; a busca continua achando pelo servidor
      ...(since ? {} : { take: CONVERSAS_NA_ABERTURA }),
    }),
    db.company.findUnique({
      where: { id: user.companyId },
      select: { slug: true },
    }),
  ]);

  // link rastreável do catálogo por cliente (leva o ref do vendedor logado):
  // catalago.net/loja/julia/<codigo> → sabe o comportamento do cliente no catálogo
  const { sellerRef } = trackedLinkParts(user, company?.slug ?? "");
  const catalogBase = catalogUrl(company?.slug ?? "");
  const linkForCustomer = (linkCode: string | null, id: string) =>
    trackedCatalogLink(catalogBase, sellerRef, linkCode ?? id);

  return conversations.map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    priority: c.priority,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
    customer: {
      id: c.customer.id,
      name: c.customer.name,
      phone: c.customer.phone,
      city: c.customer.city,
      // foto do WhatsApp (link do próprio WhatsApp; nulo = mostra iniciais)
      photoUrl: c.customer.photoUrl,
      wholesale: c.customer.type !== "VAREJO",
      catalogLink: linkForCustomer(c.customer.linkCode, c.customer.id),
      tags: c.customer.tags.map((t) => ({
        id: t.tag.id,
        name: t.tag.name,
        color: t.tag.color,
      })),
    },
    assignee: c.assignee
      ? { id: c.assignee.id, name: c.assignee.name, color: c.assignee.color }
      : null,
    setor: c.setor
      ? { id: c.setor.id, name: c.setor.name, color: c.setor.color }
      : null,
    // na abertura a busca vem da mais nova para a mais antiga (é assim que se
    // pega "as últimas 100"); a tela desenha de cima para baixo, então volta
    // à ordem cronológica aqui
    messages: (since ? c.messages : [...c.messages].reverse()).map((m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      mediaType: m.mediaType,
      // mídia NUNCA viaja em base64 no JSON (deixava o celular de joelhos):
      // vira link que o navegador busca uma vez e guarda em cache
      mediaUrl:
        m.mediaUrl && m.mediaUrl.startsWith("data:")
          ? `/api/messages/${m.id}/media`
          : m.mediaUrl,
      fileName: m.fileName,
      status: m.status,
      error: m.error,
      body: m.body,
      authorName: m.author?.name ?? null,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            body: m.replyTo.body.slice(0, 140),
            direction: m.replyTo.direction,
          }
        : null,
      createdAt: m.createdAt.toISOString(),
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
      readAt: m.readAt?.toISOString() ?? null,
      editedAt: m.editedAt?.toISOString() ?? null,
      revoked: m.revoked,
      revokedBy: m.revokedBy,
    })),
  }));
}
