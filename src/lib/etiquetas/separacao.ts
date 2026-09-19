import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import { orderScope } from "../scope";
import { orderNumber, orderStatusLabel } from "../orders";
import { sincronizarPedidoSemQuebrar } from "../financeiro/porta-vendas";
import {
  aplicarBipe,
  avaliarBipe,
  conciliarContagens,
  declararFalta,
  lerItensDaSeparacao,
  mesclarComGravado,
  podeConcluir,
  resumoDaSeparacao,
  type ItemDaSeparacao,
  type ResultadoDoBipe,
  STATUS_NA_FILA,
} from "./separacao-regra";

export { STATUS_NA_FILA };


export type PedidoNaFila = {
  id: string;
  numero: string;
  cliente: string;
  vendedora: string | null;
  pecas: number;
  status: string;
  pagoEm: Date | null;
  /** separação em andamento: quem e desde quando */
  emAndamento: { quem: string; desde: Date } | null;
  separadoEm: Date | null;
};

/** Teto da fila: acima disso a tela DIZ que cortou (nunca esconde em silêncio). */
export const TETO_DA_FILA = 500;

/**
 * A FILA DE SEPARAÇÃO (RN-060): todo pedido pago que ainda não foi separado,
 * do mais antigo para o mais novo (pela data do pagamento), com quem está
 * separando agora; e os separados nos últimos dias, para conferência.
 * Respeita a visibilidade de pedidos (RN-007): vendedora vê os dela.
 * Pedido sem nenhuma peça não entra (não há o que separar).
 */
export async function filaDeSeparacao(
  user: SessionUser
): Promise<{ aSeparar: PedidoNaFila[]; separados: PedidoNaFila[]; cortada: boolean }> {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const selecao = {
    id: true,
    number: true,
    status: true,
    paidAt: true,
    createdAt: true,
    separadoEm: true,
    customer: { select: { name: true } },
    seller: { select: { name: true } },
    items: { select: { quantity: true } },
    separacoes: {
      where: { concluidaEm: null, descartadaEm: null },
      select: { iniciadaEm: true, user: { select: { name: true } } },
      take: 1,
    },
  } as const;
  const baseWhere = { ...orderScope(user), status: { in: [...STATUS_NA_FILA] }, items: { some: {} } };
  const [aSeparar, totalASeparar, separados] = await Promise.all([
    db.order.findMany({
      where: { ...baseWhere, separadoEm: null },
      select: selecao,
      // pago sem carimbo de data (pedido antigo) é o mais antigo de todos:
      // NULL primeiro, senão ele caía no fim da fila
      orderBy: [{ paidAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      take: TETO_DA_FILA,
    }),
    db.order.count({ where: { ...baseWhere, separadoEm: null } }),
    // separados: SÓ pelo carimbo — o pedido separado de manhã e enviado à
    // tarde continua na conferência (o filtro de status o sumia)
    db.order.findMany({
      where: { ...orderScope(user), separadoEm: { gte: desde } },
      select: selecao,
      orderBy: { separadoEm: "desc" },
      take: 100,
    }),
  ]);
  const linha = (p: (typeof aSeparar)[number]): PedidoNaFila => ({
    id: p.id,
    numero: orderNumber(p.number),
    cliente: p.customer.name,
    vendedora: p.seller?.name ?? null,
    pecas: p.items.reduce((s, i) => s + i.quantity, 0),
    status: orderStatusLabel[p.status] ?? p.status,
    pagoEm: p.paidAt,
    emAndamento: p.separacoes[0] ? { quem: p.separacoes[0].user?.name ?? "alguém", desde: p.separacoes[0].iniciadaEm } : null,
    separadoEm: p.separadoEm,
  });
  return { aSeparar: aSeparar.map(linha), separados: separados.map(linha), cortada: totalASeparar > aSeparar.length };
}

export type EstadoDaSeparacao = {
  orderId: string;
  numero: string;
  cliente: string;
  itens: ItemDaSeparacao[];
  /** quem está separando (pode ser outra pessoa — a tela avisa) */
  quem: { id: string | null; nome: string; desde: Date } | null;
  jaSeparadoEm: Date | null;
  /** peças do pedido sem variação (apagada do cadastro): não dá para bipar */
  semCodigo: { rotulo: string; quantidade: number }[];
};

/** Os itens do pedido no formato da separação, com o código de cada variação. */
async function itensDoPedido(
  tx: Prisma.TransactionClient | typeof db,
  orderId: string
): Promise<{ itens: ItemDaSeparacao[]; semCodigo: EstadoDaSeparacao["semCodigo"] }> {
  const linhas = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      variantId: true,
      name: true,
      color: true,
      size: true,
      quantity: true,
      variant: { select: { barcode: true, color: true, size: true } },
    },
    orderBy: { name: "asc" },
  });
  // a MESMA variação em duas linhas do pedido é uma só na separação
  const porVariacao = new Map<string, ItemDaSeparacao>();
  const semCodigo: EstadoDaSeparacao["semCodigo"] = [];
  for (const l of linhas) {
    if (!l.variantId || !l.variant?.barcode) {
      semCodigo.push({ rotulo: [l.name, l.color, l.size].filter(Boolean).join(" · "), quantidade: l.quantity });
      continue;
    }
    const atual = porVariacao.get(l.variantId);
    if (atual) {
      atual.pedida += l.quantity;
      continue;
    }
    porVariacao.set(l.variantId, {
      variantId: l.variantId,
      rotulo: l.name,
      detalhe: [l.variant.color ?? l.color, l.variant.size ?? l.size].filter(Boolean).join(" · "),
      codigo: l.variant.barcode,
      pedida: l.quantity,
      bipada: 0,
      falta: 0,
    });
  }
  return { itens: [...porVariacao.values()], semCodigo };
}

