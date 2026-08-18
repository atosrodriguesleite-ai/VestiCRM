import { db } from "./db";
import { PAID_ORDER_STATUSES } from "./orders";

/**
 * CICLO DE RECOMPRA — o sistema aprende o ritmo de CADA cliente.
 *
 * O motor antigo usava um prazo fixo para todo mundo ("comprou há 30+ dias").
 * Isso erra dos dois lados: a lojista que repõe a cada 3 semanas era cobrada
 * tarde demais (a concorrente já vendeu), e a que compra de 3 em 3 meses era
 * incomodada cedo demais — o jeito mais rápido de a vendedora perder a mão.
 *
 * Aqui o ritmo sai do histórico dela: intervalo médio entre as compras pagas.
 * Quem só comprou uma vez ainda não tem ritmo — usa a média da loja (e, se a
 * loja é nova demais para ter média, um padrão conservador).
 */

/** Sem histórico nenhum: nem da cliente, nem da loja. */
const CICLO_PADRAO_DIAS = 45;
/** Piso e teto de sanidade — protege de dado estranho (devolução, importação). */
const CICLO_MIN_DIAS = 7;
const CICLO_MAX_DIAS = 180;
/** Só cobra quando passou do ritmo dela com uma folga (evita cobrar no dia). */
const FOLGA = 1.15;
/** Sumiu de vez: acima disso vira reativação, não recompra. */
const ABANDONO_DIAS = 365;

const DIA_MS = 24 * 60 * 60 * 1000;

export type ClienteNaHora = {
  customerId: string;
  /** dias desde a última compra */
  diasSemComprar: number;
  /** ritmo aprendido (ou herdado da loja) */
  cicloDias: number;
  /** true quando o ritmo veio do histórico DELA, não da média da loja */
  ritmoProprio: boolean;
  ultimaCompra: Date;
};

type Agregado = {
  customerId: string | null;
  _min: { paidAt: Date | null };
  _max: { paidAt: Date | null };
  _count: number;
};

/**
 * Intervalo médio entre compras, em dias. Null quando não dá para saber
 * (uma compra só não revela ritmo nenhum).
 *
 * Exportada pura de propósito: é a conta que decide QUANDO a cliente é
 * chamada. Errar para menos é incomodar quem acabou de comprar; errar para
 * mais é perder a venda para a concorrente. Fica travada por teste.
 */
export function cicloEntreCompras(
  primeira: Date | null,
  ultima: Date | null,
  quantidade: number
): number | null {
  if (quantidade < 2 || !primeira || !ultima) return null;
  const dias =
    (ultima.getTime() - primeira.getTime()) / DIA_MS / (quantidade - 1);
  if (!Number.isFinite(dias) || dias <= 0) return null;
  return Math.min(Math.max(dias, CICLO_MIN_DIAS), CICLO_MAX_DIAS);
}

/** Já passou do ritmo dela (com a folga que evita cobrar no dia exato)? */
export function passouDoRitmo(diasSemComprar: number, cicloDias: number): boolean {
  return diasSemComprar >= cicloDias * FOLGA;
}

function cicloDe(a: Agregado): number | null {
  return cicloEntreCompras(a._min.paidAt, a._max.paidAt, a._count);
}

/**
 * Clientes da loja que já passaram do próprio ritmo de compra.
 *
 * Uma consulta só (agrupa os pedidos pagos por cliente e calcula min/max/qtd),
 * então serve tanto para a tela "Quem chamar hoje" quanto para a rodada
 * diária sem pesar.
 */
