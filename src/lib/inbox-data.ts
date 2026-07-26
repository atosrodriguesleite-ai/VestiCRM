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
        messages: { orderBy: { createdAt: "asc" }, include: { author: true } },
      },
      orderBy: { lastMessageAt: "desc" },
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
    messages: c.messages.map((m) => ({
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
      createdAt: m.createdAt.toISOString(),
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
      readAt: m.readAt?.toISOString() ?? null,
      editedAt: m.editedAt?.toISOString() ?? null,
      revoked: m.revoked,
      revokedBy: m.revokedBy,
    })),
  }));
}
