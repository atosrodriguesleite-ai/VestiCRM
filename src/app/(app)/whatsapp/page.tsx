import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isManagerUp, podeOperarIntegracoes } from "@/lib/scope";
import { db } from "@/lib/db";
import { loadInboxConversations } from "@/lib/inbox-data";
import { centralDisponivel } from "@/lib/comm/central-disponivel";
import { ehLojaDemo } from "@/lib/gestao";
import { Inbox } from "./inbox";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string }>;
}) {
  const user = await requireUser();
  const { conv: conversaPedida } = await searchParams;

  // O RELÓGIO DA CARGA, marcado ANTES de ler o banco. A tela usa isto como
  // âncora do primeiro sync: o navegador do celular pode reabrir a página
  // com esta carga já VELHA (cache de navegação) — ancorando no relógio do
  // aparelho, tudo que mudou entre a carga e a reabertura nunca chegava
  // ("respondi e continua como não respondida").
  const carregadoEm = new Date().toISOString();

  // A CENTRAL SÓ APARECE PARA QUEM JÁ TEM WHATSAPP (RN-049). O pedido do
  // catálogo continua nascendo com conversa (RN-008/RN-010 — por trás nada
  // muda); o que a loja SEM WhatsApp vê é o convite para conectar, em vez
  // de uma fila que ninguém atende ali. E quem já conversou de verdade nunca
  // perde o histórico atrás dessa tela: a mensagem com id do WhatsApp é a
  // prova de que houve conexão, mesmo com ela caída ou desfeita hoje.
  // A prova de "já teve" é o carimbo da primeira conexão, que o Desconectar
  // nunca apaga — não a mensagem com id (o provedor simulado também carimba).
  const [conexao, loja] = await Promise.all([
    db.commSettings.findUnique({
      where: { companyId: user.companyId },
      select: { activeProvider: true, evolutionStatus: true, whatsappConectadoEm: true },
    }),
    db.company.findUnique({ where: { id: user.companyId }, select: { slug: true } }),
  ]);
  const mostraCentral = centralDisponivel({
    activeProvider: conexao?.activeProvider,
    evolutionStatus: conexao?.evolutionStatus,
    jaConectou: conexao?.whatsappConectadoEm != null,
    lojaDemo: ehLojaDemo(loja?.slug ?? ""),
  });
  // Quem chegou por um LINK para uma conversa específica ("Conversar no
  // sistema" na ficha, a resposta da Agenda, o sino) pediu aquela conversa —
  // o convite no lugar dela seria um beco sem saída (achado da revisão).
  if (!mostraCentral && !conversaPedida)
    return <ConecteOWhatsApp podeConectar={podeOperarIntegracoes(user)} />;

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
      // bloquear uma cliente é decisão da gerência (fecha a porta para a loja)
      podeGerenciar={isManagerUp(user)}
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

/**
 * O que a loja sem WhatsApp vê no lugar da fila e do chat. Os pedidos do
 * catálogo continuam na tela Pedidos e no sino — aqui só falta a conexão.
 * Conectar é trabalho de gerência/suporte (mesma régua da tela Comunicação);
 * a vendedora vê a quem pedir.
 */
function ConecteOWhatsApp({ podeConectar }: { podeConectar: boolean }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-50">
          <MessageCircle className="size-8 text-emerald-600" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Conecte o WhatsApp da loja</h1>
        <p className="mt-2 text-sm text-gray-600">
          Com o WhatsApp conectado, as conversas com as clientes aparecem aqui:
          fila de atendimento, chats e contatos, com o pedido de cada uma dentro
          da conversa.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Os pedidos do catálogo continuam chegando normalmente na tela{" "}
          <Link href="/pedidos" className="font-medium text-brand-600 underline underline-offset-2">
            Pedidos
          </Link>{" "}
          e no sino.
        </p>
        {podeConectar ? (
          <Link
            href="/comunicacao"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="size-4" />
            Conectar pelo QR Code
          </Link>
        ) : (
          <p className="mt-5 text-sm text-gray-500">
            Peça para a gerência conectar em <span className="font-medium">Comunicação</span>.
          </p>
        )}
      </div>
    </div>
  );
}
