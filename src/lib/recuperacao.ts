import { db } from "./db";
import { PAID_ORDER_STATUSES } from "./orders";
import { findCustomerByPhone } from "./intake";
import { sendMessage } from "./comm/engine";
import { loadConn } from "./nuvemshop";
import { catalogUrl } from "./catalog-url";

/**
 * RECUPERAÇÃO DE CARRINHOS — o motor da tela "Recuperação".
 *
 * A cliente encheu a sacola e não enviou. Esse dinheiro ficava parado num
 * número da Inteligência; agora vira uma ESTEIRA de trabalho:
 *
 *   NOVO → CHAMADA → RECUPERADO / PERDIDO
 *
 * De onde vêm os carrinhos:
 *  • CATÁLOGO: sessão de navegação que pôs peça na sacola e não enviou o
 *    pedido em 1h (Tracking Engine já grava tudo; aqui só vira carrinho).
 *  • NUVEMSHOP: checkouts abandonados, buscados pela API da loja conectada.
 *
 * Como roda: DE CARONA no tráfego (mesma técnica do vigia em lib/health.ts),
 * com trava atômica — SEM cron novo (Vercel Hobby: 2 crons, e um 3º bloqueia
 * TODOS os deploys em silêncio; já causou incidente).
 *
 * 1ª mensagem automática (Company.recoveryAuto, nasce DESLIGADA): sai 2h
 * depois do abandono, só em horário comercial, pela Communication Engine —
 * que já aplica o ritmo humano anti-bloqueio do WhatsApp. Uma por carrinho,
 * nunca mais que isso: insistência é trabalho de gente, não de robô.
 */

/** Item da sacola abandonada (JSON em AbandonedCart.items). */
export type ItemDoCarrinho = {
  productId?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  qty: number;
  price?: number | null;
};

const HORA_MS = 60 * 60 * 1000;
/** sem mexer na sacola há 1h = abandonou */
const ABANDONO_MS = 1 * HORA_MS;
/** a 1ª mensagem automática espera 2h (a cliente pode só ter ido jantar) */
const ESPERA_AUTO_MS = 2 * HORA_MS;
/** carrinho mais velho que isso não entra (mensagem tardia soa a spam) */
const JANELA_DIAS = 14;
/** a varredura roda no máximo a cada 10 min */
const VARREDURA_INTERVAL_MS = 10 * 60_000;

/** Horário decente para mensagem automática (8h–20h de São Paulo). */
export function horarioComercialSP(agora = new Date()): boolean {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(agora)
  );
  return hora >= 8 && hora < 20;
}

/**
 * A FOTO DA SACOLA gravada no próprio evento (meta.sacola) — a fonte boa.
 * O catálogo grava o estado real da sacola a cada mexida; remontar por
 * eventos agregados errava tamanho ("P,M"), quantidade e preço.
 */
export function sacolaDaFoto(meta: string | null | undefined): ItemDoCarrinho[] | null {
  if (!meta) return null;
  try {
    const m = JSON.parse(meta) as { sacola?: unknown };
    if (!Array.isArray(m.sacola)) return null;
    const itens = (m.sacola as Record<string, unknown>[])
      .map((i) => ({
        productId: typeof i.productId === "string" ? i.productId : null,
        name: typeof i.name === "string" ? i.name.trim() : "",
        color: typeof i.color === "string" ? i.color : null,
        size: typeof i.size === "string" ? i.size : null,
        qty: Number(i.qty ?? 0) || 0,
        price: Number(i.price ?? 0) || null,
      }))
      .filter((i) => i.name && i.qty > 0);
    return itens.length ? itens : null;
  } catch {
    return null;
  }
}

