import { db } from "./db";
import { conversationScope } from "./scope";
import { casaCliente } from "./busca";
import { catalogUrl, trackedCatalogLink, trackedLinkParts } from "./catalog-url";
import type { SessionUser } from "./auth";
import type { InboxConversation, InboxMessage } from "@/app/(app)/whatsapp/inbox";

/**
 * Conversas da inbox no formato que a tela consome — compartilhado entre o
 * carregamento inicial (página) e o sync incremental (GET /api/conversations,
 * que passa `since` para trazer só o que mudou desde a última busca).
 */
/**
 * QUANTO A TELA RECEBE AO ABRIR.
 *
 * A LISTA não carrega conversa: carrega SÓ A ÚLTIMA MENSAGEM de cada uma
 * (é o único texto que a lista mostra). O histórico vem quando a conversa é
 * aberta, uma por vez.
 *
 * Medido numa loja de 2.007 conversas e 120 mil mensagens: com 100 mensagens
 * por conversa a abertura pesava 4,5 MB e ainda assim mostrava só 200
 * conversas. Chat comercial vive com milhares de conversas — a lista tem que
 * ser leve por construção, não por sorte.
 */
const CONVERSAS_NA_ABERTURA = 2000;
const MENSAGENS_NA_ABERTURA = 100;
/** Só a última: é o que a lista escreve embaixo do nome. */
const MENSAGENS_NA_LISTA = 1;
/**
 * A lista mostra UMA LINHA da última mensagem — o resto do texto não serve
 * para nada nela. E a mensagem real do catálogo tem MILHARES de caracteres
 * (o pedido inteiro): sem cortar, mil conversas dessas viram megabytes de
 * texto que ninguém lê. O texto completo vem quando a conversa é aberta.
 */
const PREVIA_MAX = 140;

/**
 * @param since  sync incremental: só o que mudou desde então
 * @param convId UMA conversa específica, com o histórico recente COMPLETO.
 *   Existe porque o sync entrega só o que mudou: uma conversa que chega à
 *   tela por ele (a loja tem mais conversas do que cabe na carga inicial)
 *   viria com uma mensagem só, e o atendimento parecia nunca ter acontecido.
 */
