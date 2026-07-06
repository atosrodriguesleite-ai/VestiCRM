import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationScope } from "@/lib/scope";
import { Inbox, type InboxConversation } from "./inbox";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const user = await requireUser();

  const [conversations, templates, team] = await Promise.all([
    db.conversation.findMany({
      where: conversationScope(user),
      include: {
        customer: { include: { tags: { include: { tag: true } } } },
        assignee: true,
        messages: { orderBy: { createdAt: "asc" }, include: { author: true } },
      },
      orderBy: { lastMessageAt: "desc" },
    }),
    db.messageTemplate.findMany({ where: { companyId: user.companyId } }),
    db.user.findMany({
      where: { companyId: user.companyId, active: true },
      select: { id: true, name: true, color: true },
    }),
  ]);

  const data: InboxConversation[] = conversations.map((c) => ({
    id: c.id,
    status: c.status,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt.toISOString(),
    customer: {
      id: c.customer.id,
      name: c.customer.name,
      phone: c.customer.phone,
      city: c.customer.city,
      tags: c.customer.tags.map((t) => ({
        name: t.tag.name,
        color: t.tag.color,
      })),
    },
    assignee: c.assignee
      ? { id: c.assignee.id, name: c.assignee.name, color: c.assignee.color }
      : null,
    messages: c.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      body: m.body,
      authorName: m.author?.name ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  return (
    <Inbox
      conversations={data}
      templates={templates.map((t) => ({ id: t.id, title: t.title, body: t.body }))}
      team={team}
      currentUserName={user.name}
    />
  );
}