/** Reconstrói a sacola a partir dos eventos de navegação (add − remove). */
export function sacolaDosEventos(
  eventos: {
    type: string;
    productId?: string | null;
    productName?: string | null;
    color?: string | null;
    size?: string | null;
    qty?: number | null;
    value?: number | null;
  }[]
): ItemDoCarrinho[] {
  const mapa = new Map<string, ItemDoCarrinho>();
  for (const e of eventos) {
    if (e.type !== "cart_add" && e.type !== "cart_remove") continue;
    const nome = (e.productName ?? "").trim();
    if (!nome) continue;
    const chave = [e.productId ?? nome, e.color ?? "", e.size ?? ""].join("|");
    const atual =
      mapa.get(chave) ??
      ({
        productId: e.productId ?? null,
        name: nome,
        color: e.color ?? null,
        size: e.size ?? null,
        qty: 0,
        price: null,
      } as ItemDoCarrinho);
    const q = e.qty ?? 1;
    atual.qty += e.type === "cart_add" ? q : -q;
    // o evento de adicionar carrega o preço unitário quando o tracking sabe
    if (e.type === "cart_add" && typeof e.value === "number" && e.value > 0) {
      atual.price = e.value;
    }
    mapa.set(chave, atual);
  }
  return [...mapa.values()].filter((i) => i.qty > 0);
}

/** "2× Vestido Midi · Rosa · P" — o resumo humano da sacola. */
export function resumoDaSacola(itens: ItemDoCarrinho[], max = 4): string {
  const linhas = itens
    .slice(0, max)
    .map((i) =>
      [`${i.qty}× ${i.name}`, i.color, i.size].filter(Boolean).join(" · ")
    );
  const resto = itens.length - max;
  if (resto > 0) linhas.push(`e mais ${resto} ite${resto === 1 ? "m" : "ns"}…`);
  return linhas.join("\n");
}

/**
 * A MENSAGEM DE RECUPERAÇÃO — com o link que REMONTA a sacola.
 *
 * O link leva o id do carrinho (?sacola=): a cliente cai no catálogo com as
 * peças já dentro, só confirmar. Para a Nuvemshop, vale o link de retomada
 * da própria plataforma (quando ela fornece).
 */
export function mensagemDeRecuperacao(
  cart: {
    id: string;
    source: string;
    items: string;
    checkoutUrl: string | null;
  },
  slugDaLoja: string,
  nomeDaCliente?: string | null
): string {
  const primeiro = (nomeDaCliente ?? "").trim().split(/\s+/)[0];
  const itens = lerItens(cart.items);
  const pecas = resumoDaSacola(itens);
  const link =
    cart.source === "NUVEMSHOP"
      ? cart.checkoutUrl
      : `${catalogUrl(slugDaLoja)}?sacola=${cart.id}`;
  return [
    `Oi${primeiro ? ` ${primeiro}` : ""}! 💛 Vi que você separou umas peças e não finalizou:`,
    pecas,
    link
      ? `Deixei sua sacola prontinha — é só tocar aqui para terminar o pedido:\n${link}`
      : "Quer que eu finalize seu pedido por aqui mesmo?",
    "Qualquer dúvida de tamanho ou cor, me chama! 😉",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function lerItens(json: string): ItemDoCarrinho[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as ItemDoCarrinho[]) : [];
  } catch {
    return [];
  }
}

// ---- Varredura (de carona no tráfego) --------------------------------------

/** Trava atômica: uma rodada por intervalo, sem corrida entre requisições. */
async function pegouAVez(agora: Date): Promise<boolean> {
  await db.systemHealth
    .createMany({ data: [{ id: "recuperacao" }], skipDuplicates: true })
    .catch(() => {});
  const r = await db.systemHealth.updateMany({
    where: {
      id: "recuperacao",
      OR: [
        { watchdogRunAt: null },
        { watchdogRunAt: { lt: new Date(agora.getTime() - VARREDURA_INTERVAL_MS) } },
      ],
    },
    data: { watchdogRunAt: agora },
  });
  return r.count > 0;
}