export async function clientesNaHoraDeComprar(
  companyId: string,
  opts?: { ownerId?: string | null }
): Promise<ClienteNaHora[]> {
  const compras = (await db.order.groupBy({
    by: ["customerId"],
    where: {
      companyId,
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { not: null },
      ...(opts?.ownerId ? { customer: { ownerId: opts.ownerId } } : {}),
    },
    _min: { paidAt: true },
    _max: { paidAt: true },
    _count: true,
  })) as unknown as Agregado[];

  if (compras.length === 0) return [];

  // média da loja = referência para quem só comprou uma vez
  const ciclos = compras.map(cicloDe).filter((c): c is number => c != null);
  const cicloDaLoja = ciclos.length
    ? ciclos.reduce((s, c) => s + c, 0) / ciclos.length
    : CICLO_PADRAO_DIAS;

  const agora = Date.now();
  const naHora: ClienteNaHora[] = [];

  for (const c of compras) {
    if (!c.customerId || !c._max.paidAt) continue;
    const proprio = cicloDe(c);
    const ciclo = proprio ?? cicloDaLoja;
    const dias = (agora - c._max.paidAt.getTime()) / DIA_MS;
    // ainda no ritmo dela → não incomoda
    if (!passouDoRitmo(dias, ciclo)) continue;
    // sumiu faz mais de um ano → é caso de reativação, outra conversa
    if (dias > ABANDONO_DIAS) continue;
    naHora.push({
      customerId: c.customerId,
      diasSemComprar: Math.floor(dias),
      cicloDias: Math.round(ciclo),
      ritmoProprio: proprio != null,
      ultimaCompra: c._max.paidAt,
    });
  }

  // quem está mais atrasado em relação AO PRÓPRIO ritmo vem primeiro
  naHora.sort(
    (a, b) => b.diasSemComprar / b.cicloDias - a.diasSemComprar / a.cicloDias
  );
  return naHora;
}

/**
 * Aniversariantes de hoje (e dos próximos dias, se pedido).
 *
 * O ano do nascimento não entra na conta: o que importa é dia e mês. Por isso
 * a peneira é feita no servidor — comparar mês/dia direto no banco exigiria
 * SQL cru e não compensa no volume de uma loja.
 */
export async function aniversariantes(
  companyId: string,
  opts?: { ownerId?: string | null; ateDias?: number }
): Promise<{ customerId: string; name: string; emQuantosDias: number; idade: number | null }[]> {
  const ate = opts?.ateDias ?? 0;
  const clientes = await db.customer.findMany({
    where: {
      companyId,
      birthDate: { not: null },
      ...(opts?.ownerId ? { ownerId: opts.ownerId } : {}),
    },
    select: { id: true, name: true, birthDate: true },
  });

  // "hoje" no fuso de São Paulo (o servidor roda em UTC)
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hojeMes = agora.getUTCMonth();
  const hojeDia = agora.getUTCDate();
  const anoAtual = agora.getUTCFullYear();

  const achados: { customerId: string; name: string; emQuantosDias: number; idade: number | null }[] = [];
  for (const c of clientes) {
    if (!c.birthDate) continue;
    const mes = c.birthDate.getUTCMonth();
    const dia = c.birthDate.getUTCDate();
    // distância em dias até o próximo aniversário (só olhamos alguns dias)
    let emDias: number | null = null;
    const bissexto = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    for (let d = 0; d <= ate; d++) {
      const alvo = new Date(Date.UTC(anoAtual, hojeMes, hojeDia + d));
      const casa =
        (alvo.getUTCMonth() === mes && alvo.getUTCDate() === dia) ||
        // nascida em 29/02: em ano comum comemora em 28/02 — sem isso ela
        // simplesmente nunca aparecia na lista (auditoria 07/08/2026)
        (mes === 1 &&
          dia === 29 &&
          !bissexto(alvo.getUTCFullYear()) &&
          alvo.getUTCMonth() === 1 &&
          alvo.getUTCDate() === 28);
      if (casa) {
        emDias = d;
        break;
      }
    }
    if (emDias == null) continue;
    const nascimento = c.birthDate.getUTCFullYear();
    achados.push({
      customerId: c.id,
      name: c.name,
      emQuantosDias: emDias,
      idade: nascimento > 1900 ? anoAtual - nascimento : null,
    });
  }
  achados.sort((a, b) => a.emQuantosDias - b.emQuantosDias);
  return achados;
}

// ---- A ABA "RECOMPRA" (tela própria) ---------------------------------------
//
// A esteira acima decide QUEM está na hora (agenda). A aba mostra a loja
// inteira POR ESTÁGIO, as VIPs e quem cutucar hoje — com a mensagem pronta.
// Nada sai sozinho: a vendedora dispara (decisão do dono — recompra pede
// contexto humano; robô aqui soa frio).

import { catalogUrl } from "./catalog-url";
import type { Faixa } from "./recompra-textos";
export * from "./recompra-textos";
import { ownedScope } from "./scope";
import type { SessionUser } from "./auth";

/** Faixa fixa pela última compra — o estágio de quem ainda não tem ritmo. */
export function faixaFixa(diasDesdeUltima: number): Faixa {
  if (diasDesdeUltima < 30) return "ATIVA";
  if (diasDesdeUltima < 60) return "ESFRIANDO";
  if (diasDesdeUltima < 90) return "RISCO";
  return "SUMIDA";
}