/**
 * O ESTADO da separação de um pedido (só leitura): as peças com o código
 * de cada uma, mescladas com o andamento gravado, e quem está separando.
 * Abrir a tela NÃO cria nada — a separação ativa nasce no PRIMEIRO BIPE
 * (a gerente que abre o pedido só para olhar não vira "em separação por"
 * na fila de todo mundo, achado da revisão).
 */
export async function estadoDaSeparacao(user: SessionUser, orderId: string): Promise<EstadoDaSeparacao | { erro: string }> {
  const pedido = await db.order.findFirst({
    where: { ...orderScope(user), id: orderId },
    select: { id: true, number: true, status: true, separadoEm: true, customer: { select: { name: true } } },
  });
  if (!pedido) return { erro: "Pedido não encontrado." };
  if (!(STATUS_NA_FILA as readonly string[]).includes(pedido.status)) {
    return { erro: `Só se separa pedido pago que ainda está na loja (este está "${orderStatusLabel[pedido.status] ?? pedido.status}").` };
  }
  const { itens, semCodigo } = await itensDoPedido(db, orderId);
  if (itens.length === 0 && semCodigo.length === 0) return { erro: "Este pedido não tem nenhuma peça — não há o que separar." };
  const ativa = await db.separacao.findFirst({
    where: { companyId: user.companyId, orderId, concluidaEm: null, descartadaEm: null },
    select: { userId: true, iniciadaEm: true, itens: true, user: { select: { name: true } } },
  });
  return {
    orderId,
    numero: orderNumber(pedido.number),
    cliente: pedido.customer.name,
    itens: ativa ? mesclarComGravado(itens, lerItensDaSeparacao(ativa.itens)) : itens,
    quem: ativa ? { id: ativa.userId, nome: ativa.user?.name ?? "alguém", desde: ativa.iniciadaEm } : null,
    jaSeparadoEm: pedido.separadoEm,
    semCodigo,
  };
}

/**
 * Trava por pedido dentro da transação: dois bipes ao mesmo tempo entram um
 * de cada vez. A porta de edição do pedido toma a MESMA trava ao trocar o
 * status — sem isso o primeiro bipe (que ainda vai criar a separação) e o
 * descarte do rascunho se cruzavam, e o rascunho nascia depois do descarte
 * (achado da revisão).
 */
