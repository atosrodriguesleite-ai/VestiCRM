import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationScope } from "@/lib/scope";
import { catalogUrl, trackedCatalogLink, trackedLinkParts } from "@/lib/catalog-url";
import { Inbox, type InboxConversation } from "./inbox";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const user = await requireUser();

  const [conversations, templates, team, setores, tags, company] = await Promise.all([
    db.conversation.findMany({
      where: conversationScope(user),
      include: {
        customer: { include: { tags: { include: { tag: true } } } },
        assignee: true,
        setor: true,
        messages: { orderBy: { createdAt: "asc" }, include: { author: true } },
      },
      orderBy: { lastMessageAt: "desc" },
    }),
    db.messageTemplate.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    }),
    db.user.findMany({
      where: { companyId: user.companyId, active: true },
      select: { id: true, name: true, color: true },
    }),
    db.setor.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    db.tag.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
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

  const data: InboxConversation[] = conversations.map((c) => ({
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
      mediaUrl: m.mediaUrl,
      fileName: m.fileName,
      status: m.status,
      error: m.error,
      body: m.body,
      authorName: m.author?.name ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  return (
    <Inbox
      conversations={data}
      templates={templates.map((t) => ({
        id: t.id,
        title: t.title,
        body: t.body,
        category: t.category,
      }))}
      team={team}
      setores={setores}
      allTags={tags}
      currentUserId={user.id}
      currentUserName={user.name}
    />
  );
}