/** As 20 maiores compradoras ganham selo VIP (escolha do dono: Top 20 fixo). */
export const TOP_VIPS = 20;
/** Produto que entrou no catálogo há menos de 14 dias conta como novidade. */
const NOVIDADE_DIAS = 14;

export type ClienteDeRecompra = {
  id: string;
  name: string;
  phone: string;
  total: number;
  compras: number;
  ultimaCompra: string;
  diasDesde: number;
  cicloDias: number | null;
  faixa: Faixa;
  passouDoPonto: boolean;
  vip: number | null; // posição no Top 20 (1 = maior compradora)
  categoriaTop: string | null;
  aniversarioMes: boolean;
};

export type DadosDaAbaRecompra = {
  clientes: ClienteDeRecompra[];
  novidades: { categoria: string; produtos: number }[];
  catalogLink: string;
  mesAtual: string;
};

/** Monta tudo que a aba Recompra mostra (carteira da vendedora; loja p/ gerente). */
export async function dadosDaAbaRecompra(user: SessionUser): Promise<DadosDaAbaRecompra> {
  const agora = new Date();
  const [clientesRaw, company, novidadesRaw] = await Promise.all([
    db.customer.findMany({
      where: { ...ownedScope(user) },
      select: {
        id: true,
        name: true,
        phone: true,
        birthDate: true,
        orders: {
          where: { status: { in: PAID_ORDER_STATUSES }, paidAt: { not: null } },
          select: {
            netTotal: true,
            paidAt: true,
            items: { select: { quantity: true, product: { select: { category: true } } } },
          },
        },
      },
    }),
    db.company.findUnique({ where: { id: user.companyId }, select: { slug: true } }),
    db.product.findMany({
      where: {
        companyId: user.companyId,
        active: true,
        createdAt: { gt: new Date(agora.getTime() - NOVIDADE_DIAS * DIA_MS) },
      },
      select: { category: true },
    }),
  ]);

  const mesAtual = agora.toLocaleDateString("pt-BR", {
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
  const mesNumero = Number(
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "numeric" }).format(
      agora
    )
  );

  const compradoras: ClienteDeRecompra[] = clientesRaw
    .filter((c) => c.orders.some((o) => o.paidAt))
    .map((c) => {
      const datas = c.orders
        .map((o) => o.paidAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime());
      const ultima = datas[datas.length - 1];
      const diasDesde = Math.floor((agora.getTime() - ultima.getTime()) / DIA_MS);
      // MESMA régua do motor da agenda (cicloEntreCompras/passouDoRitmo):
      // duas telas discordando de "quem está na hora" seria veneno
      const ciclo = cicloEntreCompras(datas[0], ultima, datas.length);
      const porCategoria = new Map<string, number>();
      for (const o of c.orders)
        for (const i of o.items) {
          const cat = i.product?.category?.trim();
          if (cat) porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + i.quantity);
        }
      const categoriaTop =
        [...porCategoria.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        total: c.orders.reduce((s, o) => s + o.netTotal, 0),
        compras: datas.length,
        ultimaCompra: ultima.toISOString(),
        diasDesde,
        cicloDias: ciclo ? Math.round(ciclo) : null,
        faixa: faixaFixa(diasDesde),
        passouDoPonto: ciclo != null && passouDoRitmo(diasDesde, ciclo),
        vip: null,
        categoriaTop,
        aniversarioMes: !!c.birthDate && c.birthDate.getUTCMonth() + 1 === mesNumero,
      };
    });

  // Top 20 pelo valor comprado (empate: quem comprou mais vezes primeiro)
  [...compradoras]
    .sort((a, b) => b.total - a.total || b.compras - a.compras)
    .slice(0, TOP_VIPS)
    .forEach((c, i) => {
      c.vip = i + 1;
    });

  const porCat = new Map<string, number>();
  for (const p of novidadesRaw) {
    const cat = p.category?.trim();
    if (cat) porCat.set(cat, (porCat.get(cat) ?? 0) + 1);
  }

  return {
    // quem passou do próprio ponto primeiro; depois as maiores
    clientes: compradoras.sort(
      (a, b) => Number(b.passouDoPonto) - Number(a.passouDoPonto) || b.total - a.total
    ),
    novidades: [...porCat.entries()]
      .map(([categoria, produtos]) => ({ categoria, produtos }))
      .sort((a, b) => b.produtos - a.produtos),
    catalogLink: catalogUrl(company?.slug ?? ""),
    mesAtual,
  };
}