/** Roda a varredura se deu a hora. NUNCA lança (roda de carona em rota viva). */
export async function varrerCarrinhosSeDeuAHora(): Promise<void> {
  try {
    const agora = new Date();
    if (!(await pegouAVez(agora))) return;

    const empresas = await db.company.findMany({
      select: { id: true, slug: true, recoveryAuto: true },
    });
    for (const c of empresas) {
      await carrinhosDoCatalogo(c.id).catch(() => {});
      await carrinhosDaNuvemshop(c.id).catch(() => {});
      await marcarRecuperados(c.id).catch(() => {});
      if (c.recoveryAuto && horarioComercialSP(agora)) {
        await enviarPrimeiraMensagem(c.id, c.slug).catch(() => {});
      }
    }
  } catch {
    /* a varredura nunca pode derrubar a rota que deu a carona */
  }
}

/** Sessões do catálogo que encheram a sacola e pararam → viram carrinho. */
async function carrinhosDoCatalogo(companyId: string): Promise<void> {
  const agora = Date.now();
  const sessoes = await db.trackSession.findMany({
    where: {
      companyId,
      converted: false,
      cartAdds: { gt: 0 },
      cartValue: { gt: 0 },
      lastEventAt: {
        lt: new Date(agora - ABANDONO_MS),
        gt: new Date(agora - JANELA_DIAS * 24 * HORA_MS),
      },
      abandonedCart: null, // ainda não virou carrinho
    },
    select: {
      id: true,
      visitorId: true,
      customerId: true,
      cartValue: true,
      startedAt: true,
      lastEventAt: true,
    },
    take: 100,
  });
  if (sessoes.length === 0) return;

  // QUEM JÁ PEDIU NÃO É ABANDONO (auditoria 24/08/2026). A sessão em si não
  // converteu, mas a cliente voltou e ENVIOU o pedido em outra visita — ou
  // fechou pelo WhatsApp (pedido criado sem sessão nenhuma). Virar carrinho
  // aqui mandava "você esqueceu suas peças" 2h depois de a cliente pedir.
  // Conta qualquer pedido NÃO-CANCELADO criado depois da sacola: o robô não
  // pode esperar o PAGO (a mensagem sairia antes de a loja faturar).
  const conversoes = await db.trackSession.findMany({
    where: {
      companyId,
      visitorId: { in: [...new Set(sessoes.map((s) => s.visitorId))] },
      converted: true,
    },
    select: { visitorId: true, startedAt: true },
  });
  const clienteIds = [
    ...new Set(sessoes.map((s) => s.customerId).filter((v): v is string => !!v)),
  ];
  const pedidosDepois = clienteIds.length
    ? await db.order.findMany({
        where: {
          companyId,
          customerId: { in: clienteIds },
          status: { not: "CANCELADO" },
        },
        select: { customerId: true, createdAt: true },
      })
    : [];
  const resolvida = (s: (typeof sessoes)[number]) =>
    conversoes.some(
      (c) => c.visitorId === s.visitorId && c.startedAt >= s.startedAt
    ) ||
    pedidosDepois.some(
      (o) => o.customerId === s.customerId && o.createdAt > s.lastEventAt
    );

  for (const s of sessoes) {
    if (resolvida(s)) continue;
    const eventos = await db.trackEvent.findMany({
      where: { sessionId: s.id, type: { in: ["cart_add", "cart_remove"] } },
      orderBy: { createdAt: "asc" },
      select: {
        type: true, productId: true, productName: true, color: true,
        size: true, qty: true, value: true, meta: true,
      },
    });
    // 1º a FOTO do último evento (estado real); sessão antiga sem foto cai na
    // reconstrução, com a peneira do tamanho composto ("P,M" não é variante)
    const ultimaFoto = [...eventos].reverse().map((e) => sacolaDaFoto(e.meta)).find(Boolean);
    const itens = (
      ultimaFoto ?? sacolaDosEventos(eventos).filter((i) => !i.size?.includes(","))
    );
    if (itens.length === 0) continue;
    const valorDaFoto = ultimaFoto
      ? ultimaFoto.reduce((soma, i) => soma + (i.price ?? 0) * i.qty, 0)
      : 0;
    await db.abandonedCart
      .create({
        data: {
          companyId,
          source: "CATALOGO",
          trackSessionId: s.id,
          customerId: s.customerId,
          items: JSON.stringify(itens),
          value: valorDaFoto > 0 ? valorDaFoto : s.cartValue,
          abandonedAt: s.lastEventAt,
        },
      })
      .catch(() => {}); // corrida com outra varredura: o único por sessão segura
  }
}