export async function travarPedido(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`;
}

/**
 * A SEPARAÇÃO EM ANDAMENTO, lida DENTRO da transação e da trava: o pedido
 * tem que continuar na fila (cancelado ou devolvido a orçamento no meio
 * não aceita bipe nem conclusão — achado da revisão), e as peças são as de
 * AGORA do pedido, mescladas com a contagem gravada. NÃO cria nada: a
 * separação ativa nasce só no primeiro bipe ACEITO (`garantirAtiva`) — a
 * criada aqui ficava viva quando o bipe era recusado, e uma aba velha
 * abria uma separação nova por cima da concluída (achado da revisão,
 * reproduzido no Postgres).
 *
 * O CARIMBO VISTO: a tela manda o `separadoEm` que carregou; se o do banco
 * é outro, alguém concluiu em outra tela — esta não bipa por cima, e a
 * resposta diz isso (`motivo: "concluida-fora"`).
 */
export type RecusaDaSeparacao = { erro: string; motivo?: "concluida-fora" };
type SeparacaoAberta =
  | RecusaDaSeparacao
  | {
      ativa: { id: string; userId: string | null; itens: string } | null;
      doPedido: ItemDaSeparacao[];
      itens: ItemDaSeparacao[];
      semCodigo: EstadoDaSeparacao["semCodigo"];
    };
async function separacaoAberta(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  orderId: string,
  carimboVisto: string | null | undefined
): Promise<SeparacaoAberta> {
  const pedido = await tx.order.findFirst({ where: { id: orderId, companyId: user.companyId }, select: { status: true, separadoEm: true } });
  if (!pedido || !(STATUS_NA_FILA as readonly string[]).includes(pedido.status)) {
    return { erro: `Este pedido não está mais na fila (está "${pedido ? orderStatusLabel[pedido.status] ?? pedido.status : "apagado"}"). Nada foi registrado.` };
  }
  if (carimboVisto !== undefined && (pedido.separadoEm?.toISOString() ?? null) !== carimboVisto) {
    return { erro: "Este pedido já foi concluído em outra tela. Nada daqui foi registrado por cima.", motivo: "concluida-fora" };
  }
  const { itens: doPedido, semCodigo } = await itensDoPedido(tx, orderId);
  const ativa = await tx.separacao.findFirst({
    where: { companyId: user.companyId, orderId, concluidaEm: null, descartadaEm: null },
    select: { id: true, userId: true, itens: true },
  });
  return { ativa, doPedido, itens: ativa ? mesclarComGravado(doPedido, lerItensDaSeparacao(ativa.itens)) : doPedido, semCodigo };
}

/** A separação ativa nasce aqui, sob a trava do pedido (o índice parcial é a segunda tranca). */
async function garantirAtiva(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  orderId: string,
  aberta: Exclude<SeparacaoAberta, RecusaDaSeparacao>
): Promise<{ id: string }> {
  if (aberta.ativa) return aberta.ativa;
  return tx.separacao.create({
    data: { companyId: user.companyId, orderId, userId: user.id, itens: JSON.stringify(aberta.doPedido) },
    select: { id: true },
  });
}

/**
 * REGISTRAR UM BIPE no servidor (a segunda tranca, RN-060): a mesma regra
 * do navegador, sobre o que está gravado. Quem bipa vira o responsável da
 * separação ativa (assume).
 */
export async function registrarBipe(
  user: SessionUser,
  orderId: string,
  codigo: string,
  carimboVisto?: string | null
): Promise<ResultadoDoBipe | RecusaDaSeparacao> {
  const pedido = await db.order.findFirst({ where: { ...orderScope(user), id: orderId }, select: { id: true } });
  if (!pedido) return { erro: "Pedido não encontrado." };
  return db.$transaction(async (tx) => {
    await travarPedido(tx, orderId);
    const aberta = await separacaoAberta(tx, user, orderId, carimboVisto);
    if ("erro" in aberta) return aberta;
    const r = avaliarBipe(aberta.itens, codigo);
    if (r.aceito) {
      const ativa = await garantirAtiva(tx, user, orderId, aberta);
      await tx.separacao.update({
        where: { id: ativa.id },
        data: { itens: JSON.stringify(aplicarBipe(aberta.itens, r)), userId: user.id },
      });
    }
    return r;
  });
}

/** Declarar FALTA numa linha (não tinha a peça): fica gravado e a conclusão passa a ser possível. */
export async function registrarFalta(
  user: SessionUser,
  orderId: string,
  variantId: string,
  falta: number,
  carimboVisto?: string | null
): Promise<{ ok: true } | RecusaDaSeparacao> {
  const pedido = await db.order.findFirst({ where: { ...orderScope(user), id: orderId }, select: { id: true } });
  if (!pedido) return { erro: "Pedido não encontrado." };
  return db.$transaction(async (tx) => {
    await travarPedido(tx, orderId);
    const aberta = await separacaoAberta(tx, user, orderId, carimboVisto);
    if ("erro" in aberta) return aberta;
    if (!aberta.itens.some((i) => i.variantId === variantId)) return { erro: "Essa peça não está no pedido." };
    const itens = declararFalta(aberta.itens, variantId, falta);
    const ativa = await garantirAtiva(tx, user, orderId, aberta);
    await tx.separacao.update({ where: { id: ativa.id }, data: { itens: JSON.stringify(itens), userId: user.id } });
    return { ok: true };
  });
}

/**
 * CONCLUIR: só com TODA linha fechada (bipada + falta = pedida). A contagem
 * que vale é a do SERVIDOR (cada bipe confirmado pela segunda tranca); do
 * navegador entra só a falta declarada. Carimba `Order.separadoEm`, muda o
 * status para SEPARAÇÃO (condicionado ao status atual: pago ou em
 * produção) e escreve no histórico do pedido QUEM separou e o que faltou.
 * Falta avisa a vendedora do pedido (sem dona, a gerência) no sino — pacote
 * sai incompleto e alguém precisa falar com a cliente.
 */
export async function concluirSeparacao(
  user: SessionUser,
  orderId: string,
  faltas: { variantId: string; falta: number }[],
  carimboVisto?: string | null,
  /** a porta do Financeiro roda no `after()` do Next; o script de prova (fora de request) passa a dele */
  avisarFinanceiro: (orderId: string) => void = sincronizarPedidoSemQuebrar
): Promise<{ ok: true; faltas: number; pecas: number; proximo: { id: string; numero: string; cliente: string } | null } | RecusaDaSeparacao> {
  const pedido = await db.order.findFirst({
    where: { ...orderScope(user), id: orderId },
    select: { id: true, number: true, status: true, sellerId: true, companyId: true, customer: { select: { name: true } } },
  });
  if (!pedido) return { erro: "Pedido não encontrado." };
  const resultado = await db.$transaction(async (tx) => {
    await travarPedido(tx, orderId);
    const aberta = await separacaoAberta(tx, user, orderId, carimboVisto);
    if ("erro" in aberta) return aberta;
    const { semCodigo } = aberta;
    const itens = conciliarContagens(aberta.itens, faltas);
    if (!podeConcluir(itens, semCodigo.length)) {
      const r = resumoDaSeparacao(itens);
      return {
        erro:
          r.faltamBipar > 0
            ? `O servidor confirmou ${r.bipadas} de ${r.pedidas} peças; ainda faltam ${r.faltamBipar}. Bipe o que falta ou declare a falta na linha.`
            : "Este pedido não tem peça para conferir.",
      } as const;
    }
    const r = resumoDaSeparacao(itens);
    const agora = new Date();
    // O CARIMBO É CONDICIONADO AO STATUS, no mesmo comando: a tela do
    // pedido não passa pela trava desta separação, então entre a leitura
    // lá em cima e esta escrita o pedido pode ter sido cancelado — e aí
    // nada aqui pode ficar gravado (achado da revisão). Zero linhas =
    // desiste antes de escrever qualquer coisa.
    const carimbo = await tx.order.updateMany({
      where: { id: orderId, companyId: user.companyId, status: { in: [...STATUS_NA_FILA] } },
      data: { separadoEm: agora },
    });
    if (carimbo.count === 0) return { erro: "O pedido saiu da fila enquanto você separava (cancelado ou enviado). Nada foi registrado." } as const;
    // sem bipe nenhum (pedido conferido na mão) a separação nasce e fecha aqui
    const ativa = await garantirAtiva(tx, user, orderId, aberta);
    await tx.separacao.update({
      where: { id: ativa.id },
      data: { itens: JSON.stringify(itens), faltas: r.faltas, concluidaEm: agora, userId: user.id },
    });
    // status: só de PAGO/EM_PRODUCAO para SEPARACAO (condicionado — a
    // corrida com a tela do pedido não passa por cima de um status novo);
    // e a troca de status entra no histórico como toda troca
    const mudouStatus = await tx.order.updateMany({
      where: { id: orderId, status: { in: ["PAGO", "EM_PRODUCAO"] } },
      data: { status: "SEPARACAO" },
    });
    if (mudouStatus.count > 0) {
      await tx.orderEvent.create({
        data: { orderId, type: "STATUS", description: `Status alterado para "${orderStatusLabel.SEPARACAO}" por ${user.name}`, userId: user.id },
      });
    }
    const faltasTexto = itens
      .filter((i) => i.falta > 0)
      .map((i) => `${i.falta}× ${i.rotulo} ${i.detalhe}`.trim())
      .join("; ");
    const naMao = semCodigo.length > 0 ? ` ${semCodigo.reduce((t, x) => t + x.quantidade, 0)} peça(s) sem código conferida(s) na mão.` : "";
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "SEPARACAO",
        description:
          `Separado com leitor por ${user.name}: ${r.bipadas} de ${r.pedidas} peças bipadas` +
          (r.faltas > 0 ? `. FALTOU: ${faltasTexto}` : ".") +
          naMao,
        userId: user.id,
      },
    });
    if (r.faltas > 0) {
      const destinos = pedido.sellerId
        ? [pedido.sellerId]
        : (await tx.user.findMany({ where: { companyId: pedido.companyId, role: { in: ["ADMIN", "MANAGER"] }, active: true }, select: { id: true } })).map((u) => u.id);
      if (destinos.length > 0) {
        await tx.notification.createMany({
          data: destinos.map((userId) => ({
            companyId: pedido.companyId,
            userId,
            type: "PEDIDO",
            title: `Pedido ${orderNumber(pedido.number)} separado com FALTA`,
            body: `${pedido.customer.name}: faltou ${faltasTexto}. Combine com a cliente antes de enviar.`,
            orderId,
          })),
        });
      }
    }
    return { ok: true, faltas: r.faltas, pecas: r.bipadas } as const;
  }, { timeout: 15_000 });
  if (!("ok" in resultado)) return resultado;
  // MODO BANCADA: quem separa 40 pedidos por dia não volta para a lista a
  // cada um — a resposta já diz qual é o próximo da fila: o mais antigo que
  // NINGUÉM MAIS está separando (abrir sozinho o pedido da colega faria o
  // primeiro bipe assumir a separação dela — achado da revisão). Uma
  // consulta só, com o recorte de quem vê (RN-007).
  const proximo = await db.order.findFirst({
    where: {
      ...orderScope(user),
      id: { not: orderId },
      status: { in: [...STATUS_NA_FILA] },
      separadoEm: null,
      items: { some: {} },
      separacoes: { none: { concluidaEm: null, descartadaEm: null, userId: { not: user.id } } },
    },
    select: { id: true, number: true, customer: { select: { name: true } } },
    orderBy: [{ paidAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  const saida = { ...resultado, proximo: proximo ? { id: proximo.id, numero: orderNumber(proximo.number), cliente: proximo.customer.name } : null };
  // toda transição de status passa pela porta do Financeiro (RN-033) — de
  // pago para separação ela não muda dinheiro, mas a régua é "toda"
  avisarFinanceiro(orderId);
  return saida;
}

/**
 * O PEDIDO MUDOU DEPOIS DE SEPARADO → volta para a fila. Chamado pela porta
 * de edição do pedido quando o PACOTE muda (variação × quantidade; só preço
 * não conta) e pelas portas que o fazem VOLTAR a ser pago (reaberto de
 * cancelado/orçamento, Pix do gateway): o pacote separado ontem não é mais o
 * pedido de hoje, e sem isso ele sumia da fila como se estivesse pronto
 * (achado da revisão). Só mexe em quem tem o carimbo; o histórico da
 * separação anterior fica.
 */
export async function desfazerCarimboDeSeparacao(tx: Prisma.TransactionClient | typeof db, companyId: string, orderId: string): Promise<void> {
  await tx.order.updateMany({ where: { id: orderId, companyId, separadoEm: { not: null } }, data: { separadoEm: null } });
}

/**
 * O PEDIDO SAIU DA FILA com a separação em andamento (cancelado, devolvido
 * a orçamento ou a aguardando pagamento): o rascunho é DESCARTADO — as
 * peças voltaram para a arara e "2 de 5 bipadas" não vale mais. Ao voltar
 * a pago, a separação recomeça do zero (pergunta do dono, 19/09/2026:
 * "pago → orçamento → pago de novo não pode duplicar" — não duplica: a
 * fila é derivada do pedido, uma linha por pedido; o que muda é que o
 * rascunho velho não volta). A linha fica, carimbada, para o histórico.
 */
export async function descartarSeparacaoAtiva(tx: Prisma.TransactionClient | typeof db, companyId: string, orderId: string): Promise<void> {
  await tx.separacao.updateMany({
    where: { companyId, orderId, concluidaEm: null, descartadaEm: null },
    data: { descartadaEm: new Date() },
  });
}
