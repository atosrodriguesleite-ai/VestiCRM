import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { isAdmin } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { CommCenter, type CommEventItem } from "./comm-center";
import { WhatsappConnect } from "./whatsapp-connect";
import { SetoresManager } from "./setores-manager";
import { MergeDuplicates } from "./merge-duplicates";
import { ImportHistory } from "./import-history";

export const dynamic = "force-dynamic";

export default async function CommunicationPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [recentes, errosRecentes, sending, failed24, outrosErros24, received24, sent24, settings] =
    await Promise.all([
      db.commEvent.findMany({
        where: { companyId: user.companyId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // OS ERROS VÊM À PARTE.
      //
      // A lista mostra os 50 eventos mais recentes e o filtro "Erros" peneira
      // essa lista. Numa loja movimentada, os erros ficam para trás dos 50
      // últimos — e a tela dizia "97 falhas" com o filtro Erros vazio. Buscar
      // os erros numa consulta própria acaba com a contradição.
      db.commEvent.findMany({
        where: { companyId: user.companyId, status: "ERRO", createdAt: { gte: h24 } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.message.count({
        where: { conversation: { companyId: user.companyId }, status: "ENVIANDO" },
      }),
      // "não foi entregue" é SÓ envio que falhou. Contar qualquer erro aqui
      // transformava registro técnico em "mensagem perdida" na cara da lojista.
      db.commEvent.count({
        where: {
          companyId: user.companyId,
          status: "ERRO",
          type: { in: ["message.sent", "message.resent"] },
          createdAt: { gte: h24 },
        },
      }),
      db.commEvent.count({
        where: {
          companyId: user.companyId,
          status: "ERRO",
          type: { notIn: ["message.sent", "message.resent"] },
          createdAt: { gte: h24 },
        },
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
          // só envios de verdade — eventos de diagnóstico futuros não inflam
          type: { in: ["message.sent", "message.resent"] },
          createdAt: { gte: h24 },
        },
      }),
      db.commSettings.findUnique({ where: { companyId: user.companyId } }),
    ]);

  // junta recentes + erros do período, sem repetir, do mais novo para o mais velho
  const events = [...recentes, ...errosRecentes]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

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
      {isAdmin(user) && (
        <ImportHistory connected={settings?.evolutionStatus === "CONECTADO"} />
      )}
      {isAdmin(user) && <MergeDuplicates />}
      <SetoresManager />
      <CommCenter
        events={items}
        stats={{
          received24,
          sent24,
          failed24,
          outrosErros24,
          sending,
          avgLatency,
          provider: settings?.activeProvider ?? "MOCK",
        }}
      />
    </div>
  );
}
