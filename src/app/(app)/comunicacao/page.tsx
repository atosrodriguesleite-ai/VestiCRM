import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { isAdmin } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { CommCenter, type CommEventItem } from "./comm-center";
import { WhatsappConnect } from "./whatsapp-connect";

export const dynamic = "force-dynamic";

export default async function CommunicationPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [events, sending, failed24, received24, sent24, settings] =
    await Promise.all([
      db.commEvent.findMany({
        where: { companyId: user.companyId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.message.count({
        where: { conversation: { companyId: user.companyId }, status: "ENVIANDO" },
      }),
      db.commEvent.count({
        where: { companyId: user.companyId, status: "ERRO", createdAt: { gte: h24 } },
      }),
      db.commEvent.count({
        where: {
          companyId: user.companyId,
          direction: "IN",
          type: "message.received",
          createdAt: { gte: h24 },
        },
      }),
      db.commEvent.count({
        where: {
          companyId: user.companyId,
          direction: "OUT",
          createdAt: { gte: h24 },
        },
      }),
      db.commSettings.findUnique({ where: { companyId: user.companyId } }),
    ]);

  const latencies = events.filter((e) => e.durationMs > 0);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, e) => a + e.durationMs, 0) / latencies.length)
    : 0;

  const items: CommEventItem[] = events.map((e) => ({
    id: e.id,
    channel: e.channel,
    direction: e.direction,
    type: e.type,
    status: e.status,
    payload: e.payload,
    response: e.response,
    error: e.error,
    durationMs: e.durationMs,
    attempts: e.attempts,
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Central de Comunicação"
        subtitle="Monitor da Communication Engine: filas, webhooks, falhas e latência de todos os canais."
      />
      {isAdmin(user) && <WhatsappConnect canEdit={isAdmin(user)} />}
      <CommCenter
        events={items}
        stats={{
          received24,
          sent24,
          failed24,
          sending,
          avgLatency,
          provider: settings?.activeProvider ?? "MOCK",
        }}
      />
    </div>
  );
}
