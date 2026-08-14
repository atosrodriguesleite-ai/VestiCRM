import { requireUser } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { db } from "@/lib/db";
import { loadInboxConversations } from "@/lib/inbox-data";
import { Inbox } from "./inbox";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const user = await requireUser();

  // O RELÓGIO DA CARGA, marcado ANTES de ler o banco. A tela usa isto como
  // âncora do primeiro sync: o navegador do celular pode reabrir a página
  // com esta carga já VELHA (cache de navegação) — ancorando no relógio do
  // aparelho, tudo que mudou entre a carga e a reabertura nunca chegava
  // ("respondi e continua como não respondida").
  const carregadoEm = new Date().toISOString();

  const [data, templates, team, setores, tags, comm, campanhas] = await Promise.all([
    loadInboxConversations(user),
    db.messageTemplate.findMany({
      where: { companyId: user.companyId },
      // a posição é escolhida pela loja (setinhas ↑↓); categoria/título é só
      // o desempate de cadastros antigos que nunca foram reordenados
      orderBy: [{ order: "asc" }, { category: "asc" }, { title: "asc" }],
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
    db.commSettings.findUnique({
      where: { companyId: user.companyId },
      select: { catalogLinkMsg: true, orderMsg: true },
    }),
    // campanhas ativas: para resolver "de qual anúncio veio" dentro do chat
    db.marketingCampaign.findMany({
      where: { companyId: user.companyId, active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <Inbox
      campanhas={campanhas}
      podeVincularCampanha={isManagerUp(user)}
      conversations={data}
      carregadoEm={carregadoEm}
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
      catalogMsg={comm?.catalogLinkMsg ?? null}
      orderMsg={comm?.orderMsg ?? null}
      canEditCatalogMsg={true}
    />
  );
}