/** Formato defensivo do checkout abandonado da Nuvemshop. */
type NsCheckout = {
  id?: number | string;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_name?: string | null;
  total?: string | number | null;
  checkout_url?: string | null;
  abandoned_checkout_url?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  products?: {
    name?: string | null;
    quantity?: number | string | null;
    price?: string | number | null;
    variant_values?: unknown;
  }[];
};

/** Traduz um checkout da Nuvemshop para os nossos itens. */
export function itensDoCheckoutNS(ck: NsCheckout): ItemDoCarrinho[] {
  return (ck.products ?? [])
    .map((p) => {
      const variantes = Array.isArray(p.variant_values)
        ? (p.variant_values as unknown[]).map(String).filter(Boolean)
        : [];
      return {
        name: (p.name ?? "").trim(),
        // a Nuvemshop não diz qual variante é cor e qual é tamanho — vão as
        // duas no rótulo, na ordem em que a loja cadastrou
        color: variantes[0] ?? null,
        size: variantes[1] ?? null,
        qty: Number(p.quantity ?? 1) || 1,
        price: Number(p.price ?? 0) || null,
      };
    })
    .filter((i) => i.name && i.qty > 0);
}

/** Checkouts abandonados da Nuvemshop → carrinhos (dedup por id). */
async function carrinhosDaNuvemshop(companyId: string): Promise<void> {
  const conn = await loadConn(companyId);
  if (!conn) return;
  const { nuvemshopEnv } = await import("./nuvemshop");
  const { apiBase } = nuvemshopEnv();
  let lista: NsCheckout[] = [];
  try {
    const res = await fetch(`${apiBase}/${conn.storeId}/checkouts?per_page=50`, {
      headers: {
        Authentication: `bearer ${conn.token}`,
        "User-Agent": "AtacadoPro (integracao@atacadopro.com)",
      },
      // Nuvemshop lenta não pode segurar a varredura inteira (a rodada dos
      // 10 min já foi consumida pela trava) — mesmo teto do vigia
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return; // loja sem o recurso/permissão: segue a vida
    const data = (await res.json().catch(() => null)) as NsCheckout[] | null;
    if (Array.isArray(data)) lista = data;
  } catch {
    return;
  }

  const corte = new Date(Date.now() - JANELA_DIAS * 24 * HORA_MS);
  for (const ck of lista) {
    const nsId = ck.id != null ? String(ck.id) : null;
    if (!nsId) continue;
    const quando = new Date(ck.updated_at ?? ck.created_at ?? Date.now());
    if (Number.isNaN(quando.getTime()) || quando < corte) continue;
    const itens = itensDoCheckoutNS(ck);
    if (itens.length === 0) continue;
    // casa a cliente pelo telefone (tolerante a 9º dígito) ou pelo e-mail
    let customerId: string | null = null;
    if (ck.contact_phone) {
      customerId = (await findCustomerByPhone(companyId, ck.contact_phone))?.id ?? null;
    }
    if (!customerId && ck.contact_email) {
      customerId =
        (
          await db.customer.findFirst({
            where: { companyId, email: ck.contact_email },
            select: { id: true },
          })
        )?.id ?? null;
    }
    await db.abandonedCart
      .upsert({
        where: { companyId_nsCheckoutId: { companyId, nsCheckoutId: nsId } },
        create: {
          companyId,
          source: "NUVEMSHOP",
          nsCheckoutId: nsId,
          customerId,
          items: JSON.stringify(itens),
          value: Number(ck.total ?? 0) || itens.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0),
          checkoutUrl: ck.abandoned_checkout_url ?? ck.checkout_url ?? null,
          abandonedAt: quando,
        },
        // já existe: só completa a cliente se ela apareceu depois
        update: { ...(customerId ? { customerId } : {}) },
      })
      .catch(() => {});
  }
}

/**
 * RECUPEROU SOZINHA: a cliente do carrinho fez um pedido PAGO depois do
 * abandono → o carrinho fecha como RECUPERADO, com o pedido amarrado.
 * É o que faz o placar de "R$ recuperados" ser verdade, não achismo.
 */
async function marcarRecuperados(companyId: string): Promise<void> {
  const abertos = await db.abandonedCart.findMany({
    where: { companyId, status: { in: ["NOVO", "CHAMADA"] }, customerId: { not: null } },
    select: { id: true, customerId: true, abandonedAt: true },
    take: 200,
  });
  // UM pedido fecha UM carrinho: a cliente que largou sacola no catálogo E
  // checkout na Nuvemshop e fez UMA compra não pode virar duas recuperações
  // (o placar dobraria — e painel que dobra número perde a confiança)
  const jaUsados = new Set(
    (
      await db.abandonedCart.findMany({
        where: { companyId, recoveredOrderId: { not: null } },
        select: { recoveredOrderId: true },
      })
    ).map((c) => c.recoveredOrderId as string)
  );
  for (const cart of abertos) {
    const pedido = await db.order.findFirst({
      where: {
        companyId,
        customerId: cart.customerId!,
        status: { in: PAID_ORDER_STATUSES },
        // JANELA de 30 dias: compra meses depois do abandono é vida normal
        // da cliente, não recuperação — creditar tudo inflava o placar
        // (auditoria 07/08/2026)
        paidAt: {
          gt: cart.abandonedAt,
          lte: new Date(cart.abandonedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
        id: { notIn: [...jaUsados] },
      },
      orderBy: { paidAt: "asc" },
      select: { id: true, paidAt: true },
    });
    if (pedido) {
      jaUsados.add(pedido.id);
      await db.abandonedCart.update({
        where: { id: cart.id },
        data: {
          status: "RECUPERADO",
          recoveredAt: pedido.paidAt ?? new Date(),
          recoveredOrderId: pedido.id,
        },
      });
    }
  }
}

/** 1ª mensagem automática — uma por carrinho, e só com cliente conhecida. */
async function enviarPrimeiraMensagem(companyId: string, slug: string): Promise<void> {
  // WhatsApp desconectado (cai toda semana): NÃO consome o carrinho. O envio
  // roda em segundo plano e a falha não volta — marcar "enviada" com a
  // conexão caída queimava o carrinho sem mensagem nenhuma.
  const conexao = await db.commSettings.findUnique({
    where: { companyId },
    select: { evolutionStatus: true },
  });
  if (conexao?.evolutionStatus !== "CONECTADO") return;
  const candidatos = await db.abandonedCart.findMany({
    where: {
      companyId,
      status: "NOVO",
      autoSentAt: null,
      customerId: { not: null },
      abandonedAt: { lt: new Date(Date.now() - ESPERA_AUTO_MS) },
    },
    include: { customer: { select: { id: true, name: true, phone: true } } },
    orderBy: { abandonedAt: "asc" }, // fila justa: a sacola mais antiga primeiro
    take: 20, // sobra para descontar os resolvidos e ainda mandar as 5
  });
  // A CLIENTE JÁ PEDIU? Então nada de "você esqueceu suas peças" — o pedido
  // pode ter nascido DEPOIS do carrinho (janela entre a varredura e as 2h de
  // espera) e por qualquer porta (catálogo, WhatsApp, manual). O carrinho
  // fica na fila HUMANA (sem carimbo de mensagem: a tela mostra o selo de
  // "automática enviada" e ele estaria mentindo) — quando o pedido for pago,
  // o marcarRecuperados fecha sozinho.
  const jaPediu = new Set<string>();
  if (candidatos.length) {
    const pedidos = await db.order.findMany({
      where: {
        companyId,
        customerId: { in: candidatos.map((c) => c.customerId as string) },
        status: { not: "CANCELADO" },
      },
      select: { customerId: true, createdAt: true },
    });
    for (const cart of candidatos) {
      if (
        pedidos.some(
          (o) => o.customerId === cart.customerId && o.createdAt > cart.abandonedAt
        )
      ) {
        jaPediu.add(cart.id);
      }
    }
  }
  const prontos = candidatos.filter((c) => !jaPediu.has(c.id)).slice(0, 5); // poucas por rodada: o ritmo anti-bloqueio agradece
  for (const cart of prontos) {
    if (!cart.customer?.phone) continue;
    // conversa da cliente: reaproveita a aberta; senão reabre/cria (na fila)
    let conv = await db.conversation.findFirst({
      where: { companyId, customerId: cart.customer.id, status: { not: "CLOSED" } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (!conv) {
      const encerrada = await db.conversation.findFirst({
        where: { companyId, customerId: cart.customer.id, status: "CLOSED" },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      conv = encerrada
        ? await db.conversation.update({
            where: { id: encerrada.id },
            data: { status: "OPEN" },
            select: { id: true },
          })
        : await db.conversation.create({
            data: {
              companyId,
              customerId: cart.customer.id,
              channel: "WHATSAPP",
              status: "OPEN",
            },
            select: { id: true },
          });
    }
    // marca ANTES de enviar: se duas rodadas correrem, ninguém manda duas
    // vezes (pior mandar duas que atrasar uma)
    const trava = await db.abandonedCart.updateMany({
      where: { id: cart.id, autoSentAt: null },
      data: { autoSentAt: new Date(), status: "CHAMADA", contactedAt: new Date() },
    });
    if (trava.count === 0) continue;
    await sendMessage({
      conversationId: conv.id,
      companyId,
      body: mensagemDeRecuperacao(cart, slug, cart.customer.name),
      kind: "TEXT",
      mediaType: "TEXT",
      authorName: "Recuperação automática",
      background: true,
    }).catch(async () => {
      // envio falhou de verdade: devolve o carrinho para a fila humana
      await db.abandonedCart.update({
        where: { id: cart.id },
        data: { status: "NOVO" },
      });
    });
  }
}


/**
 * PLACAR DA RECUPERAÇÃO — função ÚNICA, usada pela tela Recuperação e pelo
 * Painel de Recompra. Se duas telas fizessem a conta separadas, um dia iam
 * discordar — e número que não bate mata a confiança no sistema inteiro.
 *
 * Soma o que os pedidos recuperados VALERAM de verdade (netTotal do pedido
 * amarrado; sem pedido amarrado, o valor da sacola).
 */
export async function placarDeRecuperacao(
  companyId: string,
  desde: Date
): Promise<{ valor: number; vendas: number }> {
  const recuperados = await db.abandonedCart.findMany({
    where: { companyId, status: "RECUPERADO", recoveredAt: { gte: desde } },
    select: { value: true, recoveredOrderId: true },
  });
  const ids = recuperados
    .map((c) => c.recoveredOrderId)
    .filter((v): v is string => !!v);
  const pedidos = ids.length
    ? await db.order.findMany({
        where: { id: { in: ids } },
        select: { id: true, netTotal: true },
      })
    : [];
  const porPedido = new Map(pedidos.map((p) => [p.id, p.netTotal]));
  // dedup por pedido: dois carrinhos amarrados no MESMO pedido contam uma vez
  const vistos = new Set<string>();
  let valor = 0;
  let vendas = 0;
  for (const c of recuperados) {
    if (c.recoveredOrderId) {
      if (vistos.has(c.recoveredOrderId)) continue;
      vistos.add(c.recoveredOrderId);
      const pagoDeVerdade = porPedido.get(c.recoveredOrderId) ?? c.value;
      // crédito honesto: nunca mais que a SACOLA abandonada. A cliente que
      // largou R$ 300 e depois fez uma compra de R$ 5.000 não "recuperou"
      // 5.000 — recuperou a sacola. Pagou menos que a sacola? Vale o pago.
      valor += c.value > 0 ? Math.min(pagoDeVerdade, c.value) : pagoDeVerdade;
    } else {
      valor += c.value;
    }
    vendas += 1;
  }
  return { valor, vendas };
}
