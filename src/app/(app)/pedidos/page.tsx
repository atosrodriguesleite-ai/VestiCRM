import Link from "next/link";
import { whereDaCampanha } from "@/lib/campanha-pedidos";
import { ShoppingBag, Download, Search, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderScope, veTodosPedidos, isManagerUp } from "@/lib/scope";
import { brl, dateShort, timeShort } from "@/lib/format";
import {
  orderStatusLabel,
  orderNumber,
  ORDER_STATUS_FLOW,
  vendaOnline,
} from "@/lib/orders";
import { Card, PageHeader, Avatar, Badge, EmptyState } from "@/components/ui";
import { NewOrderButton } from "./new-order";
import { ImportarMensagemButton } from "./importar-mensagem";
import { RowStatusMenu } from "./row-status-menu";
import type { OrderStatus, Prisma } from "@prisma/client";
import { classificarBusca, clientesDaBusca } from "@/lib/busca-de-pedidos";

// converte YYYY-MM-DD (fuso de São Paulo, UTC-3) em Date UTC
const SP_OFFSET = 3 * 60 * 60 * 1000;
function spDayStart(d: string) {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
}
function spDayEnd(d: string) {
  const t = Date.parse(`${d}T23:59:59.999Z`);
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
}

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; de?: string; ate?: string; canal?: string; vendedora?: string; q?: string; pagina?: string; campanha?: string }>;
}) {
  const user = await requireUser();
  const { status, de, ate, canal: canalRaw, vendedora: vendedoraRaw, q: qRaw, pagina: paginaRaw, campanha: campanhaRaw } = await searchParams;
  // canal da venda: nuvemshop | atacadopro (catálogo/WhatsApp/manual) | todos
  const canal = canalRaw === "nuvemshop" || canalRaw === "atacadopro" ? canalRaw : null;
  // filtro "sem vendedora": pedido pago sem dona não conta na comissão de
  // ninguém (auditoria Entre Linhas, 28/08/2026) — este filtro existe para a
  // gerência achá-los e atribuir a dona. SÓ para quem já vê a loja inteira:
  // para a vendedora comum o parâmetro é ignorado (o escopo dela é ela mesma,
  // e aplicar sellerId nulo por cima furaria a RN-007).
  const veLojaInteira = veTodosPedidos(user);
  const semVendedora = vendedoraRaw === "sem" && veLojaInteira;
  // busca inteligente: número curto = código do pedido, número comprido =
  // telefone (tolerante ao 9º dígito), texto = nome da cliente (sem acento)
  const q = (qRaw ?? "").trim();
  const buscando = q.length > 0;
  const busca = buscando ? classificarBusca(q) : null;

  const from = de ? spDayStart(de) : null;
  const to = ate ? spDayEnd(ate) : null;

  const where: Prisma.OrderWhereInput = orderScope(user);
  // a busca encontra o pedido em qualquer status; quem limita o que aparece
  // continua sendo o orderScope (RN-007) — o recorte da busca é só de cliente
  let buscaEstourou = false;
  if (busca) {
    if (busca.tipo === "codigo") {
      where.number = busca.numero;
    } else {
      const { ids, estourou } = await clientesDaBusca(user.companyId, busca);
      buscaEstourou = estourou;
      // nenhum cliente casou: id impossível para a lista vir vazia (em vez
      // de um `in: []` esquecido virar "sem filtro" numa refatoração futura)
      where.customerId = ids.length ? { in: ids } : "busca-sem-resultado";
    }
  }
  if (!buscando && status && ORDER_STATUS_FLOW.includes(status as OrderStatus)) {
    where.status = status as OrderStatus;
  }
  if (from || to) {
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  // PEDIDOS DE UMA CAMPANHA (RN-040): é o caminho que faltava entre o número
  // do cartão da campanha e o pedido em si — a lojista via "1 pedido" e não
  // tinha como chegar nele (relato do dono, 01/09/2026).
  // o que vem da URL não é promessa de texto: `?campanha=a&campanha=b` chega
  // como ARRAY em runtime, e um `.trim()` em cima derrubava a tela inteira
  const campanhaBruta = Array.isArray(campanhaRaw) ? campanhaRaw[0] : campanhaRaw;
  const campanhaSlug =
    (typeof campanhaBruta === "string" ? campanhaBruta : "").trim().toLowerCase() || null;
  let campanhaWhere: Prisma.OrderWhereInput | null = null;
  const campanha = campanhaSlug
    ? await db.trackCampaign.findFirst({
        where: { companyId: user.companyId, slug: campanhaSlug },
        select: { id: true, name: true, slug: true },
      })
    : null;
  if (campanha) {
    // pela CAMPANHA, não pelo texto do `?ref=`: é a mesma régua que o cartão
    // da Inteligência usa para contar, e número que não bate com a lista
    // deixaria a lojista procurando de novo
    // TODAS as visitas da campanha, com teto. Recortar por `converted` foi
    // tentado e recusado na revisão: aquele campo é gravado em best-effort
    // (`.catch(() => {})` na rota do pedido), então um pedido PAGO de verdade
    // podia sumir da conta e da lista por causa de uma marca que falhou. O
    // teto existe porque o `IN` cresce com os cliques; acima dele, o pedido
    // ainda é achado pelo carimbo (`Order.campaignRef`).
    const sessoes = await db.trackSession.findMany({
      where: { companyId: user.companyId, campaignId: campanha.id },
      select: { id: true },
      orderBy: { startedAt: "desc" },
      take: 5000,
    });
    campanhaWhere = whereDaCampanha(campanha.slug, sessoes.map((x) => x.id));
  } else if (campanhaSlug) {
    // pediram uma campanha que não existe (link velho, endereço digitado
    // errado, campanha excluída): mostrar a LOJA INTEIRA como se fossem dela
    // seria pior que mostrar nada — a lojista leria pedido de outra origem
    // como resultado da campanha
    campanhaWhere = { id: "campanha-inexistente" };
  }
  /** Junta o recorte da campanha sem brigar com o `OR` do orderScope (RN-007). */
  const comCampanha = (base: Prisma.OrderWhereInput): Prisma.OrderWhereInput =>
    campanhaWhere
      ? {
          ...base,
          AND: [
            ...(Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : []),
            campanhaWhere,
          ],
        }
      : base;
  Object.assign(where, comCampanha(where));

  if (canal === "nuvemshop") where.source = "NUVEMSHOP";
  if (canal === "atacadopro") where.source = { not: "NUVEMSHOP" };
  if (!buscando && semVendedora) where.sellerId = null;

  // filtros cruzados: os chips de STATUS respeitam o canal escolhido e os
  // chips de CANAL respeitam o status escolhido — os números sempre batem
  // com a lista exibida (antes cada grupo de chips ignorava o outro filtro)
  const canalWhere: Prisma.OrderWhereInput =
    canal === "nuvemshop"
      ? { source: "NUVEMSHOP" }
      : canal === "atacadopro"
        ? { source: { not: "NUVEMSHOP" } }
        : {};
  const statusWhere: Prisma.OrderWhereInput =
    !buscando && status && ORDER_STATUS_FLOW.includes(status as OrderStatus)
      ? { status: status as OrderStatus }
      : {};
  const periodoWhere: Prisma.OrderWhereInput =
    from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {};
  const vendedoraWhere: Prisma.OrderWhereInput =
    !buscando && semVendedora ? { sellerId: null } : {};

  // NENHUM PEDIDO SOME: a lista mostra 100 por vez (pedido tem foto, cliente,
  // vendedor — carregar milhares de uma vez derrubaria a tela no celular),
  // mas TODO o histórico fica alcançável pelas páginas. Antes o corte nos 100
  // mais recentes era mudo: pedido antigo "sumia" e a vendedora só achava
  // pela busca (relato real, 18/08/2026 — o histórico é para sempre).
  const POR_PAGINA = 100;
  // na busca por CÓDIGO o resultado é um pedido só: sempre página 1. Busca
  // por nome/telefone pode passar de 100 pedidos — aí as páginas valem.
  const paginaPedida =
    busca?.tipo === "codigo"
      ? 1
      : (() => {
          const n = Number(paginaRaw ?? "1");
          return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
        })();

  // pedidos criados no MESMO instante (dois checkouts do catálogo, webhooks
  // da Nuvemshop) precisam de um desempate ESTÁVEL entre as páginas — só a
  // data deixava o banco livre para pôr o mesmo pedido nas duas páginas (ou
  // em nenhuma, o "sumiço" de novo). O nº do pedido é único na loja.
  const ordenacao = [
    { createdAt: "desc" as const },
    { number: "desc" as const },
  ];
  const listar = (p: number) =>
    db.order.findMany({
      where,
      include: {
        customer: true,
        seller: true,
        items: { take: 3 },
        _count: { select: { items: true } },
      },
      orderBy: ordenacao,
      skip: (p - 1) * POR_PAGINA,
      take: POR_PAGINA,
    });

  let pagina = paginaPedida;
  // a contagem por CANAL entrou nesta mesma rodada: era uma terceira ida ao
  // banco, sozinha, lá embaixo — e não dependia de nada (velocidade, 20/08/2026)
  // eslint-disable-next-line prefer-const -- orders é reatribuído no ajuste de página abaixo
  let [orders, counts, bySource, semDonaCount, buscaTotal] = await Promise.all([
    listar(pagina),
    // na busca os chips somem — as duas contagens por grupo seriam jogadas
    // fora (mesma razão do guard do semDonaCount logo abaixo)
    buscando
      ? Promise.resolve([])
      : db.order.groupBy({
          by: ["status"],
          where: comCampanha({ ...orderScope(user), ...periodoWhere, ...canalWhere, ...vendedoraWhere }),
          _count: true,
        }),
    buscando
      ? Promise.resolve([])
      : db.order.groupBy({
          by: ["source"],
          where: comCampanha({ ...orderScope(user), ...periodoWhere, ...statusWhere, ...vendedoraWhere }),
          _count: true,
        }),
    // o número do chip "Sem vendedora" — mesma regra dos outros grupos de
    // chips: respeita todos os filtros MENOS a própria dimensão. Na busca por
    // código os chips nem aparecem: não gasta uma ida ao banco à toa.
    veLojaInteira && !buscando
      ? db.order.count({
          where: comCampanha({
            ...orderScope(user),
            ...periodoWhere,
            ...statusWhere,
            ...canalWhere,
            sellerId: null,
          }),
        })
      : Promise.resolve(0),
    // total da BUSCA por nome/telefone: pode passar de uma página, e sem a
    // conta as páginas seguintes ficariam inalcançáveis
    buscando ? db.order.count({ where }) : Promise.resolve(0),
  ]);

  const countByStatus = Object.fromEntries(
    counts.map((c) => [c.status, c._count])
  );
  const totalCount = counts.reduce((s, c) => s + c._count, 0);
  // o total da lista atual já sai da conta por status (nenhuma consulta a mais)
  const totalFiltrado = buscando
    ? buscaTotal
    : status && ORDER_STATUS_FLOW.includes(status as OrderStatus)
      ? (countByStatus[status] ?? 0)
      : totalCount;
  const ultimaPagina = Math.max(1, Math.ceil(totalFiltrado / POR_PAGINA));
  // link velho apontando além do fim (a lista encolheu): cai na última página
  if (orders.length === 0 && pagina > 1) {
    pagina = ultimaPagina;
    orders = await listar(pagina);
  }

  const nsCount = bySource.find((r) => r.source === "NUVEMSHOP")?._count ?? 0;
  const apCount = bySource.filter((r) => r.source !== "NUVEMSHOP").reduce((a, r) => a + r._count, 0);
  // UM montador de endereço para todos os filtros da tela: trocar filtro
  // volta para a página 1; navegar de página mantém os filtros. (Eram três
  // montadores copiados — quem adicionasse um filtro novo esquecia um deles
  // e o filtro caía em silêncio ao navegar.)
  const href = (
    muda: {
      status?: string | null;
      canal?: string | null;
      vendedora?: string | null;
      semPeriodo?: boolean;
      pagina?: number;
      campanha?: string | null;
    } = {}
  ) => {
    const s = muda.status !== undefined ? muda.status : status;
    const c = muda.canal !== undefined ? muda.canal : canal;
    const v = muda.vendedora !== undefined ? muda.vendedora : semVendedora ? "sem" : null;
    const p = muda.pagina ?? 1;
    // o filtro de campanha viaja junto: sem isso, trocar de status ou de
    // página jogava a lojista de volta na lista inteira
    const camp = muda.campanha !== undefined ? muda.campanha : (campanha?.slug ?? null);
    return `/pedidos?${[
      s ? `status=${s}` : "",
      !muda.semPeriodo && de ? `de=${de}` : "",
      !muda.semPeriodo && ate ? `ate=${ate}` : "",
      c ? `canal=${c}` : "",
      v ? `vendedora=${v}` : "",
      // a busca viaja junto ao trocar de página (senão a página 2 da busca
      // por nome voltava para a lista inteira)
      buscando ? `q=${encodeURIComponent(q)}` : "",
      camp ? `campanha=${encodeURIComponent(camp)}` : "",
      p > 1 ? `pagina=${p}` : "",
    ]
      .filter(Boolean)
      .join("&")}`.replace(/\?$/, "");
  };
  const pageHref = (p: number) => href({ pagina: p });
  const canalHref = (c: string | null) => href({ canal: c });

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Pedidos"
        subtitle="Todos os pedidos e orçamentos da loja, do carrinho à entrega."
        action={
          <div className="flex items-center gap-2">
            <a
              href="/api/export/pedidos"
              download
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition"
            >
              <Download className="size-4" />
              CSV
            </a>
            <ImportarMensagemButton />
            <NewOrderButton />
          </div>
        }
      />

      {/* Busca inteligente — nome, telefone ou código; para todos os usuários */}
      <form method="GET" className="mb-4">
        <div className="relative">
          <Search className="size-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome, telefone ou código do pedido (ex.: Maria, 82 99999-1234 ou #0042)"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-24 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3 py-1.5 transition">
            Buscar
          </button>
        </div>
      </form>

      {buscando && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-2.5">
          <p className="text-sm text-slate-600">
            {orders.length === 0 ? (
              <>Nenhum pedido encontrado para <b className="text-slate-800">{q}</b>.</>
            ) : busca?.tipo === "codigo" ? (
              <>Resultado para o código <b className="text-slate-800">{q.startsWith("#") ? q : `#${q.replace(/\D/g, "")}`}</b></>
            ) : busca?.tipo === "telefone" ? (
              <>
                {totalFiltrado} pedido{totalFiltrado === 1 ? "" : "s"} do telefone{" "}
                <b className="text-slate-800">{q}</b>
              </>
            ) : (
              <>
                {totalFiltrado} pedido{totalFiltrado === 1 ? "" : "s"} de cliente com{" "}
                <b className="text-slate-800">{q}</b> no nome
              </>
            )}
            {buscaEstourou && (
              <>
                {" "}
                — busca muito aberta: parte dos clientes parecidos ficou de fora.
                Digite mais letras (ou o telefone) para afinar.
              </>
            )}
          </p>
          <Link href="/pedidos" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            <X className="size-3.5" /> Limpar busca
          </Link>
        </div>
      )}

      {/* Filtro de período (fuso de São Paulo) */}
      {!buscando && (
      <>
      <form className="flex flex-wrap items-end gap-2 mb-4" method="GET">
        {status && <input type="hidden" name="status" value={status} />}
        {canal && <input type="hidden" name="canal" value={canal} />}
        {semVendedora && <input type="hidden" name="vendedora" value="sem" />}
        {campanha && <input type="hidden" name="campanha" value={campanha.slug} />}
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
          <input type="date" name="de" defaultValue={de ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
        </div>
        <button className="rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition">
          Filtrar
        </button>
        {(de || ate) && (
          // pelo montador único: limpar o período NÃO derruba os outros
          // filtros (o link antigo, montado à mão, perdia canal e vendedora)
          <Link href={href({ semPeriodo: true })} className="text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-2.5">
            Limpar período
          </Link>
        )}
      </form>

      {/* Canal da venda: tudo, só AtacadoPro (catálogo/WhatsApp/manual) ou só Nuvemshop */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {[
          { c: null, label: `Todos os canais (${apCount + nsCount})` },
          { c: "atacadopro", label: `AtacadoPro (${apCount})` },
          { c: "nuvemshop", label: `Nuvemshop (${nsCount})` },
        ].map((o) => (
          <Link
            key={o.label}
            href={canalHref(o.c)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              canal === o.c
                ? o.c === "nuvemshop"
                  ? "bg-cyan-700 text-white"
                  : "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {o.label}
          </Link>
        ))}
        {/* pedido sem dona não conta na comissão de ninguém — o chip acende
            em âmbar para a gerência achar e atribuir (só quem vê a loja toda) */}
        {veLojaInteira && (
          <Link
            href={href({ vendedora: semVendedora ? null : "sem" })}
            className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              semVendedora
                ? "bg-amber-500 text-white"
                : "bg-white border border-amber-300 text-amber-700 hover:border-amber-400"
            }`}
          >
            Sem vendedora ({semDonaCount})
          </Link>
        )}
      </div>

      {/* De onde a lojista veio: o número do cartão da campanha. A faixa diz
          o que ela está vendo e como sair — filtro sem saída assusta. */}
      {!campanha && campanhaSlug && (
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-sm text-amber-800">
            ⚠️ Não existe campanha com o endereço <b>{campanhaSlug}</b> nesta
            loja (pode ter sido excluída ou o link está errado).
          </p>
          <Link
            href={href({ campanha: null })}
            className="text-xs font-semibold text-amber-800 hover:underline whitespace-nowrap"
          >
            Ver todos os pedidos
          </Link>
        </div>
      )}

      {campanha && (
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5">
          <p className="text-sm text-brand-800">
            🏷 Mostrando só os pedidos que vieram da campanha{" "}
            <b>{campanha.name}</b>.
          </p>
          <Link
            href={href({ campanha: null })}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
          >
            Ver todos os pedidos
          </Link>
        </div>
      )}

      {semVendedora && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="text-sm text-amber-800">
            Estes pedidos não contam na comissão nem na meta de ninguém — por
            isso a soma das vendedoras fica menor que o faturamento. Venda da
            Nuvemshop fica assim mesmo (loja online não gera comissão);{" "}
            {/* a instrução só para quem PODE definir a dona (gerência): para
                suporte e vendedora com visão total, "mostra, não mexe" —
                mandá-los ao botão que a API recusa seria promessa falsa */}
            {isManagerUp(user) ? (
              <>nas demais, abra o pedido e defina a vendedora em <b>&ldquo;Editar dados&rdquo;</b>.</>
            ) : (
              <>nas demais, avise a gerência para definir a vendedora.</>
            )}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-4 pb-1">
        <Link
          href={href({ status: null })}
          className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
            !status
              ? "bg-brand-600 text-white"
              : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
          }`}
        >
          Todos ({totalCount})
        </Link>
        {ORDER_STATUS_FLOW.map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
              status === s
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {orderStatusLabel[s]}
            {countByStatus[s] ? ` (${countByStatus[s]})` : ""}
          </Link>
        ))}
      </div>
      </>
      )}

      {orders.length === 0 ? (
        <Card>
          {/* o texto antigo mandava "monte pelo WhatsApp" — instrução
              impossível para quem ainda nem conectou. Agora aponta o
              caminho real: publicar/compartilhar o catálogo. */}
          <EmptyState
            icon={<ShoppingBag />}
            title={buscando ? "Nenhum pedido encontrado" : "Nenhum pedido ainda"}
            hint={
              buscando
                ? busca?.tipo === "codigo"
                  ? "Confira o número do pedido e tente de novo."
                  : "Confira o nome ou o telefone e tente de novo — dá para buscar também pelo código do pedido (ex.: #0042)."
                : "Os pedidos aparecem aqui quando alguém compra pelo seu catálogo ou quando você monta um na conversa do WhatsApp."
            }
            action={
              buscando ? undefined : (
                <Link
                  href="/configuracoes/catalogo"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
                >
                  Ver e compartilhar meu catálogo
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <>
        <div className="space-y-2">
          {orders.map((o) => (
            <Link key={o.id} href={`/pedidos/${o.id}`} className="block">
              <Card className="p-4 hover:shadow-pop transition">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <span className="text-sm font-bold text-brand-700 tabular-nums shrink-0 w-11 sm:w-14">
                    {orderNumber(o.number)}
                  </span>
                  <Avatar name={o.customer.name} color={o.seller?.color ?? "#c4622d"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {o.customer.name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {o._count.items}{" "}
                      {o._count.items === 1 ? "item" : "itens"} ·{" "}
                      {o.items.map((i) => i.name).join(", ")}
                    </p>
                    {/* celular: selos numa 2ª linha, dentro da coluna (cabe na tela) */}
                    <div className="sm:hidden mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {o.source === "NUVEMSHOP" ? (
                        <Badge color="#0891B2">Nuvemshop</Badge>
                      ) : (
                        <Badge color="#C4622D">AtacadoPro</Badge>
                      )}
                      {/* Nuvemshop sem dona é o certo (RN-005) — o alerta é só
                          para venda que PODERIA ter vendedora e não tem */}
                      {veLojaInteira && !o.seller && !vendaOnline(o) && (
                        <Badge color="#D97706">sem vendedora</Badge>
                      )}
                      <RowStatusMenu orderId={o.id} current={o.status} />
                    </div>
                  </div>
                  <div className="hidden sm:block text-right shrink-0">
                    <p className="text-xs text-gray-400">
                      {dateShort(o.createdAt)} {timeShort(o.createdAt)}
                    </p>
                    {/* "—" mudo escondia o problema: sem dona = sem comissão.
                        Nuvemshop fica cinza: sem vendedora ali é o esperado */}
                    {o.seller ? (
                      <p className="text-xs text-gray-400">{o.seller.name}</p>
                    ) : vendaOnline(o) ? (
                      <p className="text-xs text-gray-400">loja online</p>
                    ) : veLojaInteira ? (
                      <p className="text-xs font-semibold text-amber-600">sem vendedora</p>
                    ) : (
                      <p className="text-xs text-gray-400">—</p>
                    )}
                  </div>
                  {/* selos no computador (inalterado) */}
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    {o.source === "NUVEMSHOP" ? (
                      <Badge color="#0891B2">Nuvemshop</Badge>
                    ) : (
                      <Badge color="#C4622D">AtacadoPro</Badge>
                    )}
                    <RowStatusMenu orderId={o.id} current={o.status} />
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0 w-20 sm:w-24 text-right whitespace-nowrap">
                    {brl(o.total)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {/* Rodapé da lista: deixa claro que o histórico está TODO aqui e dá
            o caminho para os antigos — o corte mudo nos 100 mais recentes
            fazia pedido antigo parecer apagado. Vale TAMBÉM na busca por
            nome/telefone (pode passar de 100 pedidos); só a busca por
            código, que devolve um pedido só, fica sem rodapé. */}
        {busca?.tipo !== "codigo" && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs text-gray-400 tabular-nums order-last sm:order-none">
              Mostrando {(pagina - 1) * POR_PAGINA + 1}–
              {(pagina - 1) * POR_PAGINA + orders.length} de {totalFiltrado}{" "}
              {totalFiltrado === 1 ? "pedido" : "pedidos"}
              {ultimaPagina > 1 ? ` · página ${pagina} de ${ultimaPagina}` : ""}
            </p>
            {ultimaPagina > 1 && (
              <div className="flex items-center gap-2">
                {pagina > 1 && (
                  <Link
                    href={pageHref(pagina - 1)}
                    className="rounded-xl border border-gray-200 bg-white hover:border-brand-300 text-gray-600 text-sm font-medium px-4 py-2 transition"
                  >
                    ← Mais recentes
                  </Link>
                )}
                {pagina < ultimaPagina && (
                  <Link
                    href={pageHref(pagina + 1)}
                    className="rounded-xl border border-gray-200 bg-white hover:border-brand-300 text-gray-600 text-sm font-medium px-4 py-2 transition"
                  >
                    Mais antigos →
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
        </>
      )}
    </div>
  );
}