export async function loadInboxConversations(
  user: SessionUser,
  since?: Date,
  convId?: string
): Promise<InboxConversation[]> {
  // lista = sem `since` e sem conversa específica: só a prévia de cada uma
  const soPrevia = !since && !convId;
  const [conversations, company] = await Promise.all([
    db.conversation.findMany({
      where: {
        ...conversationScope(user),
        // pedindo UMA conversa, o histórico dela vem inteiro (o `since` não
        // se aplica: o pedido é justamente "me dá tudo dessa aqui")
        ...(convId ? { id: convId } : since ? { updatedAt: { gt: since } } : {}),
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
        messages: since && !convId
          ? {
              where: { updatedAt: { gt: since } },
              orderBy: { createdAt: "asc" },
              select: MENSAGEM_LEVE,
            }
          : {
              orderBy: { createdAt: "desc" },
              take: soPrevia ? MENSAGENS_NA_LISTA : MENSAGENS_NA_ABERTURA,
              select: MENSAGEM_LEVE,
            },
      },
      orderBy: { lastMessageAt: "desc" },
      // conversa que não recebe mensagem há muito tempo não precisa estar na
      // memória do navegador; a busca continua achando pelo servidor
      ...(since || convId ? {} : { take: CONVERSAS_NA_ABERTURA }),
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
  // VISÃO TOTAL NÃO LEVA A VENDA DA COLEGA (achado da revisão de 17/08/2026):
  // na conversa assumida por OUTRA pessoa, o link oferecido sai com o ref de
  // QUEM ATENDE — pela RN-005, quem manda o link leva a venda E a carteira, e
  // a vendedora com visão total do chat está ali para acompanhar, não para
  // virar dona da cliente da colega com dois cliques.
  const refDaConversa = (c: {
    assigneeId: string | null;
    assignee: { name: string; role: string } | null;
  }): string | null =>
    user.role === "SELLER" &&
    user.chatVisaoTotal &&
    c.assigneeId &&
    c.assigneeId !== user.id &&
    c.assignee
      ? trackedLinkParts(c.assignee, company?.slug ?? "").sellerRef
      : sellerRef;
  const linkForCustomer = (
    linkCode: string | null,
    id: string,
    c: { assigneeId: string | null; assignee: { name: string; role: string } | null }
  ) => trackedCatalogLink(catalogBase, refDaConversa(c), linkCode ?? id);

  // presença de mídia em lote (uma consulta para todas as mensagens da carga)
  const comMidia = await idsComMidia(
    conversations.flatMap((c) =>
      c.messages.filter((m) => m.mediaType !== "TEXT").map((m) => m.id)
    )
  );

  return conversations.map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    priority: c.priority,
    unreadCount: c.unreadCount,
    // fixada no topo / favorita (menu de clique-direito na conversa)
    pinned: c.pinned,
    favorite: c.favorite,
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
      // bloqueada no WhatsApp da loja (nulo = não está)
      blockedAt: c.customer.blockedAt?.toISOString() ?? null,
      // nome que ela usa no WhatsApp (RN-024): quem é a pessoa por trás
      // de uma ficha que virou razão social
      waName: c.customer.waName ?? null,
      wholesale: c.customer.type !== "VAREJO",
      catalogLink: linkForCustomer(c.customer.linkCode, c.customer.id, c),
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
    messages: (since && !convId ? c.messages : [...c.messages].reverse()).map(
      (m) => {
        const msg = mapMessage({ ...m, temMidia: comMidia.has(m.id) });
        return soPrevia && msg.body.length > PREVIA_MAX
          ? { ...msg, body: msg.body.slice(0, PREVIA_MAX) }
          : msg;
      }
    ),
  }));
}

/**
 * OS CAMPOS QUE A TELA USA — SEM `mediaUrl`.
 *
 * `mediaUrl` guarda a foto/áudio INTEIRO em base64. Um `include` inocente
 * puxava esses megabytes do banco em TODA carga (lista, abertura de conversa,
 * mensagens antigas) só para o `mapMessage` jogar fora e mandar o link.
 * Era o que fazia "carregar as mensagens" demorar: a tela pedia texto e o
 * banco despachava as fotos junto. Agora a mídia só sai do banco quando o
 * navegador pede o arquivo (rota /api/messages/[id]/media, com cache).
 *
 * O autor também vem SÓ com o nome — `author: true` trazia a linha inteira
 * do usuário (com a senha criptografada) do banco à toa.
 */
export const MENSAGEM_LEVE = {
  id: true,
  direction: true,
  kind: true,
  mediaType: true,
  fileName: true,
  status: true,
  error: true,
  body: true,
  createdAt: true,
  deliveredAt: true,
  readAt: true,
  editedAt: true,
  revoked: true,
  revokedBy: true,
  // emoji grudado na mensagem: `reaction` = da cliente, `reactionStore` = da loja
  reaction: true,
  reactionStore: true,
  author: { select: { name: true } },
  replyTo: { select: { id: true, body: true, direction: true } },
} as const;

/**
 * Quais destas mensagens TÊM mídia gravada? Consulta só o "existe ou não"
 * (o banco confere IS NOT NULL sem despachar o conteúdo) — é o que permite
 * montar o link da mídia sem nunca ler o base64.
 */
export async function idsComMidia(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.message.findMany({
    where: { id: { in: ids }, mediaUrl: { not: null } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * O FORMATO DA MENSAGEM NA TELA — um lugar só.
 *
 * A carga inicial, o sync e a busca de mensagens antigas precisam entregar
 * exatamente o mesmo formato. Quando isso estava copiado em mais de um
 * lugar, bastava alguém mexer num que a mensagem antiga chegava diferente
 * da nova (sem autor, sem recibo) — e ninguém percebia até a loja reclamar.
 */
export function mapMessage(m: {
  id: string;
  direction: string;
  kind: string;
  mediaType: string | null;
  /** presente só nos caminhos antigos; os novos passam `temMidia` */
  mediaUrl?: string | null;
  /** a mensagem tem mídia gravada? (calculado sem ler o base64) */
  temMidia?: boolean;
  fileName: string | null;
  status: string | null;
  error: string | null;
  body: string;
  author?: { name: string } | null;
  replyTo?: { id: string; body: string; direction: string } | null;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  editedAt: Date | null;
  revoked: boolean;
  revokedBy: string | null;
  reaction?: string | null;
  reactionStore?: string | null;
}): InboxMessage {
  return {
    id: m.id,
    direction: m.direction as InboxMessage["direction"],
    kind: m.kind as InboxMessage["kind"],
    mediaType: (m.mediaType ?? "TEXT") as InboxMessage["mediaType"],
    // mídia NUNCA viaja em base64 no JSON (deixava o celular de joelhos):
    // vira link que o navegador busca uma vez e guarda em cache. A rota
    // resolve tanto o base64 gravado quanto link externo (redireciona).
    mediaUrl:
      m.mediaUrl !== undefined
        ? m.mediaUrl && m.mediaUrl.startsWith("data:")
          ? `/api/messages/${m.id}/media`
          : m.mediaUrl
        : m.temMidia
          ? `/api/messages/${m.id}/media`
          : null,
    fileName: m.fileName,
    status: m.status ?? "",
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
    reaction: m.reaction ?? null,
    reactionStore: m.reactionStore ?? null,
  };
}

/** Teto de conversas devolvidas numa busca (a tela mostra uma lista, não um censo). */
const RESULTADOS_DA_BUSCA = 60;

/**
 * BUSCA DE CONVERSA NA LOJA INTEIRA.
 *
 * A tela abre com as conversas mais recentes; a cliente antiga não está lá.
 * Filtrar só o que está na tela fazia a lupa "não achar" justamente quem a
 * vendedora não lembrava de cabeça — o caso em que a busca serve para algo.
 *
 * O casamento acontece em memória com `casaCliente` (o mesmo da tela de
 * Clientes): é o único jeito de ignorar ACENTO de forma confiável — o banco
 * ignora maiúscula, mas "goiania" não acha "Goiânia". Para isso a varredura
 * lê só os dados do contato (sem mensagem nenhuma), que é barato; as
 * mensagens só são carregadas das conversas que casaram.
 */
export async function buscarConversas(
  user: SessionUser,
  termo: string
): Promise<InboxConversation[]> {
  const candidatas = await db.conversation.findMany({
    where: conversationScope(user),
    select: {
      id: true,
      lastMessageAt: true,
      customer: {
        select: {
          name: true,
          phone: true,
          city: true,
          state: true,
          cpf: true,
          cnpj: true,
          waName: true, // a lupa acha pelo nome do WhatsApp (RN-024)
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const ids = candidatas
    .filter((c) => casaCliente(c.customer, termo))
    .slice(0, RESULTADOS_DA_BUSCA)
    .map((c) => c.id);
  if (ids.length === 0) return [];

  // carrega as que casaram, com o histórico recente de cada uma
  const achadas = await Promise.all(
    ids.map((id) => loadInboxConversations(user, undefined, id))
  );
  return achadas.flat();
}
