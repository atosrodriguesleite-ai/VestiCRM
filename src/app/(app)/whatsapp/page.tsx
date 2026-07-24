import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadInboxConversations } from "@/lib/inbox-data";
import { Inbox } from "./inbox";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const user = await requireUser();

  const [data, templates, team, setores, tags] = await Promise.all([
    loadInboxConversations(user),
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
  ]);

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
